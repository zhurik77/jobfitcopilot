import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHh, snippet } from '../src/sites/hh.js';

// Фейковый мост: evaluate отдаёт заготовленные ответы по очереди (проба, затем данные).
function fakeBridge(evalReplies) {
  const queue = [...evalReplies];
  const bridge = {
    navigated: [],
    codes: [],
    commands: [],
    async command(action, args) { bridge.commands.push({ action, args }); return {}; },
    async navigate(url) { bridge.navigated.push(url); return { url, tabId: 1 }; },
    async evaluate(code) {
      bridge.codes.push(code);
      if (!queue.length) throw new Error('нет заготовленного ответа');
      const next = queue.shift();
      if (next instanceof Error) throw next;
      return typeof next === 'string' ? next : JSON.stringify(next);
    },
  };
  return bridge;
}

const sleep = async () => {};
const found = { url: 'https://hh.ru/x', found: true, captcha: false };
const waiting = { url: 'https://hh.ru/x', found: false, captcha: false };

test('snippet: асинхронная IIFE без top-level await', () => {
  const s = snippet((a) => a + 1, 2);
  assert.match(s, /^\(async \(\) => JSON\.stringify\(await/);
  assert.match(s, /\(2\)\)\)\(\)$/);
});

test('search: парсит карточки, строит url без query и считает page', async () => {
  const b = fakeBridge([
    waiting,
    found,
    { total: 173, items: [
      { id: '139138141', title: 'n8n инженер', employer: 'Рога', address: 'Москва', salary: '', experience: 'От 1 до 3 лет', snippet: 'делать' },
    ] },
  ]);
  const hh = createHh(b, { sleep });
  const r = await hh.search({ text: 'n8n', page: 2 });
  assert.equal(r.total, 173);
  assert.equal(r.page, 2);
  assert.equal(r.items[0].id, '139138141');
  assert.equal(r.items[0].url, 'https://hh.ru/vacancy/139138141');
  assert.match(b.navigated[0], /^https:\/\/hh\.ru\/search\/vacancy\?/);
  assert.match(b.navigated[0], /text=n8n/);
  assert.match(b.navigated[0], /area=113/);
  assert.match(b.navigated[0], /page=2/);
});

test('getVacancy: по числовому id', async () => {
  const b = fakeBridge([
    found,
    { title: 'Dev', company: 'ACME', salary: '', experience: '1-3', description: 'текст', skills: ['JS'] },
  ]);
  const v = await createHh(b, { sleep }).getVacancy('123456');
  assert.deepEqual(v, {
    id: '123456', source: 'hh.ru', url: 'https://hh.ru/vacancy/123456',
    title: 'Dev', company: 'ACME', salary: '', experience: '1-3', description: 'текст', skills: ['JS'],
  });
  assert.equal(b.navigated[0], 'https://hh.ru/vacancy/123456');
});

test('getVacancy: по полному url с query', async () => {
  const b = fakeBridge([found, { title: 'T', company: 'C', salary: '', experience: '', description: '', skills: [] }]);
  const v = await createHh(b, { sleep }).getVacancy('https://spb.hh.ru/vacancy/777?query=n8n&hhtmFrom=x');
  assert.equal(v.id, '777');
  assert.equal(v.url, 'https://hh.ru/vacancy/777');
  assert.equal(b.navigated[0], 'https://hh.ru/vacancy/777');
});

test('getVacancy: мусор вместо id даёт bad_id', async () => {
  await assert.rejects(createHh(fakeBridge([]), { sleep }).getVacancy('abc'), { code: 'bad_id' });
});

test('редирект на /account/login даёт login_required', async () => {
  const b = fakeBridge([{ url: 'https://hh.ru/account/login?backurl=%2F', found: false, captcha: false }]);
  await assert.rejects(createHh(b, { sleep }).listNegotiations(), { code: 'login_required' });
});

test('капча даёт captcha', async () => {
  const b = fakeBridge([{ url: 'https://hh.ru/x', found: false, captcha: true }]);
  await assert.rejects(createHh(b, { sleep }).getVacancy('1'), { code: 'captcha' });
});

test('селектор не появился за waitMs даёт timeout', async () => {
  const b = fakeBridge(Array(10).fill(waiting));
  const hh = createHh(b, { waitMs: 2000, pollMs: 500, sleep });
  await assert.rejects(hh.getVacancy('1'), { code: 'timeout' });
  assert.equal(b.codes.length, 4); // waitMs / pollMs проб
});

test('listNegotiations: возвращает строки как есть', async () => {
  const rows = [
    { vacancyId: '10', title: 'A', company: 'X', status: 'Приглашение', date: '5 ноября' },
    { vacancyId: null, title: 'B', company: 'Y', status: 'Отказ', date: '1 ноября' },
  ];
  const b = fakeBridge([found, rows]);
  assert.deepEqual(await createHh(b, { sleep }).listNegotiations(), rows);
  assert.equal(b.navigated[0], 'https://hh.ru/applicant/negotiations');
});

test('importResume: собирает текст из структурных полей', async () => {
  const b = fakeBridge([
    found,
    { title: 'Инженер', salary: '100 000 ₽', experience: [{ company: 'ACME', text: 'Делал X' }], education: ['МГУ'], skills: ['JS', 'n8n'], about: 'Я' },
  ]);
  const r = await createHh(b, { sleep }).importResume('https://hh.ru/resume/abc?hhtmFrom=x');
  assert.equal(r.title, 'Инженер');
  assert.match(r.text, /^Инженер — 100 000 ₽/);
  assert.match(r.text, /Опыт работы:\n\nACME\nДелал X/);
  assert.match(r.text, /Навыки: JS, n8n/);
  assert.match(r.text, /— МГУ/);
  assert.match(r.text, /О себе:\nЯ$/);
  assert.equal(b.navigated[0], 'https://hh.ru/resume/abc');
});

test('isLoggedIn: true по маркерам шапки, false при ошибке моста, без навигации', async () => {
  const yes = fakeBridge([true]);
  assert.equal(await createHh(yes, { sleep }).isLoggedIn(), true);
  assert.equal(yes.navigated.length, 0);
  const no = fakeBridge([false]);
  assert.equal(await createHh(no, { sleep }).isLoggedIn(), false);
  const broken = fakeBridge([new Error('daemon_unreachable')]);
  assert.equal(await createHh(broken, { sleep }).isLoggedIn(), false);
});

test('search: order_by=publication_time по умолчанию', async () => {
  const b = fakeBridge([found, found, { total: 0, items: [] }]);
  await createHh(b, { sleep }).search({ text: 'n8n' });
  assert.match(b.navigated[0], /order_by=publication_time/);
});

test('search: order_by вызывающего перекрывает умолчание', async () => {
  const b = fakeBridge([found, found, { total: 0, items: [] }]);
  await createHh(b, { sleep }).search({ text: 'n8n', filters: { order_by: 'relevance' } });
  const qs = new URL(b.navigated[0]).searchParams;
  assert.deepEqual(qs.getAll('order_by'), ['relevance']);
});

test('search: order_by null или пустая строка даёт умолчание', async () => {
  for (const v of [null, '', undefined]) {
    const b = fakeBridge([found, found, { total: 0, items: [] }]);
    await createHh(b, { sleep }).search({ text: 'n8n', filters: { order_by: v } });
    assert.deepEqual(new URL(b.navigated[0]).searchParams.getAll('order_by'), ['publication_time']);
  }
});

test('search: filters — массив повторяет параметр, пустые значения пропускаются', async () => {
  const b = fakeBridge([found, found, { total: 0, items: [] }]);
  await createHh(b, { sleep }).search({
    text: 'n8n',
    filters: { experience: 'between1And3', schedule: ['remote', 'fullDay'], salary: '', excluded_text: null, only_with_salary: undefined, search_period: 7 },
  });
  const qs = new URL(b.navigated[0]).searchParams;
  assert.deepEqual(qs.getAll('experience'), ['between1And3']);
  assert.deepEqual(qs.getAll('schedule'), ['remote', 'fullDay']);
  assert.deepEqual(qs.getAll('search_period'), ['7']);
  assert.equal(qs.has('salary'), false);
  assert.equal(qs.has('excluded_text'), false);
  assert.equal(qs.has('only_with_salary'), false);
  assert.equal(qs.get('text'), 'n8n');
});

test('listMyResumes: разбирает карточки и строит url', async () => {
  const b = fakeBridge([
    found,
    [{ externalId: 'abc123', title: 'Инженер' }, { externalId: 'def456', title: 'Аналитик' }],
  ]);
  const r = await createHh(b, { sleep }).listMyResumes();
  assert.deepEqual(r, [
    { externalId: 'abc123', url: 'https://hh.ru/resume/abc123', title: 'Инженер' },
    { externalId: 'def456', url: 'https://hh.ru/resume/def456', title: 'Аналитик' },
  ]);
  assert.equal(b.navigated[0], 'https://hh.ru/applicant/resumes');
  assert.match(b.codes[1], /compact-resume-show-more/);
  assert.equal(b.commands.length, 0);
});

// ---------- submitResponse ----------

const RID = 'abc123def';
const LETTER = 'Здравствуйте!\nХочу к вам.';
const SUBMIT_SEL = 'button[data-qa="vacancy-response-submit-popup"]';
const okArgs = { vacancyId: '555', resumeExternalId: RID, letter: LETTER, confirm: true };
const submitClicks = (b) => b.commands.filter((c) => c.action === 'click' && c.args.selector === SUBMIT_SEL);
const selOk = { optionsPresent: true, selectedId: RID, title: 'Инженер' };
const formOk = { available: true, letter: 'optional', resumeHidden: false, resumeWarning: '', currentResumeTitle: 'Инженер', intro: '', questions: [] };

// Ответы evaluate для успешного прохода формы до клика (без listNegotiations).
function formReplies({ selected = false, back = LETTER } = {}) {
  const r = [found, { ok: true }, { found: true, selected }];
  if (!selected) r.push({ ok: true });
  r.push(selOk, formOk, { ok: true }, found, { found: true, value: back });
  return r;
}
const rows = (id) => [found, [{ vacancyId: id, title: 'A', company: 'X', status: 'Ожидает', date: '1 ноября' }]];

test('submitResponse: без confirm === true ничего не трогает', async () => {
  for (const confirm of [undefined, false, 'true', 1, null]) {
    const b = fakeBridge([]);
    await assert.rejects(createHh(b, { sleep }).submitResponse({ ...okArgs, confirm }), { code: 'confirm_required' });
    assert.equal(b.navigated.length, 0);
    assert.equal(b.codes.length, 0);
    assert.equal(b.commands.length, 0);
  }
});

test('submitResponse: невалидные входы дают bad_input до любых вызовов моста', async () => {
  const bads = [
    { vacancyId: '12a' }, { vacancyId: '' }, { vacancyId: undefined }, { vacancyId: {} },
    { resumeExternalId: 'xyz' }, { resumeExternalId: '' }, { resumeExternalId: 123 },
    { letter: '' }, { letter: '   \n' }, { letter: null }, { letter: 5 },
  ];
  for (const bad of bads) {
    const b = fakeBridge([]);
    await assert.rejects(createHh(b, { sleep }).submitResponse({ ...okArgs, ...bad }), { code: 'bad_input' });
    assert.equal(b.navigated.length, 0);
    assert.equal(b.commands.length, 0);
  }
});

test('submitResponse: нет кнопки отправки — manual_required, не timeout', async () => {
  const b = fakeBridge(Array(4).fill(waiting));
  await assert.rejects(createHh(b, { waitMs: 1000, pollMs: 500, sleep }).submitResponse(okArgs), { code: 'manual_required' });
  assert.equal(b.navigated[0], 'https://hh.ru/applicant/vacancy_response?vacancyId=555');
  assert.equal(b.commands.length, 0);
});

test('submitResponse: login_required и captcha остаются как есть', async () => {
  const l = fakeBridge([{ url: 'https://hh.ru/account/login', found: false, captcha: false }]);
  await assert.rejects(createHh(l, { sleep }).submitResponse(okArgs), { code: 'login_required' });
  assert.equal(l.commands.length, 0);
  const c = fakeBridge([{ url: 'https://hh.ru/x', found: false, captcha: true }]);
  await assert.rejects(createHh(c, { sleep }).submitResponse(okArgs), { code: 'captcha' });
  assert.equal(c.commands.length, 0);
});

test('submitResponse: нужного резюме нет в списке — manual_required', async () => {
  const b = fakeBridge([found, { ok: true }, { found: false, selected: false }, { found: false, selected: false }]);
  await assert.rejects(createHh(b, { waitMs: 1000, pollMs: 500, sleep }).submitResponse(okArgs), { code: 'manual_required' });
  assert.equal(b.commands.length, 0);
});

test('submitResponse: выбрано другое резюме — resume_mismatch', async () => {
  const other = { optionsPresent: true, selectedId: 'ffff', title: 'Другое' };
  const b = fakeBridge([found, { ok: true }, { found: true, selected: false }, { ok: true }, other, other]);
  await assert.rejects(createHh(b, { waitMs: 1000, pollMs: 500, sleep }).submitResponse(okArgs), { code: 'resume_mismatch' });
  assert.equal(b.commands.length, 0);
});

test('submitResponse: текст в поле не совпал — fill_mismatch, клика нет', async () => {
  const b = fakeBridge(formReplies({ back: 'обрезано' }));
  await assert.rejects(createHh(b, { sleep }).submitResponse(okArgs), { code: 'fill_mismatch' });
  assert.equal(b.commands.filter((c) => c.action === 'fill').length, 1);
  assert.equal(submitClicks(b).length, 0);
  assert.equal(b.commands.filter((c) => c.action === 'click').length, 0);
});

test('submitResponse: нет поля письма — manual_required, клика нет', async () => {
  const b = fakeBridge([found, { ok: true }, { found: true, selected: true }, selOk, formOk, { ok: false }]);
  await assert.rejects(createHh(b, { sleep }).submitResponse(okArgs), { code: 'manual_required' });
  assert.equal(b.commands.length, 0);
});

test('submitResponse: успех — один клик, confirmed true, resumeTitle', async () => {
  const b = fakeBridge([...formReplies(), ...rows('555')]);
  const r = await createHh(b, { sleep }).submitResponse(okArgs);
  assert.deepEqual(r, { submitted: true, confirmed: true, resumeTitle: 'Инженер' });
  assert.equal(submitClicks(b).length, 1);
  assert.equal(b.commands.filter((c) => c.action === 'click').length, 1);
  assert.deepEqual(b.commands[0], { action: 'fill', args: { selector: 'textarea[data-qa="vacancy-response-popup-form-letter-input"]', value: LETTER } });
  assert.equal(b.commands[1].action, 'click');
  assert.equal(b.navigated[1], 'https://hh.ru/applicant/negotiations');
  assert.ok(b.codes.some((c) => c.includes('label.click()')), 'невыбранное резюме кликается');
});

test('submitResponse: резюме уже выбрано — клик по опции не делается', async () => {
  const b = fakeBridge([...formReplies({ selected: true }), ...rows('555')]);
  const r = await createHh(b, { sleep }).submitResponse(okArgs);
  assert.equal(r.submitted, true);
  assert.ok(!b.codes.some((c) => c.includes('label.click()')));
  assert.equal(submitClicks(b).length, 1);
});

test('submitResponse: после клика список закрылся — открывается заново, проверка проходит', async () => {
  const b = fakeBridge([
    found, { ok: true }, { found: true, selected: false }, { ok: true },
    { optionsPresent: false, selectedId: null, title: 'Инженер' }, { ok: true }, selOk, formOk,
    { ok: true }, found, { found: true, value: LETTER },
    ...rows('555'),
  ]);
  const r = await createHh(b, { sleep }).submitResponse(okArgs);
  assert.equal(r.submitted, true);
  assert.equal(submitClicks(b).length, 1);
});

test('submitResponse: переводы строк CRLF в поле считаются совпадением', async () => {
  const b = fakeBridge([...formReplies({ back: LETTER.replace(/\n/g, '\r\n') }), ...rows('555')]);
  const r = await createHh(b, { sleep }).submitResponse(okArgs);
  assert.equal(r.submitted, true);
  assert.equal(submitClicks(b).length, 1);
});

test('submitResponse: вакансии нет в откликах — submitted true, confirmed false', async () => {
  const b = fakeBridge([...formReplies(), ...rows('999')]);
  const r = await createHh(b, { sleep }).submitResponse(okArgs);
  assert.deepEqual(r, { submitted: true, confirmed: false, resumeTitle: 'Инженер' });
  assert.equal(submitClicks(b).length, 1);
});

test('submitResponse: listNegotiations упал после клика — submitted true, confirmed false, без повтора клика', async () => {
  const b = fakeBridge([...formReplies(), new Error('мост упал')]);
  const r = await createHh(b, { sleep }).submitResponse(okArgs);
  assert.deepEqual(r, { submitted: true, confirmed: false, resumeTitle: 'Инженер' });
  assert.equal(submitClicks(b).length, 1);
});

// ---------- варианты формы отклика ----------

const qText = { id: 't1', text: 'Опыт с Python?', kind: 'text', multiple: false, options: [], allowsOwn: false };
const qMulti = {
  id: 'c1', text: 'Инструменты', kind: 'choice', multiple: true, allowsOwn: true,
  options: [{ value: 'a', label: 'n8n' }, { value: 'b', label: 'Zapier' }],
};
const qRadio = {
  id: 'r1', text: 'Формат', kind: 'choice', multiple: false, allowsOwn: false,
  options: [{ value: 'x', label: 'Офис' }, { value: 'y', label: 'Удалёнка' }],
};
const formQ = { ...formOk, questions: [qText, qMulti, qRadio] };
const upToForm = (form) => [found, { ok: true }, { found: true, selected: true }, selOk, form];
const fills = (b) => b.commands.filter((c) => c.action === 'fill');
const goodAnswers = [
  { id: 't1', text: 'Python 3 года' },
  { id: 'c1', values: ['a'], own: 'Make' },
  { id: 'r1', values: ['y'] },
];

test('inspectResponseForm: необязательное письмо, без вопросов; клик и fill не делаются', async () => {
  const b = fakeBridge([found, formOk]);
  const r = await createHh(b, { sleep }).inspectResponseForm('555');
  assert.deepEqual(r, formOk);
  assert.equal(b.navigated[0], 'https://hh.ru/applicant/vacancy_response?vacancyId=555');
  assert.equal(b.commands.length, 0);
});

test('inspectResponseForm: обязательное письмо и вопросы всех видов', async () => {
  const form = { ...formQ, letter: 'required', intro: 'Ответьте на вопросы' };
  const b = fakeBridge([found, form]);
  const r = await createHh(b, { sleep }).inspectResponseForm(555);
  assert.equal(r.letter, 'required');
  assert.equal(r.intro, 'Ответьте на вопросы');
  assert.deepEqual(r.questions.map((q) => [q.id, q.kind, q.multiple, q.allowsOwn]), [
    ['t1', 'text', false, false], ['c1', 'choice', true, true], ['r1', 'choice', false, false],
  ]);
  assert.equal(b.commands.length, 0);
});

test('inspectResponseForm: с resumeExternalId выбирает резюме, затем читает скрытость', async () => {
  const hidden = { ...formOk, resumeHidden: true, resumeWarning: 'Чтобы откликнуться, поменяйте видимость резюме' };
  const b = fakeBridge([found, { ok: true }, { found: true, selected: false }, { ok: true }, selOk, hidden]);
  const r = await createHh(b, { sleep }).inspectResponseForm('555', { resumeExternalId: RID });
  assert.equal(r.resumeHidden, true);
  assert.match(r.resumeWarning, /видимость/);
  assert.equal(b.commands.length, 0);
});

test('inspectResponseForm: нет кнопки отправки — available false', async () => {
  const b = fakeBridge(Array(4).fill(waiting));
  const r = await createHh(b, { waitMs: 1000, pollMs: 500, sleep }).inspectResponseForm('555');
  assert.equal(r.available, false);
  assert.deepEqual(r.questions, []);
  assert.equal(b.commands.length, 0);
});

test('inspectResponseForm: мусорный vacancyId — bad_input без вызовов моста', async () => {
  const b = fakeBridge([]);
  await assert.rejects(createHh(b, { sleep }).inspectResponseForm('x1'), { code: 'bad_input' });
  assert.equal(b.navigated.length, 0);
});

test('submitResponse: resume_hidden до заполнения и клика', async () => {
  const b = fakeBridge(upToForm({ ...formQ, resumeHidden: true, resumeWarning: 'скрыто' }));
  await assert.rejects(createHh(b, { sleep }).submitResponse({ ...okArgs, answers: goodAnswers }), { code: 'resume_hidden' });
  assert.equal(b.commands.length, 0);
});

test('submitResponse: answers_required перечисляет вопросы без ответа', async () => {
  const cases = [
    [], // совсем без ответов
    [{ id: 't1', text: 'ок' }, { id: 'c1', values: ['a'] }], // нет r1
    [{ id: 't1', text: '  ' }, { id: 'c1', values: ['a'] }, { id: 'r1', values: ['x'] }], // пустой текст
    [{ id: 't1', text: 'ок' }, { id: 'c1', values: [] }, { id: 'r1', values: ['x'] }], // пустой выбор
  ];
  for (const answers of cases) {
    const b = fakeBridge(upToForm(formQ));
    await assert.rejects(
      createHh(b, { sleep }).submitResponse({ ...okArgs, answers }),
      (e) => e.code === 'answers_required' && /t1|c1|r1/.test(e.message),
    );
    assert.equal(b.commands.length, 0);
  }
});

test('submitResponse: некорректные ответы — bad_input до заполнения и клика', async () => {
  const base = { t1: { id: 't1', text: 'ок' }, c1: { id: 'c1', values: ['a'] }, r1: { id: 'r1', values: ['x'] } };
  const variants = [
    [base.t1, base.c1, base.r1, { id: 'zzz', text: 'лишний' }],          // нет такого вопроса
    [base.t1, { id: 'c1', values: ['nope'] }, base.r1],                    // значения нет среди вариантов
    [base.t1, base.c1, { id: 'r1', values: ['x', 'y'] }],                  // два значения у radio
    [base.t1, base.c1, { id: 'r1', own: 'свой' }],                         // own без allowsOwn
    [base.t1, base.c1, { id: 'r1', values: ['x'], own: 'свой' }],          // radio: вариант + own
    [base.t1, base.c1, base.r1, base.r1],                                  // дубль id
    [{ id: 't1', text: 'ок', values: ['a'] }, base.c1, base.r1],                     // values у текстового
  ];
  for (const answers of variants) {
    const b = fakeBridge(upToForm(formQ));
    await assert.rejects(createHh(b, { sleep }).submitResponse({ ...okArgs, answers }), { code: 'bad_input' });
    assert.equal(b.commands.length, 0);
  }
  for (const answers of ['x', [null], [{ text: 'без id' }]]) {
    const b = fakeBridge([]);
    await assert.rejects(createHh(b, { sleep }).submitResponse({ ...okArgs, answers }), { code: 'bad_input' });
    assert.equal(b.navigated.length, 0);
  }
});

test('submitResponse: ответы заполняются, набор отмеченных верный, ровно один клик', async () => {
  const b = fakeBridge([
    ...upToForm(formQ),
    { ok: true }, // setChoices c1
    { ok: true }, // setChoices r1
    { ok: true }, found, // письмо
    {
      t1: { checked: [], text: 'Python 3 года' },
      c1: { checked: ['a', 'open'], text: 'Make' },
      r1: { checked: ['y'], text: null },
    },
    { found: true, value: LETTER },
    ...rows('555'),
  ]);
  const r = await createHh(b, { sleep }).submitResponse({ ...okArgs, answers: goodAnswers });
  assert.deepEqual(r, { submitted: true, confirmed: true, resumeTitle: 'Инженер' });
  assert.deepEqual(fills(b).map((c) => [c.args.selector, c.args.value]), [
    ['textarea[name="task_t1_text"]', 'Python 3 года'],
    ['textarea[name="task_c1_text"]', 'Make'],
    ['textarea[data-qa="vacancy-response-popup-form-letter-input"]', LETTER],
  ]);
  assert.ok(b.codes.some((c) => c.includes('("c1", ["a","open"])')), 'c1: итоговый набор a + open');
  assert.ok(b.codes.some((c) => c.includes('("r1", ["y"])')), 'r1: y');
  assert.equal(submitClicks(b).length, 1);
  assert.equal(b.commands.filter((c) => c.action === 'click').length, 1);
});

test('submitResponse: расхождение при чтении ответа — fill_mismatch, клика нет', async () => {
  const bad = [
    { t1: { checked: [], text: 'не то' }, c1: { checked: ['a', 'open'], text: 'Make' }, r1: { checked: ['y'], text: null } },
    { t1: { checked: [], text: 'Python 3 года' }, c1: { checked: ['a'], text: 'Make' }, r1: { checked: ['y'], text: null } },
    { t1: { checked: [], text: 'Python 3 года' }, c1: { checked: ['a', 'open'], text: 'Make' }, r1: { checked: ['x', 'y'], text: null } },
  ];
  for (const state of bad) {
    const b = fakeBridge([...upToForm(formQ), { ok: true }, { ok: true }, { ok: true }, found, state]);
    await assert.rejects(createHh(b, { sleep }).submitResponse({ ...okArgs, answers: goodAnswers }), { code: 'fill_mismatch' });
    assert.equal(b.commands.filter((c) => c.action === 'click').length, 0);
  }
});

test('openLetterField: поле уже на странице — переключатель не кликается', async () => {
  const b = fakeBridge([...formReplies(), ...rows('555')]);
  await createHh(b, { sleep }).submitResponse(okArgs);
  const code = b.codes.find((c) => c.includes('function openLetterField'));
  assert.ok(code);
  let toggled = 0;
  const run = async (hasArea) => {
    globalThis.document = {
      querySelector: (sel) => (/textarea/.test(sel) ? (hasArea ? {} : null) : { click: () => { toggled++; } }),
    };
    try { return JSON.parse(await (0, eval)(code)); } finally { delete globalThis.document; }
  };
  assert.deepEqual(await run(true), { ok: true });
  assert.equal(toggled, 0);
  assert.deepEqual(await run(false), { ok: true });
  assert.equal(toggled, 1);
});

test('модуль не содержит кликов по кнопкам отклика', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../src/sites/hh.js', import.meta.url), 'utf8');
  const code = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.doesNotMatch(code, /vacancy-serp__vacancy_response|vacancy-response-link-top/);
});
