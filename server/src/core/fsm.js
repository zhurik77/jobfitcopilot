// State Machine (FSM) для автоматического конвейера вакансий.
// Определяет состояния, переходы, проверки (guards) и вычисляет блокеры/следующие шаги.
import { unansweredQuestionIds } from '../api.js';

export const FSM_STATES = {
  FOUND: 'found',
  SCORED: 'scored',
  DRAFTED: 'drafted',
  AWAITING_APPROVAL: 'awaiting_approval',
  APPROVED: 'approved',
  SENT: 'sent',
  REPLIED: 'replied',
  INVITED: 'invited',
  REJECTED: 'rejected',
  SKIPPED: 'skipped',
};

// Вес прогресса вакансии по шкале 0..100%
export const STATE_PROGRESS = {
  found: 10,
  scored: 30,
  drafted: 55,
  awaiting_approval: 80,
  approved: 90,
  sent: 100,
  replied: 100,
  invited: 100,
  rejected: 100,
  skipped: 0,
};

// Допустимые прямые переходы
export const ALLOWED_TRANSITIONS = {
  found: ['scored', 'skipped'],
  scored: ['drafted', 'skipped'],
  drafted: ['awaiting_approval', 'skipped'],
  awaiting_approval: ['approved', 'skipped', 'drafted'],
  approved: ['sent', 'awaiting_approval', 'skipped'],
  sent: ['replied', 'invited', 'rejected'],
  replied: ['invited', 'rejected'],
  invited: [],
  rejected: [],
  skipped: ['found'], // возможность вернуть из пропуска при повторном пересмотре
};

/**
 * Проверяет условия (guards) для перехода вакансии из одного состояния в другое.
 * @param {string} from - исходный статус
 * @param {string} to - целевой статус
 * @param {object} vacancy - объект вакансии из db.getVacancy
 * @param {object} [extra] - дополнительные данные { letter, resume, answers, userApproved }
 * @returns {{ ok: boolean, reason?: string, blockers?: string[] }}
 */
export function evaluateTransitionGuards(from, to, vacancy, extra = {}) {
  const allowed = ALLOWED_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    return {
      ok: false,
      reason: `Недопустимый переход из '${from}' в '${to}'. Разрешены: [${allowed.join(', ')}]`,
      blockers: [`invalid_transition: ${from} -> ${to}`]
    };
  }

  const blockers = [];

  if (to === 'scored') {
    if (!vacancy.description && !extra.description) {
      blockers.push('missing_description: Описание вакансии не загружено (вызовите get_vacancy)');
    }
    const resumeId = vacancy.resumeId ?? extra.resumeId;
    if (!resumeId) {
      blockers.push('missing_resume: Не выбрано резюме для вакансии (вызовите save_ats_match и rank_resumes)');
    }
  }

  if (to === 'drafted') {
    const letter = extra.letter;
    if (!vacancy.letterId && !letter) {
      blockers.push('missing_letter: Сопроводительное письмо не сгенерировано (вызовите save_letter)');
    } else if (letter && letter.lint && letter.lint.ok === false) {
      const errCount = (letter.lint.issues || []).filter(i => i.severity === 'error').length;
      blockers.push(`lint_failed: Письмо содержит ошибки линтера (${errCount} шт.)`);
    }
  }

  if (to === 'awaiting_approval') {
    const letter = extra.letter;
    if (letter && letter.lint && letter.lint.ok === false) {
      blockers.push('lint_failed: Письмо не прошло проверку линтера');
    }
    const form = vacancy.form ?? extra.form;
    if (!form) {
      blockers.push('missing_form: Форма отклика не проверена (вызовите inspect_response_form)');
    } else {
      if (form.resumeHidden === true) {
        blockers.push('resume_hidden: Резюме скрыто от работодателя на hh.ru');
      }
      const answers = vacancy.answers ?? extra.answers ?? [];
      const unanswered = unansweredQuestionIds(form, answers);
      if (unanswered.length > 0) {
        blockers.push(`unanswered_questions: Не отвечены обязательные вопросы работодателя (${unanswered.join(', ')})`);
      }
    }
  }

  if (to === 'approved') {
    // Безопасность Human-in-the-Loop: утверждение может дать только человек через панель / явное действие
    if (!extra.userApproved && !extra.force) {
      blockers.push('human_approval_required: Требуется явное подтверждение человека (Human-in-the-Loop)');
    }
  }

  if (to === 'sent') {
    if (from !== 'approved') {
      blockers.push('not_approved: Отправка возможна только для одобренных вакансий (approved)');
    }
    if (!extra.confirmed) {
      blockers.push('submit_required: Статус sent устанавливается только после подтверждённой отправки через submit_application');
    }
    if (extra.limitReached) {
      blockers.push('daily_limit: Исчерпан дневной лимит отправок');
    }
    if (extra.waitMs && extra.waitMs > 0) {
      blockers.push(`delay_active: Действует пауза между откликами (ещё ${Math.ceil(extra.waitMs / 1000)} сек)`);
    }
  }

  if (blockers.length > 0) {
    return { ok: false, reason: blockers[0], blockers };
  }

  return { ok: true };
}

/**
 * Возвращает полный анализ состояния вакансии в рамках FSM.
 * @param {object} vacancy - запись вакансии
 * @param {object} db - экземпляр базы данных
 * @returns {object} Сводка FSM: текущее состояние, прогресс, блокеры, следующий автоматический шаг
 */
export function inspectVacancyFsm(vacancy, db) {
  if (!vacancy) return null;

  const status = vacancy.status || 'found';
  const progress = STATE_PROGRESS[status] ?? 0;
  const isTerminal = ['sent', 'replied', 'invited', 'rejected', 'skipped'].includes(status);
  const allowedTransitions = ALLOWED_TRANSITIONS[status] ?? [];

  const letter = vacancy.letterId && db.getLetter ? db.getLetter(vacancy.letterId) : null;
  const resume = vacancy.resumeId && db.getResume ? db.getResume(vacancy.resumeId) : null;

  const blockers = [];
  let nextAction = null;

  switch (status) {
    case 'found': {
      if (!vacancy.description) {
        nextAction = { tool: 'get_vacancy', params: { key: vacancy.key }, description: 'Загрузить полный текст вакансии' };
      } else if (!vacancy.resumeId) {
        nextAction = { tool: 'rank_resumes', params: { key: vacancy.key }, description: 'Провести ATS-сопоставление резюме и выбрать лучшее' };
      } else {
        nextAction = { tool: 'save_fit_analysis', params: { key: vacancy.key }, description: 'Провести Fit-анализ соответствия' };
      }
      break;
    }
    case 'scored': {
      if (!vacancy.letterId) {
        nextAction = { tool: 'save_letter', params: { key: vacancy.key, resumeId: vacancy.resumeId }, description: 'Сгенерировать и проверить сопроводительное письмо' };
      } else if (letter?.lint && !letter.lint.ok) {
        blockers.push('Письмо содержит ошибки линтера, требуется исправление');
        nextAction = { tool: 'save_letter', params: { key: vacancy.key, letterId: letter.id }, description: 'Исправить ошибки в письме и сохранить' };
      } else {
        nextAction = { tool: 'advance_fsm', target: 'drafted', description: 'Перевести вакансию в статус drafted' };
      }
      break;
    }
    case 'drafted': {
      if (!vacancy.form) {
        nextAction = { tool: 'inspect_response_form', params: { key: vacancy.key }, description: 'Проверить форму отклика и вопросы работодателя на hh.ru' };
      } else {
        if (vacancy.form.resumeHidden) {
          blockers.push('Резюме скрыто от работодателя на hh.ru (смените видимость в профиле)');
        }
        const unanswered = unansweredQuestionIds(vacancy.form, vacancy.answers || []);
        if (unanswered.length > 0) {
          blockers.push(`Не отвечены вопросы работодателя: ${unanswered.join(', ')}`);
          nextAction = { tool: 'save_answers', params: { key: vacancy.key }, description: 'Подготовить ответы на вопросы работодателя' };
        } else if (!vacancy.form.resumeHidden) {
          nextAction = { tool: 'queue_application', params: { key: vacancy.key, letterId: vacancy.letterId, resumeId: vacancy.resumeId }, description: 'Поставить вакансию в очередь на одобрение человеком' };
        }
      }
      break;
    }
    case 'awaiting_approval': {
      blockers.push('Ожидает подтверждения пользователем в веб-панели');
      nextAction = { tool: 'human_approval', description: 'Одобрить отклик в панели управления' };
      break;
    }
    case 'approved': {
      const stats = db.stats ? db.stats() : { sentToday: 0 };
      const settings = db.getSettings ? db.getSettings() : { dailyLimit: 20, minDelaySec: 45 };
      const lastSent = db.lastSentAt ? db.lastSentAt() : null;
      const now = Date.now();
      const delayLeft = lastSent ? settings.minDelaySec * 1000 - (now - lastSent) : 0;

      if ((stats.sentToday || 0) >= settings.dailyLimit) {
        blockers.push(`Достигнут суточный лимит отправок (${settings.dailyLimit})`);
      } else if (delayLeft > 0) {
        blockers.push(`Пауза безопасности: подождите ${Math.ceil(delayLeft / 1000)} сек`);
      } else {
        nextAction = { tool: 'submit_application', params: { key: vacancy.key }, description: 'Отправить отклик работодателю' };
      }
      break;
    }
    case 'sent': {
      nextAction = { tool: 'sync_responses', description: 'Синхронизировать статусы ответов работодателей' };
      break;
    }
    default:
      break;
  }

  return {
    key: vacancy.key,
    title: vacancy.title,
    company: vacancy.company,
    status,
    progress,
    isTerminal,
    allowedTransitions,
    blockers,
    letterOk: letter?.lint?.ok ?? null,
    resumeTitle: resume?.title ?? resume?.name ?? null,
    nextAction,
  };
}

/**
 * Собирает общую сводку состояния всей State Machine конвейера.
 * @param {object} db - экземпляр базы данных
 * @returns {object} Сводка по состояниям, узким местам и рекомендуемым шагам
 */
export function getPipelineFsmSummary(db) {
  const stats = db.stats ? db.stats() : { byStatus: {}, sentToday: 0 };
  const settings = db.getSettings ? db.getSettings() : { dailyLimit: 20, minDelaySec: 45 };
  const byStatus = stats.byStatus || {};

  // Собираем ключевые узкие места
  const awaitingApproval = byStatus['awaiting_approval'] || 0;
  const approved = byStatus['approved'] || 0;
  const found = byStatus['found'] || 0;
  const scored = byStatus['scored'] || 0;
  const drafted = byStatus['drafted'] || 0;
  const sentToday = stats.sentToday || 0;

  const bottlenecks = [];
  if (awaitingApproval > 0) {
    bottlenecks.push({
      stage: 'awaiting_approval',
      count: awaitingApproval,
      message: `${awaitingApproval} вакансий ждут одобрения человеком в веб-панели`
    });
  }
  if (sentToday >= settings.dailyLimit) {
    bottlenecks.push({
      stage: 'rate_limited',
      count: approved,
      message: `Дневной лимит (${settings.dailyLimit}) достигнут; одобренные вакансии ждут следующего дня`
    });
  }

  return {
    stateDistribution: {
      found,
      scored,
      drafted,
      awaiting_approval: awaitingApproval,
      approved,
      sent: byStatus['sent'] || 0,
      replied: byStatus['replied'] || 0,
      invited: byStatus['invited'] || 0,
      rejected: byStatus['rejected'] || 0,
      skipped: byStatus['skipped'] || 0,
    },
    metrics: {
      totalActive: found + scored + drafted + awaitingApproval + approved,
      readyToSubmit: approved,
      sentToday,
      dailyLimit: settings.dailyLimit,
    },
    bottlenecks,
  };
}
