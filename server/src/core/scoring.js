// Детерминированный расчёт баллов. Перенесено из sidepanel/panel.js (computeScore
// и rankResumeMatches) как чистые функции: сервер должен давать тот же индекс,
// что и панель, иначе сохранённый в БД балл расходится с тем, что видит пользователь.

// Базовый уровень индекса соответствия; совпадает с BASE_SCORE в panel.js.
const BASE_SCORE = 50;

/**
 * Итоговый индекс соответствия из разбора вакансии.
 *
 * LLM иногда пишет в поле score число, которое не сходится с разбивкой по
 * пунктам (ledger). Поэтому, когда ledger есть, считаем сами: база плюс сумма
 * дельт. Поле score берём только как запасной вариант для старых ответов без ledger.
 *
 * @param {{ ledger?: Array<{ delta?: unknown }>, score?: unknown } | null | undefined} parsed
 * @returns {number} целое от 0 до 100
 */
export function computeFitScore(parsed) {
  const p = parsed ?? {};
  if (Array.isArray(p.ledger) && p.ledger.length) {
    let sum = 0;
    for (const item of p.ledger) {
      // Нечисловые дельты (строка «много», null, undefined) не должны сдвигать
      // балл: иначе один кривой пункт от модели испортит весь индекс.
      const delta = Number(item && item.delta);
      if (Number.isFinite(delta)) sum += delta;
    }
    return clamp(Math.round(BASE_SCORE + sum));
  }
  return clamp(Math.round(Number(p.score) || 0));
}

/**
 * Ранжирует результаты сравнения резюме по вакансии.
 *
 * Сначала важно покрытие ОБЯЗАТЕЛЬНЫХ требований: именно они решают, пройдёт
 * ли резюме формальный фильтр. Общий балл только тай-брейк. Записи без результата
 * (непосчитанные или упавшие запросы) в ранжирование не попадают.
 *
 * @param {Array<{ resumeId?: string, name?: string, failed?: boolean, result?: object | null }>} scored
 * @returns {Array<object>} новый массив тех же объектов, лучшее резюме первым
 */
export function rankResumeMatches(scored) {
  const rows = (Array.isArray(scored) ? scored : [])
    .filter(s => s && !s.failed && s.result)
    .map(s => ({
      item: s,
      // Округляем так же, как панель: сравнение идёт по целым процентам,
      // иначе резюме с 80.4 и 80.1 разойдутся по порядку, которого пользователь не видит.
      hard: Math.round(Number(s.result.hard_requirements_coverage_percent) || 0),
      overall: Math.round(Number(s.result.overall_match_score) || 0)
    }));

  // Array.prototype.sort стабилен, поэтому при полном равенстве сохраняется порядок входа.
  rows.sort((a, b) => (b.hard - a.hard) || (b.overall - a.overall));
  return rows.map(r => r.item);
}

function clamp(n) {
  return Math.max(0, Math.min(100, n));
}
