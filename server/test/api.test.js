import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApi } from '../src/api.js';

// Минимальный фейк БД: только методы, которые api.js реально вызывает.
function fakeDb() {
  let settings = { dailyLimit: 20, minDelaySec: 45, blacklistEmployers: [], stopWords: [] };
  const vacancies = new Map([
    ['hh.ru:1', { key: 'hh.ru:1', status: 'drafted', form: { questions: [{ id: 'q1', kind: 'text', options: [] }, { id: 'q2', kind: 'choice', multiple: false, allowsOwn: false, options: [{ value: 'a', label: 'A' }] }] } }],
    ['hh.ru:2', { key: 'hh.ru:2', status: 'drafted', form: null }]
  ]);
  const letters = new Map([['let_1', { id: 'let_1', vacancyKey: 'hh.ru:1', lang: 'ru', text: 'старое', lint: { ok: false } }]]);
  return {
    listPipeline: ({ status } = {}) => [...vacancies.values()].filter((v) => !status || v.status === status),
    getVacancy: (k) => vacancies.get(k) ?? null,
    listAnalyses: () => [{ id: 'an_1' }],
    listLetters: () => [...letters.values()],
    listEvents: () => [],
    setStatus: (k, status, note) => {
      const v = vacancies.get(k);
      v.status = status;
      v.note = note;
      return v;
    },
    getLetter: (id) => letters.get(id) ?? null,
    saveLetter: (l) => {
      letters.set(l.id, l);
      return l;
    },
    listResumes: () => [{ id: 'r1', name: 'CV', text: 'секрет', review: { a: 1 }, reviewScore: 80, reviewedAt: 5 }],
    getResume: (id) => (id === 'r1' ? { id: 'r1', name: 'CV', text: 'секрет', review: { a: 1 }, reviewScore: 80 } : null),
    comparison: () => [
      { resumeId: 'a', name: 'Слабое', hardCoverage: 50, overall: 90, analysisId: 'x', createdAt: 1 },
      { resumeId: 'b', name: 'Сильное', hardCoverage: 80, overall: 60, analysisId: 'y', createdAt: 2 }
    ],
    saveAnswers: (k, answers) => Object.assign(vacancies.get(k), { answers }),
    getSettings: () => settings,
    updateSettings: (patch) => {
      if (patch.dailyLimit === 999) throw Object.assign(new Error('dailyLimit вне диапазона'), { code: 'bad_settings' });
      settings = { ...settings, ...patch };
      return settings;
    },
    listSearches: () => [{ id: 's1', name: 'n8n' }],
    stats: () => ({ byStatus: {}, sentToday: 0, sentLast7Days: 0, total: 1 })
  };
}

async function withServer(fn) {
  const fakeLlm = {
    status: async () => ({ connected: true, model: 'fake-deepseek' }),
    processVacancyWorkflow: async ({ vacancy }) => ({
      status: 'drafted',
      key: vacancy.key,
      chosenResume: 'CV',
      fitScore: 88,
      letterId: 'let_test',
      lintOk: true
    })
  };
  const fakeAutopilot = {
    getStatus: () => ({ running: true, config: { enabled: true, intervalMin: 30 } }),
    updateConfig: (patch) => ({ enabled: true, intervalMin: 15, ...patch }),
    runCycle: async ({ force }) => ({ completed: true, queuedForApproval: 2, force })
  };
  const api = createApi({
    db: fakeDb(),
    lint: (text) => ({ ok: text.includes('ok'), issues: [] }),
    llm: fakeLlm,
    autopilot: fakeAutopilot
  });
  const server = http.createServer(async (req, res) => {
    if (!(await api.handle(req, res))) {
      res.statusCode = 418;
      res.end();
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    server.close();
  }
}

const post = (url, body, method = 'POST') =>
  fetch(url, { method, headers: { 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });

test('не-API пути не обрабатываются', async () => {
  await withServer(async (base) => {
    assert.equal((await fetch(`${base}/index.html`)).status, 418);
  });
});

test('GET pipeline, resumes, stats', async () => {
  await withServer(async (base) => {
    assert.equal((await (await fetch(`${base}/api/pipeline`)).json()).items.length, 2);
    assert.equal((await (await fetch(`${base}/api/pipeline?status=sent`)).json()).items.length, 0);
    assert.equal((await (await fetch(`${base}/api/resumes`)).json()).items[0].id, 'r1');
    assert.equal((await (await fetch(`${base}/api/stats`)).json()).total, 1);
  });
});

test('вакансия по URL-кодированному ключу и 404 для неизвестного', async () => {
  await withServer(async (base) => {
    const r = await fetch(`${base}/api/vacancies/${encodeURIComponent('hh.ru:1')}`);
    const body = await r.json();
    assert.equal(r.status, 200);
    assert.equal(body.vacancy.key, 'hh.ru:1');
    assert.equal(body.letters.length, 1);
    const miss = await fetch(`${base}/api/vacancies/${encodeURIComponent('hh.ru:999')}`);
    assert.equal(miss.status, 404);
    assert.equal((await miss.json()).error.code, 'not_found');
  });
});

test('статус: разрешённый проходит, запрещённый даёт 403 forbidden_status', async () => {
  await withServer(async (base) => {
    const url = `${base}/api/vacancies/${encodeURIComponent('hh.ru:1')}/status`;
    const okRes = await post(url, { status: 'approved', note: 'ок' });
    assert.equal(okRes.status, 200);
    assert.equal((await okRes.json()).vacancy.status, 'approved');
    const bad = await post(url, { status: 'sent' });
    assert.equal(bad.status, 403);
    assert.equal((await bad.json()).error.code, 'forbidden_status');
    const miss = await post(`${base}/api/vacancies/nope/status`, { status: 'skipped' });
    assert.equal(miss.status, 404);
  });
});

test('битый JSON даёт 400, слишком большое тело даёт 413', async () => {
  await withServer(async (base) => {
    const url = `${base}/api/vacancies/hh.ru%3A1/status`;
    const bad = await post(url, '{oops');
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).error.code, 'bad_json');
    const big = await post(url, JSON.stringify({ status: 'skipped', note: 'x'.repeat(1024 * 1024 + 10) }));
    assert.equal(big.status, 413);
  });
});

test('PUT письма перелинтовывает текст, неизвестное письмо даёт 404', async () => {
  await withServer(async (base) => {
    const res = await post(`${base}/api/letters/let_1`, { text: 'всё ok' }, 'PUT');
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.letter.text, 'всё ok');
    assert.equal(body.letter.lint.ok, true);
    assert.equal((await post(`${base}/api/letters/nope`, { text: 'x' }, 'PUT')).status, 404);
    assert.equal((await post(`${base}/api/letters/let_1`, {}, 'PUT')).status, 400);
  });
});

test('неизвестный маршрут и неверный метод', async () => {
  await withServer(async (base) => {
    assert.equal((await fetch(`${base}/api/nothing`)).status, 404);
    assert.equal((await post(`${base}/api/stats`, {})).status, 405);
  });
});

test('вакансия содержит comparison, ранжированный по покрытию, затем по общему баллу', async () => {
  await withServer(async (base) => {
    const body = await (await fetch(`${base}/api/vacancies/hh.ru%3A1`)).json();
    assert.deepEqual(body.comparison.map((c) => c.resumeId), ['b', 'a']);
    assert.equal(body.comparison[0].recommended, true);
    assert.equal(body.comparison[0].hardCoverage, 80);
    assert.equal(body.comparison[1].recommended, false);
  });
});

test('список резюме без text и review; деталь с ними; 404', async () => {
  await withServer(async (base) => {
    const item = (await (await fetch(`${base}/api/resumes`)).json()).items[0];
    assert.equal(item.reviewScore, 80);
    assert.equal(item.reviewedAt, 5);
    assert.ok(!('text' in item) && !('review' in item));
    const one = (await (await fetch(`${base}/api/resumes/r1`)).json()).resume;
    assert.equal(one.text, 'секрет');
    assert.deepEqual(one.review, { a: 1 });
    assert.equal((await fetch(`${base}/api/resumes/nope`)).status, 404);
  });
});

test('настройки: GET, PUT патчем, bad_settings даёт 400, не-объект даёт 400', async () => {
  await withServer(async (base) => {
    assert.equal((await (await fetch(`${base}/api/settings`)).json()).settings.dailyLimit, 20);
    const put = await post(`${base}/api/settings`, { dailyLimit: 5 }, 'PUT');
    assert.equal(put.status, 200);
    assert.equal((await put.json()).settings.dailyLimit, 5);
    const bad = await post(`${base}/api/settings`, { dailyLimit: 999 }, 'PUT');
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).error.code, 'bad_settings');
    assert.equal((await post(`${base}/api/settings`, [1], 'PUT')).status, 400);
    assert.equal((await post(`${base}/api/settings`, {}, 'DELETE')).status, 405);
  });
});

test('GET /api/searches', async () => {
  await withServer(async (base) => {
    assert.deepEqual((await (await fetch(`${base}/api/searches`)).json()).items, [{ id: 's1', name: 'n8n' }]);
  });
});

test('GET /api/fsm/summary и /api/fsm/vacancies/:key', async () => {
  await withServer(async (base) => {
    const summaryRes = await fetch(`${base}/api/fsm/summary`);
    assert.equal(summaryRes.status, 200);
    const summary = await summaryRes.json();
    assert.ok(summary.stateDistribution);

    const fsmRes = await fetch(`${base}/api/fsm/vacancies/${encodeURIComponent('hh.ru:1')}`);
    assert.equal(fsmRes.status, 200);
    const fsm = await fsmRes.json();
    assert.equal(fsm.status, 'drafted');
    assert.equal(typeof fsm.progress, 'number');

    const notFound = await fetch(`${base}/api/fsm/vacancies/hh.ru%3Anonexistent`);
    assert.equal(notFound.status, 404);
  });
});

test('PUT answers: сохраняет, 400 bad_answers и no_form, 404, 405', async () => {
  await withServer(async (base) => {
    const url = `${base}/api/vacancies/${encodeURIComponent('hh.ru:1')}/answers`;
    const ok = await post(url, { answers: [{ id: 'q1', text: 'да' }, { id: 'q2', values: ['a'] }] }, 'PUT');
    assert.equal(ok.status, 200);
    assert.deepEqual((await ok.json()).vacancy.answers, [{ id: 'q1', text: 'да' }, { id: 'q2', values: ['a'] }]);
    const bad = await post(url, { answers: [{ id: 'q2', values: ['zzz'] }] }, 'PUT');
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).error.code, 'bad_answers');
    assert.equal((await post(url, { answers: 'x' }, 'PUT')).status, 400);
    const noForm = await post(`${base}/api/vacancies/${encodeURIComponent('hh.ru:2')}/answers`, { answers: [] }, 'PUT');
    assert.equal(noForm.status, 400);
    assert.equal((await noForm.json()).error.code, 'no_form');
    assert.equal((await post(`${base}/api/vacancies/nope/answers`, { answers: [] }, 'PUT')).status, 404);
    assert.equal((await post(url, { answers: [] })).status, 405);
  });
});

test('FastAPI_CDEKLLM REST API: GET /api/llm/status и POST auto-process', async () => {
  await withServer(async (base) => {
    const statusRes = await fetch(`${base}/api/llm/status`);
    assert.equal(statusRes.status, 200);
    const st = await statusRes.json();
    assert.equal(st.connected, true);
    assert.equal(st.model, 'fake-deepseek');

    const procRes = await post(`${base}/api/vacancies/${encodeURIComponent('hh.ru:1')}/auto-process`, {}, 'POST');
    assert.equal(procRes.status, 200);
    const proc = await procRes.json();
    assert.equal(proc.status, 'drafted');
    assert.equal(proc.fitScore, 88);

    const notFound = await post(`${base}/api/vacancies/unknown/auto-process`, {}, 'POST');
    assert.equal(notFound.status, 404);
  });
});

test('Autopilot REST API: GET status, POST config, POST run-now', async () => {
  await withServer(async (base) => {
    const stRes = await fetch(`${base}/api/autopilot/status`);
    assert.equal(stRes.status, 200);
    const st = await stRes.json();
    assert.equal(st.running, true);
    assert.equal(st.config.enabled, true);

    const cfgRes = await post(`${base}/api/autopilot/config`, { intervalMin: 15 });
    assert.equal(cfgRes.status, 200);
    const cfg = await cfgRes.json();
    assert.equal(cfg.intervalMin, 15);

    const runRes = await post(`${base}/api/autopilot/run-now`, {});
    assert.equal(runRes.status, 200);
    const run = await runRes.json();
    assert.equal(run.completed, true);
    assert.equal(run.queuedForApproval, 2);
  });
});
