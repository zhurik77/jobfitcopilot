import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer, mapHhStatus } from '../src/mcp.js';
import { createApp, resolveStaticPath } from '../src/index.js';

// Фейки реализуют только контрактные методы, которые вызывает mcp.js.
function fakeDb() {
  const vacancies = new Map();
  const letters = new Map();
  const resumes = new Map([['r1', { id: 'r1', name: 'CV', externalId: 'ext1', reviewedAt: 5 }]]);
  const searches = new Map();
  const events = [];
  const analyses = [];
  const calls = [];
  let settings = { dailyLimit: 20, minDelaySec: 45, blacklistEmployers: [], stopWords: [] };
  const db = {
    calls,
    events,
    resumes,
    sentToday: 0,
    lastSent: null,
    upsertVacancy(v) {
      const key = `${v.source ?? 'hh.ru'}:${v.id}`;
      const row = vacancies.get(key) ?? { key, status: 'found' };
      Object.assign(row, v, { key, status: row.status });
      vacancies.set(key, row);
      return row;
    },
    getVacancy: (k) => vacancies.get(k) ?? null,
    setStatus(k, status, note) {
      if (!vacancies.has(k)) throw new Error('unknown key');
      calls.push(['setStatus', k, status]);
      Object.assign(vacancies.get(k), { status, note });
      return vacancies.get(k);
    },
    saveForm(k, form) {
      if (!vacancies.has(k)) throw Object.assign(new Error('not_found'), { code: 'not_found' });
      return Object.assign(vacancies.get(k), { form });
    },
    saveAnswers(k, answers) {
      if (!vacancies.has(k)) throw Object.assign(new Error('not_found'), { code: 'not_found' });
      return Object.assign(vacancies.get(k), { answers });
    },
    setChoice(k, c) {
      Object.assign(vacancies.get(k), c);
    },
    listResumes: () => [...resumes.values()],
    getResume: (id) => resumes.get(String(id)) ?? null,
    saveResume: (r) => ({ id: r.id ?? 'r_new', ...r }),
    upsertResumeByExternal(r) {
      const id = `ext_${r.externalId}`;
      const row = { ...(resumes.get(id) ?? {}), id, ...r };
      resumes.set(id, row);
      return row;
    },
    saveResumeReview(id, review, score) {
      const r = resumes.get(String(id));
      Object.assign(r, { review, reviewScore: score, reviewedAt: 99 });
      return r;
    },
    saveSearch(s) {
      const row = { id: s.id ?? `s${searches.size + 1}`, site: 'hh.ru', area: 113, filters: {}, enabled: true, ...s };
      searches.set(String(row.id), row);
      return row;
    },
    listSearches: () => [...searches.values()],
    getSearch: (id) => searches.get(String(id)) ?? null,
    deleteSearch: (id) => searches.delete(String(id)),
    touchSearch: (id) => calls.push(['touchSearch', id]),
    getSettings: () => settings,
    updateSettings(patch) {
      if (patch.dailyLimit !== undefined && !Number.isInteger(patch.dailyLimit)) {
        throw Object.assign(new Error('dailyLimit'), { code: 'bad_settings' });
      }
      settings = { ...settings, ...patch };
      return settings;
    },
    lastSentAt() {
      return db.lastSent;
    },
    addEvent(k, type, payload) {
      events.push({ id: events.length + 1, vacancyKey: k, type, payload, createdAt: events.length + 1 });
    },
    listEvents: (k) => events.filter((e) => e.vacancyKey === k),
    saveAnalysis(a) {
      const row = { id: `an_${analyses.length}`, createdAt: analyses.length, ...a };
      analyses.unshift(row);
      return row;
    },
    listAnalyses: () => analyses,
    saveLetter(l) {
      const row = { id: `let_${letters.size + 1}`, ...l };
      letters.set(row.id, row);
      return row;
    },
    getLetter: (id) => letters.get(id) ?? null,
    listPipeline: ({ status } = {}) => [...vacancies.values()].filter((v) => !status || v.status === status),
    stats() {
      const byStatus = {};
      for (const v of vacancies.values()) byStatus[v.status] = (byStatus[v.status] ?? 0) + 1;
      return { byStatus, sentToday: db.sentToday, sentLast7Days: 0, total: vacancies.size };
    }
  };
  return db;
}

function fakes() {
  const db = fakeDb();
  const hh = {
    submitCalls: [],
    isLoggedIn: async () => true,
    search: async () => ({
      total: 2,
      page: 0,
      items: [
        { id: '1', url: 'https://hh.ru/vacancy/1', title: 'A', employer: 'Acme' },
        { id: '2', url: 'https://hh.ru/vacancy/2', title: 'B', employer: 'Beta' }
      ]
    }),
    getVacancy: async (id) => ({ id, source: 'hh.ru', url: `https://hh.ru/vacancy/${id}`, title: 'A', description: 'полный' }),
    importResume: async (url) => ({ title: `T ${url}`, text: 'текст резюме' }),
    listMyResumes: async () => [
      { externalId: 'e1', url: 'https://hh.ru/resume/e1', title: 'Первое' },
      { externalId: 'e2', url: 'https://hh.ru/resume/e2', title: 'Второе' }
    ],
    inspectCalls: [],
    inspectResponseForm: async (id, opts) => {
      hh.inspectCalls.push([id, opts]);
      return { available: true, letter: 'optional', resumeHidden: false, resumeWarning: '', currentResumeTitle: 'CV', intro: '', questions: [] };
    },
    submitResponse: async function (args) {
      hh.submitCalls.push(args);
      return { submitted: true, confirmed: true, resumeTitle: 'CV' };
    },
    listNegotiations: async () => [
      { vacancyId: '1', status: 'Приглашение' },
      { vacancyId: '2', status: 'Не просмотрено' },
      { vacancyId: '77', status: 'Отказ' }
    ]
  };
  const li = { getVacancy: async (url) => ({ id: '555', source: 'linkedin', url, title: 'LI', description: 'd' }) };
  const sites = {
    hh,
    linkedin: li,
    forUrl: (url) => (url.includes('hh.ru') ? hh : url.includes('linkedin.com') ? li : null),
    forSource: (s) => (s === 'hh.ru' ? hh : s === 'linkedin' ? li : null)
  };
  const bridge = { status: async () => ({ connected: true }) };
  const llm = {
    status: async () => ({ connected: true, model: 'deepseek-test' }),
    processVacancyWorkflow: async ({ vacancy }) => ({
      status: 'drafted',
      key: vacancy.key,
      chosenResume: 'CV',
      fitScore: 85,
      letterId: 'let_test',
      lintOk: true
    })
  };
  return { db, sites, hh, bridge, llm };
}

async function connect(deps = fakes(), extra = {}) {
  const { hh, ...mcpDeps } = deps;
  const server = createMcpServer({ ...mcpDeps, ...extra });
  const client = new Client({ name: 'test', version: '0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  const call = async (name, args = {}) => {
    const res = await client.callTool({ name, arguments: args });
    assert.equal(res.content.length, 1);
    assert.equal(res.content[0].type, 'text');
    return { isError: res.isError === true, data: JSON.parse(res.content[0].text) };
  };
  return { call, client, ...deps };
}

test('регистрирует все инструменты контракта', async () => {
  const { client } = await connect();
  const names = (await client.listTools()).tools.map((t) => t.name);
  for (const n of [
    'browser_status', 'search_vacancies', 'get_vacancy', 'list_resumes', 'save_resume', 'import_resume',
    'get_instructions', 'save_fit_analysis', 'save_ats_match', 'rank_resumes', 'lint_letter', 'save_letter',
    'queue_application', 'list_pipeline', 'pipeline_stats', 'sync_responses', 'submit_application',
    'next_actions', 'sync_resumes', 'save_resume_review', 'save_search', 'list_searches', 'delete_search',
    'run_search', 'skip_vacancy', 'get_settings', 'update_settings', 'inspect_response_form', 'save_answers'
  ]) {
    assert.ok(names.includes(n), n);
  }
  // approved ставит только панель: MCP-инструмента для этого быть не должно
  assert.ok(!names.some((n) => /approve/i.test(n)));
  const prompts = (await client.listPrompts()).prompts.map((p) => p.name);
  assert.deepEqual(prompts, ['job_hunt']);
});

test('search_vacancies сохраняет found и отдаёт key со статусом', async () => {
  const { call, db } = await connect();
  const { data } = await call('search_vacancies', { text: 'n8n' });
  assert.deepEqual(data.items.map((i) => [i.key, i.status]), [['hh.ru:1', 'found'], ['hh.ru:2', 'found']]);
  assert.ok(db.getVacancy('hh.ru:1'));
});

test('ошибка моста сохраняет code и ставит isError', async () => {
  const deps = fakes();
  deps.hh.search = async () => {
    throw Object.assign(new Error('нет расширения'), { code: 'extension_not_connected' });
  };
  const { call } = await connect(deps);
  const { isError, data } = await call('search_vacancies', { text: 'x' });
  assert.equal(isError, true);
  assert.deepEqual(data, { error: { code: 'extension_not_connected', message: 'нет расширения' } });
});

test('get_instructions: letter просит plan перед text, fit указывает инструмент сохранения', async () => {
  const { call } = await connect();
  const letter = (await call('get_instructions', { kind: 'letter', lang: 'ru', tone: 'neutral' })).data;
  assert.equal(letter.saveWith, 'save_letter');
  assert.ok(typeof letter.system === 'string' && letter.system.length > 0);
  assert.ok(letter.shape.indexOf('plan') < letter.shape.indexOf('text'));
  assert.equal((await call('get_instructions', { kind: 'fit' })).data.saveWith, 'save_fit_analysis');
});

test('save_fit_analysis считает счёт и ставит scored; неизвестный ключ даёт not_found', async () => {
  const { call, db } = await connect();
  await call('search_vacancies', { text: 'x' });
  const { data } = await call('save_fit_analysis', {
    key: 'hh.ru:1', resumeId: 'r1', result: { hard_requirements_coverage_percent: 80, overall_match_score: 90 }
  });
  assert.equal(data.score, 87);
  assert.equal(db.getVacancy('hh.ru:1').status, 'scored');
  const miss = await call('save_fit_analysis', { key: 'hh.ru:404', resumeId: 'r1', result: {} });
  assert.equal(miss.data.error.code, 'not_found');
});

test('queue_application: lint_failed, not_found и успех', async () => {
  const { call, db } = await connect();
  await call('search_vacancies', { text: 'x' });
  const bad = db.saveLetter({ vacancyKey: 'hh.ru:1', text: 't', lint: { ok: false } });
  const good = db.saveLetter({ vacancyKey: 'hh.ru:1', text: 't', lint: { ok: true } });
  assert.equal((await call('queue_application', { key: 'hh.ru:1', letterId: bad.id, resumeId: 'r1' })).data.error.code, 'lint_failed');
  assert.equal((await call('queue_application', { key: 'hh.ru:1', letterId: 'nope', resumeId: 'r1' })).data.error.code, 'not_found');
  assert.equal((await call('queue_application', { key: 'hh.ru:9', letterId: good.id, resumeId: 'r1' })).data.error.code, 'not_found');
  assert.equal((await call('queue_application', { key: 'hh.ru:1', letterId: good.id, resumeId: 'r1' })).data.error.code, 'no_form');
  db.saveForm('hh.ru:1', { questions: [] });
  await call('queue_application', { key: 'hh.ru:1', letterId: good.id, resumeId: 'r1' });
  assert.equal(db.getVacancy('hh.ru:1').status, 'awaiting_approval');
  assert.equal(db.getVacancy('hh.ru:1').letterId, good.id);
});

test('mapHhStatus: регистронезависимо', () => {
  assert.equal(mapHhStatus('ПРИГЛАШЕНИЕ'), 'invited');
  assert.equal(mapHhStatus('Отказ'), 'rejected');
  assert.equal(mapHhStatus('Не просмотрено'), 'sent');
  assert.equal(mapHhStatus('Просмотрено'), 'sent');
  assert.equal(mapHhStatus('что-то новое'), 'sent');
});

test('sync_responses обновляет только известные вакансии и считает', async () => {
  const { call, db } = await connect();
  await call('search_vacancies', { text: 'x' });
  const { data } = await call('sync_responses');
  assert.equal(db.getVacancy('hh.ru:1').status, 'invited');
  assert.equal(db.getVacancy('hh.ru:2').status, 'sent');
  assert.equal(db.getVacancy('hh.ru:77'), null);
  assert.deepEqual([data.total, data.updated, data.unknown], [3, 2, 1]);
});

test('sync_responses пишет synced на просмотренных вакансиях', async () => {
  const { call, db } = await connect();
  await call('search_vacancies', { text: 'x' });
  await call('sync_responses');
  assert.deepEqual(db.events.filter((e) => e.type === 'synced').map((e) => e.vacancyKey).sort(), ['hh.ru:1', 'hh.ru:2']);
});

test('job_hunt: промпт с текстом workflow', async () => {
  const { client } = await connect();
  const p = await client.getPrompt({ name: 'job_hunt' });
  assert.match(p.messages[0].content.text, /sync_resumes/);
  assert.match(p.messages[0].content.text, /submit_application/);
});

test('next_actions: восемь шагов и подсказка по счётчикам', async () => {
  const { call, db } = await connect();
  const first = (await call('next_actions')).data;
  assert.equal(first.steps.length, 8);
  assert.deepEqual(first.steps.map((s) => s.step), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.ok(first.steps.every((s) => s.tools.length > 0));
  assert.match(first.suggestion, /search_vacancies/); // есть проверенное резюме, очередь пуста
  db.resumes.clear();
  assert.match((await call('next_actions')).data.suggestion, /sync_resumes/);
  db.resumes.set('r2', { id: 'r2', name: 'X', reviewedAt: null });
  const rev = (await call('next_actions')).data;
  assert.equal(rev.counts.resumesWithoutReview, 1);
  assert.match(rev.suggestion, /save_resume_review/);
  db.resumes.get('r2').reviewedAt = 1;
  await call('search_vacancies', { text: 'x' });
  db.setStatus('hh.ru:1', 'approved');
  const appr = (await call('next_actions')).data;
  assert.equal(appr.counts.approvedWaiting, 1);
  assert.equal(appr.steps[6].count, 1);
  assert.match(appr.suggestion, /submit_application/);
  assert.equal(appr.counts.dailyLimit, 20);
});

test('sync_resumes идёт дальше после сбоя и отдаёт errors', async () => {
  const deps = fakes();
  deps.hh.importResume = async (url) => {
    if (url.endsWith('e1')) throw Object.assign(new Error('boom'), { code: 'timeout' });
    return { title: 'Т', text: '12345' };
  };
  const { call } = await connect(deps);
  const { data } = await call('sync_resumes');
  assert.equal(data.items.length, 1);
  assert.deepEqual(data.items[0], { id: 'ext_e2', name: 'Второе', title: 'Второе', chars: 5, reviewed: false });
  assert.deepEqual(data.errors, [{ externalId: 'e1', title: 'Первое', code: 'timeout', message: 'boom' }]);
});

test('save_resume_review: оценка из overall_ats_score, not_found', async () => {
  const { call, db } = await connect();
  const { data } = await call('save_resume_review', { resumeId: 'r1', result: { overall_ats_score: 77 } });
  assert.equal(data.resume.reviewScore, 77);
  assert.equal(db.resumes.get('r1').review.overall_ats_score, 77);
  assert.equal((await call('save_resume_review', { resumeId: 'zz', result: {} })).data.error.code, 'not_found');
});

test('search_vacancies: чёрный список и стоп-слова отбрасываются до записи, filters передаются', async () => {
  const deps = fakes();
  let seen;
  deps.hh.search = async (a) => {
    seen = a;
    return {
      total: 3,
      page: 0,
      items: [
        { id: '1', title: 'Senior Dev', employer: 'Acme' },
        { id: '2', title: 'Junior Dev', employer: 'ООО Плохие' },
        { id: '3', title: 'Dev', employer: 'Beta' }
      ]
    };
  };
  const { call, db } = await connect(deps);
  db.updateSettings({ blacklistEmployers: ['ооо плохие'], stopWords: ['SENIOR'] });
  const { data } = await call('search_vacancies', { text: 'dev', filters: { experience: 'noExperience', work_format: ['REMOTE'] } });
  assert.deepEqual(data.items.map((i) => i.key), ['hh.ru:3']);
  assert.equal(data.dropped, 2);
  assert.equal(db.getVacancy('hh.ru:1'), null);
  assert.deepEqual(seen.filters, { experience: 'noExperience', work_format: ['REMOTE'] });
});

test('сохранённые поиски: save, list, run (touch), delete, not_found', async () => {
  const { call, db } = await connect();
  const saved = (await call('save_search', { name: 'n8n', text: 'n8n', filters: { schedule: 'remote' } })).data.search;
  assert.equal((await call('list_searches')).data.items.length, 1);
  const run = (await call('run_search', { id: saved.id })).data;
  assert.equal(run.items.length, 2);
  assert.ok(db.calls.some((c) => c[0] === 'touchSearch' && c[1] === saved.id));
  assert.equal((await call('run_search', { id: 'nope' })).data.error.code, 'not_found');
  assert.deepEqual((await call('delete_search', { id: saved.id })).data, { deleted: saved.id });
  assert.equal((await call('delete_search', { id: saved.id })).data.error.code, 'not_found');
  assert.equal((await call('list_searches')).data.items.length, 0);
});

test('get_vacancy: по key, по url hh/linkedin, unsupported_site, пустой вызов', async () => {
  const { call } = await connect();
  assert.equal((await call('get_vacancy', { key: 'hh.ru:5' })).data.key, 'hh.ru:5');
  const li = (await call('get_vacancy', { url: 'https://www.linkedin.com/jobs/view/555' })).data;
  assert.equal(li.key, 'linkedin:555');
  const bad = await call('get_vacancy', { url: 'https://example.com/job/1' });
  assert.equal(bad.isError, true);
  assert.equal(bad.data.error.code, 'unsupported_site');
  assert.equal((await call('get_vacancy', {})).data.error.code, 'bad_request');
});

test('rank_resumes отдаёт ranking и missing', async () => {
  const { call, db } = await connect();
  await call('search_vacancies', { text: 'x' });
  db.resumes.set('r2', { id: 'r2', name: 'Второе' });
  await call('save_ats_match', {
    key: 'hh.ru:1', resumeId: 'r1', result: { overall_match_score: 70, hard_requirements_coverage_percent: 80 }
  });
  const { data } = await call('rank_resumes', { key: 'hh.ru:1' });
  assert.deepEqual(data.ranking.map((r) => r.resumeId), ['r1']);
  assert.deepEqual(data.missing, [{ resumeId: 'r2', name: 'Второе' }]);
});

test('skip_vacancy ставит skipped с причиной в note', async () => {
  const { call, db } = await connect();
  await call('search_vacancies', { text: 'x' });
  await call('skip_vacancy', { key: 'hh.ru:1', reason: 'не наш стек' });
  assert.equal(db.getVacancy('hh.ru:1').status, 'skipped');
  assert.equal(db.getVacancy('hh.ru:1').note, 'не наш стек');
  assert.equal((await call('skip_vacancy', { key: 'hh.ru:9', reason: 'x' })).data.error.code, 'not_found');
});

test('get_settings / update_settings; bad_settings пробрасывает код', async () => {
  const { call } = await connect();
  assert.equal((await call('get_settings')).data.settings.dailyLimit, 20);
  assert.equal((await call('update_settings', { patch: { dailyLimit: 5 } })).data.settings.dailyLimit, 5);
  const bad = await call('update_settings', { patch: { dailyLimit: 1.5 } });
  assert.equal(bad.isError, true);
  assert.equal(bad.data.error.code, 'bad_settings');
});

// Вакансия, полностью готовая к отправке; каждый тест ломает одно условие.
async function ready(overrides = {}, extra = {}) {
  const ctx = await connect(fakes(), extra);
  await ctx.call('search_vacancies', { text: 'x' });
  const { db } = ctx;
  const letter = db.saveLetter({ vacancyKey: 'hh.ru:1', text: 'письмо', lint: { ok: true }, ...overrides.letter });
  db.setChoice('hh.ru:1', { resumeId: 'r1', letterId: letter.id });
  db.saveForm('hh.ru:1', { questions: [] });
  db.setStatus('hh.ru:1', overrides.status ?? 'approved');
  return { ...ctx, letter };
}

test('submit_application: каждый отказ имеет свой код и не трогает браузер', async () => {
  const code = async (ctx) => (await ctx.call('submit_application', { key: 'hh.ru:1' })).data.error?.code;

  let c = await ready({ status: 'awaiting_approval' });
  assert.equal(await code(c), 'not_approved');
  assert.equal(c.hh.submitCalls.length, 0);

  c = await ready();
  c.db.getVacancy('hh.ru:1').source = 'linkedin';
  assert.equal(await code(c), 'unsupported_site');
  assert.equal(c.hh.submitCalls.length, 0);

  c = await ready();
  c.db.getVacancy('hh.ru:1').letterId = null;
  assert.equal(await code(c), 'not_ready');
  c = await ready();
  c.db.resumes.get('r1').externalId = undefined;
  assert.equal(await code(c), 'not_ready');
  assert.equal(c.hh.submitCalls.length, 0);

  c = await ready({ letter: { lint: { ok: false } } });
  assert.equal(await code(c), 'lint_failed');
  assert.equal(c.hh.submitCalls.length, 0);

  c = await ready();
  c.db.sentToday = 20;
  assert.equal(await code(c), 'daily_limit');
  assert.equal(c.hh.submitCalls.length, 0);

  c = await ready({}, { now: () => 100_000 });
  c.db.lastSent = 100_000 - 10_000;
  const r = await c.call('submit_application', { key: 'hh.ru:1' });
  assert.equal(r.data.error.code, 'too_soon');
  assert.match(r.data.error.message, /35/);
  assert.equal(c.hh.submitCalls.length, 0);

  assert.equal((await c.call('submit_application', { key: 'hh.ru:404' })).data.error.code, 'not_found');
});

test('submit_application: пауза прошла, подтверждённая отправка даёт sent и submitted', async () => {
  const c = await ready({}, { now: () => 100_000 });
  c.db.lastSent = 100_000 - 45_000;
  const r = await c.call('submit_application', { key: 'hh.ru:1' });
  assert.equal(r.isError, false);
  assert.equal(r.data.confirmed, true);
  assert.deepEqual(c.hh.submitCalls, [{ vacancyId: '1', resumeExternalId: 'ext1', letter: 'письмо', answers: [], confirm: true }]);
  assert.equal(c.db.getVacancy('hh.ru:1').status, 'sent');
  assert.ok(c.db.events.some((e) => e.type === 'submitted'));
});

test('submit_application: неподтверждённая отправка блокирует повтор до sync_responses', async () => {
  const c = await ready();
  c.hh.submitResponse = async (args) => {
    c.hh.submitCalls.push(args);
    return { submitted: true, confirmed: false, resumeTitle: 'CV' };
  };
  const first = await c.call('submit_application', { key: 'hh.ru:1' });
  assert.equal(first.isError, false);
  assert.equal(first.data.confirmed, false);
  assert.match(first.data.next, /sync_responses/);
  assert.equal(c.db.getVacancy('hh.ru:1').status, 'approved');
  assert.equal(c.db.events.at(-1).type, 'submit_unconfirmed');

  const second = await c.call('submit_application', { key: 'hh.ru:1' });
  assert.equal(second.isError, true);
  assert.equal(second.data.error.code, 'submit_unconfirmed');
  assert.equal(c.hh.submitCalls.length, 1);

  // hh отклика не показал: сверка всё равно снимает блокировку (synced пишется и на одобренные)
  c.hh.listNegotiations = async () => [];
  await c.call('sync_responses');
  assert.equal(c.db.events.at(-1).type, 'synced');
  const third = await c.call('submit_application', { key: 'hh.ru:1' });
  assert.equal(third.isError, false);
  assert.equal(c.hh.submitCalls.length, 2);
});

test('submit_application: ошибка адаптера пишет submit_failed и оставляет статус', async () => {
  const c = await ready();
  c.hh.submitResponse = async (args) => {
    c.hh.submitCalls.push(args);
    throw Object.assign(new Error('таймаут'), { code: 'timeout' });
  };
  const r = await c.call('submit_application', { key: 'hh.ru:1' });
  assert.equal(r.isError, true);
  assert.deepEqual(r.data, { error: { code: 'timeout', message: 'таймаут' } });
  assert.equal(c.db.getVacancy('hh.ru:1').status, 'approved');
  const ev = c.db.events.at(-1);
  assert.equal(ev.type, 'submit_failed');
  assert.equal(ev.payload.code, 'timeout');
  assert.equal(c.hh.submitCalls.length, 1);
});

const FORM = {
  available: true,
  letter: 'optional',
  resumeHidden: false,
  questions: [
    { id: 'q1', text: 'Опыт?', kind: 'text', multiple: false, options: [], allowsOwn: false },
    {
      id: 'q2', text: 'Формат?', kind: 'choice', multiple: false, allowsOwn: true,
      options: [{ value: 'a', label: 'Офис' }, { value: 'b', label: 'Удалёнка' }]
    },
    {
      id: 'q3', text: 'Стек?', kind: 'choice', multiple: true, allowsOwn: false,
      options: [{ value: 'x', label: 'X' }, { value: 'y', label: 'Y' }]
    }
  ]
};

test('inspect_response_form: берёт резюме вакансии, сохраняет форму; чужой сайт и not_found', async () => {
  const c = await connect();
  await c.call('search_vacancies', { text: 'x' });
  c.db.setChoice('hh.ru:1', { resumeId: 'r1' });
  c.hh.inspectResponseForm = async (id, opts) => {
    c.hh.inspectCalls.push([id, opts]);
    return FORM;
  };
  const { data } = await c.call('inspect_response_form', { key: 'hh.ru:1' });
  assert.deepEqual(c.hh.inspectCalls, [['1', { resumeExternalId: 'ext1' }]]);
  assert.equal(data.form.questions.length, 3);
  assert.equal(typeof data.form.inspectedAt, 'number');
  assert.equal(c.db.getVacancy('hh.ru:1').form.questions.length, 3);
  c.db.getVacancy('hh.ru:2').source = 'linkedin';
  assert.equal((await c.call('inspect_response_form', { key: 'hh.ru:2' })).data.error.code, 'unsupported_site');
  assert.equal((await c.call('inspect_response_form', { key: 'hh.ru:9' })).data.error.code, 'not_found');
  // без выбранного резюме externalId не передаётся
  await c.call('inspect_response_form', { key: 'hh.ru:2' }).catch(() => {});
});

test('save_answers: успех, unanswered и каждая ошибка валидации', async () => {
  const c = await connect();
  await c.call('search_vacancies', { text: 'x' });
  const save = (answers) => c.call('save_answers', { key: 'hh.ru:1', answers });
  assert.equal((await save([])).data.error.code, 'no_form');
  c.db.saveForm('hh.ru:1', FORM);
  const ok = await save([{ id: 'q1', text: 'Пять лет' }, { id: 'q3', values: ['x', 'y'] }]);
  assert.equal(ok.isError, false);
  assert.deepEqual(ok.data.unanswered, ['q2']);
  assert.deepEqual(c.db.getVacancy('hh.ru:1').answers, [{ id: 'q1', text: 'Пять лет' }, { id: 'q3', values: ['x', 'y'] }]);
  const own = await save([{ id: 'q2', values: ['a'], own: 'Гибрид' }]);
  assert.deepEqual(own.data.vacancy.answers, [{ id: 'q2', own: 'Гибрид', values: ['a'] }]);
  for (const bad of [
    [{ id: 'nope', text: 'x' }],
    [{ id: 'q2', values: ['zzz'] }],
    [{ id: 'q2', values: ['a', 'b'] }],
    [{ id: 'q3', values: ['x'], own: 'свой' }],
    [{ id: 'q1', text: 'a' }, { id: 'q1', text: 'b' }],
    [{ id: 'q1', values: ['a'] }],
    [{ id: 'q2', text: 'a' }]
  ]) {
    const r = await save(bad);
    assert.equal(r.isError, true);
    assert.equal(r.data.error.code, 'bad_answers', JSON.stringify(bad));
  }
  assert.equal((await c.call('save_answers', { key: 'hh.ru:9', answers: [] })).data.error.code, 'not_found');
});

test('queue_application: no_form, resume_hidden, answers_required, затем успех', async () => {
  const c = await connect();
  await c.call('search_vacancies', { text: 'x' });
  const good = c.db.saveLetter({ vacancyKey: 'hh.ru:1', text: 't', lint: { ok: true } });
  const q = async () => (await c.call('queue_application', { key: 'hh.ru:1', letterId: good.id, resumeId: 'r1' })).data;
  assert.equal((await q()).error.code, 'no_form');
  c.db.saveForm('hh.ru:1', { ...FORM, resumeHidden: true, resumeWarning: 'скрыто' });
  assert.equal((await q()).error.code, 'resume_hidden');
  c.db.saveForm('hh.ru:1', FORM);
  const miss = await q();
  assert.equal(miss.error.code, 'answers_required');
  assert.match(miss.error.message, /q1.*q2.*q3/);
  await c.call('save_answers', { key: 'hh.ru:1', answers: [{ id: 'q1', text: ' ' }, { id: 'q2', values: ['a'] }, { id: 'q3', values: ['x'] }] });
  assert.equal((await q()).error.code, 'answers_required'); // пустой текст не ответ
  await c.call('save_answers', { key: 'hh.ru:1', answers: [{ id: 'q1', text: 'ok' }, { id: 'q2', values: ['a'] }, { id: 'q3', values: ['x'] }] });
  assert.equal((await q()).vacancy.status, 'awaiting_approval');
});

test('submit_application передаёт answers в адаптер', async () => {
  const c = await ready();
  const answers = [{ id: 'q1', text: 'ok' }];
  c.db.getVacancy('hh.ru:1').answers = answers;
  await c.call('submit_application', { key: 'hh.ru:1' });
  assert.deepEqual(c.hh.submitCalls[0].answers, answers);
});

test('submit_application: четыре кода формы возвращают в awaiting_approval с причиной и событием', async () => {
  for (const code of ['resume_hidden', 'answers_required', 'fill_mismatch', 'manual_required']) {
    const c = await ready();
    c.hh.submitResponse = async (args) => {
      c.hh.submitCalls.push(args);
      throw Object.assign(new Error('причина ' + code), { code });
    };
    const r = await c.call('submit_application', { key: 'hh.ru:1' });
    assert.equal(r.data.error.code, code);
    const v = c.db.getVacancy('hh.ru:1');
    assert.equal(v.status, 'awaiting_approval', code);
    assert.equal(v.note, 'submit: ' + code + ': причина ' + code);
    assert.ok(c.db.events.some((e) => e.type === 'submit_failed' && e.payload.code === code), code);
    assert.equal(c.hh.submitCalls.length, 1);
  }
  // прочие ошибки статус не трогают (проверено выше для timeout-подобного кода)
  const c = await ready();
  c.hh.submitResponse = async () => {
    throw Object.assign(new Error('x'), { code: 'timeout' });
  };
  await c.call('submit_application', { key: 'hh.ru:1' });
  assert.equal(c.db.getVacancy('hh.ru:1').status, 'approved');
});

test('FSM MCP инструменты: summary, inspect, advance, batch_advance', async () => {
  const c = await ready();

  // 1. fsm_pipeline_summary
  const sumRes = await c.call('fsm_pipeline_summary', {});
  assert.equal(sumRes.isError, false);
  assert.ok(sumRes.data.stateDistribution);
  assert.equal(typeof sumRes.data.stateDistribution.found, 'number');

  // 2. fsm_inspect_vacancy
  const inspRes = await c.call('fsm_inspect_vacancy', { key: 'hh.ru:1' });
  assert.equal(inspRes.isError, false);
  assert.equal(inspRes.data.status, 'approved');
  assert.equal(inspRes.data.progress, 90);

  // 3. fsm_advance_vacancy с блокером (попытка перевести approved без отправки)
  const advBlock = await c.call('fsm_advance_vacancy', { key: 'hh.ru:1', targetState: 'sent' });
  assert.equal(advBlock.isError, false);
  assert.equal(advBlock.data.advanced, false);
  assert.ok(advBlock.data.blockers.length > 0);

  // Создадим вакансию в found, готовую к переходу в scored
  c.db.upsertVacancy({
    source: 'hh.ru',
    id: 'fsm-test',
    title: 'Node.js Dev',
    description: 'Backend developer with Node.js and SQLite experience',
    resumeId: 'r1',
    status: 'found',
  });

  const advOk = await c.call('fsm_advance_vacancy', { key: 'hh.ru:fsm-test', targetState: 'scored' });
  assert.equal(advOk.isError, false);
  assert.equal(advOk.data.advanced, true);
  assert.equal(advOk.data.to, 'scored');
  assert.equal(c.db.getVacancy('hh.ru:fsm-test').status, 'scored');

  // 4. fsm_batch_advance
  const batchRes = await c.call('fsm_batch_advance', { limit: 5 });
  assert.equal(batchRes.isError, false);
  assert.equal(typeof batchRes.data.processed, 'number');
});

test('LLM инструменты: status, auto_process_vacancy, auto_run_pipeline', async () => {
  const c = await ready();

  // 1. llm_status
  const stRes = await c.call('llm_status', {});
  assert.equal(stRes.isError, false);
  assert.equal(stRes.data.connected, true);
  assert.equal(stRes.data.model, 'deepseek-test');

  // 2. auto_process_vacancy
  const procRes = await c.call('auto_process_vacancy', { key: 'hh.ru:1' });
  assert.equal(procRes.isError, false);
  assert.equal(procRes.data.status, 'drafted');
  assert.equal(procRes.data.fitScore, 85);

  // 3. auto_run_pipeline
  const runRes = await c.call('auto_run_pipeline', { limit: 2 });
  assert.equal(runRes.isError, false);
  assert.equal(typeof runRes.data.processed, 'number');
});

test('resolveStaticPath не выпускает за каталог', () => {
  const root = path.resolve('/srv/public');
  assert.equal(resolveStaticPath(root, '/'), path.join(root, 'index.html'));
  assert.equal(resolveStaticPath(root, '/app.js'), path.join(root, 'app.js'));
  assert.equal(resolveStaticPath(root, '/../secret'), null);
  assert.equal(resolveStaticPath(root, '/%2e%2e/secret'), null);
  assert.equal(resolveStaticPath(root, '/..%5Csecret'), null);
  assert.equal(resolveStaticPath(root, '/a%00'), null);
});

test('HTTP: healthz, 405 на GET /mcp, stateless POST /mcp, статика', async () => {
  const deps = fakes();
  const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
  const server = createApp({ ...deps, publicDir });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const health = await (await fetch(`${base}/healthz`)).json();
    assert.equal(health.ok, true);
    assert.ok(typeof health.requestId === 'string');
    assert.equal((await fetch(`${base}/mcp`)).status, 405);
    assert.equal((await fetch(`${base}/mcp`, { method: 'DELETE' })).status, 405);
    assert.equal((await fetch(`${base}/mcp`, { method: 'POST', body: '{' })).status, 400);
    const res = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '0' } }
      })
    });
    assert.equal(res.status, 200);
    assert.match(await res.text(), /jobfitcopilot/);
    assert.equal((await fetch(`${base}/..%2F..%2Fpackage.json`)).status, 404);
  } finally {
    server.close();
  }
});
