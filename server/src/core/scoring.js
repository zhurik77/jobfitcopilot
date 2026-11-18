// Детерминированный расчёт баллов. Перенесено из sidepanel/panel.js (computeScore
// и rankResumeMatches) как чистые функции: сервер должен давать тот же индекс,
// что и панель, иначе сохранённый в БД балл расходится с тем, что видит пользователь.

// Базовый уровень индекса соответствия; совпадает с BASE_SCORE в panel.js.
const BASE_SCORE = 50;

/**
 * Итоговый индекс соответствия из разбора вакансии.
 *
 * LLM иногда пишет в поле score число, которое не сходится с разбором.
 * Игнорируем score и пересчитываем по hard_requirements_coverage_percent
 * и overall_match_score. Если их нет — BASE_SCORE.
 *
 * @param {object|null|undefined} result  Объект с полями hard_requirements_coverage_percent, overall_match_score
 * @returns {number} 0–100
 */
export function computeFitScore(result) {
  if (!result) return BASE_SCORE;
  const hard = Number(result.hard_requirements_coverage_percent) || 0;
  const overall = Number(result.overall_match_score) || 0;
  return clamp(BASE_SCORE + Math.round((hard - BASE_SCORE) * 0.3 + (overall - BASE_SCORE) * 0.7));
}

/**
 * Ранжирование резюме по убыванию hard_requirements_coverage_percent,
 * затем overall_match_score. Стабильная сортировка.
 *
 * @param {Array|null|undefined} scored  Массив объектов { resumeId, name, result: { hard_requirements_coverage_percent, overall_match_score } }
 * @returns {Array}  Отсортированный массив с полями rank и recommended
 */
export function rankResumeMatches(scored) {
  if (!Array.isArray(scored)) return [];
  const items = scored
    .filter((s) => s && s.result && typeof s.result === 'object')
    .map((s) => ({
      item: s,
      hard: Math.round(Number(s.result.hard_requirements_coverage_percent) || 0),
      overall: Math.round(Number(s.result.overall_match_score) || 0),
    }));

  // Array.prototype.sort стабилен, поэтому при полном равенстве сохраняется порядок входа.
  items.sort((a, b) => (b.hard - a.hard) || (b.overall - a.overall));
  return items.map((r, i) => ({ ...r.item, rank: i + 1, recommended: i === 0 }));
}

function clamp(n) {
  return Math.max(0, Math.min(100, n));
}
