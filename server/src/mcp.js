// MCP-инструменты. Тяжёлую LLM-работу делает клиент (Claude), сервер даёт данные,
// промпты, детерминированный скоринг и хранение. Ничего не уходит работодателю
// без одобрения в панели: статус approved ставится только через REST панели,
// а submit_application — единственный путь к реальной отправке и только для approved.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { computeFitScore, rankResumeMatches } from './core/scoring.js';
import { validateAnswers, unansweredQuestionIds } from './api.js';
import { lintLetter } from './core/letter-lint.js';
import { PROMPTS, letterPrompt } from './core/prompts.js';
import {
  evaluateTransitionGuards,
  inspectVacancyFsm,
  getPipelineFsmSummary,
} from './core/fsm.js';
import { createLlmClient } from './core/llm.js';

const SOURCE = 'hh.ru';

class ToolError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** Единый конверт ответа: один текстовый элемент с компактным JSON. */
const ok = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data) }] });

// .code сохраняем, чтобы клиент отличил login_required от extension_not_connected.
const fail = (err) => ({
  isError: true,
  content: [
    {
      type: 'text',
      text: JSON.stringify({
        error: { code: err?.code ?? 'internal_error', message: err?.message ?? String(err) }
      })
    }
  ]
});

// Любой throw становится { error } с isError, а не протокольной ошибкой.
const wrap = (fn) => async (args) => {
  try {
    return ok(await fn(args ?? {}));
  } catch (err) {
    return fail(err);
  }
};

/** Статус hh (текст) -> наш статус. «не просмотр» и «просмотр» дают sent, как и всё неизвестное. */
export function mapHhStatus(text) {
  const t = String(text ?? '').toLowerCase();
  // «Собеседование» — так hh.ru подписывает приглашение (видно на живой странице 2026-11-12).
  if (t.includes('приглаш') || t.includes('собесед')) return 'invited';
  if (t.includes('отказ')) return 'rejected';
  return 'sent';
}

// Статусы, которые «sent» из синхронизации не должен затирать.
const LATER_THAN_SENT = new Set(['replied', 'invited', 'rejected']);

// Ошибки адаптера, после которых вакансия возвращается человеку в панель.
const BACK_TO_QUEUE = new Set(['resume_hidden', 'answers_required', 'fill_mismatch', 'manual_required']);

const WORKFLOW_TEXT = `Ты ведёшь поиск работы через инструменты jobfitcopilot. Порядок работы:
1. sync_resumes — подтянуть все резюме профиля hh.ru в базу.
2. get_instructions {kind:'resume_review'}, разбор каждого резюме, затем save_resume_review.
3. run_search {id} или search_vacancies — новые вакансии попадают в базу со статусом found.
4. Для каждой found-вакансии, на которую стоит потратить время: get_vacancy, затем get_instructions {kind:'ats'} и save_ats_match по одному разу на каждое подходящее резюме, затем rank_resumes {key}, чтобы выбрать резюме.
5. get_instructions {kind:'fit'}, затем save_fit_analysis с выбранным резюме; при вердикте «ПРОПУСТИТЬ» — skip_vacancy.
6. get_instructions {kind:'letter'}, затем save_letter (ошибки линтера исправить и сохранить заново), затем inspect_response_form {key}; если в форме есть вопросы работодателя — save_answers; затем queue_application. Ответы бери только из резюме. Вопрос, на который резюме ответить не может (ожидания по зарплате, город, дата выхода), оставь без ответа и сообщи человеку: он заполнит его в панели. Если форма требует видимое резюме (resumeHidden), сообщи человеку: нужно поменять видимость резюме на hh.ru или выбрать другое.
7. Одобряет человек в панели, ты статус approved поставить не можешь. list_pipeline {status:'approved'}, затем submit_application {key} строго по одной вакансии.
8. sync_responses — забрать статусы откликов с hh.ru.
Если не знаешь, с чего начать, вызови next_actions: он покажет счётчики и подскажет ближайший шаг.`;

/** Самое свежее событие вакансии. Порядок listEvents не гарантирован, поэтому сравниваем время, затем id. */
function latestEvent(events) {
  let best = null;
  let bestKey = null;
  (events ?? []).forEach((e, i) => {
    const k = [Number(e.createdAt ?? e.at ?? 0) || 0, Number(e.id) || 0, i];
    if (!bestKey || k[0] > bestKey[0] || (k[0] === bestKey[0] && (k[1] > bestKey[1] || (k[1] === bestKey[1] && k[2] > bestKey[2])))) {
      best = e;
      bestKey = k;
    }
  });
  return best;
}

/**
 * @param {{ db: any, sites: any, bridge: any, now?: () => number }} deps
 *   now — источник времени (мс), подменяется в тестах для проверки too_soon
 */
export function createMcpServer({ db, sites, bridge, llm, autopilot, now = Date.now }) {
  const hh = sites.hh;
  const llmClient = llm ?? createLlmClient();
  const server = new McpServer({ name: 'jobfitcopilot', version: '0.2.0' });
  const tool = (name, description, inputSchema, fn) =>
    server.registerTool(name, { description, inputSchema }, wrap(fn));

  server.registerPrompt(
    'job_hunt',
    { description: 'Полный цикл поиска работы: от импорта резюме до отправки откликов' },
    () => ({ messages: [{ role: 'user', content: { type: 'text', text: WORKFLOW_TEXT } }] })
  );

  const needVacancy = (key) => {
    const v = db.getVacancy(key);
    if (!v) throw new ToolError('not_found', `Вакансия не найдена: ${key}`);
    return v;
  };

  const idSchema = z.union([z.string(), z.number()]);
  const resultSchema = z.record(z.string(), z.any());

  tool(
    'browser_status',
    'Проверить, что мост к браузеру жив и пользователь вошёл на hh.ru. Вызывай первым, если другие инструменты вернули ошибку extension_not_connected, daemon_unreachable или login_required. Ничего не меняет.',
    {},
    async () => {
    const status = await bridge.status();
    // Мост может быть жив, а вход не выполнен: отдаём ошибку адаптера как данные, а не роняем весь ответ.
    let hhLoggedIn;
    try {
      hhLoggedIn = await hh.isLoggedIn();
    } catch (err) {
      hhLoggedIn = { error: { code: err?.code ?? 'internal_error', message: err?.message } };
    }
    return { bridge: status, hhLoggedIn };
    }
  );

  tool(
    'next_actions',
    'Показать, где ты в рабочем процессе поиска работы: восемь шагов с названиями инструментов и живыми счётчиками (резюме, резюме без разбора, вакансии по статусам, одобренные к отправке, отправлено сегодня против дневного лимита) и подсказку suggestion с ближайшим полезным шагом. Вызывай в начале сессии и когда не уверен, что делать дальше. Ничего не меняет.',
    {},
    async () => {
      const resumes = db.listResumes();
      const unreviewed = resumes.filter((r) => r.reviewedAt == null).length;
      const stats = db.stats();
      const settings = db.getSettings();
      const byStatus = stats.byStatus ?? {};
      const n = (s) => byStatus[s] ?? 0;
      const approved = n('approved');
      const sentToday = stats.sentToday ?? 0;
      const limitReached = sentToday >= settings.dailyLimit;

      let suggestion;
      if (resumes.length === 0) {
        suggestion = 'Резюме в базе нет: вызови sync_resumes, чтобы подтянуть их с hh.ru.';
      } else if (unreviewed > 0) {
        suggestion = `Резюме без разбора: ${unreviewed}. Возьми get_instructions {kind:'resume_review'}, разбери каждое и сохрани через save_resume_review.`;
      } else if (approved > 0 && !limitReached) {
        suggestion = `Одобренных вакансий ждёт отправки: ${approved}. Вызови list_pipeline {status:'approved'} и отправляй по одной через submit_application.`;
      } else if (n('found') > 0) {
        suggestion = `Новых вакансий (found): ${n('found')}. Оцени самые интересные: get_vacancy, save_ats_match, rank_resumes, save_fit_analysis.`;
      } else if (approved > 0) {
        suggestion = `Дневной лимит (${settings.dailyLimit}) исчерпан, одобренных вакансий ${approved} подождут до завтра. Пока можно запустить поиск или sync_responses.`;
      } else {
        suggestion = 'Очередь пуста: запусти поиск (run_search по сохранённому запросу или search_vacancies).';
      }

      return {
        counts: {
          resumes: resumes.length,
          resumesWithoutReview: unreviewed,
          byStatus,
          approvedWaiting: approved,
          sentToday,
          dailyLimit: settings.dailyLimit
        },
        steps: [
          { step: 1, title: 'Подтянуть резюме с hh.ru', tools: ['sync_resumes'], count: resumes.length },
          {
            step: 2,
            title: 'Разобрать резюме',
            tools: ["get_instructions {kind:'resume_review'}", 'save_resume_review'],
            count: unreviewed
          },
          { step: 3, title: 'Найти вакансии', tools: ['run_search', 'search_vacancies', 'save_search'], count: n('found') },
          {
            step: 4,
            title: 'ATS-сопоставление и выбор резюме',
            tools: ['get_vacancy', "get_instructions {kind:'ats'}", 'save_ats_match', 'rank_resumes'],
            count: n('found')
          },
          {
            step: 5,
            title: 'Fit-анализ или пропуск',
            tools: ["get_instructions {kind:'fit'}", 'save_fit_analysis', 'skip_vacancy'],
            count: n('found') + n('scored')
          },
          {
            step: 6,
            title: 'Письмо, форма отклика, ответы на вопросы работодателя и очередь на одобрение',
            tools: ["get_instructions {kind:'letter'}", 'save_letter', 'inspect_response_form', 'save_answers', 'queue_application'],
            count: n('scored') + n('drafted')
          },
          {
            step: 7,
            title: 'Одобрение в панели (человек), затем отправка',
            tools: ['list_pipeline {status:"approved"}', 'submit_application'],
            count: approved,
            awaitingApproval: n('awaiting_approval')
          },
          { step: 8, title: 'Забрать статусы откликов', tools: ['sync_responses'], count: n('sent') }
        ],
        suggestion
      };
    }
  );

  tool(
    'sync_resumes',
    'Подтянуть все резюме профиля hh.ru в базу (читает страницы в браузере пользователя, записывает резюме в базу). Существующие резюме обновляются на месте: id, имя и сохранённый разбор сохраняются. Сбой одного резюме не прерывает остальные и попадает в errors. Дальше: get_instructions {kind:"resume_review"} и save_resume_review для резюме с reviewed=false.',
    {},
    async () => {
      const listed = await hh.listMyResumes();
      const items = [];
      const errors = [];
      for (const r of listed) {
        try {
          const { title, text } = await hh.importResume(r.url);
          const resumeTitle = r.title || title;
          const saved = db.upsertResumeByExternal({
            source: SOURCE,
            externalId: r.externalId,
            url: r.url,
            title: resumeTitle,
            name: resumeTitle,
            text
          });
          items.push({
            id: saved.id,
            name: saved.name,
            title: saved.title ?? resumeTitle,
            chars: (text ?? '').length,
            reviewed: saved.reviewedAt != null
          });
        } catch (err) {
          errors.push({
            externalId: r.externalId,
            title: r.title ?? null,
            code: err?.code ?? 'internal_error',
            message: err?.message ?? String(err)
          });
        }
      }
      return { items, errors };
    }
  );

  tool(
    'save_resume_review',
    'Сохранить разбор резюме (результат по промпту get_instructions {kind:"resume_review"}). Оценка берётся из result.overall_ats_score. Меняет только поля разбора у резюме. Дальше: поиск вакансий.',
    { resumeId: idSchema, result: resultSchema },
    async ({ resumeId, result }) => {
      if (!db.getResume(resumeId)) throw new ToolError('not_found', `Резюме не найдено: ${resumeId}`);
      const raw = result.overall_ats_score;
      const score = typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
      const saved = db.saveResumeReview(resumeId, result, score);
      return { resume: { id: saved.id, name: saved.name, reviewScore: saved.reviewScore, reviewedAt: saved.reviewedAt } };
    }
  );

  // Общий код search_vacancies и run_search: фильтры из настроек применяются до записи в базу,
  // чтобы чёрный список не засорял воронку.
  async function searchAndStore({ text, area, page, filters }) {
    const settings = db.getSettings();
    const blocked = new Set(settings.blacklistEmployers.map((s) => s.trim().toLowerCase()));
    const stops = settings.stopWords.map((s) => s.trim().toLowerCase()).filter(Boolean);
    const res = await hh.search({ text, area, page, filters });
    const items = [];
    let dropped = 0;
    for (const item of res.items) {
      const employer = String(item.employer ?? '').trim().toLowerCase();
      const title = String(item.title ?? '').toLowerCase();
      if ((employer && blocked.has(employer)) || stops.some((w) => title.includes(w))) {
        dropped++;
        continue;
      }
      const row = db.upsertVacancy({ ...item, source: SOURCE });
      items.push({ ...item, key: row.key, status: row.status });
    }
    return { total: res.total, page: res.page, items, dropped };
  }

  const filtersSchema = z.record(z.string(), z.union([z.string(), z.array(z.string())]));

  tool(
    'search_vacancies',
    'Поиск вакансий на hh.ru через браузер пользователя. Найденные сохраняются в базу со статусом found. Вакансии работодателей из чёрного списка и с стоп-словами в названии отбрасываются до сохранения, их число в поле dropped. filters: параметры URL hh.ru (experience, schedule, employment, salary, only_with_salary, search_period, order_by, excluded_text, professional_role, work_format), значение строка или массив. Дальше: get_vacancy для интересных.',
    {
      text: z.string().min(1),
      area: z.number().int().optional(),
      page: z.number().int().min(0).optional(),
      filters: filtersSchema.optional()
    },
    searchAndStore
  );

  tool(
    'save_search',
    'Сохранить поисковый запрос (создаёт или, если передан id, обновляет). Потом его можно запускать через run_search. Меняет только список сохранённых запросов.',
    {
      id: idSchema.optional(),
      name: z.string().min(1),
      site: z.string().optional(),
      text: z.string().min(1),
      area: z.number().int().optional(),
      filters: filtersSchema.optional(),
      enabled: z.boolean().optional()
    },
    async (args) => ({ search: db.saveSearch(args) })
  );

  tool('list_searches', 'Список сохранённых поисковых запросов. Ничего не меняет. Дальше: run_search {id}.', {}, async () => ({
    items: db.listSearches()
  }));

  tool(
    'delete_search',
    'Удалить сохранённый поисковый запрос по id. Найденные им вакансии остаются.',
    { id: idSchema },
    async ({ id }) => {
      if (!db.getSearch(id)) throw new ToolError('not_found', `Поиск не найден: ${id}`);
      db.deleteSearch(id);
      return { deleted: id };
    }
  );

  tool(
    'run_search',
    'Запустить сохранённый поиск с его параметрами (то же, что search_vacancies, плюс отметка времени последнего запуска). page — номер страницы выдачи с нуля. Находки сохраняются со статусом found. Дальше: get_vacancy для интересных.',
    { id: idSchema, page: z.number().int().min(0).optional() },
    async ({ id, page }) => {
      const s = db.getSearch(id);
      if (!s) throw new ToolError('not_found', `Поиск не найден: ${id}`);
      if (s.site && s.site !== SOURCE) {
        throw new ToolError('unsupported_site', `Поиск на ${s.site} не поддерживается, только ${SOURCE}`);
      }
      const result = await searchAndStore({ text: s.text, area: s.area, page, filters: s.filters });
      db.touchSearch(id);
      return { search: { id: s.id, name: s.name }, ...result };
    }
  );

  tool(
    'get_vacancy',
    'Получить полный текст вакансии и сохранить его в базу. Передай key (hh.ru:123, голый id hh или URL hh) либо url вакансии hh.ru, LinkedIn или Upwork. Неподдерживаемый сайт даёт код unsupported_site. Дальше: get_instructions {kind:"ats"} и save_ats_match.',
    { key: z.string().min(1).optional(), url: z.string().min(1).optional() },
    async ({ key, url }) => {
      if (!key && !url) throw new ToolError('bad_request', 'Нужен key или url');
      let adapter;
      let arg;
      if (url || /^https?:\/\//i.test(key)) {
        arg = url ?? key;
        adapter = sites.forUrl(arg);
        if (!adapter) throw new ToolError('unsupported_site', `Сайт не поддерживается: ${arg}`);
      } else if (key.startsWith(`${SOURCE}:`)) {
        adapter = hh;
        arg = key.slice(SOURCE.length + 1);
      } else if (/^[a-z][\w.]*:/i.test(key)) {
        // Ключ другого источника (linkedin:…, upwork:…): адрес берём из сохранённой вакансии.
        const row = db.getVacancy(key);
        if (!row?.url) throw new ToolError('not_found', `Вакансия не найдена: ${key}`);
        arg = row.url;
        adapter = sites.forUrl(arg);
        if (!adapter) throw new ToolError('unsupported_site', `Сайт не поддерживается: ${arg}`);
      } else {
        adapter = hh;
        arg = key;
      }
      const v = await adapter.getVacancy(arg);
      const row = db.upsertVacancy(v);
      return { ...v, key: row.key, status: row.status };
    }
  );

  tool('list_resumes', 'Сохранённые резюме с оценкой разбора. Ничего не меняет. Нужны resumeId для save_ats_match, save_letter и queue_application.', {}, async () => ({ items: db.listResumes() }));

  tool(
    'save_resume',
    'Сохранить или обновить резюме вручную (для резюме не с hh.ru; hh-резюме лучше брать через sync_resumes).',
    { id: idSchema.optional(), name: z.string().min(1), text: z.string().min(1) },
    async ({ id, name, text }) => ({ resume: db.saveResume({ id, name, text }) })
  );

  tool(
    'import_resume',
    'Импортировать одно резюме со страницы hh.ru по URL и сохранить как новое. Для всех резюме профиля сразу используй sync_resumes.',
    { url: z.string().min(1) },
    async ({ url }) => {
      const { title, text } = await hh.importResume(url);
      return { resume: db.saveResume({ name: title, text }) };
    }
  );

  tool(
    'get_instructions',
    'Получить системный промпт, которому ты должен следовать, и форму JSON для сохранения результата. kind: resume_review (разбор резюме, сохранять через save_resume_review), ats (сопоставление резюме с вакансией, save_ats_match), fit (оценка соответствия, save_fit_analysis), letter (сопроводительное письмо, save_letter). Ничего не меняет.',
    {
      kind: z.enum(['fit', 'ats', 'letter', 'resume_review']),
      lang: z.string().optional(),
      tone: z.string().optional()
    },
    async ({ kind, lang = 'ru', tone }) => {
      switch (kind) {
        case 'fit':
          return {
            system: PROMPTS.fit,
            saveWith: 'save_fit_analysis',
            shape: 'JSON проверки соответствия с ledger: [{delta, ...}]; передать как result вместе с key и resumeId'
          };
        case 'ats':
          return {
            system: PROMPTS.ats,
            saveWith: 'save_ats_match',
            shape:
              'JSON ATS-сопоставления с overall_match_score и hard_requirements_coverage_percent; передать как result вместе с key и resumeId'
          };
        case 'resume_review':
          return {
            system: PROMPTS.resumeReview,
            saveWith: 'save_resume_review',
            shape: 'JSON разбора резюме с overall_ats_score; передать как result вместе с resumeId'
          };
        default:
          return {
            system: letterPrompt(lang, tone),
            saveWith: 'save_letter',
            shape:
              'JSON { plan, text }: сначала plan (2-3 факта из резюме и одна связка со ссылкой на вакансию), затем text строго по плану; передать с key, resumeId и lang'
          };
      }
    }
  );

  tool(
    'save_fit_analysis',
    'Сохранить результат fit-анализа (по промпту get_instructions {kind:"fit"}); счёт считается на сервере по ledger. Ставит вакансии статус scored. При вердикте «ПРОПУСТИТЬ» вместо этого вызови skip_vacancy. Дальше: письмо через get_instructions {kind:"letter"}.',
    { key: z.string().min(1), resumeId: idSchema, result: resultSchema },
    async ({ key, resumeId, result }) => {
      needVacancy(key);
      const score = computeFitScore(result);
      const analysis = db.saveAnalysis({
        vacancyKey: key,
        resumeId,
        kind: 'fit',
        score,
        verdict: result.verdict ?? null,
        payload: result
      });
      db.setStatus(key, 'scored');
      return { analysis, score };
    }
  );

  tool(
    'save_ats_match',
    'Сохранить ATS-сопоставление одного резюме с вакансией (по промпту get_instructions {kind:"ats"}). Вызывай по разу на каждое подходящее резюме, статус вакансии не меняется. Дальше: rank_resumes, чтобы выбрать резюме.',
    { key: z.string().min(1), resumeId: idSchema, result: resultSchema },
    async ({ key, resumeId, result }) => {
      needVacancy(key);
      const analysis = db.saveAnalysis({
        vacancyKey: key,
        resumeId,
        kind: 'ats',
        score: result.overall_match_score ?? null,
        verdict: result.verdict ?? null,
        payload: result
      });
      return { analysis };
    }
  );

  tool(
    'rank_resumes',
    'Ранжировать резюме по сохранённым ATS-сопоставлениям вакансии (сначала покрытие обязательных требований, затем общий балл). missing — резюме, для которых ATS-сопоставления ещё нет: сделай для них save_ats_match, если они подходят. Ничего не меняет. Дальше: save_fit_analysis с лучшим резюме.',
    { key: z.string().min(1) },
    async ({ key }) => {
    needVacancy(key);
    const names = new Map(db.listResumes().map((r) => [String(r.id), r.name]));
    // На одно резюме берём самое свежее сопоставление; порядок listAnalyses не предполагаем.
    const latest = new Map();
    for (const a of db.listAnalyses(key)) {
      if (a.kind !== 'ats') continue;
      const prev = latest.get(String(a.resumeId));
      if (!prev || (a.createdAt ?? 0) > (prev.createdAt ?? 0)) latest.set(String(a.resumeId), a);
    }
    const scored = [...latest.values()].map((a) => ({
      resumeId: a.resumeId,
      name: names.get(String(a.resumeId)) ?? String(a.resumeId),
      result: a.payload
    }));
    const missing = [...names]
      .filter(([id]) => !latest.has(id))
      .map(([id, name]) => ({ resumeId: id, name }));
    return { ranking: rankResumeMatches(scored), missing };
    }
  );

  tool(
    'skip_vacancy',
    'Пропустить вакансию: ставит статус skipped, reason сохраняется как заметка. Используй при вердикте «ПРОПУСТИТЬ» или когда вакансия не подходит.',
    { key: z.string().min(1), reason: z.string().min(1) },
    async ({ key, reason }) => {
      needVacancy(key);
      return { vacancy: db.setStatus(key, 'skipped', reason) };
    }
  );

  tool(
    'get_settings',
    'Прочитать настройки: дневной лимит откликов, минимальная пауза между ними (секунды), чёрный список работодателей, стоп-слова. Ничего не меняет.',
    {},
    async () => ({ settings: db.getSettings() })
  );

  tool(
    'update_settings',
    'Изменить настройки частичным патчем (dailyLimit 0..200, minDelaySec 0..3600, blacklistEmployers и stopWords как массивы строк). Невалидное значение даёт код bad_settings. Лимит и пауза действуют в submit_application, списки в поиске.',
    { patch: z.record(z.string(), z.any()) },
    async ({ patch }) => ({ settings: db.updateSettings(patch) })
  );

  tool(
    'lint_letter',
    'Проверить текст сопроводительного письма детерминированными правилами (клише, длина, плейсхолдеры и др.), ничего не сохраняет. Полезно для черновика перед save_letter.',
    { text: z.string(), lang: z.string().optional() },
    async ({ text, lang }) => lintLetter(text, { lang: lang ?? 'ru' })
  );

  tool(
    'save_letter',
    'Сохранить письмо с планом, прогнать линтер и пометить вакансию drafted. Если в lint есть ошибки, исправь текст и сохрани заново. Дальше: queue_application с id письма, когда lint.ok равно true.',
    {
      key: z.string().min(1),
      resumeId: idSchema,
      lang: z.string().optional(),
      plan: z.any(),
      text: z.string().min(1)
    },
    async ({ key, resumeId, lang = 'ru', plan, text }) => {
      needVacancy(key);
      const lint = lintLetter(text, { lang });
      const letter = db.saveLetter({ vacancyKey: key, resumeId, lang, plan, text, lint });
      db.setStatus(key, 'drafted');
      return { letter, lint };
    }
  );

  tool(
    'inspect_response_form',
    'Осмотреть форму отклика на hh.ru (только чтение: ничего не заполняется и не отправляется) и сохранить её в вакансии: обязательность письма, вопросы работодателя, предупреждение о скрытом резюме. Учитывает выбранное для вакансии резюме. Вызывай после save_letter, затем save_answers, если есть вопросы. Только hh.ru.',
    { key: z.string().min(1) },
    async ({ key }) => {
      const v = needVacancy(key);
      if ((v.source ?? SOURCE) !== SOURCE) {
        throw new ToolError('unsupported_site', `Форма отклика на ${v.source} не поддерживается, только ${SOURCE}`);
      }
      const resume = v.resumeId != null ? db.getResume(v.resumeId) : null;
      const vacancyId = key.slice(key.indexOf(':') + 1);
      const form = await hh.inspectResponseForm(vacancyId, { resumeExternalId: resume?.externalId });
      const stored = { ...form, inspectedAt: now() };
      db.saveForm(key, stored);
      return { form: stored };
    }
  );

  tool(
    'save_answers',
    'Сохранить ответы на вопросы работодателя из осмотренной формы. answers: [{id, text}] для текстовых вопросов, [{id, values:[значение варианта], own?}] для вопросов с выбором. Отвечай только фактами из резюме; вопрос, на который резюме ответить не может (зарплата, город, дата выхода), не включай и сообщи человеку, он ответит в панели. Ошибки: no_form (сначала inspect_response_form), bad_answers. Заменяет все сохранённые ответы вакансии.',
    { key: z.string().min(1), answers: z.array(z.record(z.string(), z.any())) },
    async ({ key, answers }) => {
      const v = needVacancy(key);
      const clean = validateAnswers(v.form, answers);
      const vacancy = db.saveAnswers(key, clean);
      return { vacancy, unanswered: unansweredQuestionIds(v.form, clean) };
    }
  );

  tool(
    'queue_application',
    'Поставить отклик в очередь на одобрение в панели: запоминает выбранные письмо и резюме и ставит статус awaiting_approval. Требует: письмо прошло линт, форма осмотрена (no_form), резюме не скрыто (resume_hidden), на все вопросы работодателя есть ответы (answers_required). Отправки не происходит: одобрить может только человек в панели, после чего вакансия станет доступна для submit_application.',
    { key: z.string().min(1), letterId: idSchema, resumeId: idSchema },
    async ({ key, letterId, resumeId }) => {
      needVacancy(key);
      const letter = db.getLetter(letterId);
      if (!letter || letter.vacancyKey !== key) {
        throw new ToolError('not_found', `Письмо не найдено для вакансии: ${letterId}`);
      }
      if (!letter.lint?.ok) {
        throw new ToolError('lint_failed', 'Письмо не прошло линт; исправьте ошибки и сохраните заново');
      }
      // Форма должна быть осмотрена: иначе при отправке всплывут вопросы, о которых человек не знал.
      const form = db.getVacancy(key).form;
      if (!form) throw new ToolError('no_form', 'Форма отклика не осмотрена: вызови inspect_response_form');
      if (form.resumeHidden) {
        throw new ToolError(
          'resume_hidden',
          'Резюме скрыто от работодателя: пусть человек поменяет видимость резюме на hh.ru или выбери другое резюме и осмотри форму заново'
        );
      }
      const missingIds = unansweredQuestionIds(form, db.getVacancy(key).answers);
      if (missingIds.length) {
        throw new ToolError('answers_required', `Нет ответов на вопросы работодателя: ${missingIds.join(', ')}. Ответь через save_answers`);
      }
      db.setChoice(key, { resumeId, letterId });
      return { vacancy: db.setStatus(key, 'awaiting_approval') };
    }
  );

  tool(
    'list_pipeline',
    'Воронка откликов: вакансии с последним счётом и вердиктом, новые сверху. status фильтрует по статусу (found, scored, drafted, awaiting_approval, approved, sent, replied, invited, rejected, skipped). Для отправки возьми status "approved". Ничего не меняет.',
    { status: z.string().optional() },
    async ({ status }) => ({ items: db.listPipeline({ status }) })
  );

  tool('pipeline_stats', 'Сводка по воронке: сколько вакансий в каждом статусе, отправлено сегодня и за 7 дней. Ничего не меняет.', {}, async () => db.stats());

  tool(
    'sync_responses',
    'Подтянуть статусы откликов с hh.ru (страница откликов в браузере) в уже известные вакансии: sent, replied, invited, rejected. Чужие отклики не заводятся. На каждой просмотренной вакансии пишется событие synced; оно же снимает блокировку submit_application после неподтверждённой отправки. Вызывай после submit_application с confirmed=false и в конце цикла.',
    {},
    async () => {
      const rows = await hh.listNegotiations();
      const report = { total: rows.length, updated: 0, unchanged: 0, unknown: 0, byStatus: {} };
      const examined = new Set();
      for (const row of rows) {
        const current = row.vacancyId ? db.getVacancy(`${SOURCE}:${row.vacancyId}`) : null;
        if (!current) {
          report.unknown++; // чужие отклики не заводим: вакансии нет в нашей базе
          continue;
        }
        examined.add(current.key);
        const next = mapHhStatus(row.status);
        // «sent» не должен затирать более поздний статус (ответ, приглашение, отказ).
        const downgrade = next === 'sent' && LATER_THAN_SENT.has(current.status);
        if (current.status === next || downgrade) {
          report.unchanged++;
        } else {
          db.setStatus(current.key, next, `hh: ${row.status ?? ''}`.trim());
          report.updated++;
          report.byStatus[next] = (report.byStatus[next] ?? 0) + 1;
        }
        db.addEvent(current.key, 'synced', { hhStatus: row.status ?? null });
      }
      // Одобренная вакансия с неподтверждённой отправкой может отсутствовать в откликах:
      // сверка всё равно состоялась, и без события synced она осталась бы заблокированной навсегда.
      for (const v of db.listPipeline({ status: 'approved' })) {
        if (examined.has(v.key)) continue;
        db.addEvent(v.key, 'synced', { hhStatus: null });
      }
      return report;
    }
  );

  tool(
    'submit_application',
    'ОТПРАВЛЯЕТ РЕАЛЬНЫЙ ОТКЛИК работодателю на hh.ru через браузер пользователя. Работает только для вакансии со статусом approved (его ставит человек в панели), по одной вакансии за вызов. Перед отправкой проверяет: статус, сайт, выбранные письмо и резюме, линт письма, дневной лимит и минимальную паузу; при отказе браузер не трогается и приходит код ошибки. confirmed=true: статус станет sent. confirmed=false: отклик, возможно, ушёл, но не подтверждён; статус остаётся approved, НЕ вызывай submit_application для этого key повторно, пока не выполнишь sync_responses. Ошибка адаптера записывается в события (submit_failed); при resume_hidden, answers_required, fill_mismatch, manual_required вакансия возвращается в awaiting_approval с причиной в заметке, иначе статус не меняется.',
    { key: z.string().min(1) },
    async ({ key }) => {
      const v = needVacancy(key);
      if (v.status !== 'approved') {
        throw new ToolError('not_approved', `Статус «${v.status}», нужен «approved» (одобрение в панели)`);
      }
      // Защита от двойной отправки: после неподтверждённого клика до сверки с hh.ru повтор запрещён.
      const last = latestEvent(db.listEvents(key));
      if (last?.type === 'submit_unconfirmed') {
        throw new ToolError(
          'submit_unconfirmed',
          'Прошлая отправка не подтверждена: выполни sync_responses и проверь статус, прежде чем повторять'
        );
      }
      if ((v.source ?? SOURCE) !== SOURCE) {
        throw new ToolError('unsupported_site', `Отправка на ${v.source} не поддерживается, только ${SOURCE}`);
      }
      const letter = v.letterId != null ? db.getLetter(v.letterId) : null;
      const resume = v.resumeId != null ? db.getResume(v.resumeId) : null;
      if (!letter || !resume || !resume.externalId) {
        throw new ToolError(
          'not_ready',
          'Не выбраны письмо и резюме или у резюме нет externalId (выполни sync_resumes и queue_application)'
        );
      }
      if (!letter.lint?.ok) {
        throw new ToolError('lint_failed', 'Письмо не прошло линт; исправь его через save_letter и снова поставь в очередь');
      }
      const settings = db.getSettings();
      const sentToday = db.stats().sentToday ?? 0;
      if (sentToday >= settings.dailyLimit) {
        throw new ToolError('daily_limit', `Дневной лимит отправок исчерпан: ${sentToday} из ${settings.dailyLimit}`);
      }
      const lastSent = db.lastSentAt();
      if (lastSent != null) {
        const waitMs = settings.minDelaySec * 1000 - (now() - lastSent);
        if (waitMs > 0) {
          throw new ToolError('too_soon', `Слишком рано: подожди ещё ${Math.ceil(waitMs / 1000)} с (минимальная пауза ${settings.minDelaySec} с)`);
        }
      }

      const vacancyId = key.slice(key.indexOf(':') + 1);
      let res;
      try {
        res = await hh.submitResponse({
          vacancyId,
          resumeExternalId: resume.externalId,
          letter: letter.text,
          answers: v.answers ?? [],
          confirm: true
        });
      } catch (err) {
        try {
          db.addEvent(key, 'submit_failed', { code: err?.code ?? 'internal_error', message: err?.message ?? String(err) });
        } catch {
          // событие вторично: исходная ошибка адаптера важнее
        }
        // Проблема формы, которую исправит человек: возвращаем в очередь, чтобы она была видна в панели.
        if (BACK_TO_QUEUE.has(err?.code)) {
          try {
            db.setStatus(key, 'awaiting_approval', `submit: ${err.code}: ${err.message}`);
          } catch {
            // статус вторичен: исходная ошибка важнее
          }
        }
        throw err;
      }

      if (res?.confirmed === true) {
        const vacancy = db.setStatus(key, 'sent', 'отправлено через submit_application');
        db.addEvent(key, 'submitted', { resumeTitle: res.resumeTitle ?? null, letterId: letter.id, confirmed: true });
        return { submitted: true, confirmed: true, status: vacancy.status, resumeTitle: res.resumeTitle ?? null };
      }
      db.addEvent(key, 'submit_unconfirmed', { resumeTitle: res?.resumeTitle ?? null, letterId: letter.id });
      return {
        submitted: true,
        confirmed: false,
        status: 'approved',
        resumeTitle: res?.resumeTitle ?? null,
        next: 'Отправка не подтверждена, отклик мог уйти. Вызови sync_responses и НЕ вызывай submit_application для этой вакансии повторно, пока синхронизация не выполнена.'
      };
    }
  );

  tool(
    'fsm_pipeline_summary',
    'Сводка состояния всей State Machine конвейера поиска работы: распределение по этапам (found -> scored -> drafted -> awaiting_approval -> approved -> sent), метрики пропускной способности, активные блокеры и рекомендуемые шаги для оркестратора.',
    {},
    async () => getPipelineFsmSummary(db)
  );

  tool(
    'fsm_inspect_vacancy',
    'Детальная FSM-инспекция вакансии: текущее состояние, процент готовности к отклику (0..100%), разрешённые переходы, список блокеров (скрытое резюме, неотвеченные вопросы, ошибки линтера) и точный следующий шаг.',
    { key: z.string().describe('Ключ вакансии (например hh.ru:12345678)') },
    async ({ key }) => {
      const v = needVacancy(key);
      return inspectVacancyFsm(v, db);
    }
  );

  tool(
    'fsm_advance_vacancy',
    'Безопасный перевод вакансии на следующий этап State Machine. Проверяет строгие условия перехода (guards). Если условия не выполнены, статус не меняется и возвращается список конкретных блокеров.',
    {
      key: z.string().describe('Ключ вакансии'),
      targetState: z.enum(['scored', 'drafted', 'awaiting_approval', 'approved', 'sent', 'skipped']).optional().describe('Целевой статус (если не указан, выбирается следующий по конвейеру)')
    },
    async ({ key, targetState }) => {
      const v = needVacancy(key);
      const letter = v.letterId ? db.getLetter(v.letterId) : null;
      const resume = v.resumeId ? db.getResume(v.resumeId) : null;

      let target = targetState;
      if (!target) {
        if (v.status === 'found') target = 'scored';
        else if (v.status === 'scored') target = 'drafted';
        else if (v.status === 'drafted') target = 'awaiting_approval';
        else if (v.status === 'awaiting_approval') target = 'approved';
        else throw new ToolError('no_default_transition', `Нет шага по умолчанию для статуса «${v.status}». Укажите targetState явно.`);
      }

      const guardRes = evaluateTransitionGuards(v.status, target, v, {
        letter,
        resume,
        form: v.form,
        answers: v.answers,
      });

      if (!guardRes.ok) {
        return {
          advanced: false,
          key,
          currentStatus: v.status,
          targetStatus: target,
          reason: guardRes.reason,
          blockers: guardRes.blockers,
        };
      }

      const updated = db.setStatus(key, target, `FSM auto-advance: ${target}`);
      db.addEvent(key, 'fsm_transition', { from: v.status, to: target });
      return {
        advanced: true,
        key,
        from: v.status,
        to: target,
        vacancy: updated,
        fsm: inspectVacancyFsm(updated, db),
      };
    }
  );

  tool(
    'fsm_batch_advance',
    'Пакетный прогон State Machine: находит все вакансии, готовые к переходу на следующий шаг без участия человека (например, с готовым письмом в drafted или с ответами в awaiting_approval), переводит их и возвращает отчёт.',
    { limit: z.number().int().min(1).max(50).optional().describe('Максимум вакансий для обработки (по умолчанию 10)') },
    async ({ limit = 10 }) => {
      const pipeline = db.listPipeline() || [];
      const eligible = pipeline.filter(v => ['found', 'scored', 'drafted'].includes(v.status)).slice(0, limit);
      const advanced = [];
      const blocked = [];

      for (const v of eligible) {
        const letter = v.letterId ? db.getLetter(v.letterId) : null;
        let target;
        if (v.status === 'found' && v.description && v.resumeId) target = 'scored';
        else if (v.status === 'scored' && v.letterId && letter?.lint?.ok) target = 'drafted';
        else if (v.status === 'drafted' && v.form && !v.form.resumeHidden && unansweredQuestionIds(v.form, v.answers || []).length === 0) target = 'awaiting_approval';

        if (!target) {
          blocked.push({ key: v.key, status: v.status, reason: 'guards not met' });
          continue;
        }

        const guardRes = evaluateTransitionGuards(v.status, target, v, {
          letter,
          form: v.form,
          answers: v.answers,
        });

        if (guardRes.ok) {
          db.setStatus(v.key, target, `FSM batch advance: ${target}`);
          db.addEvent(v.key, 'fsm_transition', { from: v.status, to: target });
          advanced.push({ key: v.key, from: v.status, to: target });
        } else {
          blocked.push({ key: v.key, status: v.status, reason: guardRes.reason });
        }
      }

      return {
        processed: eligible.length,
        advancedCount: advanced.length,
        advanced,
        blockedCount: blocked.length,
        blocked,
      };
    }
  );

  tool(
    'cdek_llm_status',
    'Проверить статус подключения к сервису FastAPI_CDEKLLM (http://127.0.0.1:8000/v1), активную корпоративную модель (DeepSeek / GLM / Virtual Orchestrator) и статус авторизации.',
    {},
    async () => llmClient.status()
  );

  tool(
    'cdek_auto_process_vacancy',
    'Полностью автономная обработка вакансии через FastAPI_CDEKLLM: выполняет ATS-сопоставление со всеми вашими резюме, выбирает наиболее релевантное резюме, считает Fit-скоринг (при нерелевантности переводит в skipped), генерирует сопроводительное письмо без клише (с авто-проверкой линтером) и переводит вакансию в drafted.',
    { key: z.string().describe('Ключ вакансии (например hh.ru:12345678)') },
    async ({ key }) => {
      const v = needVacancy(key);
      const resumes = db.listResumes();
      return llmClient.processVacancyWorkflow({ vacancy: v, resumes, db });
    }
  );

  tool(
    'cdek_auto_run_pipeline',
    'Автономный пакетный прогон конвейера через FastAPI_CDEKLLM: берёт найденные вакансии (статус found), проводит через скоринг, ранжирование резюме и генерацию писем, подготавливая их к одобрению в панели.',
    { limit: z.number().int().min(1).max(20).optional().describe('Сколько вакансий обработать за раз (по умолчанию 3)') },
    async ({ limit = 3 }) => {
      const pipeline = db.listPipeline({ status: 'found' }) || [];
      const candidates = pipeline.slice(0, limit);
      const resumes = db.listResumes();
      const results = [];
      for (const v of candidates) {
        try {
          const res = await llmClient.processVacancyWorkflow({ vacancy: v, resumes, db });
          results.push({ key: v.key, title: v.title, success: true, ...res });
        } catch (err) {
          results.push({ key: v.key, title: v.title, success: false, error: err.message });
        }
      }
      return {
        processed: candidates.length,
        results,
        fsmSummary: getPipelineFsmSummary(db),
      };
    }
  );

  tool(
    'autopilot_status',
    'Возвращает текущий статус фонового автопилота: активен ли таймер, текущие настройки, рабочие часы, время последнего прогона и последний отчет.',
    {},
    async () => {
      if (!autopilot) return { available: false, running: false };
      return autopilot.getStatus();
    }
  );

  tool(
    'autopilot_configure',
    'Настройка фонового автопилота (включение/отключение, интервал проверок, рабочие часы, лимит пачки).',
    {
      enabled: z.boolean().optional().describe('Включить или выключить фоновый автопилот'),
      intervalMin: z.number().int().min(1).max(1440).optional().describe('Интервал между циклами в минутах (по умолчанию 30)'),
      workHoursOnly: z.boolean().optional().describe('Работать только в рабочие часы (по умолчанию true)'),
      workHoursStart: z.number().int().min(0).max(23).optional().describe('Час начала рабочих часов (например, 9)'),
      workHoursEnd: z.number().int().min(0).max(23).optional().describe('Час окончания рабочих часов (например, 20)'),
      batchSize: z.number().int().min(1).max(50).optional().describe('Сколько вакансий обрабатывать за один цикл (по умолчанию 5)'),
      autoSubmitApproved: z.boolean().optional().describe('Автоматически отправлять одобренные человеком вакансии (по умолчанию true)'),
      minDelayJitterSec: z.number().int().min(5).max(300).optional().describe('Минимальная пауза/джиттер между отправками в секундах (по умолчанию 15)'),
    },
    async (args) => {
      if (!autopilot) throw new ToolError('autopilot_unavailable', 'Автопилот не инициализирован');
      return autopilot.updateConfig(args);
    }
  );

  tool(
    'autopilot_run_now',
    'Немедленный принудительный запуск полного автономного цикла автопилота (игнорирует рабочие часы при force: true). Выполняет синхронизацию статусов, отправку одобренных с джиттером, поиск новых вакансий, ATS-матчинг резюме, генерацию писем и постановку в очередь на одобрение.',
    {
      force: z.boolean().optional().describe('Принудительный запуск даже вне рабочих часов (по умолчанию true)'),
    },
    async ({ force = true }) => {
      if (!autopilot) throw new ToolError('autopilot_unavailable', 'Автопилот не инициализирован');
      return await autopilot.runCycle({ force });
    }
  );

  return server;
}
