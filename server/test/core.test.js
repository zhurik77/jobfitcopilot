// Тесты чистых модулей ядра: баллы, промпты и линтер письма.
// Сети и браузера нет: всё работает на входных данных.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { computeFitScore, rankResumeMatches } from '../src/core/scoring.js';
import { PROMPTS, letterPrompt, LETTER_RULES } from '../src/core/prompts.js';
import { lintLetter } from '../src/core/letter-lint.js';

// Чистое письмо около 150 слов: конкретные цифры и инструменты, разная длина
// предложений, без штампов и без итоговой фразы. Все негативные тесты строятся
// от него заменой одного фрагмента, чтобы срабатывало только нужное правило.
const CLEAN = `Здравствуйте, Анна!

В прошлом году я перевёл отчётность отдела продаж с Excel на n8n и PostgreSQL. Теперь 40 менеджеров получают сводку каждое утро. Раньше на ручную выгрузку уходило около шести часов в неделю.

В логистической компании до этого я написал скрипт на Python, который сверял 12 000 накладных с банковскими выписками. Ошибок при закрытии месяца стало на треть меньше. Скрипт запускается по расписанию в шесть утра и присылает отчёт в Telegram. Проект сейчас поддерживает коллега, и я могу показать, как он устроен.

В описании вакансии есть CRM и интеграции через API. С Bitrix24 я работаю больше года: настраиваю вебхуки и обработку заявок с сайта. Воронку из семи стадий для отдела продаж я перестроил за две недели. Оба опыта напрямую закрывают ваши основные требования.

Могу созвониться в четверг до полудня или в любой другой удобный вам день. Напишите, какой слот подойдёт.`;

const RULE_CASES = {
  cliche: CLEAN.replace('Оба опыта', 'Хотел бы выразить заинтересованность. Оба опыта'),
  placeholder: CLEAN.replace('Анна', '[Имя рекрутера]'),
  moralizing: CLEAN.replace('Оба опыта напрямую закрывают ваши основные требования.', 'Этот опыт научил меня считать каждую минуту.'),
  summary_ending: CLEAN.replace('Напишите, какой слот подойдёт.', 'Таким образом, я уверен, что подойду.'),
  no_specifics: 'Здравствуйте. Я работал над задачами команды и делал всё аккуратно. Мне интересна эта работа и хочу развиваться дальше.',
  uniform_rhythm: Array(6).fill('Каждый день я собирал отчёты для команды продаж вручную.').join(' '),
  dash_overuse: CLEAN.replace(/,/g, ' —')
};

describe('computeFitScore', () => {
  test('база 50 плюс сумма дельт из ledger', () => {
    assert.equal(computeFitScore({ ledger: [{ delta: 20 }, { delta: -5 }] }), 65);
  });

  test('результат зажимается в диапазон 0..100', () => {
    assert.equal(computeFitScore({ ledger: [{ delta: 40 }, { delta: 30 }] }), 100);
    assert.equal(computeFitScore({ ledger: [{ delta: -40 }, { delta: -30 }] }), 0);
  });

  test('нечисловые дельты игнорируются', () => {
    const parsed = { ledger: [{ delta: 'много' }, { delta: 5 }, { delta: null }, {}, { delta: 'nan' }] };
    assert.equal(computeFitScore(parsed), 55);
  });

  test('без ledger берётся score и тоже зажимается', () => {
    assert.equal(computeFitScore({ score: 72.4 }), 72);
    assert.equal(computeFitScore({ score: 150 }), 100);
    assert.equal(computeFitScore({ ledger: [], score: 60 }), 60);
  });

  test('пустой объект и отсутствующий ledger дают 0 без падения', () => {
    assert.equal(computeFitScore({}), 0);
    assert.equal(computeFitScore(null), 0);
  });
});

describe('rankResumeMatches', () => {
  const row = (name, hard, overall, extra = {}) => ({
    resumeId: name.toLowerCase(),
    name,
    result: {
      hard_requirements_coverage_percent: hard,
      overall_match_score: overall
    },
    ...extra
  });

  test('покрытие обязательных важнее общего балла', () => {
    const ranked = rankResumeMatches([
      row('Общий', 60, 90),
      row('Обязательные', 80, 70)
    ]);
    assert.deepEqual(ranked.map(r => r.name), ['Обязательные', 'Общий']);
  });

  test('при равном покрытии решает общий балл', () => {
    const ranked = rankResumeMatches([
      row('Низкий', 80, 60),
      row('Высокий', 80, 85)
    ]);
    assert.deepEqual(ranked.map(r => r.name), ['Высокий', 'Низкий']);
  });

  test('полная ничья сохраняет порядок входа', () => {
    const ranked = rankResumeMatches([row('A', 70, 70), row('B', 70, 70)]);
    assert.deepEqual(ranked.map(r => r.name), ['A', 'B']);
  });

  test('проценты сравниваются после округления, как в панели', () => {
    // 80.4 и 80.1 округляются до 80; тогда решает общий балл.
    const ranked = rankResumeMatches([
      row('Первый', 80.1, 70),
      row('Второй', 80.4, 75)
    ]);
    assert.deepEqual(ranked.map(r => r.name), ['Второй', 'Первый']);
  });

  test('упавшие и без результата записи отбрасываются, исходный массив не меняется', () => {
    const input = [
      row('Есть', 50, 50),
      { resume: { name: 'Упал' }, failed: true, name: 'Упал' },
      { resumeId: 'пусто', name: 'Пусто', result: null },
      null
    ];
    const before = input.length;
    const ranked = rankResumeMatches(input);
    assert.deepEqual(ranked.map(r => r.name), ['Есть']);
    assert.equal(input.length, before);
  });
});

describe('prompts', () => {
  test('PROMPTS содержит три непустые строки из shared/constants.js', () => {
    for (const key of ['fit', 'ats', 'resumeReview']) {
      assert.equal(typeof PROMPTS[key], 'string', key);
      assert.ok(PROMPTS[key].length > 0, key);
    }
  });

  test('letterPrompt добавляет правила к базовому промпту', () => {
    const p = letterPrompt('ru', 'neutral');
    assert.ok(p.includes('Напиши готовое к отправке'), 'базовый текст расширения');
    assert.ok(p.includes(LETTER_RULES), 'правила сервера');
    assert.ok(p.endsWith(LETTER_RULES), 'правила идут в конце');
  });

  test('letterPrompt для английского и уверенного тона тоже содержит правила', () => {
    const p = letterPrompt('en', 'confident');
    assert.ok(p.includes('на английском языке'));
    assert.ok(p.includes(LETTER_RULES));
  });

  test('LETTER_RULES содержит пять пронумерованных правил', () => {
    for (let i = 1; i <= 5; i++) {
      assert.ok(LETTER_RULES.includes(`\n${i}. `), `правило ${i}`);
    }
  });
});

describe('lintLetter', () => {
  test('чистое письмо проходит без ошибок', () => {
    const result = lintLetter(CLEAN);
    assert.equal(result.ok, true, JSON.stringify(result.issues));
    assert.deepEqual(result.issues, []);
    assert.ok(result.stats.words >= 120 && result.stats.words <= 180, `words=${result.stats.words}`);
  });

  test('статистика предложений заполнена', () => {
    const { stats } = lintLetter(CLEAN);
    assert.ok(stats.sentences > 5);
    assert.ok(stats.avgSentenceWords > 0);
    assert.ok(stats.sentenceStdev >= 0);
  });

  test('cliche: штамп из списка ловится без учёта регистра', () => {
    const result = lintLetter(RULE_CASES.cliche);
    assert.equal(result.ok, false);
    assert.ok(result.issues.some(i => i.rule === 'cliche' && i.severity === 'error' && i.excerpt.length > 0));
  });

  test('cliche: английский штамп тоже ловится', () => {
    const text = CLEAN.replace('Оба опыта', 'I am a passionate engineer. Оба опыта');
    assert.ok(lintLetter(text).issues.some(i => i.rule === 'cliche'));
  });

  test('placeholder: квадратные скобки — ошибка', () => {
    const result = lintLetter(RULE_CASES.placeholder);
    assert.equal(result.ok, false);
    assert.ok(result.issues.some(i => i.rule === 'placeholder' && i.severity === 'error'));
  });

  test('length: слишком короткое и слишком длинное письмо — ошибка', () => {
    const short = lintLetter(CLEAN, { minWords: 500 });
    assert.equal(short.ok, false);
    assert.ok(short.issues.some(i => i.rule === 'length' && i.severity === 'error'));

    const long = lintLetter(CLEAN, { maxWords: 20 });
    assert.equal(long.ok, false);
    assert.ok(long.issues.some(i => i.rule === 'length'));
  });

  test('moralizing: вывод за читателя — предупреждение', () => {
    const result = lintLetter(RULE_CASES.moralizing);
    assert.ok(result.issues.some(i => i.rule === 'moralizing' && i.severity === 'warn'));
  });

  test('summary_ending: итоговая последняя фраза — предупреждение', () => {
    const result = lintLetter(RULE_CASES.summary_ending);
    assert.ok(result.issues.some(i => i.rule === 'summary_ending' && i.severity === 'warn'));
  });

  test('no_specifics: без цифр, латиницы и имён — предупреждение', () => {
    const result = lintLetter(RULE_CASES.no_specifics, { minWords: 1 });
    assert.ok(result.issues.some(i => i.rule === 'no_specifics' && i.severity === 'warn'));
  });

  test('uniform_rhythm: одинаковая длина предложений — предупреждение', () => {
    const result = lintLetter(RULE_CASES.uniform_rhythm, { minWords: 1 });
    assert.ok(result.issues.some(i => i.rule === 'uniform_rhythm' && i.severity === 'warn'));
  });

  test('dash_overuse: больше трёх тире — предупреждение', () => {
    const result = lintLetter(RULE_CASES.dash_overuse);
    assert.ok(result.issues.some(i => i.rule === 'dash_overuse' && i.severity === 'warn'));
  });

  test('ai_vocabulary: английские маркеры и русские кальки ловятся, обычные слова нет', () => {
    const en = CLEAN.replace('Оба опыта', 'This work underscores a pivotal shift. Оба опыта');
    const issuesEn = lintLetter(en).issues.filter(i => i.rule === 'ai_vocabulary');
    assert.equal(issuesEn.length, 2);
    assert.ok(issuesEn.every(i => i.severity === 'warn' && i.excerpt.length > 0));

    const ru = CLEAN.replace('Оба опыта', 'Стоит отметить, что оба опыта');
    assert.ok(lintLetter(ru).issues.some(i => i.rule === 'ai_vocabulary'));

    assert.ok(!lintLetter(CLEAN).issues.some(i => i.rule === 'ai_vocabulary'));
    assert.ok(lintLetter(en, { lang: 'en' }).issues.find(i => i.rule === 'ai_vocabulary').message.includes('machine-written'));
  });

  test('contrast_frame: «не просто X, а Y» и "not only but also" ловятся', () => {
    const ru = CLEAN.replace('Оба опыта напрямую закрывают', 'Это не просто отчёт, а рабочий инструмент, и он закрывает');
    assert.ok(lintLetter(ru).issues.some(i => i.rule === 'contrast_frame' && i.severity === 'warn'));

    const en = CLEAN.replace('Оба опыта', 'It is not only a script but also a process. Оба опыта');
    assert.ok(lintLetter(en).issues.some(i => i.rule === 'contrast_frame'));

    assert.ok(!lintLetter(CLEAN).issues.some(i => i.rule === 'contrast_frame'));
    // Обычное «не» без противопоставления рамкой не считается.
    const plain = CLEAN.replace('Напишите, какой слот подойдёт.', 'Если не подходит четверг, напишите другой день.');
    assert.ok(!lintLetter(plain).issues.some(i => i.rule === 'contrast_frame'));
  });

  test('triple_list: два и более перечисления из трёх пунктов', () => {
    const two = CLEAN
      .replace('Excel на n8n и PostgreSQL', 'Excel на n8n, SQL и Metabase')
      .replace('вебхуки и обработку заявок', 'вебхуки, формы и отчёты');
    const found = lintLetter(two).issues.find(i => i.rule === 'triple_list');
    assert.ok(found && found.severity === 'warn' && found.excerpt.length > 0);

    // Одно перечисление допустимо.
    const one = CLEAN.replace('Excel на n8n и PostgreSQL', 'Excel на n8n, SQL и Metabase');
    assert.ok(!lintLetter(one).issues.some(i => i.rule === 'triple_list'));
    assert.ok(!lintLetter(CLEAN).issues.some(i => i.rule === 'triple_list'));
  });

  test('предупреждения не делают ok ложным', () => {
    const result = lintLetter(RULE_CASES.moralizing);
    assert.equal(result.ok, true, JSON.stringify(result.issues));
  });

  test('точка внутри числа не делит предложение', () => {
    const { stats } = lintLetter('Я сократил время на 1.5 часа в день. Проект запущен в марте 2025 года.');
    assert.equal(stats.sentences, 2);
  });
});
