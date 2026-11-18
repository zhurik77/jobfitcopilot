// Детерминированная проверка сопроводительного письма. Модель склонна к одним и
// тем же штампам, поэтому ошибки ловим кодом, а не просим модель проверить себя:
// её самооценка «письмо хорошее» не надёжна. Порог ok=false включает только
// error; warn-правила подсказывают, что поправить, но не блокируют отправку.

// Клише из letterPrompt (shared/constants.js) плюс частые шаблонные фразы.
// Список короткий намеренно: каждая новая фраза становится ошибкой на всех письмах.
const CLICHES = [
  // из letterPrompt расширения
  'хотел бы выразить заинтересованность',
  'с большим интересом ознакомился',
  'буду рад сотрудничеству',
  'являюсь ответственным и целеустремлённым',
  'сообщить о своём интересе',
  'внимательно изучил вашу вакансию',
  'высококвалифицированный специалист',
  // частые русские штампы
  'надеюсь на возможность',
  'идеально подхожу',
  'большой опыт работы',
  'стремлюсь к развитию',
  'ценю командную работу',
  'готов к новым вызовам',
  'быстро обучаюсь',
  'коммуникабельный и ответственный',
  'в настоящее время ищу',
  'прошу рассмотреть мою кандидатуру',
  'открыт к новым возможностям',
  // частые английские штампы
  'i am writing to express',
  'excited to apply',
  'would be a perfect fit',
  'i am a passionate',
  'team player',
  'fast learner',
  'think outside the box',
  'hit the ground running',
  'results-driven',
  'dynamic and motivated',
  'look forward to hearing from you'
];

const MORALIZING = ['научил меня', 'научила меня', 'я понял, что', 'я поняла, что', 'taught me', 'i realized'];

const SUMMARY_STARTS = [
  'таким образом', 'в заключение', 'уверен, что', 'уверена, что',
  'in conclusion', 'i am confident'
];

// ai_vocabulary, EN: слова с аномальным избытком в текстах LLM.
// Источники: Kobak et al. 2025 (arXiv 2406.07016: delves r=28, underscores 13.8, showcasing 10.7),
// Reinhart et al. 2025 (arXiv 2410.16107: tapestry 155x, intricate 119x у GPT-4o),
// Russell et al. 2025 (arXiv 2501.15654, табл. 12: testament, pivotal, multifaceted, paramount).
// Список короткий намеренно; все исследования про английский (научные тексты и художка), не про письма.
const AI_WORDS_EN_RE =
  /\b(?:delv(?:e|es|ed|ing)|tapestry|testament|underscor(?:e|es|ed|ing)|showcas(?:e|es|ed|ing)|pivotal|intricate|multifaceted|paramount)\b/gi;

// ai_vocabulary, RU: НАША АДАПТАЦИЯ, прямых данных по русскому нет. Это кальки английских
// маркеров из Russell et al. 2025 (табл. 12: "it's important to note", "in a world where",
// "testament", "crucial role"). Проверки на русских текстах не найдено, поэтому только warn.
const AI_PHRASES_RU = [
  'важно отметить', 'стоит отметить', 'играет ключевую роль', 'играет важную роль',
  'в мире, где', 'является свидетельством'
];

// contrast_frame: «не только X, но и Y», "it's not about X, it's about Y".
// Источник EN: Russell et al. 2025 (arXiv 2501.15654, табл. 12 и 17: частые "not only ... but also",
// "it's not just this, it's this"). Русские формы «не просто X, а Y» — НАША АДАПТАЦИЯ, прямых данных нет.
const CONTRAST_RU = [
  /не просто [^.!?]{1,80}?, а /,
  /дело не в [^.!?]{1,60}?, а в /,
  /не только [^.!?]{1,80}?,? но и /
];
const CONTRAST_EN = [
  /not only [^.!?]{1,80}?,? but also /,
  /not just [^.!?]{1,80}?,? (?:but|it'?s|it is) /,
  /it(?:'|’)?s not about [^.!?]{1,60}?,? it(?:'|’)?s about /
];

// triple_list: перечисление из трёх однословных пунктов «A, B и C». Источник: Russell et al. 2025
// (arXiv 2501.15654, табл. 17 и прил. D.3: ИИ почти всегда перечисляет по три). Порог «два и более
// раза за письмо» и русская форма — НАША АДАПТАЦИЯ к короткому деловому письму.
const TRIPLE_RE =
  /(?<![\p{L}\p{N}-])[\p{L}\p{N}-]+, [\p{L}\p{N}-]+,? (?:и|или|and|or) [\p{L}\p{N}-]+(?![\p{L}\p{N}-])/giu;

const PLACEHOLDER_RE = /\[[^[\]\n]{1,100}\]|<[^<>\n]{1,100}>|\{\{[^{}\n]{1,100}\}\}/g;

const EXCERPT_CONTEXT = 30;

/**
 * Проверяет текст письма.
 *
 * @param {string} text
 * @param {{ lang?: 'ru' | 'en', minWords?: number, maxWords?: number }} [opts]
 * @returns {{
 *   ok: boolean,
 *   issues: Array<{ rule: string, severity: 'error' | 'warn', message: string, excerpt: string }>,
 *   stats: { words: number, sentences: number, avgSentenceWords: number, sentenceStdev: number }
 * }}
 */
export function lintLetter(text, { lang = 'ru', minWords = 120, maxWords = 180 } = {}) {
  const body = typeof text === 'string' ? text : '';
  const msg = messages(lang);
  const issues = [];

  const words = wordsOf(body);
  const sentences = splitSentences(body);
  const sentenceLengths = sentences.map(s => wordsOf(s).length);
  const { avg, stdev } = meanAndStdev(sentenceLengths);

  // Нормализуем «ё» к «е» и регистр. Замена один-к-одному не сдвигает индексы,
  // поэтому по позиции в нормализованной строке можно вырезать фрагмент из исходного текста.
  const norm = normalize(body);

  // cliche: штамп из списка, без учёта регистра.
  for (const phrase of CLICHES) {
    const idx = norm.indexOf(normalize(phrase));
    if (idx !== -1) {
      issues.push(issue('cliche', 'error', msg.cliche(phrase), snip(body, idx, phrase.length)));
    }
  }

  // placeholder: незаполненные шаблонные поля вроде [Название компании].
  for (const m of body.matchAll(PLACEHOLDER_RE)) {
    issues.push(issue('placeholder', 'error', msg.placeholder, snip(body, m.index, m[0].length)));
  }

  // length: письмо вне диапазона слов. Считаем только токены с буквами или цифрами,
  // чтобы тире и пунктуация отдельными «словами» не завышали объём.
  if (words.length < minWords) {
    issues.push(issue('length', 'error', msg.tooShort(words.length, minWords), head(body)));
  } else if (words.length > maxWords) {
    issues.push(issue('length', 'error', msg.tooLong(words.length, maxWords), head(body)));
  }

  // moralizing: вывод за читателя («этот опыт научил меня…»).
  for (const phrase of MORALIZING) {
    const idx = norm.indexOf(normalize(phrase));
    if (idx !== -1) {
      issues.push(issue('moralizing', 'warn', msg.moralizing, snip(body, idx, phrase.length)));
    }
  }

  // summary_ending: последняя фраза подводит итог вместо конкретного шага.
  if (sentences.length) {
    const last = sentences[sentences.length - 1];
    const lastNorm = normalize(last.replace(/^[^\p{L}]+/u, ''));
    if (SUMMARY_STARTS.some(start => lastNorm.startsWith(normalize(start)))) {
      issues.push(issue('summary_ending', 'warn', msg.summaryEnding, head(last)));
    }
  }

  // no_specifics: в тексте нет ни цифр, ни латинских слов, ни имён собственных
  // (заглавная буква внутри предложения). Такое письмо можно отправить любому.
  if (sentences.length && !hasSpecifics(sentences)) {
    issues.push(issue('no_specifics', 'warn', msg.noSpecifics, head(body)));
  }

  // uniform_rhythm: все предложения одной длины звучат как шаблон.
  if (sentences.length >= 5 && stdev < 3) {
    issues.push(issue('uniform_rhythm', 'warn', msg.uniformRhythm, head(body)));
  }

  // dash_overuse: тире вместо точек и запятых — частый признак машинного текста.
  const dashes = [...body.matchAll(/—/g)];
  if (dashes.length > 3) {
    issues.push(issue('dash_overuse', 'warn', msg.dashOveruse(dashes.length), snip(body, dashes[0].index, 1)));
  }

  // ai_vocabulary: слова и обороты, избыточные в машинном тексте (см. источники у списков).
  for (const m of body.matchAll(AI_WORDS_EN_RE)) {
    issues.push(issue('ai_vocabulary', 'warn', msg.aiVocabulary(m[0]), snip(body, m.index, m[0].length)));
  }
  for (const phrase of AI_PHRASES_RU) {
    const idx = norm.indexOf(normalize(phrase));
    if (idx !== -1) {
      issues.push(issue('ai_vocabulary', 'warn', msg.aiVocabulary(phrase), snip(body, idx, phrase.length)));
    }
  }

  // contrast_frame: рамка «не X, а Y». Одно предупреждение на письмо, по первому совпадению.
  for (const re of [...CONTRAST_RU, ...CONTRAST_EN]) {
    const m = re.exec(norm);
    if (m) {
      issues.push(issue('contrast_frame', 'warn', msg.contrastFrame, snip(body, m.index, m[0].length)));
      break;
    }
  }

  // triple_list: два и более перечисления из трёх пунктов.
  const triples = [...body.matchAll(TRIPLE_RE)];
  if (triples.length >= 2) {
    issues.push(issue('triple_list', 'warn', msg.tripleList(triples.length), snip(body, triples[0].index, triples[0][0].length)));
  }

  return {
    ok: !issues.some(i => i.severity === 'error'),
    issues,
    stats: {
      words: words.length,
      sentences: sentences.length,
      avgSentenceWords: round1(avg),
      sentenceStdev: round1(stdev)
    }
  };
}

// Токены с буквами или цифрами: «—» и «,» словами не считаем.
function wordsOf(s) {
  return s.split(/\s+/).filter(t => /[\p{L}\p{N}]/u.test(t));
}

// Делим по . ! ? только если за ними пробел или конец текста: «1.5» и «e.g.» не режем.
function splitSentences(s) {
  return s
    .split(/[.!?]+(?=\s|$)/)
    .map(p => p.trim())
    .filter(p => wordsOf(p).length > 0);
}

function normalize(s) {
  // Замена «ё» → «е» не меняет длину строки, поэтому индексы совпадают с исходным текстом.
  return s.toLowerCase().replace(/ё/g, 'е');
}

function hasSpecifics(sentences) {
  for (const s of sentences) {
    const tokens = s.split(/\s+/);
    if (/\d/.test(s)) return true;
    if (tokens.some(t => /[A-Za-z]/.test(t))) return true;
    // Первое слово предложения всегда с заглавной, поэтому его не считаем.
    const midCap = tokens.slice(1).some(t => /^\p{Lu}/u.test(t.replace(/^[^\p{L}]+/u, '')));
    if (midCap) return true;
  }
  return false;
}

function meanAndStdev(values) {
  if (!values.length) return { avg: 0, stdev: 0 };
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  // Популяционное стандартное отклонение: письмо — весь набор предложений, а не выборка.
  const variance = values.reduce((a, v) => a + (v - avg) ** 2, 0) / values.length;
  return { avg, stdev: Math.sqrt(variance) };
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

function issue(rule, severity, message, excerpt) {
  return { rule, severity, message, excerpt };
}

// Фрагмент с контекстом вокруг нарушения; многоточием отмечаем обрезанные края.
function snip(text, index, length) {
  const start = Math.max(0, index - EXCERPT_CONTEXT);
  const end = Math.min(text.length, index + length + EXCERPT_CONTEXT);
  return (start > 0 ? '…' : '') + text.slice(start, end).trim() + (end < text.length ? '…' : '');
}

// Для правил, которые касаются всего текста, показываем начало письма.
function head(text, max = 80) {
  const t = text.trim();
  return t.length > max ? t.slice(0, max).trim() + '…' : t;
}

const MESSAGES = {
  ru: {
    cliche: p => `Штамп, от которого читатель устаёт: «${p}». Замени на факт из резюме.`,
    placeholder: 'Незаполненное место вместо факта. Убери скобки и подставь реальные данные или удали фразу.',
    tooShort: (n, min) => `Слишком короткое письмо: ${n} слов, нужно не меньше ${min}.`,
    tooLong: (n, max) => `Слишком длинное письмо: ${n} слов, нужно не больше ${max}.`,
    moralizing: 'Вывод за читателя. Лучше опиши, что было сделано, и оставь выводы работодателю.',
    summaryEnding: 'Письмо заканчивается итоговой фразой о себе. Заверши конкретным следующим шагом.',
    noSpecifics: 'В письме нет цифр, названий инструментов или продуктов. Добавь хотя бы один конкретный факт.',
    uniformRhythm: 'Предложения одной длины, текст звучит как шаблон. Чередуй короткие и длинные фразы.',
    dashOveruse: n => `Слишком много тире (${n}). Оставь одно-два, остальное замени точками и запятыми.`,
    aiVocabulary: w => `Слово или оборот «${w}» часто встречается в машинных текстах. Замени на простое слово или конкретный факт.`,
    contrastFrame: 'Рамка «не X, а Y» («не только… но и…») звучит как заготовка. Назови сразу, что именно сделано.',
    tripleList: n => `Перечислений из трёх пунктов в письме ${n}. Оставь одно, остальные сократи до одного-двух пунктов.`
  },
  en: {
    cliche: p => `Stock phrase readers skip: "${p}". Replace it with a fact from the resume.`,
    placeholder: 'Unfilled placeholder instead of a fact. Remove the brackets and insert real data or drop the phrase.',
    tooShort: (n, min) => `Letter too short: ${n} words, need at least ${min}.`,
    tooLong: (n, max) => `Letter too long: ${n} words, need at most ${max}.`,
    moralizing: 'Draws the conclusion for the reader. Describe what was done and leave the lesson out.',
    summaryEnding: 'Ends with a summary about yourself. End with a concrete next step instead.',
    noSpecifics: 'No numbers, tools or product names. Add at least one concrete fact.',
    uniformRhythm: 'Sentences are all the same length, so the text reads like a template. Mix short and long sentences.',
    dashOveruse: n => `Too many dashes (${n}). Keep one or two and use periods or commas for the rest.`,
    aiVocabulary: w => `"${w}" is over-represented in machine-written text. Use a plain word or a concrete fact.`,
    contrastFrame: 'The "not X but Y" / "not only... but also" frame reads as boilerplate. State directly what was done.',
    tripleList: n => `${n} three-item lists in one letter. Keep one and cut the others to one or two items.`
  }
};

function messages(lang) {
  return MESSAGES[lang] ?? MESSAGES.ru;
}
