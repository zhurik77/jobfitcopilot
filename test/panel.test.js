// Комплексные тесты панели: сборка отчётов, экранирование, пороги оценок.
const test = require('node:test');
const assert = require('node:assert');
const { loadPanelExports } = require('../tools/panel-harness');

const panel = loadPanelExports();

// ---------- esc ----------
test('esc: экранирует HTML-спецсимволы', () => {
  assert.strictEqual(panel.esc('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.strictEqual(panel.esc('"hello" & \'world\''), '&quot;hello&quot; &amp; &#39;world&#39;');
  assert.strictEqual(panel.esc('a < b > c'), 'a &lt; b &gt; c');
});

test('esc: null/undefined возвращает пустую строку', () => {
  assert.strictEqual(panel.esc(null), '');
  assert.strictEqual(panel.esc(undefined), '');
  assert.strictEqual(panel.esc(''), '');
});

test('esc: обычный текст не меняется', () => {
  assert.strictEqual(panel.esc('Hello World'), 'Hello World');
  assert.strictEqual(panel.esc('12345'), '12345');
  assert.strictEqual(panel.esc('Привет, мир!'), 'Привет, мир!');
});

// ---------- scoreKind ----------
test('scoreKind: good >= 75', () => {
  assert.strictEqual(panel.scoreKind(100), 'good');
  assert.strictEqual(panel.scoreKind(75), 'good');
  assert.strictEqual(panel.scoreKind(85), 'good');
});

test('scoreKind: mid 50-74', () => {
  assert.strictEqual(panel.scoreKind(74), 'mid');
  assert.strictEqual(panel.scoreKind(50), 'mid');
  assert.strictEqual(panel.scoreKind(60), 'mid');
});

test('scoreKind: bad < 50', () => {
  assert.strictEqual(panel.scoreKind(49), 'bad');
  assert.strictEqual(panel.scoreKind(0), 'bad');
  assert.strictEqual(panel.scoreKind(-10), 'bad');
});

test('scoreKind: NaN/null/undefined = bad', () => {
  assert.strictEqual(panel.scoreKind(NaN), 'bad');
  assert.strictEqual(panel.scoreKind(null), 'bad');
  assert.strictEqual(panel.scoreKind(undefined), 'bad');
});

// ---------- computeScore ----------
test('computeScore: ledger дельты суммируются с BASE_SCORE=50', () => {
  assert.strictEqual(panel.computeScore({ ledger: [{ delta: 10 }, { delta: 20 }] }), 80);
  assert.strictEqual(panel.computeScore({ ledger: [{ delta: -10 }] }), 40);
  assert.strictEqual(panel.computeScore({ ledger: [{ delta: 50 }] }), 100);
});

test('computeScore: ledger пустой = 0 (падает на score)', () => {
  assert.strictEqual(panel.computeScore({ ledger: [] }), 0);
});

test('computeScore: score из поля, если нет ledger', () => {
  assert.strictEqual(panel.computeScore({ score: 71 }), 71);
  assert.strictEqual(panel.computeScore({ score: 0 }), 0);
});

test('computeScore: без ledger и score = 0', () => {
  assert.strictEqual(panel.computeScore({}), 0);
});

test('computeScore: null/undefined падает (ожидаемое поведение — вызывается только с объектом)', () => {
  assert.throws(() => panel.computeScore(null), /ledger/);
  assert.throws(() => panel.computeScore(undefined), /ledger/);
});

test('computeScore: границы [0, 100]', () => {
  assert.strictEqual(panel.computeScore({ ledger: [{ delta: -80 }] }), 0);
  assert.strictEqual(panel.computeScore({ ledger: [{ delta: 90 }] }), 100);
});

test('computeScore: нечисловая дельта игнорируется', () => {
  assert.strictEqual(panel.computeScore({ ledger: [{ delta: 'мусор' }] }), 50);
});

// ---------- rankResumeMatches ----------
test('rankResumeMatches: hard requirements важнее общего балла', () => {
  const items = [
    { resumeId: 1, name: 'A', hard: 90, overall: 30 },
    { resumeId: 2, name: 'B', hard: 80, overall: 90 },
  ];
  const ranked = panel.rankResumeMatches(items);
  assert.strictEqual(ranked[0].name, 'A');
  assert.strictEqual(ranked[1].name, 'B');
});

test('rankResumeMatches: при равенстве hard побеждает overall', () => {
  const items = [
    { resumeId: 1, name: 'A', hard: 80, overall: 70 },
    { resumeId: 2, name: 'B', hard: 80, overall: 90 },
  ];
  const ranked = panel.rankResumeMatches(items);
  assert.strictEqual(ranked[0].name, 'B');
});

test('rankResumeMatches: фильтрует failed', () => {
  const items = [
    { resumeId: 1, name: 'A', hard: 90, overall: 90 },
    { resumeId: 2, name: 'B', hard: 70, overall: 70, failed: true },
  ];
  const ranked = panel.rankResumeMatches(items);
  assert.strictEqual(ranked.length, 1);
  assert.strictEqual(ranked[0].name, 'A');
});

test('rankResumeMatches: один элемент', () => {
  const ranked = panel.rankResumeMatches([
    { resumeId: 1, name: 'A', hard: 50, overall: 50 },
  ]);
  assert.strictEqual(ranked.length, 1);
});

test('rankResumeMatches: пустой массив', () => {
  const ranked = panel.rankResumeMatches([]);
  assert.deepStrictEqual(ranked, []);
});

test('rankResumeMatches: null/undefined = пустой массив (filter убирает)', () => {
  const ranked = panel.rankResumeMatches([null, undefined]);
  assert.deepStrictEqual(ranked, []);
});

// ---------- splitExperienceHeading ----------
test('splitExperienceHeading: разделяет по точке-разделителю ·', () => {
  const r = panel.splitExperienceHeading('Senior Developer · удалённо');
  assert.strictEqual(r.title, 'Senior Developer');
  assert.strictEqual(r.meta, 'удалённо');
});

test('splitExperienceHeading: без разделителя', () => {
  const r = panel.splitExperienceHeading('Фриланс');
  assert.strictEqual(r.title, 'Фриланс');
  assert.strictEqual(r.meta, '');
});

test('splitExperienceHeading: пустое значение', () => {
  assert.deepStrictEqual(panel.splitExperienceHeading(''), { title: '', meta: '' });
  assert.deepStrictEqual(panel.splitExperienceHeading(undefined), { title: '', meta: '' });
});

test('splitExperienceHeading: несколько разделителей', () => {
  const r = panel.splitExperienceHeading('Lead · Москва · гибрид');
  assert.strictEqual(r.title, 'Lead');
  assert.strictEqual(r.meta, 'Москва · гибрид');
});

// ---------- buildAtsAuditReportHtml ----------
test('buildAtsAuditReportHtml: генерирует валидный HTML', () => {
  const html = panel.buildAtsAuditReportHtml({
    overall_ats_score: 85,
    hard_requirements_coverage_percent: 90,
    nice_to_have_coverage_percent: 70,
    score_breakdown: { formatting: 80, keywords: 75, sections: 60 },
    strengths: ['React', 'TypeScript'],
    weaknesses: [],
    critical_gaps: [],
    improvements: [],
    verdict: 'ОТКЛИКАТЬСЯ'
  }, 'My Resume');
  assert.ok(html.includes('<!doctype html>'));
  assert.ok(html.includes('My Resume'));
  assert.ok(html.includes('85'));
  assert.ok(html.includes('90'));
  assert.ok(html.includes('70'));
  assert.ok(html.includes('verdict'));
});

test('buildAtsAuditReportHtml: XSS-экранирование имени резюме', () => {
  const html = panel.buildAtsAuditReportHtml({
    overall_ats_score: 50,
    hard_requirements_coverage_percent: 50,
    nice_to_have_coverage_percent: 50,
    strengths: [],
    weaknesses: [],
    critical_gaps: [],
    improvements: [],
    verdict: 'ПРОПУСТИТЬ'
  }, '<script>alert("xss")</script>');
  assert.ok(!html.includes('<script>alert'));
  assert.ok(html.includes('&lt;script&gt;alert'));
});

test('buildAtsAuditReportHtml: null parsed падает с TypeError', () => {
  assert.throws(() => panel.buildAtsAuditReportHtml(null, null), TypeError);
});

// ---------- buildAnalyticsReportHtml ----------
test('buildAnalyticsReportHtml: генерирует отчёт', () => {
  const html = panel.buildAnalyticsReportHtml([
    { date: '2025-07-20', title: 'Dev', score: 85, status: 'sent', source: 'hh.ru' },
    { date: '2025-07-19', title: 'Senior', score: 70, status: 'found', source: 'linkedin' },
  ]);
  assert.ok(html.includes('<!doctype html>'));
  assert.ok(html.includes('Dev'));
  assert.ok(html.includes('Senior'));
});

test('buildAnalyticsReportHtml: пустой массив', () => {
  const html = panel.buildAnalyticsReportHtml([]);
  assert.ok(html);
  assert.ok(html.includes('<!doctype html>'));
});

test('buildAnalyticsReportHtml: null не падает', () => {
  const html = panel.buildAnalyticsReportHtml(null);
  assert.ok(html);
  assert.ok(html.includes('<!doctype html>'));
});

// ---------- extractor consistency ----------
test('scoreKind и computeScore согласованы: scoreKind(computeScore(...))', () => {
  const result = { ledger: [{ delta: 30 }] };
  const score = panel.computeScore(result);
  const kind = panel.scoreKind(score);
  // BASE_SCORE=50, delta=30 → 80 → good
  assert.strictEqual(score, 80);
  assert.strictEqual(kind, 'good');
});
