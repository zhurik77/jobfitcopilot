// Тесты i18n-движка: загрузка локалей, интерполяция, fallback.
const test = require('node:test');
const assert = require('node:assert');

// Загружаем i18n в Node-контекст (без chrome/DOM)
const fs = require('fs');
const path = require('path');

// Парсим ru.json и en.json напрямую
const ru = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', 'shared', 'locales', 'ru.json'), 'utf-8'
));
const en = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', 'shared', 'locales', 'en.json'), 'utf-8'
));

// Эмулируем JFC_I18N.t()
function t(lang, key, vars) {
  const msgs = lang === 'en' ? en : ru;
  const template = msgs[key];
  if (template === undefined || template === null) return key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, k) => {
    const val = vars[k];
    return val !== undefined && val !== null ? String(val) : `{${k}}`;
  });
}

test('i18n: ru.json загружается и содержит все ключи', () => {
  assert.ok(ru);
  assert.ok(ru.app_name);
  assert.ok(ru.nav_analysis);
  assert.ok(ru.btn_analyze);
  assert.ok(ru.verdict_apply);
  assert.ok(ru.msg_no_vacancy);
  assert.ok(ru.settings_title);
  assert.ok(ru.status_found);
  assert.ok(ru.time_just_now);
  // Проверяем количество ключей (не меньше 100)
  const keys = Object.keys(ru);
  assert.ok(keys.length >= 100, `ru.json has ${keys.length} keys, expected >= 100`);
});

test('i18n: en.json загружается и содержит все ключи', () => {
  assert.ok(en);
  assert.ok(en.app_name);
  assert.ok(en.nav_analysis);
  assert.ok(en.btn_analyze);
  assert.ok(en.verdict_apply);
  assert.ok(en.msg_no_vacancy);
  assert.ok(en.settings_title);
  assert.ok(en.status_found);
  assert.ok(en.time_just_now);
  const keys = Object.keys(en);
  assert.ok(keys.length >= 100, `en.json has ${keys.length} keys, expected >= 100`);
});

test('i18n: en и ru имеют одинаковый набор ключей', () => {
  const ruKeys = Object.keys(ru).sort();
  const enKeys = Object.keys(en).sort();
  const missingInEn = ruKeys.filter(k => !enKeys.includes(k));
  const missingInRu = enKeys.filter(k => !ruKeys.includes(k));
  assert.deepStrictEqual(missingInEn, [], 'Ключи из ru отсутствуют в en: ' + missingInEn.join(', '));
  assert.deepStrictEqual(missingInRu, [], 'Ключи из en отсутствуют в ru: ' + missingInRu.join(', '));
});

test('i18n: t() возвращает перевод по ключу', () => {
  assert.strictEqual(t('ru', 'app_name'), 'Job Fit Copilot');
  assert.strictEqual(t('en', 'app_name'), 'Job Fit Copilot');
  assert.strictEqual(t('ru', 'nav_analysis'), 'Разбор');
  assert.strictEqual(t('en', 'nav_analysis'), 'Analysis');
});

test('i18n: t() возвращает ключ при отсутствии перевода', () => {
  assert.strictEqual(t('ru', 'nonexistent_key'), 'nonexistent_key');
  assert.strictEqual(t('en', 'nonexistent_key'), 'nonexistent_key');
});

test('i18n: t() интерполирует {vars}', () => {
  assert.strictEqual(
    t('ru', 'msg_no_api_key', { model: 'GPT-4' }),
    'Не указан API-ключ для GPT-4. Открой настройки и вставь ключ.'
  );
  assert.strictEqual(
    t('en', 'msg_no_api_key', { model: 'GPT-4' }),
    'No API key for GPT-4. Open Settings and enter your key.'
  );
});

test('i18n: t() интерполирует {name} в confirm_delete', () => {
  assert.strictEqual(
    t('ru', 'msg_confirm_delete', { name: 'Backend Dev' }),
    'Удалить резюме «Backend Dev»?'
  );
  assert.strictEqual(
    t('en', 'msg_confirm_delete', { name: 'Backend Dev' }),
    'Delete resume "Backend Dev"?'
  );
});

test('i18n: t() интерполирует {n} в time_*', () => {
  assert.strictEqual(t('ru', 'time_minutes_ago', { n: 5 }), '5 мин. назад');
  assert.strictEqual(t('en', 'time_minutes_ago', { n: 5 }), '5m ago');
  assert.strictEqual(t('ru', 'time_hours_ago', { n: 3 }), '3 ч. назад');
  assert.strictEqual(t('en', 'time_hours_ago', { n: 3 }), '3h ago');
});

test('i18n: t() без vars не меняет строку', () => {
  assert.strictEqual(t('ru', 'time_yesterday'), 'вчера');
  assert.strictEqual(t('en', 'time_yesterday'), 'yesterday');
});

test('i18n: t() экранирует отсутствующую переменную как {key}', () => {
  // Если переменная не передана, {placeholder} остаётся в строке
  const result = t('ru', 'msg_confirm_delete', {});
  assert.ok(result.includes('{name}'), `Expected {name} in result, got: ${result}`);
});

test('i18n: все вердикты переведены', () => {
  assert.strictEqual(t('ru', 'verdict_apply'), 'ОТКЛИКАТЬСЯ');
  assert.strictEqual(t('en', 'verdict_apply'), 'APPLY');
  assert.strictEqual(t('ru', 'verdict_skip'), 'ПРОПУСТИТЬ');
  assert.strictEqual(t('en', 'verdict_skip'), 'SKIP');
});

test('i18n: все статусы вакансий переведены', () => {
  const statuses = ['found', 'scored', 'drafted', 'awaiting', 'approved', 'sent', 'replied', 'invited', 'rejected', 'skipped'];
  for (const s of statuses) {
    assert.ok(t('ru', `status_${s}`), `ru.status_${s} is missing`);
    assert.ok(t('en', `status_${s}`), `en.status_${s} is missing`);
    assert.notStrictEqual(t('ru', `status_${s}`), `status_${s}`, `ru.status_${s} returned key`);
    assert.notStrictEqual(t('en', `status_${s}`), `status_${s}`, `en.status_${s} returned key`);
  }
});

test('i18n: все кнопки переведены', () => {
  const btns = ['analyze', 'save', 'cancel', 'delete', 'copy', 'settings', 'retry'];
  for (const b of btns) {
    assert.ok(t('ru', `btn_${b}`), `ru.btn_${b} is missing`);
    assert.ok(t('en', `btn_${b}`), `en.btn_${b} is missing`);
  }
});

test('i18n: locale файлы валидный JSON', () => {
  // Уже загрузились через JSON.parse — значит валидны
  assert.ok(true);
});

test('i18n: нет пустых значений в ru.json', () => {
  const empty = Object.entries(ru).filter(([, v]) => !v || (typeof v === 'string' && v.trim() === ''));
  assert.deepStrictEqual(empty, [], 'Пустые значения: ' + empty.map(([k]) => k).join(', '));
});

test('i18n: нет пустых значений в en.json', () => {
  const empty = Object.entries(en).filter(([, v]) => !v || (typeof v === 'string' && v.trim() === ''));
  assert.deepStrictEqual(empty, [], 'Пустые значения: ' + empty.map(([k]) => k).join(', '));
});
