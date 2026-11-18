import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FSM_STATES,
  STATE_PROGRESS,
  ALLOWED_TRANSITIONS,
  evaluateTransitionGuards,
  inspectVacancyFsm,
  getPipelineFsmSummary,
} from '../src/core/fsm.js';

test('FSM: состояния и допустимые переходы', () => {
  assert.equal(FSM_STATES.FOUND, 'found');
  assert.equal(FSM_STATES.AWAITING_APPROVAL, 'awaiting_approval');
  assert.equal(STATE_PROGRESS['sent'], 100);
  assert.ok(ALLOWED_TRANSITIONS['found'].includes('scored'));
  assert.ok(!ALLOWED_TRANSITIONS['found'].includes('sent')); // запрещён прямой перескок в sent
});

test('FSM guards: found -> scored', () => {
  const vWithoutDesc = { status: 'found', key: 'hh.ru:123' };
  const res1 = evaluateTransitionGuards('found', 'scored', vWithoutDesc);
  assert.equal(res1.ok, false);
  assert.ok(res1.reason.includes('missing_description'));

  const vWithDescNoResume = { status: 'found', key: 'hh.ru:123', description: 'Some text' };
  const res2 = evaluateTransitionGuards('found', 'scored', vWithDescNoResume);
  assert.equal(res2.ok, false);
  assert.ok(res2.reason.includes('missing_resume'));

  const vReady = { status: 'found', key: 'hh.ru:123', description: 'Some text', resumeId: 'res-1' };
  const res3 = evaluateTransitionGuards('found', 'scored', vReady);
  assert.equal(res3.ok, true);
});

test('FSM guards: scored -> drafted', () => {
  const v = { status: 'scored', key: 'hh.ru:123', resumeId: 'res-1' };
  const resNoLetter = evaluateTransitionGuards('scored', 'drafted', v);
  assert.equal(resNoLetter.ok, false);
  assert.ok(resNoLetter.reason.includes('missing_letter'));

  const resLintFailed = evaluateTransitionGuards('scored', 'drafted', v, {
    letter: { text: 'test', lint: { ok: false, issues: [{ severity: 'error' }] } }
  });
  assert.equal(resLintFailed.ok, false);
  assert.ok(resLintFailed.reason.includes('lint_failed'));

  const resLetterOk = evaluateTransitionGuards('scored', 'drafted', v, {
    letter: { text: 'test', lint: { ok: true } }
  });
  assert.equal(resLetterOk.ok, true);
});

test('FSM guards: drafted -> awaiting_approval', () => {
  const v = { status: 'drafted', key: 'hh.ru:123', letterId: 'let-1' };
  
  // Нет формы отклика
  const resNoForm = evaluateTransitionGuards('drafted', 'awaiting_approval', v, {
    letter: { lint: { ok: true } }
  });
  assert.equal(resNoForm.ok, false);
  assert.ok(resNoForm.reason.includes('missing_form'));

  // Резюме скрыто
  const resHidden = evaluateTransitionGuards('drafted', 'awaiting_approval', v, {
    letter: { lint: { ok: true } },
    form: { resumeHidden: true }
  });
  assert.equal(resHidden.ok, false);
  assert.ok(resHidden.reason.includes('resume_hidden'));

  // Не отвечены вопросы
  const resUnanswered = evaluateTransitionGuards('drafted', 'awaiting_approval', v, {
    letter: { lint: { ok: true } },
    form: {
      resumeHidden: false,
      questions: [{ id: 'q1', kind: 'text' }]
    },
    answers: []
  });
  assert.equal(resUnanswered.ok, false);
  assert.ok(resUnanswered.reason.includes('unanswered_questions'));

  // Все условия выполнены
  const resOk = evaluateTransitionGuards('drafted', 'awaiting_approval', v, {
    letter: { lint: { ok: true } },
    form: {
      resumeHidden: false,
      questions: [{ id: 'q1', kind: 'text' }]
    },
    answers: [{ id: 'q1', text: '5 лет опыта' }]
  });
  assert.equal(resOk.ok, true);
});

test('FSM guards: awaiting_approval -> approved (Human-in-the-Loop)', () => {
  const v = { status: 'awaiting_approval', key: 'hh.ru:123' };
  
  const resNoHuman = evaluateTransitionGuards('awaiting_approval', 'approved', v);
  assert.equal(resNoHuman.ok, false);
  assert.ok(resNoHuman.reason.includes('human_approval_required'));

  const resHumanApproved = evaluateTransitionGuards('awaiting_approval', 'approved', v, { userApproved: true });
  assert.equal(resHumanApproved.ok, true);
});

test('inspectVacancyFsm: вычисление блокеров и следующего действия', () => {
  const fakeDb = {
    getLetter: () => null,
    getResume: () => null,
    stats: () => ({ sentToday: 0 }),
    getSettings: () => ({ dailyLimit: 20, minDelaySec: 45 }),
    lastSentAt: () => null,
  };

  const vFound = { key: 'hh.ru:101', status: 'found', title: 'Developer' };
  const fsm1 = inspectVacancyFsm(vFound, fakeDb);
  assert.equal(fsm1.progress, 10);
  assert.equal(fsm1.nextAction.tool, 'get_vacancy');

  const vAwaiting = { key: 'hh.ru:102', status: 'awaiting_approval', title: 'DevOps' };
  const fsm2 = inspectVacancyFsm(vAwaiting, fakeDb);
  assert.equal(fsm2.progress, 80);
  assert.ok(fsm2.blockers.some(b => b.includes('Ожидает подтверждения')));
});

test('getPipelineFsmSummary: подсчет метрик и узких мест', () => {
  const fakeDb = {
    stats: () => ({
      byStatus: { found: 5, scored: 2, awaiting_approval: 3, sent: 1 },
      sentToday: 20,
    }),
    getSettings: () => ({ dailyLimit: 20, minDelaySec: 45 }),
  };

  const summary = getPipelineFsmSummary(fakeDb);
  assert.equal(summary.stateDistribution.found, 5);
  assert.equal(summary.stateDistribution.awaiting_approval, 3);
  assert.ok(summary.bottlenecks.some(b => b.stage === 'awaiting_approval'));
  assert.ok(summary.bottlenecks.some(b => b.stage === 'rate_limited'));
});
