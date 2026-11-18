# Job Fit Copilot — MCP server

MCP server in Docker that searches jobs through the user's real browser (Kimi
WebBridge daemon on the host), stores a pipeline in SQLite and serves a small
web panel. The LLM work (fit check, ATS match, letters) is done by the MCP
client (Claude); the server supplies data, prompts, deterministic scoring,
letter linting and storage. Nothing is sent to an employer without an explicit
approval made in the panel.

## Conventions

- Node >= 24, ESM (`"type": "module"`), plain JavaScript with JSDoc, no TypeScript, no build step.
- Runtime deps only: `@modelcontextprotocol/sdk`, `zod`. SQLite is the built-in `node:sqlite`. HTTP is `node:http`.
- Tests: `node --test` files in `server/test/*.test.js`, no network, no real browser.
- Comments in Russian, same tone as the rest of the repo (explain why, not what).
- Every factory takes its dependencies as arguments so tests can pass fakes.

## Layout and ownership

| File | Exports |
|---|---|
| `src/bridge.js` | `createBridge`, `BridgeError` |
| `src/sites/hh.js` | `createHh` |
| `src/db.js` | `createDb`, `STATUSES` |
| `src/core/scoring.js` | `computeFitScore`, `rankResumeMatches` |
| `src/core/letter-lint.js` | `lintLetter` |
| `src/core/prompts.js` | `PROMPTS`, `letterPrompt`, `LETTER_RULES` |
| `src/api.js` | `createApi` |
| `src/mcp.js` | `createMcpServer` |
| `src/index.js` | process entry point |
| `public/` | web panel (static, vanilla JS) |

## Contracts

### bridge.js

```js
createBridge({ baseUrl = process.env.WEBBRIDGE_URL ?? 'http://127.0.0.1:10086',
               session = 'jobfit', fetchImpl = fetch })
// -> {
//   command(action, args = {}) -> Promise<data>   POST {baseUrl}/command, body {action,args,session}
//   navigate(url, { newTab = false, groupTitle } = {}) -> Promise<{url, tabId}>
//   evaluate(code) -> Promise<any>                 returns `.value` of the daemon reply
//   status() -> Promise<object>                    GET {baseUrl}/status
// }
```

Daemon reply envelope: `{ok:true,data}` or `{ok:false,error:{code,message}}`.
Failures throw `BridgeError` with `.code` (`extension_not_connected`,
`daemon_unreachable`, `bad_reply`, or the daemon's own code) and `.message`.
`evaluate` code must not use top-level `await` (wrap in an async IIFE) and
should return `JSON.stringify(...)` strings; callers parse them.

### sites/hh.js

```js
createHh(bridge, { waitMs = 15000, pollMs = 500, sleep } = {})
// -> {
//   search({ text, area = 113, page = 0 }) ->
//     { total, page, items: [{ id, url, title, employer, address, salary, experience, snippet }] }
//   getVacancy(idOrUrl) ->
//     { id, source: 'hh.ru', url, title, company, salary, experience, description, skills: [] }
//   listNegotiations() -> [{ vacancyId, title, company, status, date }]
//   importResume(url) -> { title, text }
//   isLoggedIn() -> boolean
// }
```

`id` is the numeric hh vacancy id as a string. After `navigate` the adapter
polls with `evaluate` until the expected selector exists or `waitMs` passes,
then throws an Error with `.code = 'timeout'`, `'login_required'` (URL moved to
`/account/login`) or `'captcha'`.

Selectors verified on the live site on 2026-11-12:

- Search `https://hh.ru/search/vacancy?text=…&area=…&page=…`: card
  `[data-qa~="vacancy-serp__vacancy"]` (50 per page); title text
  `[data-qa="serp-item__title-text"]`; link `a[data-qa="serp-item__title"]`
  (href `https://hh.ru/vacancy/<id>?query…`); employer
  `[data-qa="vacancy-serp__vacancy-employer-text"]`; address
  `[data-qa="vacancy-serp__vacancy-address"]`; experience: an element whose
  `data-qa` starts with `vacancy-serp__vacancy-work-experience-`; snippets
  `[data-qa="vacancy-serp__vacancy_snippet_responsibility"]` and
  `…_snippet_requirement`; total in the `h1` text ("Найдено 173 вакансии «n8n»").
- Vacancy `https://hh.ru/vacancy/<id>`: `[data-qa="vacancy-title"]`,
  `[data-qa="vacancy-company-name"]`, `[data-qa="vacancy-experience"]`,
  `[data-qa="vacancy-description"]`, `[data-qa="skills-element"]`; salary
  `[data-qa="vacancy-salary"]` or any `[data-qa^="vacancy-salary"]` (often absent).
- Negotiations `https://hh.ru/applicant/negotiations`: row
  `[data-qa="negotiations-item"]`; inside it `negotiations-tag` (status text),
  `negotiations-item-vacancy`, `negotiations-item-company`,
  `negotiations-item-date`; vacancy id from the `a[data-qa="serp-item__title"]`
  href in the same row when present.
- Resume page: port the logic of `content-scripts/extractor-hh-resume.js`.

The response button (`[data-qa="vacancy-serp__vacancy_response"]`,
`[data-qa="vacancy-response-link-top"]`) must never be clicked by this module.

### db.js

```js
createDb(path = process.env.DB_PATH ?? ':memory:')
// -> {
//   upsertVacancy(v) -> row            v: getVacancy() shape or a search item; key = `${source}:${id}`
//   getVacancy(key) -> row | null      row adds: key, status, resumeId, letterId, note, fetchedAt, updatedAt
//   listPipeline({ status, limit = 200 } = {}) -> rows (newest first) + lastScore, lastVerdict
//   setStatus(key, status, note) -> row          throws on unknown status / unknown key
//   setChoice(key, { resumeId, letterId }) -> row
//   saveResume({ id?, name, text }) -> resume    listResumes() -> [...]   getResume(id)
//   saveAnalysis({ vacancyKey, resumeId, kind: 'fit'|'ats', score, verdict, payload }) -> analysis
//   listAnalyses(vacancyKey) -> [...]
//   saveLetter({ id?, vacancyKey, resumeId, lang, plan, text, lint }) -> letter   getLetter(id)   listLetters(vacancyKey)
//   addEvent(vacancyKey, type, payload)          listEvents(vacancyKey)
//   stats() -> { byStatus: {status: n}, sentToday, sentLast7Days, total }
//   close()
// }
STATUSES = ['found','scored','drafted','awaiting_approval','approved','sent','replied','invited','rejected','skipped']
```

Rows are returned as plain objects with camelCase keys; JSON columns
(`skills`, `payload`, `plan`, `lint`) are parsed. Timestamps are ms since epoch.
`upsertVacancy` never downgrades: a search item must not erase an already
stored `description`, and must not reset `status`. A search item has no
`source`; default it to `'hh.ru'`. `setStatus` writes an event `status` with
`{from, to, note}`.

### core/scoring.js

```js
computeFitScore(parsed) -> number   // 50 + Σ ledger[i].delta, clamped 0..100, non-numeric deltas ignored
rankResumeMatches(scored) -> sorted copy
// scored: [{ resumeId, name, result }], result = ATS match JSON.
// Order: hard_requirements_coverage_percent desc, then overall_match_score desc.
```

Port the behaviour of `computeScore` and `rankResumeMatches` from
`sidepanel/panel.js`.

### core/prompts.js

Re-exports the prompts of `shared/constants.js` (import that file for its side
effect: it sets `globalThis.JFC`) as `PROMPTS = { fit, ats, resumeReview }` and
`letterPrompt(lang, tone)`. `LETTER_RULES` is a Russian text block with the
plan-then-write rules below, appended to the letter prompt.

Letter rules (from the StoryScope findings, adapted to a 120-180 word letter):
1. Сначала план: 2-3 конкретных факта из резюме и одна связка с вакансией. Текст пишется строго по плану.
2. Не формулировать вывод за читателя: без «этот опыт научил меня», «я понял, что».
3. Называть вещи по именам: продукт работодателя, инструмент, цифра — вместо «ваши задачи», «современные технологии».
4. Не закруглять: письмо кончается конкретным следующим шагом, а не итоговой фразой о себе.
5. Только факты из резюме; чего нет в резюме, того нет в письме.

### core/letter-lint.js

```js
lintLetter(text, { lang = 'ru', minWords = 120, maxWords = 180 } = {})
// -> { ok, issues: [{ rule, severity: 'error'|'warn', message, excerpt }], stats: { words, sentences, avgSentenceWords, sentenceStdev } }
```

`ok` is false when any `error` exists. Rules: `cliche` (error; the banned list
from `letterPrompt` plus common ru/en stock phrases), `placeholder` (error;
`[…]`, `<…>`, `{{…}}`), `length` (error outside min/max), `moralizing` (warn;
«научил меня», «я понял, что», "taught me", "I realized"), `summary_ending`
(warn; last sentence starts with «таким образом», «в заключение», «уверен, что»,
"in conclusion", "I am confident"), `no_specifics` (warn; no digits and no
Latin-script or capitalised mid-sentence tokens), `uniform_rhythm` (warn; ≥5
sentences and stdev of sentence length < 3 words), `dash_overuse` (warn; more
than 3 em dashes).

### api.js (REST for the panel)

`createApi({ db })` -> `async handle(req, res)` returning `true` when it handled
the request (paths under `/api/`). JSON in, JSON out, errors as
`{ error: { code, message } }` with a matching HTTP status.

| Method and path | Result |
|---|---|
| `GET /api/pipeline?status=` | `{ items }` from `db.listPipeline` |
| `GET /api/vacancies/:key` | `{ vacancy, analyses, letters, events }` |
| `POST /api/vacancies/:key/status` body `{ status, note }` | `{ vacancy }`; the panel may only set `approved`, `skipped`, `awaiting_approval`, `found` |
| `PUT /api/letters/:id` body `{ text }` | `{ letter }`, re-linted with `lintLetter` |
| `GET /api/resumes` | `{ items }` |
| `GET /api/stats` | `db.stats()` |

`:key` is URL-encoded (`hh.ru%3A139138141`).

### mcp.js

`createMcpServer({ db, hh, bridge })` -> an MCP `McpServer` with these tools.
All tool results are JSON text.

| Tool | Does |
|---|---|
| `browser_status` | bridge status + `hh.isLoggedIn()` |
| `search_vacancies {text, area?, page?}` | `hh.search`, upserts items as `found`, returns items with `key` and current `status` |
| `get_vacancy {key}` | `hh.getVacancy`, upserts full text, returns it |
| `list_resumes` / `save_resume {id?, name, text}` / `import_resume {url}` | resume storage |
| `get_instructions {kind: 'fit'|'ats'|'letter'|'resume_review', lang?, tone?}` | the system prompt the client must follow, plus the JSON shape to save |
| `save_fit_analysis {key, resumeId, result}` | computes score with `computeFitScore`, stores, sets `scored` |
| `save_ats_match {key, resumeId, result}` | stores `kind:'ats'`, score = `overall_match_score` |
| `rank_resumes {key}` | `rankResumeMatches` over stored ATS matches of this vacancy |
| `lint_letter {text, lang?}` | `lintLetter` |
| `save_letter {key, resumeId, lang, plan, text}` | lints, stores, sets `drafted`; returns lint |
| `queue_application {key, letterId, resumeId}` | requires letter lint `ok`; `db.setChoice`, sets `awaiting_approval` |
| `list_pipeline {status?}` / `pipeline_stats` | read the pipeline |
| `sync_responses` | `hh.listNegotiations`, updates matching vacancies to `sent`/`replied`/`invited`/`rejected` |
| `submit_application {key}` | only for `approved`; returns `{ error: 'not_implemented' }` until the response form is mapped |

### index.js

One `node:http` server on `PORT` (default 8765): `/mcp` — MCP Streamable HTTP
transport (stateless), `/api/*` — `createApi`, everything else — static files
from `public/`. `GET /healthz` -> `{ ok: true }`.

## Version 2 additions

Everything above stays valid; this section extends it. Where the two disagree,
this section wins.

### End-to-end workflow (what the MCP client does)

1. `sync_resumes` — pull every resume of the hh.ru profile into the database.
2. `get_instructions {kind:'resume_review'}` -> audit each resume -> `save_resume_review`.
3. `run_search {id}` or `search_vacancies` — new vacancies land as `found`.
4. For each `found` vacancy worth a look: `get_vacancy`, then
   `get_instructions {kind:'ats'}` and `save_ats_match` once per candidate
   resume, then `rank_resumes {key}` to pick the resume.
5. `get_instructions {kind:'fit'}` -> `save_fit_analysis` with the chosen resume;
   verdict «ПРОПУСТИТЬ» -> `skip_vacancy`.
6. `get_instructions {kind:'letter'}` -> `save_letter` (fix lint errors and save
   again) -> `queue_application`.
7. The human approves in the panel. `list_pipeline {status:'approved'}` ->
   `submit_application {key}` one at a time.
8. `sync_responses` — pull statuses back from hh.ru.

`next_actions` returns this list with live counts so the client knows where it is.

### sites/hh.js additions

```js
// search gets optional filters, appended to the query string as-is:
search({ text, area = 113, page = 0, filters = {} })
// filters keys are hh.ru URL params, values strings or arrays (array -> repeated param):
// experience, schedule, employment, salary, only_with_salary, search_period,
// order_by, excluded_text, professional_role, work_format

listMyResumes() -> [{ externalId, url, title }]
// submitResponse fills the form and presses the button. It is the only
// function in the codebase allowed to do so.
submitResponse({ vacancyId, resumeExternalId, letter, confirm })
//   -> { submitted: true, confirmed: boolean, resumeTitle }
```

Markup verified read-only on the live site on 2026-11-12:

- Resume list: `https://hh.ru/applicant/resumes` (redirects to
  `/applicant/profile/me`). Card link `a[data-qa^="resume-card-link-"]`, href
  `/resume/<hex id>`; the hex id is `externalId`; title in
  `[data-qa="resume-title"]` inside the card (fallback: the link's last text
  line). If `[data-qa="compact-resume-show-more"]` exists, click it once before
  reading (it only expands the list).
- Response form: `https://hh.ru/applicant/vacancy_response?vacancyId=<id>`
  (a GET; it renders a page titled «Отклик на вакансию» and sends nothing).
  - Current resume: `[data-qa="resume-title"]`. To change it, click
    `document.querySelector('[data-qa="resume-title"]').closest('[role="button"]')`,
    then click `label[data-qa="magritte-select-option-<externalId>"]`
    (`aria-selected="true"` on the chosen one). Skip both clicks when the
    wanted resume is already the current one and cannot be told apart, i.e.
    always open the list and check `aria-selected` before clicking.
  - Letter: click `[data-qa="vacancy-response-letter-toggle"]`, then fill
    `textarea[data-qa="vacancy-response-popup-form-letter-input"]` with the
    bridge `fill` command (`bridge.command('fill', { selector, value })`), which
    fires the input events React needs. Read the value back with `evaluate` and
    fail with `fill_mismatch` if it differs from the letter.
  - Submit: `button[data-qa="vacancy-response-submit-popup"]`, clicked with
    `bridge.command('click', { selector })`.

`submitResponse` rules: throw `confirm_required` unless `confirm === true`;
throw `manual_required` when the submit button or the wanted resume option is
missing (employer test, archived vacancy, already responded); throw
`fill_mismatch` as above; never retry the click. What the page shows after a
successful submit is NOT known yet, so confirmation is done independently:
after the click wait, then call `listNegotiations()` and set
`confirmed = rows.some(r => r.vacancyId === vacancyId)`.

### sites/index.js, sites/linkedin.js, sites/upwork.js

```js
createSites(bridge, opts) -> { hh, linkedin, upwork, forUrl(url) -> adapter | null, forSource(source) }
// linkedin and upwork expose only: getVacancy(url) -> same shape as hh.getVacancy,
// with source 'linkedin' | 'upwork' and id taken from the URL
// (linkedin: /jobs/view/<digits> or ?currentJobId=<digits>; upwork: the ~<hex> token).
```

Port the selectors of `content-scripts/extractor-linkedin.js` and
`extractor-upwork.js`. They are not verified on the live sites; say so in a
comment. No search and no submission on these sites.

### db.js additions (schema `user_version` 2, migrated in place from 1)

```js
// resumes gain: source ('manual' | 'hh.ru'), externalId, url, title,
//               review (JSON), reviewScore, reviewedAt
saveResume({ id?, name, text, source?, externalId?, url?, title? }) -> resume
upsertResumeByExternal({ source, externalId, url, title, name?, text }) -> resume
//   same (source, externalId) updates text/title/url in place and keeps id, name and review
saveResumeReview(resumeId, review, score) -> resume
// vacancies gain: sentAt
// saved searches
saveSearch({ id?, name, site = 'hh.ru', text, area = 113, filters = {}, enabled = true }) -> search
listSearches() -> [...]   getSearch(id)   deleteSearch(id)   touchSearch(id) // sets lastRunAt
// settings (single JSON row)
getSettings() -> { dailyLimit, minDelaySec, blacklistEmployers: [], stopWords: [] }
updateSettings(patch) -> settings          // defaults: 20, 45, [], []
lastSentAt() -> ms | null
comparison(vacancyKey) -> [{ resumeId, name, hardCoverage, overall, analysisId, createdAt }]
//   latest ATS analysis per resume for this vacancy, unranked
```

`setStatus(key, 'sent')` also stamps `sentAt`. `updateSettings` validates:
`dailyLimit` integer 0..200, `minDelaySec` integer 0..3600, the two lists are
arrays of trimmed non-empty strings; otherwise throw code `bad_settings`.

### mcp.js additions and changes

`createMcpServer({ db, sites, bridge })` — `sites` replaces `hh`
(`sites.hh` is the hh adapter).

| Tool | Does |
|---|---|
| `next_actions` | the workflow above plus counts: resumes, resumes without review, vacancies by status, approved waiting to be sent, sent today vs `dailyLimit` |
| `sync_resumes` | `hh.listMyResumes`, `hh.importResume(url)` for each, `db.upsertResumeByExternal`; returns `[{id, name, title, chars, reviewed}]` and per-resume errors without aborting the rest |
| `save_resume_review {resumeId, result}` | stores the audit; score = `result.overall_ats_score` |
| `search_vacancies {text, area?, page?, filters?}` | as before, plus drops items whose employer is in `blacklistEmployers` or whose title contains a stop word (case-insensitive) and reports how many were dropped |
| `save_search` / `list_searches` / `delete_search` / `run_search {id, page?}` | saved searches; `run_search` = `search_vacancies` with the stored params + `touchSearch` |
| `get_vacancy {key?, url?}` | by key (existing) or by URL through `sites.forUrl`; unsupported URL -> code `unsupported_site` |
| `rank_resumes {key}` | ranked list plus `missing`: resumes that have no ATS match for this vacancy yet |
| `skip_vacancy {key, reason}` | sets `skipped` with the reason as note |
| `get_settings` / `update_settings {patch}` | settings |
| `submit_application {key}` | real submission, rules below |

`submit_application` checks, in this order, each failing with its own code and
without touching the browser: status is `approved` (`not_approved`); source is
`hh.ru` (`unsupported_site`); a letter and a resume are chosen and the resume
has an `externalId` (`not_ready`); the letter lint is ok (`lint_failed`);
`sentToday < dailyLimit` (`daily_limit`); `now - lastSentAt >= minDelaySec`
(`too_soon`, message says how many seconds to wait). Then
`hh.submitResponse({ ..., confirm: true })`. `confirmed: true` -> status `sent`
+ event `submitted`. `confirmed: false` -> status stays `approved`, event
`submit_unconfirmed`, and the result tells the client to run `sync_responses`
and NOT to call `submit_application` again for this key until that sync has
run. A thrown adapter error -> event `submit_failed` with the code, status
unchanged. There is no way to submit a vacancy that is not `approved`, and
`approved` can only be set through the panel's REST API.

Also register one MCP prompt `job_hunt` whose text is the workflow above.

### api.js additions

| Method and path | Result |
|---|---|
| `GET /api/vacancies/:key` | adds `comparison` (ranked with `rankResumeMatches`) |
| `GET /api/resumes` | items with `reviewScore`, `reviewedAt`, without `text` and `review` |
| `GET /api/resumes/:id` | `{ resume }` with `text` and `review` |
| `GET /api/settings` / `PUT /api/settings` | `{ settings }`; body is a patch |
| `GET /api/searches` | `{ items }` |

### Panel additions

Three sections switched by tabs: «Отклики» (existing pipeline; the detail view
gains a «Сравнение резюме» block from `comparison`: resume name, hard
requirement coverage, overall score, the top one marked as recommended),
«Резюме» (list with ATS score; detail shows the audit: four sub-scores, issues,
per-job rewrite suggestions, target roles in three groups, keyword matrix,
checklist — field names are in `RESUME_REVIEW_SYSTEM_PROMPT` in
`shared/constants.js`), «Настройки» (daily limit, minimum delay, employer
blacklist, stop words, read-only list of saved searches).

## Version 3 additions: response form variants

A read-only survey of 16 recent vacancies on 2026-11-12 found these variants of
`/applicant/vacancy_response?vacancyId=<id>`; they combine freely:

- **Letter optional**: `[data-qa="vacancy-response-letter-toggle"]` is present
  and the textarea appears only after clicking it.
- **Letter required**: no toggle; `textarea[data-qa="vacancy-response-popup-form-letter-input"]`
  is already on the page and `[data-qa="form-helper-description"]` reads
  «Сопроводительное письмо обязательное для этой вакансии».
- **Employer questions**: `[data-qa="employer-asking-for-test"]` present,
  intro in `[data-qa="test-description"]`. Each question is a
  `[data-qa="task-body"]` holding `[data-qa="task-question"]` (the text) and its
  inputs: a free-text question has `textarea[name="task_<qid>_text"]`; a choice
  question has `input[type="checkbox"|"radio"][name="task_<qid>"][value="<optionId>"]`,
  each inside a `label` whose text is the option label; an "own answer" option
  is the input with `value="open"` plus `textarea[name="task_<qid>_text"]`.
  hh.ru lists the "own answer" label twice (a duplicate input with a numeric
  value and the same label «Свой вариант»); keep only the `open` one.
- **Hidden resume**: `[data-qa="hidden-resume-warning"]` with text «Чтобы
  откликнуться на эту вакансию, поменяйте видимость резюме…». It refers to
  the resume currently selected in the form. The submit button stays enabled.

Not seen in the survey and therefore unhandled: external application links,
archived vacancies, vacancies already responded to. They surface as
`manual_required` because the expected controls are missing.

### sites/hh.js

```js
inspectResponseForm(vacancyId, { resumeExternalId } = {}) -> {
  available,            // false when there is no submit button
  letter,               // 'optional' | 'required'
  resumeHidden,         // warning present for the selected resume
  resumeWarning,        // its text or ''
  currentResumeTitle,
  intro,                // employer's text above the questions or ''
  questions: [{ id, text, kind: 'text' | 'choice', multiple, options: [{ value, label }], allowsOwn }]
}
// Selects resumeExternalId first when given (selection sends nothing), so that
// resumeHidden describes that resume. Never fills anything, never submits.

submitResponse({ vacancyId, resumeExternalId, letter, answers = [], confirm })
// answers: [{ id, text?, values?: [optionValue], own?: string }]
```

`submitResponse` now inspects the form after selecting the resume and, before
filling anything: throws `resume_hidden` when `resumeHidden`; throws
`answers_required` (message lists the unanswered question ids) unless every
question has an answer (`text` non-empty for kind `text`; at least one of
`values` / `own` for kind `choice`); throws `bad_input` for an answer whose id
is not on the form, a value that is not among the options, more than one value
on a non-`multiple` question, or `own` on a question without `allowsOwn`. Then
it fills: text answers with `bridge.command('fill', …)`; choices by clicking the
inputs page-side so the final checked set equals `values` (plus `open` when
`own` is given, whose text is then filled); the letter as before, skipping the
toggle click when the textarea is already present. It reads every field back and
throws `fill_mismatch` on any difference. Only then the single submit click.

### db.js (schema `user_version` 3)

Vacancies gain two JSON columns: `form` (the last `inspectResponseForm` result
plus `inspectedAt`) and `answers` (array in the shape above).
`saveForm(key, form) -> row`, `saveAnswers(key, answers) -> row`; both throw
`not_found` for an unknown key. `getVacancy` and `listPipeline` rows include
both, parsed (null when absent).

### mcp.js

| Tool | Does |
|---|---|
| `inspect_response_form {key}` | `hh.inspectResponseForm(id, { resumeExternalId })` using the vacancy's chosen resume when there is one, stores it with `db.saveForm`, returns it. hh.ru only (`unsupported_site`) |
| `save_answers {key, answers}` | validates against the stored form (same rules as `bad_input` above, code `bad_answers`; code `no_form` when the form was not inspected), stores with `db.saveAnswers` |

`queue_application` additionally requires an inspected form (`no_form`), refuses
with `resume_hidden` when the stored form says so (the message tells the human
to change the resume's visibility on hh.ru or pick another resume), and
requires answers to every question (`answers_required`). `submit_application`
passes `answers` through, and treats `resume_hidden`, `answers_required`,
`fill_mismatch` and `manual_required` from the adapter as a failure that moves
the vacancy back to `awaiting_approval` with the reason as note (event
`submit_failed`), so the human sees it in the panel. Workflow step 6 becomes:
letter -> `inspect_response_form` -> `save_answers` when there are questions ->
`queue_application`. Answers must be drawn from the resume; a question the
resume cannot answer (salary expectations, city, start date) is left
unanswered and reported to the human, who fills it in the panel.

### api.js and panel

`GET /api/vacancies/:key` already returns the vacancy row, which now carries
`form` and `answers`. New: `PUT /api/vacancies/:key/answers` body `{ answers }`
-> `{ vacancy }`, validated like `save_answers` (HTTP 400 on `bad_answers` /
`no_form`). The panel's vacancy detail shows a block «Вопросы работодателя»:
each question with its answer editable (textarea, checkboxes or radios, own
answer field), a save button, unanswered questions highlighted. Approve is
enabled only when the letter lint is ok, every question is answered and
`form.resumeHidden` is false; when it is true the block shows the warning text.

### Docker

`server/Dockerfile` (build context = repo root, because `shared/constants.js`
is imported) on `node:24-alpine`; `docker-compose.yml` in the repo root with a
named volume for `/data/jobfit.db`, `WEBBRIDGE_URL=http://host.docker.internal:10086`
and the port published on `127.0.0.1` only.
