// REST для веб-панели. Панель — единственное место, где человек одобряет
// отправку, поэтому здесь жёстко ограничен набор статусов, которые она может ставить.
import { lintLetter } from './core/letter-lint.js';
import { rankResumeMatches } from './core/scoring.js';
import { getPipelineFsmSummary, inspectVacancyFsm } from './core/fsm.js';
import { createLlmClient } from './core/llm.js';
import { extractResumeSummary } from './core/resume-summary.js';

/** Статусы, доступные панели. Остальные выставляет только MCP-сервер. */
export const PANEL_STATUSES = ['approved', 'skipped', 'awaiting_approval', 'found'];

/**
 * Проверка ответов на вопросы работодателя по сохранённой форме. Одна функция на MCP-инструмент
 * save_answers и на PUT /api/vacancies/:key/answers, чтобы правила не разошлись.
 * Бросает ошибку с .code: no_form (форму не осматривали) или bad_answers.
 * @returns {Array<{id:string,text?:string,values?:string[],own?:string}>} нормализованные ответы
 */
export function validateAnswers(form, answers) {
  const bad = (msg) => Object.assign(new Error(msg), { code: 'bad_answers' });
  if (!form) throw Object.assign(new Error('Форма отклика не осмотрена: сначала inspect_response_form'), { code: 'no_form' });
  if (!Array.isArray(answers)) throw bad('answers должен быть массивом');
  const questions = new Map((form.questions ?? []).map((q) => [String(q.id), q]));
  const seen = new Set();
  return answers.map((raw) => {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw bad('Ответ должен быть объектом');
    const id = String(raw.id ?? '');
    const q = questions.get(id);
    if (!q) throw bad(`Вопроса ${id} нет в форме`);
    if (seen.has(id)) throw bad(`Повторный ответ на вопрос ${id}`);
    seen.add(id);
    const out = { id };
    if (q.kind === 'text') {
      if (typeof raw.text !== 'string') throw bad(`Вопрос ${id}: нужен text (строка)`);
      if (raw.values !== undefined || raw.own !== undefined) throw bad(`Вопрос ${id} текстовый: values и own недопустимы`);
      out.text = raw.text;
      return out;
    }
    if (raw.text !== undefined) throw bad(`Вопрос ${id} с выбором: text недопустим`);
    const values = raw.values ?? [];
    if (!Array.isArray(values)) throw bad(`Вопрос ${id}: values должен быть массивом`);
    const allowed = new Set((q.options ?? []).map((o) => String(o.value)));
    for (const v of values) {
      if (!allowed.has(String(v))) throw bad(`Вопрос ${id}: значения «${v}» нет среди вариантов`);
    }
    if (values.length > 1 && !q.multiple) throw bad(`Вопрос ${id}: допускается один вариант`);
    if (raw.own !== undefined) {
      if (!q.allowsOwn) throw bad(`Вопрос ${id}: свой вариант не предусмотрен`);
      if (typeof raw.own !== 'string') throw bad(`Вопрос ${id}: own должен быть строкой`);
      out.own = raw.own;
    }
    out.values = values.map(String);
    return out;
  });
}

/** Вопрос без ответа: пустой текст либо не выбран ни один вариант и не задан свой. */
export function unansweredQuestionIds(form, answers) {
  const byId = new Map((answers ?? []).map((x) => [String(x.id), x]));
  return (form?.questions ?? [])
    .filter((q) => {
      const x = byId.get(String(q.id));
      if (!x) return true;
      if (q.kind === 'text') return !String(x.text ?? '').trim();
      return !(x.values?.length > 0) && !String(x.own ?? '').trim();
    })
    .map((q) => String(q.id));
}

const MAX_BODY = 1024 * 1024; // 1 МБ: письма и заметки короткие, больше — это ошибка или атака

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function send(res, status, body) {
  const data = body === null ? '' : JSON.stringify(body);
  res.writeHead(status, {
    'content-type': body === null ? '' : 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(data),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'access-control-allow-headers': 'content-type, authorization',
  });
  res.end(data);
}

// Читаем тело сами и обрываем на лимите, не дожидаясь конца потока.
async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, 'payload_too_large', 'Тело запроса больше 1 МБ');
    chunks.push(chunk);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'bad_json', 'Некорректный JSON');
  }
}

/**
 * @param {{ db: any, lint?: typeof lintLetter }} deps
 */
export function createApi({ db, lint = lintLetter, llm, autopilot, monitor }) {
  const llmClient = llm ?? createLlmClient();
  /** @returns {Promise<boolean>} true, если запрос обработан */
  async function handle(req, res) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (!url.pathname.startsWith('/api/')) return false;
    if (req.method === 'OPTIONS') {
      send(res, 204, null);
      return true;
    }
    try {
      const body = await route(req, url);
      send(res, 200, body);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      const code = err instanceof HttpError ? err.code : 'internal_error';
      const message = status >= 500 ? 'Внутренняя ошибка сервера' : (err?.message ?? String(err));
      send(res, status, { error: { code, message } });
    }
    return true;
  }

  async function route(req, url) {
    const method = req.method ?? 'GET';
    const parts = url.pathname.split('/').filter(Boolean).slice(1); // без «api»
    // decodeURIComponent бросает на битом %, это тоже 400, а не 500
    const seg = (i) => {
      try {
        return decodeURIComponent(parts[i]);
      } catch {
        throw new HttpError(400, 'bad_request', 'Некорректная кодировка пути');
      }
    };
    const [a, , c] = parts;

    if (a === 'autopilot' && parts.length === 2 && parts[1] === 'status') {
      allow(method, 'GET');
      return autopilot ? autopilot.getStatus() : { running: false, available: false };
    }
    if (a === 'autopilot' && parts.length === 2 && parts[1] === 'config') {
      allow(method, 'POST');
      const patch = asObject(await readJson(req));
      return autopilot ? autopilot.updateConfig(patch) : { error: 'autopilot_unavailable' };
    }
    if (a === 'metrics' && parts.length === 1) {
      allow(method, 'GET');
      return monitor ? monitor.snapshot() : { error: 'monitor_unavailable' };
    }
 if (a === 'autopilot' && parts.length === 2 && parts[1] === 'run-now') {
      allow(method, 'POST');
      return autopilot ? await autopilot.runCycle({ force: true }) : { error: 'autopilot_unavailable' };
    }
    if (a === 'pipeline' && parts.length === 1) {
      allow(method, 'GET');
      const status = url.searchParams.get('status') || undefined;
      return { items: db.listPipeline({ status }) };
    }
    if (a === 'llm' && parts.length === 2 && parts[1] === 'status') {
      allow(method, 'GET');
      return await llmClient.status();
    }
    if (a === 'pipeline' && parts.length === 2 && parts[1] === 'auto-run') {
      allow(method, 'POST');
      const body = asObject(await readJson(req).catch(() => ({})));
      const limit = Number(body.limit || 5);
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
      return { processed: candidates.length, results };
    }
    if (a === 'vacancies' && parts.length === 3 && c === 'auto-process') {
      allow(method, 'POST');
      const key = seg(1);
      const vacancy = db.getVacancy(key);
      if (!vacancy) throw new HttpError(404, 'not_found', `Вакансия не найдена: ${key}`);
      const resumes = db.listResumes();
      return await llmClient.processVacancyWorkflow({ vacancy, resumes, db });
    }
    if (a === 'fsm' && parts.length === 2 && parts[1] === 'summary') {
      allow(method, 'GET');
      return getPipelineFsmSummary(db);
    }
    if (a === 'fsm' && parts.length === 3 && parts[1] === 'vacancies') {
      allow(method, 'GET');
      const key = seg(2);
      const vacancy = db.getVacancy(key);
      if (!vacancy) throw new HttpError(404, 'not_found', `Вакансия не найдена: ${key}`);
      return inspectVacancyFsm(vacancy, db);
    }
    if (a === 'vacancies' && parts.length === 2) {
      allow(method, 'GET');
      const key = seg(1);
      const vacancy = db.getVacancy(key);
      if (!vacancy) throw new HttpError(404, 'not_found', `Вакансия не найдена: ${key}`);
      return {
        vacancy,
        analyses: db.listAnalyses(key),
        letters: db.listLetters(key),
        events: db.listEvents(key),
        comparison: rankComparison(db.comparison(key))
      };
    }
    if (a === 'vacancies' && parts.length === 3 && c === 'status') {
      allow(method, 'POST');
      const key = seg(1);
      const { status, note } = asObject(await readJson(req));
      if (!PANEL_STATUSES.includes(status)) {
        throw new HttpError(403, 'forbidden_status', `Панель не может ставить статус «${status}»`);
      }
      if (!db.getVacancy(key)) throw new HttpError(404, 'not_found', `Вакансия не найдена: ${key}`);
      try {
        return { vacancy: db.setStatus(key, status, note) };
      } catch (err) {
        throw new HttpError(400, 'bad_request', err.message);
      }
    }
    if (a === 'vacancies' && parts.length === 3 && c === 'answers') {
      allow(method, 'PUT');
      const key = seg(1);
      const { answers } = asObject(await readJson(req));
      const vacancy = db.getVacancy(key);
      if (!vacancy) throw new HttpError(404, 'not_found', `Вакансия не найдена: ${key}`);
      try {
        return { vacancy: db.saveAnswers(key, validateAnswers(vacancy.form, answers)) };
      } catch (err) {
        if (err?.code === 'bad_answers' || err?.code === 'no_form') throw new HttpError(400, err.code, err.message);
        throw err;
      }
    }
    if (a === 'letters' && parts.length === 2) {
      allow(method, 'PUT');
      const id = seg(1);
      const { text } = asObject(await readJson(req));
      if (typeof text !== 'string' || !text.trim()) {
        throw new HttpError(400, 'bad_request', 'Нужно поле text (непустая строка)');
      }
      const letter = db.getLetter(id);
      if (!letter) throw new HttpError(404, 'not_found', `Письмо не найдено: ${id}`);
      // Правка вручную может вернуть клише, поэтому линт гоняем заново.
      const saved = db.saveLetter({ ...letter, text, lint: lint(text, { lang: letter.lang ?? 'ru' }) });
      return { letter: saved };
    }
    if (a === 'resumes' && parts.length === 1) {
      allow(method, 'GET');
      // Возвращаем сводку метаданных (wordCount, compRange, experience, skills, facts, reviewScore)
      const list = db.listResumes();
      return {
        items: list.map((r) => {
          const { text, review, ...summary } = extractResumeSummary(r);
          return summary;
        })
      };
    }
    if (a === 'resumes' && parts.length === 2 && parts[1] === 'audit-all') {
      allow(method, 'POST');
      if (!llmClient || typeof llmClient.auditResume !== 'function') {
        throw new HttpError(503, 'llm_unavailable', 'LLM клиент не поддерживает аудит резюме');
      }
      const list = db.listResumes();
      const results = [];
      for (const r of list) {
        try {
          const reviewResult = await llmClient.auditResume({ resumeText: r.text });
          const score = typeof reviewResult?.overall_ats_score === 'number' ? reviewResult.overall_ats_score : null;
          db.saveResumeReview(r.id, reviewResult, score);
          results.push({ id: r.id, title: r.title, success: true, score });
        } catch (err) {
          results.push({ id: r.id, title: r.title, success: false, error: err.message });
        }
      }
      return { processed: results.length, results };
    }
    if (a === 'resumes' && parts.length === 3 && parts[2] === 'review') {
      allow(method, 'POST');
      const id = seg(1);
      const resume = db.getResume(id);
      if (!resume) throw new HttpError(404, 'not_found', `Резюме не найдено: ${id}`);
      if (!llmClient || typeof llmClient.auditResume !== 'function') {
        throw new HttpError(503, 'llm_unavailable', 'LLM клиент не поддерживает аудит резюме');
      }
      const reviewResult = await llmClient.auditResume({ resumeText: resume.text });
      const score = typeof reviewResult?.overall_ats_score === 'number' ? reviewResult.overall_ats_score : null;
      db.saveResumeReview(id, reviewResult, score);
      return { resume: extractResumeSummary(db.getResume(id)) };
    }
    if (a === 'resumes' && parts.length === 2) {
      allow(method, 'GET');
      const id = seg(1);
      const resume = db.getResume(id);
      if (!resume) throw new HttpError(404, 'not_found', `Резюме не найдено: ${id}`);
      return { resume: extractResumeSummary(resume) };
    }
    if (a === 'settings' && parts.length === 1) {
      if (method === 'PUT') {
        try {
          return { settings: db.updateSettings(asObject(await readJson(req))) };
        } catch (err) {
          if (err?.code === 'bad_settings') throw new HttpError(400, 'bad_settings', err.message);
          throw err;
        }
      }
      allow(method, 'GET');
      return { settings: db.getSettings() };
    }
    if (a === 'searches' && parts.length === 1) {
      if (method === 'POST') {
        const body = asObject(await readJson(req));
        return { search: db.saveSearch(body) };
      }
      allow(method, 'GET');
      return { items: db.listSearches() };
    }
    if (a === 'stats' && parts.length === 1) {
      allow(method, 'GET');
      return db.stats();
    }
    throw new HttpError(404, 'not_found', `Неизвестный маршрут: ${url.pathname}`);
  }

  return { handle };
}

// db.comparison отдаёт строки без порядка; ранжируем теми же правилами, что rank_resumes.
function rankComparison(rows) {
  const byId = new Map(rows.map((r) => [String(r.resumeId), r]));
  const scored = rows.map((r) => ({
    resumeId: r.resumeId,
    name: r.name,
    result: { hard_requirements_coverage_percent: r.hardCoverage, overall_match_score: r.overall }
  }));
  return rankResumeMatches(scored).map((s, i) => ({ ...byId.get(String(s.resumeId)), rank: i + 1, recommended: i === 0 }));
}

function allow(method, expected) {
  if (method !== expected) throw new HttpError(405, 'method_not_allowed', `Ожидается ${expected}`);
}

function asObject(v) {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) {
    throw new HttpError(400, 'bad_request', 'Ожидается JSON-объект');
  }
  return v;
}
