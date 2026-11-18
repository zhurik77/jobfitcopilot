// Адаптер hh.ru поверх WebBridge: ходит в реальный браузер пользователя (с его
// сессией), поэтому не нужен ни API-ключ, ни обход антибота.
// Код, который исполняется на странице, написан обычными функциями и
// превращается в строку через Function.prototype.toString: так его можно
// читать и править как нормальный JS. Эти функции НЕ должны ссылаться на
// переменные модуля — в странице их не будет.
// Модуль никогда не кликает кнопки отклика (vacancy-serp__vacancy_response,
// vacancy-response-link-top): отправка идёт только после одобрения в панели.

const BASE = 'https://hh.ru';

// ---------- код, исполняемый в странице ----------

// Лёгкая проба состояния страницы для опроса: адрес, найден ли нужный
// элемент, не показана ли капча.
function pageProbe(selector, emptySelector) {
  const text = (document.body && document.body.innerText) || '';
  const captcha =
    /captcha/i.test(location.href) ||
    !!document.querySelector('[data-qa*="captcha"], iframe[src*="captcha"], iframe[src*="recaptcha"]') ||
    /я не робот|подтвердите, что вы не робот/i.test(text.slice(0, 3000));
  const count = document.querySelectorAll(selector).length;
  return {
    url: location.href,
    found: count > 0,
    count,
    empty: !!(emptySelector && document.querySelector(emptySelector)),
    captcha,
  };
}

function extractSearch() {
  const txt = (el) => (el && el.innerText ? el.innerText.trim() : '');
  const q = (root, sel) => root.querySelector(sel);
  const h1 = txt(document.querySelector('h1'));
  const m = h1.match(/Найдено\s+([\d\s  ]+)/);
  const total = m ? parseInt(m[1].replace(/[^\d]/g, ''), 10) : null;

  const items = [];
  document.querySelectorAll('[data-qa~="vacancy-serp__vacancy"]').forEach((card) => {
    const link = q(card, 'a[data-qa="serp-item__title"]');
    const href = link ? link.href || link.getAttribute('href') || '' : '';
    const idm = href.match(/\/vacancy\/(\d+)/);
    if (!idm) return; // карточка без ссылки на вакансию (реклама) пропускаем
    const exp = card.querySelector('[data-qa^="vacancy-serp__vacancy-work-experience-"]');
    const salary = card.querySelector('[data-qa^="vacancy-serp__vacancy-compensation"]');
    const snippet = [
      txt(q(card, '[data-qa="vacancy-serp__vacancy_snippet_responsibility"]')),
      txt(q(card, '[data-qa="vacancy-serp__vacancy_snippet_requirement"]')),
    ].filter(Boolean).join(' ');
    items.push({
      id: idm[1],
      title: txt(q(card, '[data-qa="serp-item__title-text"]')) || txt(link),
      employer: txt(q(card, '[data-qa="vacancy-serp__vacancy-employer-text"]')),
      address: txt(q(card, '[data-qa="vacancy-serp__vacancy-address"]')),
      salary: txt(salary),
      experience: txt(exp),
      snippet,
    });
  });
  return { total, items };
}

function extractVacancy() {
  const txt = (el) => (el && el.innerText ? el.innerText.trim() : '');
  const one = (sel) => txt(document.querySelector(sel));
  const salaryEl =
    document.querySelector('[data-qa="vacancy-salary"]') ||
    document.querySelector('[data-qa^="vacancy-salary"]');
  return {
    title: one('[data-qa="vacancy-title"]'),
    company: one('[data-qa="vacancy-company-name"]'),
    salary: txt(salaryEl),
    experience: one('[data-qa="vacancy-experience"]'),
    description: one('[data-qa="vacancy-description"]'),
    skills: Array.from(document.querySelectorAll('[data-qa="skills-element"]'))
      .map(txt).filter(Boolean),
  };
}

function extractNegotiations() {
  const txt = (el) => (el && el.innerText ? el.innerText.trim() : '');
  const rows = [];
  document.querySelectorAll('[data-qa="negotiations-item"]').forEach((row) => {
    // Проверено на живой странице 2026-11-12: ссылка на вакансию в строке —
    // обычный a[href="/vacancy/<id>"], а у тега статуса data-qa из двух слов
    // ("negotiations-tag negotiations-item-viewed"), поэтому ~=, а не =.
    const link = row.querySelector('a[href*="/vacancy/"]');
    const href = link ? link.getAttribute('href') || link.href || '' : '';
    const idm = href.match(/\/vacancy\/(\d+)/);
    rows.push({
      vacancyId: idm ? idm[1] : null,
      title: txt(row.querySelector('[data-qa="negotiations-item-vacancy"]')),
      company: txt(row.querySelector('[data-qa="negotiations-item-company"]')),
      status: txt(row.querySelector('[data-qa~="negotiations-tag"]')),
      date: txt(row.querySelector('[data-qa="negotiations-item-date"]')),
    });
  });
  return rows;
}

// Порт content-scripts/extractor-hh-resume.js. Клики только по «Развернуть»
// внутри карточек резюме: без них часть опыта вообще не попадает в DOM.
async function extractResume() {
  const text = (el) => (el && el.innerText ? el.innerText.trim() : '');
  const stripToggleLabel = (s) => s.replace(/\n*(Развернуть|Свернуть)\s*$/i, '').trim();
  const clickExpandButtons = (root) => {
    if (!root) return false;
    const buttons = Array.from(root.querySelectorAll('button'))
      .filter((b) => /^развернуть$/i.test((b.innerText || '').trim()));
    buttons.forEach((b) => b.click());
    return buttons.length > 0;
  };

  const expCard = document.querySelector('[data-qa="resume-list-card-experience"]');
  const aboutCard = document.querySelector('[data-qa="resume-about-card"]');
  const clickedExp = clickExpandButtons(expCard);
  const clickedAbout = clickExpandButtons(aboutCard);
  if (clickedExp || clickedAbout) await new Promise((r) => setTimeout(r, 300)); // даём React перерисовать

  const title = text(document.querySelector('[data-qa="resume-block-title-position"]'));
  const salary = text(document.querySelector('[data-qa="resume-block-salary"]'));

  const experience = [];
  document.querySelectorAll('[data-qa="profile-experience-company-card"]').forEach((co) => {
    const cells = co.querySelectorAll('[data-qa="cell-text-content"]');
    const company = cells.length ? text(cells[0]) : '';
    co.querySelectorAll('[data-qa="magritte-stepper-step-content"]').forEach((step) => {
      const stepText = stripToggleLabel(text(step));
      if (stepText) experience.push({ company, text: stepText });
    });
  });

  const education = Array.from(
    document.querySelectorAll('[data-qa="resume-list-card-education"] [data-qa^="resume-list-card-education-item-"]'),
  ).map((el) => stripToggleLabel(text(el))).filter(Boolean);

  const skills = Array.from(
    document.querySelectorAll('[data-qa="skills-card"] [data-qa^="skill-tag-"]'),
  ).map(text).filter(Boolean);

  const about = stripToggleLabel(text(document.querySelector('[data-qa="resume-about-card"]')));
  return { title, salary, experience, education, skills, about };
}

// Список резюме профиля. «Показать ещё» только раскрывает список, поэтому один
// клик допустим; больше одного не делаем, чтобы не зациклиться на странице.
async function extractMyResumes() {
  const txt = (el) => (el && el.innerText ? el.innerText.trim() : '');
  // «Показать ещё» (compact-resume-show-more) не нажимаем: на живой странице
  // 2026-11-12 клик уводил вкладку на другую страницу, и evaluate падал с
  // «Inspected target navigated or closed». Все шесть резюме профиля видны и без него.
  const seen = new Set();
  const out = [];
  document.querySelectorAll('a[data-qa^="resume-card-link-"]').forEach((link) => {
    const m = (link.getAttribute('href') || link.href || '').match(/\/resume\/([0-9a-f]+)/i);
    if (!m || seen.has(m[1])) return;
    seen.add(m[1]);
    // Заголовок лежит в карточке: поднимаемся до ближайшего предка, где он есть.
    let titleEl = null;
    for (let el = link; el && !titleEl; el = el.parentElement) {
      titleEl = el.querySelector('[data-qa="resume-title"]');
    }
    const lines = txt(link).split('\n').map((s) => s.trim()).filter(Boolean);
    out.push({ externalId: m[1], title: txt(titleEl) || lines[lines.length - 1] || '' });
  });
  return out;
}

// Форма отклика: открыть выпадающий список резюме. Кликаем по ближайшему
// role=button от заголовка текущего резюме (так устроена разметка).
function openResumePicker() {
  const t = document.querySelector('[data-qa="resume-title"]');
  const btn = t && t.closest('[role="button"]');
  if (!btn) return { ok: false };
  btn.click();
  return { ok: true };
}

function readResumeOption(externalId) {
  const label = document.querySelector(`label[data-qa="magritte-select-option-${externalId}"]`);
  if (!label) return { found: false, selected: false };
  return { found: true, selected: label.getAttribute('aria-selected') === 'true' };
}

function clickResumeOption(externalId) {
  const label = document.querySelector(`label[data-qa="magritte-select-option-${externalId}"]`);
  if (!label) return { ok: false };
  label.click();
  return { ok: true };
}

// Что выбрано сейчас. Если после клика список закрылся, опций в DOM нет
// (optionsPresent=false): вызывающий код откроет список заново.
function readResumeSelection() {
  const opts = document.querySelectorAll('label[data-qa^="magritte-select-option-"]');
  const sel = document.querySelector('label[data-qa^="magritte-select-option-"][aria-selected="true"]');
  const t = document.querySelector('[data-qa="resume-title"]');
  return {
    optionsPresent: opts.length > 0,
    selectedId: sel ? (sel.getAttribute('data-qa') || '').replace('magritte-select-option-', '') : null,
    title: t && t.innerText ? t.innerText.trim() : '',
  };
}

// Разбор формы отклика (только чтение). Разметка снята с живых форм 2026-11-12.
// Вопрос работодателя: [data-qa="task-body"]; текстовый — textarea
// name="task_<qid>_text"; выбор — input checkbox/radio name="task_<qid>".
// hh.ru дублирует вариант «Свой вариант»: input value="open" и ещё один с
// числовым value и той же подписью — оставляем только open.
function extractResponseForm() {
  const txt = (el) => (el && el.innerText ? el.innerText.trim() : '');
  const submit = document.querySelector('button[data-qa="vacancy-response-submit-popup"]');
  const toggle = document.querySelector('[data-qa="vacancy-response-letter-toggle"]');
  const area = document.querySelector('textarea[data-qa="vacancy-response-popup-form-letter-input"]');
  const helper = txt(document.querySelector('[data-qa="form-helper-description"]'));
  const warn = document.querySelector('[data-qa="hidden-resume-warning"]');
  const questions = [];
  document.querySelectorAll('[data-qa="task-body"]').forEach((body) => {
    const labelOf = (inp) => {
      const l = inp.closest('label');
      return txt(l) || inp.getAttribute('aria-label') || '';
    };
    const inputs = Array.from(body.querySelectorAll('input[type="checkbox"], input[type="radio"]'))
      .filter((i) => /^task_/.test(i.getAttribute('name') || ''));
    const ta = body.querySelector('textarea[name^="task_"][name$="_text"]');
    const text = txt(body.querySelector('[data-qa="task-question"]'));
    if (inputs.length) {
      const id = inputs[0].getAttribute('name').slice('task_'.length);
      const open = inputs.find((i) => i.value === 'open');
      const openLabel = open ? labelOf(open) : null;
      const options = inputs
        .filter((i) => i.value !== 'open' && !(open && labelOf(i) === openLabel))
        .map((i) => ({ value: i.value, label: labelOf(i) }));
      questions.push({
        id, text, kind: 'choice',
        multiple: inputs[0].type === 'checkbox',
        options, allowsOwn: !!open,
      });
    } else if (ta) {
      const id = ta.getAttribute('name').slice('task_'.length, -'_text'.length);
      questions.push({ id, text, kind: 'text', multiple: false, options: [], allowsOwn: false });
    }
  });
  return {
    available: !!submit,
    letter: (!toggle && area) || /Сопроводительное письмо обязательн/i.test(helper) ? 'required' : 'optional',
    resumeHidden: !!warn,
    resumeWarning: txt(warn),
    currentResumeTitle: txt(document.querySelector('[data-qa="resume-title"]')),
    intro: txt(document.querySelector('[data-qa="test-description"]')),
    questions,
  };
}

// Выставить выбор: итоговый набор отмеченных = want. Радио снимается само при
// клике по нужному, чекбоксы кликаем в обе стороны. Клики идут по input на
// странице, чтобы React увидел change.
function setChoices(qid, want) {
  const inputs = document.querySelectorAll(`input[name="task_${qid}"]`);
  if (!inputs.length) return { ok: false };
  inputs.forEach((inp) => {
    const wanted = want.includes(inp.value);
    if (inp.checked !== wanted && (wanted || inp.type === 'checkbox')) inp.click();
  });
  return { ok: true };
}

// Прочитать обратно: отмеченные значения и текст textarea по каждому вопросу.
function readAnswerState(qids) {
  const out = {};
  qids.forEach((qid) => {
    const checked = Array.from(document.querySelectorAll(`input[name="task_${qid}"]`))
      .filter((i) => i.checked).map((i) => i.value).sort();
    const ta = document.querySelector(`textarea[name="task_${qid}_text"]`);
    out[qid] = { checked, text: ta ? ta.value : null };
  });
  return out;
}

function openLetterField(textareaSelector, toggleSelector) {
  if (document.querySelector(textareaSelector)) return { ok: true }; // уже раскрыто: повторный клик свернул бы поле
  const toggle = document.querySelector(toggleSelector);
  if (!toggle) return { ok: false };
  toggle.click();
  return { ok: true };
}

function readLetterValue(textareaSelector) {
  const ta = document.querySelector(textareaSelector);
  return { found: !!ta, value: ta ? ta.value : null };
}

function loginMarkers() {
  return !!document.querySelector(
    '[data-qa="mainmenu_profileAndResumes"], [data-qa="mainmenu_vacancyResponses"]',
  );
}

// ---------- сборка строки для evaluate ----------

// Асинхронная IIFE: top-level await в evaluate — синтаксическая ошибка, а
// общий JS-realm требует изолировать переменные. Результат — компактный JSON.
export function snippet(fn, ...args) {
  return `(async () => JSON.stringify(await (${fn.toString()})(${args.map((a) => JSON.stringify(a)).join(', ')})))()`;
}

function formatResumeText(r) {
  const parts = [];
  if (r.title) parts.push(r.title + (r.salary ? ' — ' + r.salary : ''));
  if (r.experience.length) {
    const blocks = r.experience.map((e) => (e.company ? e.company + '\n' : '') + e.text);
    parts.push('Опыт работы:\n\n' + blocks.join('\n\n---\n\n'));
  }
  if (r.skills.length) parts.push('Навыки: ' + r.skills.join(', '));
  if (r.education.length) parts.push('Образование:\n' + r.education.map((e) => '— ' + e).join('\n'));
  if (r.about) parts.push('О себе:\n' + r.about);
  return parts.join('\n\n');
}

function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

const stripQuery = (u) => String(u).split(/[?#]/)[0];

function parseVacancyId(idOrUrl) {
  const s = String(idOrUrl ?? '').trim();
  if (/^\d+$/.test(s)) return s;
  const m = s.match(/\/vacancy\/(\d+)/);
  if (!m) throw fail('bad_id', `Не удалось определить id вакансии: ${s}`);
  return m[1];
}

function parseJson(raw) {
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    throw fail('bad_reply', 'Страница вернула не-JSON из evaluate');
  }
}

/**
 * @param {{ navigate: Function, evaluate: Function }} bridge
 * @param {{ waitMs?: number, pollMs?: number, sleep?: (ms: number) => Promise<void> }} [opts]
 */
export function createHh(bridge, {
  waitMs = 15000,
  pollMs = 500,
  settleMs = 3000,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
} = {}) {
  const run = async (fn, ...args) => parseJson(await bridge.evaluate(snippet(fn, ...args)));

  // Опрос по счётчику, а не по Date.now(): в тестах sleep пустой, и время
  // не должно идти по настоящим часам.
  // Возвращает 'found' или 'empty' (показан блок «ничего не найдено»).
  // Список считается готовым, только когда число элементов совпало в двух
  // опросах подряд: выдача hh.ru дорисовывается порциями, и выборка по
  // первому появившемуся элементу давала 20 карточек из 50.
  // Одиночным элементам (заголовок вакансии, резюме) ждать нечего — `stable`
  // включается только для списков.
  async function open(url, selector, { emptySelector = null, stable = false } = {}) {
    await bridge.navigate(url);
    const attempts = Math.max(1, Math.ceil(waitMs / pollMs));
    let prevCount = -1;
    for (let i = 0; i < attempts; i++) {
      // Пока страница перенаправляется (например, /applicant/resumes ->
      // /applicant/profile/me), evaluate падает с «Inspected target navigated
      // or closed». Это не ошибка, а «ещё не готово»: ждём следующего опроса.
      let p = null;
      try {
        p = await run(pageProbe, selector, emptySelector);
      } catch (err) {
        if (!/navigated or closed|execution context|cannot find context/i.test(String(err && err.message))) throw err;
      }
      if (p && /\/account\/login/.test(p.url ?? '')) {
        throw fail('login_required', 'hh.ru просит войти в аккаунт: залогиньтесь в браузере');
      }
      if (p && p.captcha) throw fail('captcha', 'hh.ru показал капчу: пройдите её в браузере');
      if (p && p.found) {
        if (!stable || typeof p.count !== 'number' || p.count === prevCount) return 'found';
        prevCount = p.count;
      } else if (p && p.empty) {
        return 'empty';
      }
      await sleep(pollMs);
    }
    // Счётчик так и не устоялся, но элементы есть — отдаём то, что нарисовано.
    if (prevCount > 0) return 'found';
    throw fail('timeout', `Не дождались ${selector} за ${waitMs} мс (${url})`);
  }

  // Вынесено из объекта, чтобы submitResponse не зависел от `this`
  // (при деструктуризации адаптера он потерялся бы и подтверждение молча падало).
  const listNegotiations = async () => {
    await open(`${BASE}/applicant/negotiations`, '[data-qa="negotiations-item"]', { stable: true });
    return run(extractNegotiations);
  };

  const SUBMIT = 'button[data-qa="vacancy-response-submit-popup"]';
  const TOGGLE = '[data-qa="vacancy-response-letter-toggle"]';
  const AREA = 'textarea[data-qa="vacancy-response-popup-form-letter-input"]';
  const attemptsN = Math.max(1, Math.ceil(waitMs / pollMs));
  const normNl = (s) => String(s ?? '').replace(/\r\n?/g, '\n');

  // Опрос до выполнения условия; null, если не дождались.
  const poll = async (fn, args, done) => {
    for (let i = 0; i < attemptsN; i++) {
      const r = await run(fn, ...args);
      if (done(r)) return r;
      await sleep(pollMs);
    }
    return null;
  };

  // Открыть форму отклика (GET, ничего не отправляет). Нет кнопки отправки
  // (тест работодателя, архив, уже откликались) — это не таймаут, а случай для
  // ручной обработки. login/captcha остаются как есть. required=false: вместо
  // исключения вернуть false.
  async function openResponseForm(vid, { required = true } = {}) {
    try {
      await open(`${BASE}/applicant/vacancy_response?vacancyId=${vid}`, SUBMIT);
      return true;
    } catch (e) {
      if (e && e.code === 'timeout') {
        if (!required) return false;
        throw fail('manual_required', 'Нет кнопки отправки отклика: нужна ручная обработка');
      }
      throw e;
    }
  }

  // Выбор резюме в форме (сам по себе ничего не отправляет). Всегда открываем
  // список и смотрим aria-selected, кликаем только если нужное не выбрано.
  // Возвращает название выбранного резюме.
  async function selectResume(resumeExternalId) {
    const opened = await run(openResumePicker);
    if (!opened || !opened.ok) throw fail('manual_required', 'Не удалось открыть список резюме');
    const opt = await poll(readResumeOption, [resumeExternalId], (r) => r && r.found);
    if (!opt) throw fail('manual_required', 'Нужного резюме нет в списке формы отклика');
    if (!opt.selected) {
      const c = await run(clickResumeOption, resumeExternalId);
      if (!c || !c.ok) throw fail('manual_required', 'Не удалось выбрать резюме');
    }
    // Проверка: выбрано именно нужное. Если список закрылся — открываем заново.
    for (let i = 0; i < attemptsN; i++) {
      const sel = await run(readResumeSelection);
      if (sel && sel.optionsPresent) {
        if (sel.selectedId === resumeExternalId) return sel.title;
      } else {
        await run(openResumePicker);
      }
      await sleep(pollMs);
    }
    throw fail('resume_mismatch', 'В форме выбрано не то резюме');
  }

  const emptyForm = {
    available: false, letter: 'optional', resumeHidden: false, resumeWarning: '',
    currentResumeTitle: '', intro: '', questions: [],
  };

  // id вопроса идёт в CSS-селектор, поэтому допускаем только безопасные символы.
  const SAFE_QID = /^[\w.-]+$/;

  return {
    // Разбор формы отклика без заполнения и отправки. С resumeExternalId сначала
    // выбирает это резюме (выбор ничего не шлёт), чтобы resumeHidden описывал его.
    async inspectResponseForm(vacancyId, { resumeExternalId } = {}) {
      const vid = typeof vacancyId === 'number' ? String(vacancyId) : vacancyId;
      if (typeof vid !== 'string' || !/^\d+$/.test(vid)) throw fail('bad_input', 'vacancyId должен состоять из цифр');
      if (resumeExternalId != null && (typeof resumeExternalId !== 'string' || !/^[0-9a-f]+$/i.test(resumeExternalId))) {
        throw fail('bad_input', 'resumeExternalId должен быть hex-строкой');
      }
      if (!(await openResponseForm(vid, { required: false }))) return { ...emptyForm };
      if (resumeExternalId) await selectResume(resumeExternalId);
      const f = await run(extractResponseForm);
      return { ...emptyForm, ...f, available: !!(f && f.available) };
    },

    async search({ text, area = 113, page = 0, filters = {} }) {
      const qs = new URLSearchParams({ text: String(text ?? ''), area: String(area), page: String(page) });
      // Фильтры идут в строку как есть; массив = повторяющийся параметр.
      // null/undefined/'' пропускаем. Выдача по умолчанию — свежие сверху:
      // order_by подставляем, если вызывающий не задал свой непустой.
      const f = { ...(filters ?? {}) };
      const hasOrder = (v) => (Array.isArray(v) ? v : [v]).some((x) => x != null && x !== '');
      if (!hasOrder(f.order_by)) f.order_by = 'publication_time';
      for (const [k, v] of Object.entries(f)) {
        for (const x of Array.isArray(v) ? v : [v]) {
          if (x == null || x === '') continue;
          qs.append(k, String(x));
        }
      }
      const state = await open(`${BASE}/search/vacancy?${qs}`, '[data-qa~="vacancy-serp__vacancy"]', {
        emptySelector: '[data-qa="empty-vacancy-search-block"]',
        stable: true,
      });
      if (state === 'empty') return { total: 0, page, items: [] };
      const r = await run(extractSearch);
      const items = (r.items ?? []).map((it) => ({
        ...it,
        url: `${BASE}/vacancy/${it.id}`,
      }));
      return { total: r.total ?? items.length, page, items };
    },

    async getVacancy(idOrUrl) {
      const id = parseVacancyId(idOrUrl);
      const url = `${BASE}/vacancy/${id}`;
      await open(url, '[data-qa="vacancy-title"]');
      const v = await run(extractVacancy);
      return { id, source: 'hh.ru', url, ...v };
    },

    listNegotiations,

    async importResume(url) {
      await open(stripQuery(url), '[data-qa="resume-block-title-position"]');
      const r = await run(extractResume);
      return { title: r.title, text: formatResumeText(r) };
    },

    async listMyResumes() {
      await open(`${BASE}/applicant/resumes`, 'a[data-qa^="resume-card-link-"]', { stable: true });
      const r = await run(extractMyResumes);
      return (r ?? []).map((x) => ({ externalId: x.externalId, url: `${BASE}/resume/${x.externalId}`, title: x.title }));
    },

    // ЕДИНСТВЕННОЕ место в кодовой базе, которое отправляет отклик работодателю.
    // Клик по кнопке отправки делается ровно один раз и никогда не повторяется,
    // даже если следующий шаг упал: отклик мог уже уйти.
    async submitResponse({ vacancyId, resumeExternalId, letter, answers = [], confirm } = {}) {
      if (confirm !== true) throw fail('confirm_required', 'Отправка отклика требует confirm === true');
      const vid = typeof vacancyId === 'number' ? String(vacancyId) : vacancyId;
      if (typeof vid !== 'string' || !/^\d+$/.test(vid)) throw fail('bad_input', 'vacancyId должен состоять из цифр');
      if (typeof resumeExternalId !== 'string' || !/^[0-9a-f]+$/i.test(resumeExternalId)) {
        throw fail('bad_input', 'resumeExternalId должен быть hex-строкой');
      }
      if (typeof letter !== 'string' || letter.trim() === '') throw fail('bad_input', 'Письмо должно быть непустой строкой');
      // Форма ответов проверяется до первого вызова моста, содержимое — после разбора формы.
      const answerList = answers == null ? [] : answers;
      if (!Array.isArray(answerList)) throw fail('bad_input', 'answers должен быть массивом');
      const seenIds = new Set();
      for (const a of answerList) {
        if (!a || typeof a !== 'object' || typeof a.id !== 'string' || a.id === '') {
          throw fail('bad_input', 'Каждый ответ должен быть объектом с id');
        }
        if (seenIds.has(a.id)) throw fail('bad_input', `Ответ на вопрос ${a.id} указан дважды`);
        seenIds.add(a.id);
        if (a.text != null && typeof a.text !== 'string') throw fail('bad_input', `text ответа ${a.id} должен быть строкой`);
        if (a.own != null && typeof a.own !== 'string') throw fail('bad_input', `own ответа ${a.id} должен быть строкой`);
        if (a.values != null && (!Array.isArray(a.values) || a.values.some((v) => typeof v !== 'string'))) {
          throw fail('bad_input', `values ответа ${a.id} должен быть массивом строк`);
        }
      }

      await openResponseForm(vid);
      const resumeTitle = await selectResume(resumeExternalId);

      // Форма разбирается ПОСЛЕ выбора резюме (предупреждение о скрытом резюме
      // относится к выбранному). Все проверки ниже идут до любого заполнения.
      const form = await run(extractResponseForm);
      if (form && form.resumeHidden) {
        throw fail('resume_hidden', `Резюме скрыто от работодателей: ${form.resumeWarning || 'поменяйте его видимость на hh.ru'}`);
      }
      const questions = (form && form.questions) || [];
      const byId = new Map(questions.map((q) => [q.id, q]));
      const answerOf = new Map(answerList.map((a) => [a.id, a]));
      const nonEmpty = (s) => typeof s === 'string' && s.trim() !== '';
      const answered = (q) => {
        const a = answerOf.get(q.id);
        if (!a) return false;
        if (q.kind === 'text') return nonEmpty(a.text);
        return (Array.isArray(a.values) && a.values.length > 0) || nonEmpty(a.own);
      };
      const missing = questions.filter((q) => !answered(q)).map((q) => q.id);
      if (missing.length) throw fail('answers_required', `Нет ответов на вопросы работодателя: ${missing.join(', ')}`);
      for (const q of questions) {
        if (!SAFE_QID.test(q.id)) throw fail('manual_required', `Непонятный id вопроса: ${q.id}`);
      }
      for (const a of answerList) {
        const q = byId.get(a.id);
        if (!q) throw fail('bad_input', `На форме нет вопроса ${a.id}`);
        const values = a.values ?? [];
        const own = nonEmpty(a.own);
        if (q.kind === 'text') {
          if (values.length || own) throw fail('bad_input', `Вопрос ${q.id} текстовый: нужен только text`);
          continue;
        }
        if (nonEmpty(a.text)) throw fail('bad_input', `Вопрос ${q.id} с выбором: text не используется`);
        const allowed = new Set(q.options.map((o) => o.value));
        for (const v of values) {
          if (!allowed.has(v)) throw fail('bad_input', `Значение ${v} не среди вариантов вопроса ${q.id}`);
        }
        if (new Set(values).size !== values.length) throw fail('bad_input', `Повторяющиеся значения в ответе ${q.id}`);
        if (!q.multiple && values.length + (own ? 1 : 0) > 1) {
          throw fail('bad_input', `Вопрос ${q.id} допускает только один вариант`);
        }
        if (own && !q.allowsOwn) throw fail('bad_input', `Вопрос ${q.id} не допускает своего варианта`);
      }

      // Заполнение ответов. Тексты — через fill; выбор — кликами по input на странице.
      const expected = [];
      for (const q of questions) {
        const a = answerOf.get(q.id);
        const textSel = `textarea[name="task_${q.id}_text"]`;
        if (q.kind === 'text') {
          await bridge.command('fill', { selector: textSel, value: a.text });
          expected.push({ q, checked: [], text: a.text });
          continue;
        }
        const own = nonEmpty(a.own);
        const want = [...(a.values ?? []), ...(own ? ['open'] : [])];
        const r = await run(setChoices, q.id, want);
        if (!r || !r.ok) throw fail('manual_required', `Не найдены варианты вопроса ${q.id}`);
        if (own) await bridge.command('fill', { selector: textSel, value: a.own });
        expected.push({ q, checked: [...want].sort(), text: own ? a.own : null });
      }

      // Письмо: раскрыть поле (если оно уже на странице, клик по переключателю
      // пропускается), заполнить через fill (React ждёт input-события).
      const lf = await run(openLetterField, AREA, TOGGLE);
      if (!lf || !lf.ok) throw fail('manual_required', 'Нет поля сопроводительного письма');
      const area = await poll(pageProbe, [AREA, null], (r) => r && r.found);
      if (!area) throw fail('manual_required', 'Поле письма не появилось');
      await bridge.command('fill', { selector: AREA, value: letter });

      // Чтение обратно: любое расхождение — fill_mismatch, клика не будет.
      if (expected.length) {
        const state = await run(readAnswerState, expected.map((e) => e.q.id));
        for (const e of expected) {
          const got = (state && state[e.q.id]) || { checked: null, text: null };
          if (e.q.kind === 'choice' && JSON.stringify(got.checked) !== JSON.stringify(e.checked)) {
            throw fail('fill_mismatch', `Отмеченные варианты вопроса ${e.q.id} не совпали с ответом`);
          }
          if (e.text != null && normNl(got.text) !== normNl(e.text)) {
            throw fail('fill_mismatch', `Текст ответа на вопрос ${e.q.id} не совпал`);
          }
        }
      }
      const back = await run(readLetterValue, AREA);
      if (!back || !back.found || normNl(back.value) !== normNl(letter)) {
        throw fail('fill_mismatch', 'Текст в поле письма не совпал с отправляемым');
      }

      // Единственный клик по кнопке отправки. Без повторов ни при каких ошибках ниже.
      await bridge.command('click', { selector: SUBMIT });

      // Что показывает страница после успеха — неизвестно, поэтому подтверждаем
      // независимо: ждём и ищем вакансию в списке откликов. Любая ошибка здесь
      // не должна скрыть факт отправки.
      let confirmed = false;
      try {
        await sleep(settleMs);
        const rows = await listNegotiations();
        confirmed = Array.isArray(rows) && rows.some((r) => String(r.vacancyId) === vid);
      } catch {
        confirmed = false;
      }
      return { submitted: true, confirmed, resumeTitle };
    },

    // Без навигации: смотрим шапку текущей страницы. Любая ошибка = не вошли.
    async isLoggedIn() {
      try {
        return (await run(loginMarkers)) === true;
      } catch {
        return false;
      }
    },
  };
}
