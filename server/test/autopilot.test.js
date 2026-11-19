import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AutopilotEngine } from '../src/core/autopilot.js';

function fakeDb() {
  const vacancies = new Map([
    ['hh.ru:10', { key: 'hh.ru:10', id: '10', title: 'Python Dev', status: 'approved', resumeId: 'r1', letterId: 'let1' }],
    ['hh.ru:20', { key: 'hh.ru:20', id: '20', title: 'React Dev', status: 'found', description: null }],
    ['hh.ru:30', { key: 'hh.ru:30', id: '30', title: 'Node Dev', status: 'found', description: 'Full description text' }],
    ['hh.ru:999', { key: 'hh.ru:999', id: '999', title: 'Tech Lead', status: 'sent' }],
  ]);
  const resumes = [{ id: 'r1', name: 'CV', externalId: 'ext1', text: '5 years Node.js' }];
  const letters = new Map([['let1', { id: 'let1', text: 'Письмо', lint: { ok: true } }]]);

  return {
    getVacancy: (k) => vacancies.get(k) ?? null,
    listPipeline: ({ status } = {}) => [...vacancies.values()].filter(v => !status || v.status === status),
    setStatus: (k, status, note) => {
      const v = vacancies.get(k);
      if (v) { v.status = status; v.note = note; }
      return v;
    },
    upsertVacancy: (item) => {
      const k = `${item.source || 'hh.ru'}:${item.id}`;
      const existing = vacancies.get(k) || { key: k };
      Object.assign(existing, item);
      vacancies.set(k, existing);
      return existing;
    },
    listResumes: () => resumes,
    getResume: (id) => resumes.find(r => r.id === id) || null,
    getLetter: (id) => letters.get(id) || null,
    saveLetter: (l) => { letters.set(l.id, l); return l; },
    saveForm: (k, form) => {
      const v = vacancies.get(k);
      if (v) v.form = form;
      return v;
    },
    saveAnswers: (k, answers) => {
      const v = vacancies.get(k);
      if (v) v.answers = answers;
      return v;
    },
    addEvent: () => {},
    lastSentAt: () => null,
    stats: () => ({ sentToday: 0 }),
    getSettings: () => ({ dailyLimit: 20, minDelaySec: 0 }),
    listSearches: () => [{ id: 's1', text: 'Node', enabled: true }],
    touchSearch: () => {},
  };
}

test('AutopilotEngine: lifecycle, config and work hours', () => {
  const db = fakeDb();
  const engine = new AutopilotEngine({ db, sites: {}, bridge: {}, llm: {} });

  assert.equal(engine.isRunning, false);
  engine.updateConfig({ enabled: true, intervalMin: 15 });
  assert.equal(engine.isRunning, true);
  assert.equal(engine.config.intervalMin, 15);

  engine.stop();
  assert.equal(engine.isRunning, false);
});

test('AutopilotEngine: runCycle full execution without exceptions', async () => {
  const db = fakeDb();
  const submittedCalls = [];
  const sites = {
    hh: {
      listNegotiations: async () => [{ vacancyId: '999', status: 'Приглашение на интервью' }],
      submitResponse: async (args) => {
        submittedCalls.push(args);
        return { confirmed: true, resumeTitle: 'CV' };
      },
      search: async () => ({ items: [{ id: '99', title: 'Golang Dev', employer: 'Google' }] }),
      getVacancy: async (id) => ({ id, description: 'Detailed Golang job description' }),
      inspectResponseForm: async () => ({ resumeHidden: false, questions: [] }),
    }
  };

  const llm = {
    processVacancyWorkflow: async ({ vacancy }) => ({
      status: 'drafted',
      key: vacancy.key,
      chosenResume: 'CV',
      fitScore: 80,
      letterId: 'let_test',
      lintOk: true
    }),
    answerQuestions: async () => [],
  };

  const engine = new AutopilotEngine({
    db,
    sites,
    bridge: {},
    llm,
    sleep: async () => {},
  });

  const report = await engine.runCycle({ force: true });
  assert.equal(report.submitted, 1);
  assert.equal(report.discovered, 1);
  assert.equal(report.enriched, 1);
  assert.equal(report.scored, 2);
  assert.equal(report.syncedNegotiations, 1);
  assert.ok(report.alerts.some(a => a.includes('ПРИГЛАШЕНИЕ')));
});
