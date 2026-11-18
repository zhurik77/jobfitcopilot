// Хранилище конвейера вакансий на встроенном node:sqlite.
// Одна таблица на сущность; JSON-колонки хранятся текстом и разбираются на выходе,
// чтобы остальные модули работали только с обычными объектами в camelCase.
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const STATUSES = [
  'found', 'scored', 'drafted', 'awaiting_approval', 'approved',
  'sent', 'replied', 'invited', 'rejected', 'skipped',
];

// Версия схемы (PRAGMA user_version). 3 = форма отклика и ответы работодателю; 2 = резюме с источником и ревью, сохранённые поиски, настройки, sentAt.
const SCHEMA_VERSION = 3;

// Схема версии 1 оставлена как есть: по ней создан реальный файл в Docker-томе.
// И новая база, и старая приходят к версии 2 одним и тем же путём (SCHEMA_V1 + MIGRATIONS),
// поэтому свежая и мигрированная базы не могут разойтись.
const SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS vacancies (
  key         TEXT PRIMARY KEY,
  source      TEXT NOT NULL,
  external_id TEXT NOT NULL,
  url         TEXT,
  title       TEXT,
  company     TEXT,
  salary      TEXT,
  experience  TEXT,
  address     TEXT,
  snippet     TEXT,
  description TEXT,
  skills      TEXT,
  status      TEXT NOT NULL DEFAULT 'found',
  resume_id   TEXT,
  letter_id   TEXT,
  note        TEXT,
  fetched_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vacancies_status ON vacancies(status);
CREATE INDEX IF NOT EXISTS idx_vacancies_updated ON vacancies(updated_at);

CREATE TABLE IF NOT EXISTS resumes (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  text       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS analyses (
  id          TEXT PRIMARY KEY,
  vacancy_key TEXT NOT NULL,
  resume_id   TEXT,
  kind        TEXT NOT NULL,
  score       REAL,
  verdict     TEXT,
  payload     TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_analyses_vacancy ON analyses(vacancy_key);

CREATE TABLE IF NOT EXISTS letters (
  id          TEXT PRIMARY KEY,
  vacancy_key TEXT NOT NULL,
  resume_id   TEXT,
  lang        TEXT,
  plan        TEXT,
  text        TEXT NOT NULL,
  lint        TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_letters_vacancy ON letters(vacancy_key);

CREATE TABLE IF NOT EXISTS events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  vacancy_key TEXT NOT NULL,
  type        TEXT NOT NULL,
  payload     TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_vacancy ON events(vacancy_key);
`;

// Миграция 1 -> 2. Только ADD COLUMN и новые таблицы: ни одна существующая строка не трогается.
// Существующие резюме получают source = 'manual' через DEFAULT.
const MIGRATION_V2 = `
ALTER TABLE resumes ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE resumes ADD COLUMN external_id TEXT;
ALTER TABLE resumes ADD COLUMN url TEXT;
ALTER TABLE resumes ADD COLUMN title TEXT;
ALTER TABLE resumes ADD COLUMN review TEXT;
ALTER TABLE resumes ADD COLUMN review_score REAL;
ALTER TABLE resumes ADD COLUMN reviewed_at INTEGER;
ALTER TABLE vacancies ADD COLUMN sent_at INTEGER;

-- Одно и то же резюме hh.ru не должно завестись дважды; ручные резюме (external_id NULL) не ограничены.
CREATE UNIQUE INDEX IF NOT EXISTS idx_resumes_external
  ON resumes(source, external_id) WHERE external_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS searches (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  site        TEXT NOT NULL,
  text        TEXT NOT NULL,
  area        INTEGER NOT NULL,
  filters     TEXT,
  enabled     INTEGER NOT NULL DEFAULT 1,
  last_run_at INTEGER,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  data       TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
`;

// Миграция 2 -> 3: форма отклика (результат inspectResponseForm) и ответы на вопросы работодателя.
const MIGRATION_V3 = `
ALTER TABLE vacancies ADD COLUMN form TEXT;
ALTER TABLE vacancies ADD COLUMN answers TEXT;
`;

const DEFAULT_SETTINGS = Object.freeze({
  dailyLimit: 20, minDelaySec: 45, blacklistEmployers: [], stopWords: [],
});

/** Ошибка с машинным кодом: вызывающий код (api/mcp) маппит .code на HTTP-статус. */
function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

const toJson = (v) => (v === undefined || v === null ? null : JSON.stringify(v));

function fromJson(s) {
  if (s === null || s === undefined) return null;
  try {
    return JSON.parse(s);
  } catch {
    // Битый JSON в колонке не должен ронять всю выдачу.
    return null;
  }
}

// Пустой ли новый кусок данных: поисковая карточка не несёт описания и навыков,
// и такие значения не имеют права затирать уже сохранённые.
const isBlank = (v) =>
  v === undefined || v === null || (typeof v === 'string' && v.trim() === '') ||
  (Array.isArray(v) && v.length === 0);

function vacancyRow(r) {
  if (!r) return null;
  return {
    key: r.key,
    source: r.source,
    id: r.external_id,
    url: r.url,
    title: r.title,
    company: r.company,
    salary: r.salary,
    experience: r.experience,
    address: r.address,
    snippet: r.snippet,
    description: r.description,
    skills: fromJson(r.skills) ?? [],
    status: r.status,
    resumeId: r.resume_id,
    letterId: r.letter_id,
    note: r.note,
    fetchedAt: r.fetched_at,
    sentAt: r.sent_at ?? null,
    form: fromJson(r.form),
    answers: fromJson(r.answers),
    updatedAt: r.updated_at,
  };
}

const resumeRow = (r) => r && {
  id: r.id, name: r.name, text: r.text,
  source: r.source, externalId: r.external_id ?? null, url: r.url ?? null, title: r.title ?? null,
  review: fromJson(r.review), reviewScore: r.review_score ?? null, reviewedAt: r.reviewed_at ?? null,
  createdAt: r.created_at, updatedAt: r.updated_at,
};

const searchRow = (r) => r && {
  id: r.id, name: r.name, site: r.site, text: r.text, area: r.area,
  filters: fromJson(r.filters) ?? {}, enabled: r.enabled === 1,
  lastRunAt: r.last_run_at ?? null, createdAt: r.created_at, updatedAt: r.updated_at,
};

const analysisRow = (r) => r && {
  id: r.id, vacancyKey: r.vacancy_key, resumeId: r.resume_id, kind: r.kind,
  score: r.score, verdict: r.verdict, payload: fromJson(r.payload), createdAt: r.created_at,
};

const letterRow = (r) => r && {
  id: r.id, vacancyKey: r.vacancy_key, resumeId: r.resume_id, lang: r.lang,
  plan: fromJson(r.plan), text: r.text, lint: fromJson(r.lint),
  createdAt: r.created_at, updatedAt: r.updated_at,
};

const eventRow = (r) => r && {
  id: r.id, vacancyKey: r.vacancy_key, type: r.type,
  payload: fromJson(r.payload), createdAt: r.created_at,
};

/**
 * @param {string} [path] путь к файлу SQLite или ':memory:'
 * @param {{ now?: () => number }} [opts] now подменяется в тестах, чтобы порядок по времени был детерминирован
 */
export function createDb(path = process.env.DB_PATH ?? ':memory:', { now = Date.now } = {}) {
  const inMemory = path === ':memory:' || path === '';
  // В Docker том может быть смонтирован в ещё не существующий каталог.
  if (!inMemory) mkdirSync(dirname(path), { recursive: true });

  const db = new DatabaseSync(inMemory ? ':memory:' : path);
  // WAL нужен, чтобы панель читала, пока MCP пишет; для :memory: он бессмыслен.
  if (!inMemory) db.exec('PRAGMA journal_mode = WAL');

  /** Атомарная группа записей: статус и событие не должны разъезжаться. */
  function tx(fn) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const out = fn();
      db.exec('COMMIT');
      return out;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }

  try {
    db.exec(SCHEMA_V1);
    // Миграция в одной транзакции: при сбое файл остаётся на версии 1 целиком, а не наполовину.
    // Версию перечитываем уже под блокировкой: второй процесс мог успеть мигрировать раньше.
    if (db.prepare('PRAGMA user_version').get().user_version < SCHEMA_VERSION) {
      tx(() => {
        const { user_version: v } = db.prepare('PRAGMA user_version').get();
        if (v < 2) db.exec(MIGRATION_V2);
      if (v < 3) db.exec(MIGRATION_V3);
        db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
      });
    }
  } catch (e) {
    // Не оставляем открытый дескриптор на файле, который не удалось открыть как базу.
    db.close();
    throw e;
  }

  const rawVacancy = (key) => db.prepare('SELECT * FROM vacancies WHERE key = ?').get(key);

  function requireVacancy(key) {
    const r = rawVacancy(key);
    if (!r) throw fail('not_found', `Vacancy not found: ${key}`);
    return r;
  }

  function insertEvent(vacancyKey, type, payload) {
    db.prepare('INSERT INTO events (vacancy_key, type, payload, created_at) VALUES (?, ?, ?, ?)')
      .run(vacancyKey, type, toJson(payload), now());
  }

  function getVacancy(key) {
    return vacancyRow(rawVacancy(key));
  }

  function upsertVacancy(v) {
    if (!v || v.id === undefined || v.id === null || String(v.id) === '') {
      throw fail('bad_vacancy', 'Vacancy id is required');
    }
    const source = v.source || 'hh.ru';
    const id = String(v.id);
    const key = `${source}:${id}`;
    const ts = now();
    // В поисковой выдаче работодатель зовётся employer, в карточке вакансии company.
    const company = v.company ?? v.employer;
    const existing = rawVacancy(key);

    if (!existing) {
      db.prepare(`INSERT INTO vacancies
        (key, source, external_id, url, title, company, salary, experience, address,
         snippet, description, skills, status, fetched_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'found', ?, ?)`)
        .run(key, source, id, v.url ?? null, v.title ?? null, company ?? null,
          v.salary ?? null, v.experience ?? null, v.address ?? null, v.snippet ?? null,
          isBlank(v.description) ? null : v.description,
          isBlank(v.skills) ? null : toJson(v.skills), ts, ts);
      return getVacancy(key);
    }

    // Слияние: новое непустое значение побеждает, пустое оставляет старое.
    // status, resume_id, letter_id и note сюда намеренно не входят.
    const pick = (next, prev) => (isBlank(next) ? prev : next);
    const hasFullText = !isBlank(v.description);
    db.prepare(`UPDATE vacancies SET
        url = ?, title = ?, company = ?, salary = ?, experience = ?, address = ?,
        snippet = ?, description = ?, skills = ?, fetched_at = ?, updated_at = ?
        WHERE key = ?`)
      .run(pick(v.url, existing.url) ?? null, pick(v.title, existing.title) ?? null,
        pick(company, existing.company) ?? null, pick(v.salary, existing.salary) ?? null,
        pick(v.experience, existing.experience) ?? null, pick(v.address, existing.address) ?? null,
        pick(v.snippet, existing.snippet) ?? null,
        pick(v.description, existing.description) ?? null,
        isBlank(v.skills) ? existing.skills : toJson(v.skills),
        // fetched_at двигаем только когда пришёл полный текст, а не просто карточка из поиска.
        hasFullText ? ts : existing.fetched_at, ts, key);
    return getVacancy(key);
  }

  function listPipeline({ status, limit = 200 } = {}) {
    const rows = status
      ? db.prepare('SELECT * FROM vacancies WHERE status = ? ORDER BY updated_at DESC, rowid DESC LIMIT ?').all(status, limit)
      : db.prepare('SELECT * FROM vacancies ORDER BY updated_at DESC, rowid DESC LIMIT ?').all(limit);
    // fit важнее ats; внутри вида берём самый свежий разбор.
    const last = db.prepare(`SELECT score, verdict FROM analyses WHERE vacancy_key = ?
      ORDER BY (kind = 'fit') DESC, created_at DESC, rowid DESC LIMIT 1`);
    return rows.map((r) => {
      const a = last.get(r.key);
      return { ...vacancyRow(r), lastScore: a?.score ?? null, lastVerdict: a?.verdict ?? null };
    });
  }

  function setStatus(key, status, note) {
    if (!STATUSES.includes(status)) throw fail('bad_status', `Unknown status: ${status}`);
    return tx(() => {
      const cur = requireVacancy(key);
      const newNote = note === undefined ? cur.note : note;
      const ts = now();
      // sent_at ставится при первом переходе в sent; повторный вызов не сдвигает время,
      // иначе пауза между откликами (lastSentAt) считалась бы от ложной отметки.
      const sentAt = status === 'sent' ? (cur.status === 'sent' && cur.sent_at ? cur.sent_at : ts) : cur.sent_at;
      db.prepare('UPDATE vacancies SET status = ?, note = ?, sent_at = ?, updated_at = ? WHERE key = ?')
        .run(status, newNote ?? null, sentAt ?? null, ts, key);
      insertEvent(key, 'status', { from: cur.status, to: status, note: note ?? null });
      return getVacancy(key);
    });
  }

  // form и answers не входят в UPDATE upsertVacancy, поэтому повторный поиск их не стирает.
  // inspectedAt пишем из инъектируемых часов: по нему видно, насколько свежа форма.
  function saveForm(key, form) {
    requireVacancy(key);
    const stored = { ...(form ?? {}), inspectedAt: now() };
    db.prepare('UPDATE vacancies SET form = ?, updated_at = ? WHERE key = ?').run(toJson(stored), now(), key);
    return getVacancy(key);
  }

  function saveAnswers(key, answers) {
    requireVacancy(key);
    db.prepare('UPDATE vacancies SET answers = ?, updated_at = ? WHERE key = ?').run(toJson(answers), now(), key);
    return getVacancy(key);
  }

  function setChoice(key, { resumeId, letterId } = {}) {
    const cur = requireVacancy(key);
    db.prepare('UPDATE vacancies SET resume_id = ?, letter_id = ?, updated_at = ? WHERE key = ?')
      .run(resumeId === undefined ? cur.resume_id : resumeId,
        letterId === undefined ? cur.letter_id : letterId, now(), key);
    return getVacancy(key);
  }

  /** Нарушение уникального индекса (source, external_id) превращаем в ошибку с кодом. */
  function guardDuplicate(fn) {
    try {
      return fn();
    } catch (e) {
      if (/UNIQUE constraint failed/i.test(String(e?.message))) {
        throw fail('duplicate_resume', 'A resume with this source and externalId already exists');
      }
      throw e;
    }
  }

  function saveResume({ id, name, text, source, externalId, url, title }) {
    const ts = now();
    const rid = id || `res_${randomUUID()}`;
    guardDuplicate(() => {
      const cur = db.prepare('SELECT * FROM resumes WHERE id = ?').get(rid);
      if (cur) {
        // Поля источника, которые не переданы, остаются прежними: ручное сохранение
        // имени и текста не должно разрывать связь резюме с hh.ru.
        const keep = (next, prev) => (next === undefined ? prev : next);
        db.prepare(`UPDATE resumes SET name = ?, text = ?, source = ?, external_id = ?, url = ?,
          title = ?, updated_at = ? WHERE id = ?`)
          .run(name, text, keep(source, cur.source) || 'manual', keep(externalId, cur.external_id) ?? null,
            keep(url, cur.url) ?? null, keep(title, cur.title) ?? null, ts, rid);
      } else {
        db.prepare(`INSERT INTO resumes (id, name, text, source, external_id, url, title, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(rid, name, text, source || 'manual', externalId ?? null, url ?? null, title ?? null, ts, ts);
      }
    });
    return getResume(rid);
  }

  function upsertResumeByExternal({ source, externalId, url, title, name, text } = {}) {
    if (!source || isBlank(externalId)) throw fail('bad_resume', 'source and externalId are required');
    if (typeof text !== 'string') throw fail('bad_resume', 'text is required');
    const ext = String(externalId);
    const ts = now();
    const cur = db.prepare('SELECT id FROM resumes WHERE source = ? AND external_id = ?').get(source, ext);
    if (cur) {
      // name и review не трогаем: пользователь мог переименовать резюме, а аудит стоил запроса к LLM.
      db.prepare('UPDATE resumes SET text = ?, title = ?, url = ?, updated_at = ? WHERE id = ?')
        .run(text, title ?? null, url ?? null, ts, cur.id);
      return getResume(cur.id);
    }
    const rid = `res_${randomUUID()}`;
    db.prepare(`INSERT INTO resumes (id, name, text, source, external_id, url, title, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(rid, name || title || ext, text, source, ext, url ?? null, title ?? null, ts, ts);
    return getResume(rid);
  }

  function saveResumeReview(resumeId, review, score) {
    if (!getResume(resumeId)) throw fail('not_found', `Resume not found: ${resumeId}`);
    const ts = now();
    db.prepare('UPDATE resumes SET review = ?, review_score = ?, reviewed_at = ? WHERE id = ?')
      .run(toJson(review), typeof score === 'number' && Number.isFinite(score) ? score : null, ts, resumeId);
    return getResume(resumeId);
  }

  const listResumes = () =>
    db.prepare('SELECT * FROM resumes ORDER BY created_at ASC, rowid ASC').all().map(resumeRow);

  const getResume = (id) => resumeRow(db.prepare('SELECT * FROM resumes WHERE id = ?').get(id)) ?? null;

  function saveAnalysis({ vacancyKey, resumeId, kind, score, verdict, payload }) {
    requireVacancy(vacancyKey);
    if (kind !== 'fit' && kind !== 'ats') throw fail('bad_kind', `Unknown analysis kind: ${kind}`);
    const id = `an_${randomUUID()}`;
    db.prepare(`INSERT INTO analyses (id, vacancy_key, resume_id, kind, score, verdict, payload, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, vacancyKey, resumeId ?? null, kind, score ?? null, verdict ?? null, toJson(payload), now());
    return analysisRow(db.prepare('SELECT * FROM analyses WHERE id = ?').get(id));
  }

  // Новые сверху: панели нужен последний разбор первым.
  const listAnalyses = (vacancyKey) =>
    db.prepare('SELECT * FROM analyses WHERE vacancy_key = ? ORDER BY created_at DESC, rowid DESC')
      .all(vacancyKey).map(analysisRow);

  function saveLetter({ id, vacancyKey, resumeId, lang, plan, text, lint }) {
    requireVacancy(vacancyKey);
    const ts = now();
    const lid = id || `let_${randomUUID()}`;
    if (db.prepare('SELECT 1 FROM letters WHERE id = ?').get(lid)) {
      db.prepare(`UPDATE letters SET vacancy_key = ?, resume_id = ?, lang = ?, plan = ?, text = ?,
        lint = ?, updated_at = ? WHERE id = ?`)
        .run(vacancyKey, resumeId ?? null, lang ?? null, toJson(plan), text, toJson(lint), ts, lid);
    } else {
      db.prepare(`INSERT INTO letters (id, vacancy_key, resume_id, lang, plan, text, lint, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(lid, vacancyKey, resumeId ?? null, lang ?? null, toJson(plan), text, toJson(lint), ts, ts);
    }
    return getLetter(lid);
  }

  const getLetter = (id) => letterRow(db.prepare('SELECT * FROM letters WHERE id = ?').get(id)) ?? null;

  const listLetters = (vacancyKey) =>
    db.prepare('SELECT * FROM letters WHERE vacancy_key = ? ORDER BY created_at DESC, rowid DESC')
      .all(vacancyKey).map(letterRow);

  function addEvent(vacancyKey, type, payload) {
    requireVacancy(vacancyKey);
    insertEvent(vacancyKey, type, payload);
  }

  // Хронологически: журнал читается сверху вниз как история вакансии.
  const listEvents = (vacancyKey) =>
    db.prepare('SELECT * FROM events WHERE vacancy_key = ? ORDER BY id ASC').all(vacancyKey).map(eventRow);

  function stats() {
    const byStatus = {};
    for (const r of db.prepare('SELECT status, COUNT(*) AS n FROM vacancies GROUP BY status').all()) {
      byStatus[r.status] = r.n;
    }
    const total = Object.values(byStatus).reduce((a, b) => a + b, 0);
    // Границы суток считаем по локальному времени, иначе «сегодня» съезжает ночью по UTC.
    const d = new Date(now());
    const startToday = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const start7 = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 6).getTime();
    const sent = db.prepare(`SELECT COUNT(*) AS n FROM events
      WHERE type = 'status' AND json_extract(payload, '$.to') = 'sent' AND created_at >= ?`);
    return {
      byStatus,
      sentToday: sent.get(startToday).n,
      sentLast7Days: sent.get(start7).n,
      total,
    };
  }

  // --- сохранённые поиски ---

  const getSearch = (id) => searchRow(db.prepare('SELECT * FROM searches WHERE id = ?').get(id)) ?? null;

  const listSearches = () =>
    db.prepare('SELECT * FROM searches ORDER BY created_at ASC, rowid ASC').all().map(searchRow);

  function saveSearch({ id, name, site = 'hh.ru', text, area = 113, filters = {}, enabled = true } = {}) {
    if (isBlank(name)) throw fail('bad_search', 'name is required');
    if (isBlank(text)) throw fail('bad_search', 'text is required');
    const ts = now();
    const sid = id || `srch_${randomUUID()}`;
    const exists = db.prepare('SELECT 1 FROM searches WHERE id = ?').get(sid);
    const args = [name, site, text, area, toJson(filters ?? {}), enabled ? 1 : 0];
    if (exists) {
      // last_run_at и created_at при правке параметров сохраняются.
      db.prepare(`UPDATE searches SET name = ?, site = ?, text = ?, area = ?, filters = ?, enabled = ?,
        updated_at = ? WHERE id = ?`).run(...args, ts, sid);
    } else {
      db.prepare(`INSERT INTO searches (name, site, text, area, filters, enabled, id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(...args, sid, ts, ts);
    }
    return getSearch(sid);
  }

  function deleteSearch(id) {
    return db.prepare('DELETE FROM searches WHERE id = ?').run(id).changes > 0;
  }

  function touchSearch(id) {
    if (!getSearch(id)) throw fail('not_found', `Search not found: ${id}`);
    db.prepare('UPDATE searches SET last_run_at = ? WHERE id = ?').run(now(), id);
    return getSearch(id);
  }

  // --- настройки (одна строка с JSON) ---

  const cloneDefaults = () => ({
    ...DEFAULT_SETTINGS, blacklistEmployers: [], stopWords: [],
  });

  function getSettings() {
    const r = db.prepare('SELECT data FROM settings WHERE id = 1').get();
    // Поверх умолчаний: поле, добавленное в новой версии, не должно пропасть из старой строки.
    return { ...cloneDefaults(), ...(r ? fromJson(r.data) : null) };
  }

  const intInRange = (v, min, max) => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

  function cleanList(name, v) {
    if (!Array.isArray(v) || v.some((s) => typeof s !== 'string' || s.trim() === '')) {
      throw fail('bad_settings', `${name} must be an array of non-empty strings`);
    }
    return v.map((s) => s.trim());
  }

  function updateSettings(patch) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      throw fail('bad_settings', 'patch must be an object');
    }
    // Сначала проверяем всё, потом пишем: невалидный патч не должен менять даже валидные поля.
    const next = getSettings();
    if ('dailyLimit' in patch) {
      if (!intInRange(patch.dailyLimit, 0, 200)) throw fail('bad_settings', 'dailyLimit must be an integer 0..200');
      next.dailyLimit = patch.dailyLimit;
    }
    if ('minDelaySec' in patch) {
      if (!intInRange(patch.minDelaySec, 0, 3600)) throw fail('bad_settings', 'minDelaySec must be an integer 0..3600');
      next.minDelaySec = patch.minDelaySec;
    }
    if ('blacklistEmployers' in patch) next.blacklistEmployers = cleanList('blacklistEmployers', patch.blacklistEmployers);
    if ('stopWords' in patch) next.stopWords = cleanList('stopWords', patch.stopWords);
    db.prepare(`INSERT INTO settings (id, data, updated_at) VALUES (1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`)
      .run(JSON.stringify(next), now());
    return getSettings();
  }

  function lastSentAt() {
    return db.prepare('SELECT MAX(sent_at) AS t FROM vacancies').get().t ?? null;
  }

  function comparison(vacancyKey) {
    // Идём от новых анализов к старым: первое попадание для резюме и есть последний разбор.
    const rows = db.prepare(`SELECT * FROM analyses WHERE vacancy_key = ? AND kind = 'ats' AND resume_id IS NOT NULL
      ORDER BY created_at DESC, rowid DESC`).all(vacancyKey);
    const seen = new Set();
    const out = [];
    for (const a of rows) {
      if (seen.has(a.resume_id)) continue;
      seen.add(a.resume_id);
      const resume = getResume(a.resume_id);
      if (!resume) continue; // резюме удалено: сравнивать не с чем
      const payload = fromJson(a.payload);
      const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
      out.push({
        resumeId: a.resume_id,
        name: resume.name,
        hardCoverage: num(payload?.hard_requirements_coverage_percent),
        overall: num(payload?.overall_match_score) ?? a.score ?? null,
        analysisId: a.id,
        createdAt: a.created_at,
      });
    }
    return out;
  }

  const close = () => db.close();

  return {
    upsertVacancy, getVacancy, listPipeline, setStatus, setChoice, saveForm, saveAnswers,
    saveResume, upsertResumeByExternal, saveResumeReview, listResumes, getResume,
    saveSearch, listSearches, getSearch, deleteSearch, touchSearch,
    getSettings, updateSettings, lastSentAt, comparison,
    saveAnalysis, listAnalyses,
    saveLetter, getLetter, listLetters,
    addEvent, listEvents, stats, close,
  };
}
