import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createDb, STATUSES } from '../src/db.js';

// Управляемые часы: порядок «новые первыми» не должен зависеть от разрешения Date.now().
function makeDb(start = Date.now()) {
  const clock = { t: start };
  const db = createDb(':memory:', { now: () => clock.t });
  return { db, clock, tick: (ms = 1000) => (clock.t += ms) };
}

const searchItem = (id, extra = {}) => ({
  id, url: `https://hh.ru/vacancy/${id}`, title: `Title ${id}`, employer: 'Acme',
  address: 'Москва', salary: '100 000', experience: '1-3 года', snippet: 'кратко', ...extra,
});

const fullVacancy = (id, extra = {}) => ({
  id, source: 'hh.ru', url: `https://hh.ru/vacancy/${id}`, title: `Title ${id}`, company: 'Acme',
  salary: null, experience: '1-3 года', description: 'Полное описание', skills: ['n8n', 'SQL'], ...extra,
});

test('STATUSES соответствует контракту', () => {
  assert.deepEqual(STATUSES, ['found', 'scored', 'drafted', 'awaiting_approval', 'approved',
    'sent', 'replied', 'invited', 'rejected', 'skipped']);
});

test('upsertVacancy: поисковая карточка создаёт found, employer -> company, source по умолчанию hh.ru', () => {
  const { db } = makeDb();
  const row = db.upsertVacancy(searchItem('1'));
  assert.equal(row.key, 'hh.ru:1');
  assert.equal(row.source, 'hh.ru');
  assert.equal(row.id, '1');
  assert.equal(row.company, 'Acme');
  assert.equal(row.status, 'found');
  assert.deepEqual(row.skills, []);
  assert.equal(row.description, null);
  assert.equal(row.resumeId, null);
  assert.equal(row.letterId, null);
  assert.equal(typeof row.fetchedAt, 'number');
  assert.equal(typeof row.updatedAt, 'number');
  db.close();
});

test('upsertVacancy: числовой id приводится к строке, ключ собирается из source и id', () => {
  const { db } = makeDb();
  const row = db.upsertVacancy({ id: 77, source: 'other.ru', title: 'T' });
  assert.equal(row.key, 'other.ru:77');
  assert.equal(row.id, '77');
  assert.throws(() => db.upsertVacancy({ title: 'no id' }), (e) => e.code === 'bad_vacancy');
  db.close();
});

test('upsertVacancy не понижает строку: описание, навыки и статус сохраняются', () => {
  const { db, tick } = makeDb();
  db.upsertVacancy(fullVacancy('2'));
  db.setStatus('hh.ru:2', 'scored', 'ok');
  tick();
  const row = db.upsertVacancy(searchItem('2', { title: 'Новый заголовок' }));
  assert.equal(row.description, 'Полное описание');
  assert.deepEqual(row.skills, ['n8n', 'SQL']);
  assert.equal(row.status, 'scored');
  assert.equal(row.note, 'ok');
  assert.equal(row.title, 'Новый заголовок');
  assert.equal(row.snippet, 'кратко');
  // Пустые строки и пустой массив тоже не затирают.
  const row2 = db.upsertVacancy({ id: '2', description: '', skills: [], title: '' });
  assert.equal(row2.description, 'Полное описание');
  assert.deepEqual(row2.skills, ['n8n', 'SQL']);
  assert.equal(row2.title, 'Новый заголовок');
  db.close();
});

test('upsertVacancy: полная карточка дополняет поисковую и обновляет fetchedAt', () => {
  const { db, tick } = makeDb();
  const first = db.upsertVacancy(searchItem('3'));
  tick();
  const afterSearch = db.upsertVacancy(searchItem('3'));
  assert.equal(afterSearch.fetchedAt, first.fetchedAt);
  tick();
  const full = db.upsertVacancy(fullVacancy('3'));
  assert.equal(full.description, 'Полное описание');
  assert.deepEqual(full.skills, ['n8n', 'SQL']);
  assert.ok(full.fetchedAt > first.fetchedAt);
  assert.equal(full.address, 'Москва'); // из поиска, не затёрт полной карточкой без адреса
  db.close();
});

test('getVacancy: неизвестный ключ даёт null', () => {
  const { db } = makeDb();
  assert.equal(db.getVacancy('hh.ru:nope'), null);
  db.close();
});

test('setStatus: пишет событие status {from,to,note} и обновляет строку', () => {
  const { db, tick } = makeDb();
  db.upsertVacancy(searchItem('4'));
  tick();
  const row = db.setStatus('hh.ru:4', 'scored', 'первая оценка');
  assert.equal(row.status, 'scored');
  assert.equal(row.note, 'первая оценка');
  db.setStatus('hh.ru:4', 'drafted');
  const events = db.listEvents('hh.ru:4');
  assert.equal(events.length, 2);
  assert.equal(events[0].type, 'status');
  assert.deepEqual(events[0].payload, { from: 'found', to: 'scored', note: 'первая оценка' });
  assert.deepEqual(events[1].payload, { from: 'scored', to: 'drafted', note: null });
  // Заметка без нового note остаётся прежней.
  assert.equal(db.getVacancy('hh.ru:4').note, 'первая оценка');
  db.close();
});

test('setStatus: неизвестный статус и неизвестный ключ бросают ошибку с кодом, событий не остаётся', () => {
  const { db } = makeDb();
  db.upsertVacancy(searchItem('5'));
  assert.throws(() => db.setStatus('hh.ru:5', 'bogus'), (e) => e instanceof Error && e.code === 'bad_status');
  assert.throws(() => db.setStatus('hh.ru:missing', 'sent'), (e) => e instanceof Error && e.code === 'not_found');
  assert.equal(db.getVacancy('hh.ru:5').status, 'found');
  assert.deepEqual(db.listEvents('hh.ru:5'), []);
  db.close();
});

test('setChoice: сохраняет резюме и письмо, частичный вызов не стирает второе поле', () => {
  const { db } = makeDb();
  db.upsertVacancy(searchItem('6'));
  let row = db.setChoice('hh.ru:6', { resumeId: 'res_a', letterId: 'let_a' });
  assert.equal(row.resumeId, 'res_a');
  assert.equal(row.letterId, 'let_a');
  row = db.setChoice('hh.ru:6', { resumeId: 'res_b' });
  assert.equal(row.resumeId, 'res_b');
  assert.equal(row.letterId, 'let_a');
  assert.throws(() => db.setChoice('hh.ru:zzz', { resumeId: 'x' }), (e) => e.code === 'not_found');
  db.close();
});

test('резюме: id генерируется, повторное сохранение обновляет на месте', () => {
  const { db, tick } = makeDb();
  const a = db.saveResume({ name: 'Основное', text: 'v1' });
  assert.match(a.id, /^res_/);
  tick();
  const b = db.saveResume({ id: a.id, name: 'Основное 2', text: 'v2' });
  assert.equal(b.id, a.id);
  assert.equal(b.name, 'Основное 2');
  assert.equal(b.text, 'v2');
  assert.equal(b.createdAt, a.createdAt);
  assert.ok(b.updatedAt > a.updatedAt);
  assert.equal(db.listResumes().length, 1);
  db.saveResume({ name: 'Второе', text: 'x' });
  assert.equal(db.listResumes().length, 2);
  assert.deepEqual(db.getResume(a.id), b);
  assert.equal(db.getResume('res_none'), null);
  db.close();
});

test('анализы: JSON payload разбирается, список новых первыми', () => {
  const { db, tick } = makeDb();
  db.upsertVacancy(searchItem('7'));
  const a1 = db.saveAnalysis({ vacancyKey: 'hh.ru:7', resumeId: 'r', kind: 'ats', score: 60,
    verdict: 'maybe', payload: { overall_match_score: 60 } });
  tick();
  const a2 = db.saveAnalysis({ vacancyKey: 'hh.ru:7', resumeId: 'r', kind: 'fit', score: 80,
    verdict: 'apply', payload: { ledger: [{ delta: 5 }] } });
  assert.notEqual(a1.id, a2.id);
  assert.deepEqual(a2.payload, { ledger: [{ delta: 5 }] });
  const list = db.listAnalyses('hh.ru:7');
  assert.deepEqual(list.map((x) => x.id), [a2.id, a1.id]);
  assert.equal(list[0].vacancyKey, 'hh.ru:7');
  assert.deepEqual(db.listAnalyses('hh.ru:other'), []);
  assert.throws(() => db.saveAnalysis({ vacancyKey: 'hh.ru:none', kind: 'fit' }), (e) => e.code === 'not_found');
  db.close();
});

test('письма: JSON plan и lint, обновление на месте по id, список по вакансии', () => {
  const { db, tick } = makeDb();
  db.upsertVacancy(searchItem('8'));
  const l1 = db.saveLetter({ vacancyKey: 'hh.ru:8', resumeId: 'r', lang: 'ru',
    plan: ['факт 1', 'факт 2'], text: 'черновик', lint: { ok: false, issues: [] } });
  assert.match(l1.id, /^let_/);
  assert.deepEqual(l1.plan, ['факт 1', 'факт 2']);
  assert.deepEqual(l1.lint, { ok: false, issues: [] });
  tick();
  const l2 = db.saveLetter({ id: l1.id, vacancyKey: 'hh.ru:8', resumeId: 'r', lang: 'ru',
    plan: ['факт 1'], text: 'правка', lint: { ok: true, issues: [] } });
  assert.equal(l2.id, l1.id);
  assert.equal(l2.text, 'правка');
  assert.equal(l2.lint.ok, true);
  assert.equal(l2.createdAt, l1.createdAt);
  assert.ok(l2.updatedAt > l1.updatedAt);
  assert.equal(db.listLetters('hh.ru:8').length, 1);
  tick();
  const l3 = db.saveLetter({ vacancyKey: 'hh.ru:8', resumeId: 'r', lang: 'en', plan: null, text: 'second', lint: null });
  assert.deepEqual(db.listLetters('hh.ru:8').map((x) => x.id), [l3.id, l1.id]);
  assert.deepEqual(db.getLetter(l1.id), l2);
  assert.equal(db.getLetter('let_none'), null);
  assert.equal(l3.plan, null);
  assert.throws(() => db.saveLetter({ vacancyKey: 'hh.ru:none', text: 'x' }), (e) => e.code === 'not_found');
  db.close();
});

test('события: addEvent и listEvents в хронологическом порядке с разобранным payload', () => {
  const { db } = makeDb();
  db.upsertVacancy(searchItem('9'));
  db.addEvent('hh.ru:9', 'note', { text: 'один' });
  db.addEvent('hh.ru:9', 'note', { text: 'два' });
  const ev = db.listEvents('hh.ru:9');
  assert.deepEqual(ev.map((e) => e.payload.text), ['один', 'два']);
  assert.equal(ev[0].type, 'note');
  assert.equal(ev[0].vacancyKey, 'hh.ru:9');
  assert.throws(() => db.addEvent('hh.ru:none', 'note', {}), (e) => e.code === 'not_found');
  db.close();
});

test('listPipeline: новые обновления первыми, фильтр по статусу, limit', () => {
  const { db, tick } = makeDb();
  db.upsertVacancy(searchItem('a'));
  tick();
  db.upsertVacancy(searchItem('b'));
  tick();
  db.upsertVacancy(searchItem('c'));
  assert.deepEqual(db.listPipeline().map((r) => r.id), ['c', 'b', 'a']);
  tick();
  db.setStatus('hh.ru:a', 'scored');
  assert.deepEqual(db.listPipeline().map((r) => r.id), ['a', 'c', 'b']);
  assert.deepEqual(db.listPipeline({ status: 'scored' }).map((r) => r.id), ['a']);
  assert.equal(db.listPipeline({ limit: 2 }).length, 2);
  db.close();
});

test('listPipeline: lastScore/lastVerdict из последнего fit, иначе ats, иначе null', () => {
  const { db, tick } = makeDb();
  for (const id of ['x', 'y', 'z']) { db.upsertVacancy(searchItem(id)); tick(); }
  db.saveAnalysis({ vacancyKey: 'hh.ru:x', kind: 'fit', score: 40, verdict: 'old fit' });
  tick();
  db.saveAnalysis({ vacancyKey: 'hh.ru:x', kind: 'fit', score: 70, verdict: 'new fit' });
  tick();
  db.saveAnalysis({ vacancyKey: 'hh.ru:x', kind: 'ats', score: 99, verdict: 'ats later' });
  db.saveAnalysis({ vacancyKey: 'hh.ru:y', kind: 'ats', score: 55, verdict: 'only ats' });
  const byId = Object.fromEntries(db.listPipeline().map((r) => [r.id, r]));
  assert.equal(byId.x.lastScore, 70);
  assert.equal(byId.x.lastVerdict, 'new fit');
  assert.equal(byId.y.lastScore, 55);
  assert.equal(byId.y.lastVerdict, 'only ats');
  assert.equal(byId.z.lastScore, null);
  assert.equal(byId.z.lastVerdict, null);
  db.close();
});

test('stats: byStatus, total, sentToday и sentLast7Days по локальным суткам', () => {
  const day = 24 * 3600 * 1000;
  const d = new Date();
  const noonToday = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12).getTime();
  const { db, clock } = makeDb(noonToday - 10 * day);
  for (const id of ['1', '2', '3', '4', '5']) db.upsertVacancy(searchItem(id));

  // Отправлено 10 дней назад: вне окна 7 дней.
  db.setStatus('hh.ru:1', 'sent');
  // 3 дня назад: в окне, но не сегодня.
  clock.t = noonToday - 3 * day;
  db.setStatus('hh.ru:2', 'sent');
  // Сегодня.
  clock.t = noonToday;
  db.setStatus('hh.ru:3', 'sent');
  db.setStatus('hh.ru:4', 'approved'); // не sent, в счёт не идёт
  // Переход из sent в replied не должен считаться отправкой.
  db.setStatus('hh.ru:3', 'replied');

  const s = db.stats();
  assert.equal(s.sentToday, 1);
  assert.equal(s.sentLast7Days, 2);
  assert.equal(s.total, 5);
  assert.deepEqual(s.byStatus, { found: 1, sent: 2, replied: 1, approved: 1 });
  db.close();
});

test('stats: пустая база', () => {
  const { db } = makeDb();
  assert.deepEqual(db.stats(), { byStatus: {}, sentToday: 0, sentLast7Days: 0, total: 0 });
  db.close();
});

test('файловая база: данные переживают переоткрытие, WAL включён, user_version выставлен', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jobfit-db-'));
  try {
    const file = join(dir, 'nested', 'jobfit.db');
    const db1 = createDb(file);
    db1.upsertVacancy(fullVacancy('p1'));
    db1.setStatus('hh.ru:p1', 'approved', 'persist');
    const res = db1.saveResume({ name: 'R', text: 'text' });
    const letter = db1.saveLetter({ vacancyKey: 'hh.ru:p1', resumeId: res.id, lang: 'ru',
      plan: ['a'], text: 'letter', lint: { ok: true } });
    db1.close();

    const db2 = createDb(file); // повторное открытие: схема создаётся идемпотентно
    const v = db2.getVacancy('hh.ru:p1');
    assert.equal(v.status, 'approved');
    assert.equal(v.note, 'persist');
    assert.deepEqual(v.skills, ['n8n', 'SQL']);
    assert.deepEqual(db2.getResume(res.id), res);
    assert.deepEqual(db2.getLetter(letter.id), letter);
    assert.equal(db2.listEvents('hh.ru:p1').length, 1);
    db2.close();

    const raw = new DatabaseSync(file);
    assert.equal(raw.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
    assert.equal(raw.prepare('PRAGMA user_version').get().user_version, 3);
    raw.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Схема версии 1, собранная вручную: копия того, что лежит в реальном Docker-томе.
const V1_SCHEMA = `
CREATE TABLE vacancies (key TEXT PRIMARY KEY, source TEXT NOT NULL, external_id TEXT NOT NULL, url TEXT,
  title TEXT, company TEXT, salary TEXT, experience TEXT, address TEXT, snippet TEXT, description TEXT,
  skills TEXT, status TEXT NOT NULL DEFAULT 'found', resume_id TEXT, letter_id TEXT, note TEXT,
  fetched_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE INDEX idx_vacancies_status ON vacancies(status);
CREATE INDEX idx_vacancies_updated ON vacancies(updated_at);
CREATE TABLE resumes (id TEXT PRIMARY KEY, name TEXT NOT NULL, text TEXT NOT NULL,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE analyses (id TEXT PRIMARY KEY, vacancy_key TEXT NOT NULL, resume_id TEXT, kind TEXT NOT NULL,
  score REAL, verdict TEXT, payload TEXT, created_at INTEGER NOT NULL);
CREATE INDEX idx_analyses_vacancy ON analyses(vacancy_key);
CREATE TABLE letters (id TEXT PRIMARY KEY, vacancy_key TEXT NOT NULL, resume_id TEXT, lang TEXT, plan TEXT,
  text TEXT NOT NULL, lint TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE INDEX idx_letters_vacancy ON letters(vacancy_key);
CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, vacancy_key TEXT NOT NULL, type TEXT NOT NULL,
  payload TEXT, created_at INTEGER NOT NULL);
CREATE INDEX idx_events_vacancy ON events(vacancy_key);
PRAGMA user_version = 1;
`;

const schemaOf = (file) => {
  const raw = new DatabaseSync(file);
  const cols = (t) => raw.prepare(`PRAGMA table_info(${t})`).all().map((c) => `${c.name}:${c.type}:${c.notnull}:${c.dflt_value}`);
  const out = {
    resumes: cols('resumes'), vacancies: cols('vacancies'), searches: cols('searches'), settings: cols('settings'),
    indexes: raw.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all().map((r) => r.name),
  };
  raw.close();
  return out;
};

test('миграция 1 -> 2: строки сохраняются, новые методы работают, схема равна свежей', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jobfit-mig-'));
  try {
    const file = join(dir, 'v1.db');
    const raw = new DatabaseSync(file);
    raw.exec(V1_SCHEMA);
    raw.prepare(`INSERT INTO vacancies (key, source, external_id, title, skills, status, note, fetched_at, updated_at)
      VALUES ('hh.ru:1', 'hh.ru', '1', 'Старая', '["n8n"]', 'sent', 'заметка', 100, 200)`).run();
    raw.prepare(`INSERT INTO vacancies (key, source, external_id, title, fetched_at, updated_at)
      VALUES ('hh.ru:2', 'hh.ru', '2', 'Вторая', 100, 100)`).run();
    raw.prepare("INSERT INTO resumes VALUES ('res_old', 'Старое', 'текст', 10, 20)").run();
    raw.prepare("INSERT INTO resumes VALUES ('res_old2', 'Старое 2', 'текст 2', 11, 21)").run();
    raw.prepare(`INSERT INTO analyses VALUES ('an_1', 'hh.ru:1', 'res_old', 'ats', 70, 'v',
      '{"overall_match_score":70}', 300)`).run();
    raw.prepare("INSERT INTO events (vacancy_key, type, payload, created_at) VALUES ('hh.ru:1', 'x', '{}', 1)").run();
    raw.close();

    const db = createDb(file);
    const v = db.getVacancy('hh.ru:1');
    assert.equal(v.title, 'Старая');
    assert.equal(v.status, 'sent');
    assert.equal(v.note, 'заметка');
    assert.deepEqual(v.skills, ['n8n']);
    assert.equal(v.updatedAt, 200);
    assert.equal(v.sentAt, null);
    assert.equal(db.getVacancy('hh.ru:2').title, 'Вторая');
    assert.equal(db.listResumes().length, 2);
    const r = db.getResume('res_old');
    assert.equal(r.name, 'Старое');
    assert.equal(r.text, 'текст');
    assert.equal(r.source, 'manual');
    assert.equal(r.externalId, null);
    assert.equal(r.review, null);
    assert.equal(r.createdAt, 10);
    assert.equal(db.listAnalyses('hh.ru:1').length, 1);
    assert.equal(db.listEvents('hh.ru:1').length, 1);
    assert.equal(db.lastSentAt(), null);

    // Новые методы на мигрированном файле.
    const up = db.upsertResumeByExternal({ source: 'hh.ru', externalId: 'abc', title: 'T', text: 'x' });
    assert.equal(up.name, 'T');
    assert.equal(db.saveSearch({ name: 's', text: 'n8n' }).area, 113);
    assert.equal(db.getSettings().dailyLimit, 20);
    assert.equal(db.comparison('hh.ru:1')[0].overall, 70);
    db.close();

    const rawAfter = new DatabaseSync(file);
    assert.equal(rawAfter.prepare('PRAGMA user_version').get().user_version, 3);
    rawAfter.close();

    // Повторное открытие не мигрирует второй раз и ничего не теряет.
    const db2 = createDb(file);
    assert.equal(db2.listResumes().length, 3);
    db2.close();

    const fresh = join(dir, 'fresh.db');
    createDb(fresh).close();
    assert.deepEqual(schemaOf(file), schemaOf(fresh));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('миграция откатывается целиком при сбое: версия остаётся 1', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jobfit-mig-'));
  try {
    const file = join(dir, 'broken.db');
    const raw = new DatabaseSync(file);
    raw.exec(V1_SCHEMA);
    // Колонка review уже есть, поэтому её ALTER упадёт после успешных ALTER source/external_id/url/title.
    raw.exec('ALTER TABLE resumes ADD COLUMN review TEXT');
    raw.close();
    assert.throws(() => createDb(file));
    const after = new DatabaseSync(file);
    assert.equal(after.prepare('PRAGMA user_version').get().user_version, 1);
    const cols = after.prepare('PRAGMA table_info(resumes)').all().map((c) => c.name);
    assert.ok(!cols.includes('source'), 'ALTER source должен откатиться');
    after.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('upsertResumeByExternal: обновляет на месте, сохраняет id, name и review', () => {
  const { db, tick } = makeDb();
  const a = db.upsertResumeByExternal({ source: 'hh.ru', externalId: 'h1', url: 'u1', title: 'Заголовок', text: 'v1' });
  assert.match(a.id, /^res_/);
  assert.equal(a.name, 'Заголовок');
  assert.equal(a.source, 'hh.ru');
  assert.equal(a.externalId, 'h1');
  db.saveResume({ id: a.id, name: 'Моё имя', text: 'v1' }); // пользователь переименовал; связь с hh.ru остаётся
  assert.equal(db.getResume(a.id).externalId, 'h1');
  db.saveResumeReview(a.id, { overall_ats_score: 80 }, 80);
  tick();
  const b = db.upsertResumeByExternal({ source: 'hh.ru', externalId: 'h1', url: 'u2', title: 'Новый', text: 'v2', name: 'Игнор' });
  assert.equal(b.id, a.id);
  assert.equal(b.name, 'Моё имя');
  assert.equal(b.text, 'v2');
  assert.equal(b.title, 'Новый');
  assert.equal(b.url, 'u2');
  assert.deepEqual(b.review, { overall_ats_score: 80 });
  assert.equal(b.reviewScore, 80);
  assert.ok(b.updatedAt > a.updatedAt);
  assert.equal(db.listResumes().length, 1);
  // Другой источник с тем же externalId — другое резюме; явное name уважается.
  const c = db.upsertResumeByExternal({ source: 'other', externalId: 'h1', title: 'T', name: 'Имя', text: 't' });
  assert.notEqual(c.id, a.id);
  assert.equal(c.name, 'Имя');
  assert.throws(() => db.upsertResumeByExternal({ source: 'hh.ru', text: 'x' }), (e) => e.code === 'bad_resume');
  db.close();
});

test('уникальность (source, externalId) для saveResume; ручные резюме без externalId не конфликтуют', () => {
  const { db } = makeDb();
  db.saveResume({ name: 'A', text: 'a', source: 'hh.ru', externalId: 'e1' });
  assert.throws(() => db.saveResume({ name: 'B', text: 'b', source: 'hh.ru', externalId: 'e1' }),
    (e) => e.code === 'duplicate_resume');
  db.saveResume({ name: 'M1', text: 'x' });
  db.saveResume({ name: 'M2', text: 'y' });
  assert.equal(db.listResumes().length, 3);
  assert.equal(db.listResumes()[1].source, 'manual');
  db.close();
});

test('saveResumeReview: хранит JSON и оценку, неизвестное резюме -> not_found', () => {
  const { db, tick } = makeDb();
  const r = db.saveResume({ name: 'R', text: 't' });
  assert.equal(r.review, null);
  assert.equal(r.reviewScore, null);
  assert.equal(r.reviewedAt, null);
  tick();
  const rev = db.saveResumeReview(r.id, { issues: ['a'], overall_ats_score: 64 }, 64);
  assert.deepEqual(rev.review, { issues: ['a'], overall_ats_score: 64 });
  assert.equal(rev.reviewScore, 64);
  assert.equal(rev.reviewedAt, r.createdAt + 1000);
  assert.deepEqual(db.listResumes()[0], rev);
  assert.throws(() => db.saveResumeReview('res_none', {}, 1), (e) => e.code === 'not_found');
  db.close();
});

test('сохранённые поиски: CRUD, умолчания, touchSearch', () => {
  const { db, tick } = makeDb();
  const s = db.saveSearch({ name: 'n8n', text: 'n8n' });
  assert.match(s.id, /^srch_/);
  assert.equal(s.site, 'hh.ru');
  assert.equal(s.area, 113);
  assert.deepEqual(s.filters, {});
  assert.equal(s.enabled, true);
  assert.equal(s.lastRunAt, null);
  tick();
  const t = db.touchSearch(s.id);
  assert.equal(t.lastRunAt, s.createdAt + 1000);
  tick();
  const u = db.saveSearch({ id: s.id, name: 'n8n 2', text: 'make', area: 2, filters: { experience: ['a', 'b'] }, enabled: false });
  assert.equal(u.id, s.id);
  assert.equal(u.name, 'n8n 2');
  assert.deepEqual(u.filters, { experience: ['a', 'b'] });
  assert.equal(u.enabled, false);
  assert.equal(u.lastRunAt, t.lastRunAt);
  assert.equal(u.createdAt, s.createdAt);
  const s2 = db.saveSearch({ name: 'второй', text: 'x' });
  assert.deepEqual(db.listSearches().map((x) => x.id), [s.id, s2.id]);
  assert.deepEqual(db.getSearch(s.id), u);
  assert.equal(db.getSearch('srch_none'), null);
  assert.equal(db.deleteSearch(s.id), true);
  assert.equal(db.deleteSearch(s.id), false);
  assert.equal(db.listSearches().length, 1);
  assert.throws(() => db.touchSearch('srch_none'), (e) => e.code === 'not_found');
  assert.throws(() => db.saveSearch({ name: '', text: 'x' }), (e) => e.code === 'bad_search');
  assert.throws(() => db.saveSearch({ name: 'n' }), (e) => e.code === 'bad_search');
  db.close();
});

test('настройки: умолчания, слияние патча, неизвестные ключи игнорируются, обрезка строк', () => {
  const { db } = makeDb();
  const defaults = { dailyLimit: 20, minDelaySec: 45, blacklistEmployers: [], stopWords: [] };
  assert.deepEqual(db.getSettings(), defaults);
  assert.deepEqual(db.updateSettings({ dailyLimit: 5 }), { ...defaults, dailyLimit: 5 });
  const s = db.updateSettings({ stopWords: ['  senior ', 'lead'], blacklistEmployers: ['Acme'], bogus: 1 });
  assert.deepEqual(s, { dailyLimit: 5, minDelaySec: 45, blacklistEmployers: ['Acme'], stopWords: ['senior', 'lead'] });
  assert.equal('bogus' in s, false);
  assert.deepEqual(db.updateSettings({}), s);
  assert.deepEqual(db.updateSettings({ dailyLimit: 0, minDelaySec: 3600 }).dailyLimit, 0);
  assert.equal(db.getSettings().minDelaySec, 3600);
  // Возвращённые объекты не делят состояние с умолчаниями.
  db.getSettings().stopWords.push('mutate');
  assert.deepEqual(db.getSettings().stopWords, ['senior', 'lead']);
  db.close();
});

test('настройки: каждое нарушение даёт bad_settings и ничего не меняет', () => {
  const { db } = makeDb();
  const before = db.updateSettings({ dailyLimit: 7 });
  const bad = [
    { dailyLimit: -1 }, { dailyLimit: 201 }, { dailyLimit: 1.5 }, { dailyLimit: '5' }, { dailyLimit: null },
    { minDelaySec: -1 }, { minDelaySec: 3601 }, { minDelaySec: 0.5 }, { minDelaySec: '1' },
    { blacklistEmployers: 'Acme' }, { blacklistEmployers: [1] }, { blacklistEmployers: ['ok', '  '] },
    { stopWords: null }, { stopWords: [''] }, { stopWords: [{}] },
    // Валидное поле рядом с невалидным тоже не применяется.
    { dailyLimit: 9, minDelaySec: 9999 },
  ];
  for (const patch of bad) {
    assert.throws(() => db.updateSettings(patch), (e) => e.code === 'bad_settings', JSON.stringify(patch));
    assert.deepEqual(db.getSettings(), before, JSON.stringify(patch));
  }
  for (const patch of [null, 'x', [], 5]) {
    assert.throws(() => db.updateSettings(patch), (e) => e.code === 'bad_settings');
  }
  db.close();
});

test('sentAt и lastSentAt: ставится при переходе в sent, повтор не сдвигает, max по вакансиям', () => {
  const { db, tick } = makeDb(1_000_000);
  db.upsertVacancy(searchItem('s1'));
  db.upsertVacancy(searchItem('s2'));
  assert.equal(db.lastSentAt(), null);
  assert.equal(db.getVacancy('hh.ru:s1').sentAt, null);
  tick();
  db.setStatus('hh.ru:s1', 'approved');
  assert.equal(db.getVacancy('hh.ru:s1').sentAt, null);
  tick();
  const sent = db.setStatus('hh.ru:s1', 'sent');
  assert.equal(sent.sentAt, 1_002_000);
  assert.equal(db.lastSentAt(), 1_002_000);
  tick();
  assert.equal(db.setStatus('hh.ru:s1', 'sent').sentAt, 1_002_000);
  assert.equal(db.setStatus('hh.ru:s1', 'replied').sentAt, 1_002_000);
  tick();
  db.setStatus('hh.ru:s2', 'sent');
  assert.equal(db.lastSentAt(), 1_004_000);
  db.close();
});

test('comparison: последний ATS-разбор на резюме, fallback на score, удалённые резюме пропускаются', () => {
  const { db, tick } = makeDb();
  db.upsertVacancy(searchItem('c1'));
  db.upsertVacancy(searchItem('c2'));
  const ra = db.saveResume({ name: 'Резюме A', text: 'a' });
  const rb = db.saveResume({ name: 'Резюме B', text: 'b' });
  const rc = db.saveResume({ name: 'Резюме C (без ats)', text: 'c' });
  const ats = (key, resumeId, score, payload) =>
    db.saveAnalysis({ vacancyKey: key, resumeId, kind: 'ats', score, verdict: 'v', payload });
  ats('hh.ru:c1', ra.id, 10, { overall_match_score: 10, hard_requirements_coverage_percent: 20 });
  tick();
  const aNew = ats('hh.ru:c1', ra.id, 60, { overall_match_score: 62, hard_requirements_coverage_percent: 75 });
  tick();
  const bOnly = ats('hh.ru:c1', rb.id, 55, { some: 'payload without fields' });
  tick();
  // fit-разбор и анализ другой вакансии не участвуют; более новый fit не вытесняет ats.
  db.saveAnalysis({ vacancyKey: 'hh.ru:c1', resumeId: rc.id, kind: 'fit', score: 99, verdict: 'f' });
  ats('hh.ru:c2', rc.id, 90, { overall_match_score: 90 });
  // Анализ удалённого/несуществующего резюме.
  ats('hh.ru:c1', 'res_deleted', 80, { overall_match_score: 80 });

  const cmp = db.comparison('hh.ru:c1');
  assert.equal(cmp.length, 2);
  const byId = Object.fromEntries(cmp.map((x) => [x.resumeId, x]));
  assert.deepEqual(byId[ra.id], {
    resumeId: ra.id, name: 'Резюме A', hardCoverage: 75, overall: 62, analysisId: aNew.id, createdAt: aNew.createdAt,
  });
  assert.equal(byId[rb.id].analysisId, bOnly.id);
  assert.equal(byId[rb.id].hardCoverage, null);
  assert.equal(byId[rb.id].overall, 55); // нет overall_match_score в payload: берём сохранённый score
  assert.equal(byId[rc.id], undefined);
  assert.deepEqual(db.comparison('hh.ru:none'), []);
  db.close();
});


test('миграция 2 -> 3: строки целы, form/answers пусты, схема равна свежей', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jobfit-mig-'));
  try {
    const file = join(dir, 'v2.db');
    const raw = new DatabaseSync(file);
    raw.exec(V1_SCHEMA);
    raw.exec(`ALTER TABLE resumes ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';
      ALTER TABLE resumes ADD COLUMN external_id TEXT; ALTER TABLE resumes ADD COLUMN url TEXT;
      ALTER TABLE resumes ADD COLUMN title TEXT; ALTER TABLE resumes ADD COLUMN review TEXT;
      ALTER TABLE resumes ADD COLUMN review_score REAL; ALTER TABLE resumes ADD COLUMN reviewed_at INTEGER;
      ALTER TABLE vacancies ADD COLUMN sent_at INTEGER;
      CREATE UNIQUE INDEX idx_resumes_external ON resumes(source, external_id) WHERE external_id IS NOT NULL;
      CREATE TABLE searches (id TEXT PRIMARY KEY, name TEXT NOT NULL, site TEXT NOT NULL, text TEXT NOT NULL,
        area INTEGER NOT NULL, filters TEXT, enabled INTEGER NOT NULL DEFAULT 1, last_run_at INTEGER,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE settings (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL, updated_at INTEGER NOT NULL);
      PRAGMA user_version = 2;`);
    raw.prepare(`INSERT INTO vacancies (key, source, external_id, title, status, sent_at, fetched_at, updated_at)
      VALUES ('hh.ru:1', 'hh.ru', '1', 'V2', 'sent', 555, 1, 2)`).run();
    raw.close();
    const db = createDb(file);
    const v = db.getVacancy('hh.ru:1');
    assert.equal(v.title, 'V2');
    assert.equal(v.sentAt, 555);
    assert.equal(v.form, null);
    assert.equal(v.answers, null);
    assert.equal(db.saveAnswers('hh.ru:1', [{ id: 'q' }]).answers[0].id, 'q');
    db.close();
    const fresh = join(dir, 'fresh.db');
    createDb(fresh).close();
    assert.deepEqual(schemaOf(file), schemaOf(fresh));
    const r2 = new DatabaseSync(file);
    assert.equal(r2.prepare('PRAGMA user_version').get().user_version, 3);
    r2.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('saveForm/saveAnswers: JSON, inspectedAt, статус не меняется, updatedAt растёт, not_found', () => {
  const { db, tick } = makeDb();
  const v0 = db.upsertVacancy(searchItem('f1'));
  db.setStatus('hh.ru:f1', 'drafted');
  assert.equal(v0.form, null);
  assert.equal(v0.answers, null);
  tick();
  const before = db.getVacancy('hh.ru:f1');
  const withForm = db.saveForm('hh.ru:f1', { available: true, letter: 'required', questions: [] });
  assert.deepEqual(withForm.form, { available: true, letter: 'required', questions: [], inspectedAt: before.updatedAt + 1000 });
  assert.equal(withForm.status, 'drafted');
  assert.equal(withForm.updatedAt, before.updatedAt + 1000);
  tick();
  const withAns = db.saveAnswers('hh.ru:f1', [{ id: '1', text: 'да' }]);
  assert.deepEqual(withAns.answers, [{ id: '1', text: 'да' }]);
  assert.equal(withAns.status, 'drafted');
  assert.ok(withAns.updatedAt > withForm.updatedAt);
  assert.deepEqual(withAns.form, withForm.form);
  const row = db.listPipeline()[0];
  assert.deepEqual(row.form, withForm.form);
  assert.deepEqual(row.answers, [{ id: '1', text: 'да' }]);
  assert.throws(() => db.saveForm('hh.ru:none', {}), (e) => e.code === 'not_found');
  assert.throws(() => db.saveAnswers('hh.ru:none', []), (e) => e.code === 'not_found');
  db.close();
});

test('upsertVacancy не стирает сохранённые form и answers', () => {
  const { db, tick } = makeDb();
  db.upsertVacancy(searchItem('f2'));
  db.saveForm('hh.ru:f2', { available: true });
  db.saveAnswers('hh.ru:f2', [{ id: 'a', text: 't' }]);
  tick();
  const row = db.upsertVacancy(fullVacancy('f2'));
  assert.equal(row.form.available, true);
  assert.deepEqual(row.answers, [{ id: 'a', text: 't' }]);
  db.close();
});
