import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateAnswers, unansweredQuestionIds } from '../src/api.js';

test('validateAnswers: пустые answers = ошибка', () => {
  assert.throws(() => validateAnswers({ questions: [] }, null), { code: 'bad_answers' });
  assert.throws(() => validateAnswers({ questions: [] }, 'string'), { code: 'bad_answers' });
  assert.throws(() => validateAnswers({ questions: [] }, {}), { code: 'bad_answers' });
});

test('validateAnswers: no form = ошибка', () => {
  assert.throws(() => validateAnswers(null, []), { code: 'no_form' });
  assert.throws(() => validateAnswers(undefined, []), { code: 'no_form' });
});

test('validateAnswers: несуществующий вопрос = ошибка', () => {
  const form = { questions: [{ id: 'q1', kind: 'text' }] };
  assert.throws(() => validateAnswers(form, [{ id: 'q2', text: 'answer' }]), { code: 'bad_answers' });
});

test('validateAnswers: повторный ответ на вопрос = ошибка', () => {
  const form = { questions: [{ id: 'q1', kind: 'text' }] };
  assert.throws(() => validateAnswers(form, [{ id: 'q1', text: 'a' }, { id: 'q1', text: 'b' }]), { code: 'bad_answers' });
});

test('validateAnswers: text вопрос валидируется', () => {
  const form = { questions: [{ id: 'q1', kind: 'text' }] };
  const result = validateAnswers(form, [{ id: 'q1', text: 'My answer' }]);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'q1');
  assert.equal(result[0].text, 'My answer');
});

test('validateAnswers: выбор вопроса валидируется', () => {
  const form = { questions: [{ id: 'q1', kind: 'select', options: [{ value: 'a' }, { value: 'b' }], multiple: true }] };
  const result = validateAnswers(form, [{ id: 'q1', values: ['a', 'b'] }]);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].values, ['a', 'b']);
});

test('validateAnswers: неверное значение выбора = ошибка', () => {
  const form = { questions: [{ id: 'q1', kind: 'select', options: [{ value: 'a' }] }] };
  assert.throws(() => validateAnswers(form, [{ id: 'q1', values: ['c'] }]), { code: 'bad_answers' });
});

test('validateAnswers: multiple=false с несколькими значениями = ошибка', () => {
  const form = { questions: [{ id: 'q1', kind: 'select', options: [{ value: 'a' }, { value: 'b' }] }] };
  assert.throws(() => validateAnswers(form, [{ id: 'q1', values: ['a', 'b'] }]), { code: 'bad_answers' });
});

test('validateAnswers: own ответ', () => {
  const form = { questions: [{ id: 'q1', kind: 'select', options: [{ value: 'a' }], allowsOwn: true }] };
  const result = validateAnswers(form, [{ id: 'q1', values: ['a'], own: 'my own' }]);
  assert.equal(result[0].own, 'my own');
});

test('unansweredQuestionIds: все отвечены', () => {
  const form = { questions: [{ id: 'q1', kind: 'text' }, { id: 'q2', kind: 'select', options: [{ value: 'a' }] }] };
  const answers = [{ id: 'q1', text: 'yes' }, { id: 'q2', values: ['a'] }];
  assert.deepEqual(unansweredQuestionIds(form, answers), []);
});

test('unansweredQuestionIds: есть неотвеченные', () => {
  const form = { questions: [{ id: 'q1', kind: 'text' }, { id: 'q2', kind: 'text' }] };
  const answers = [{ id: 'q1', text: 'yes' }];
  assert.deepEqual(unansweredQuestionIds(form, answers), ['q2']);
});

test('unansweredQuestionIds: пустой текст считается неотвеченным', () => {
  const form = { questions: [{ id: 'q1', kind: 'text' }] };
  const answers = [{ id: 'q1', text: '' }];
  assert.deepEqual(unansweredQuestionIds(form, answers), ['q1']);
});

test('unansweredQuestionIds: пустой form = пустой массив', () => {
  assert.deepEqual(unansweredQuestionIds(null, []), []);
  assert.deepEqual(unansweredQuestionIds({ questions: [] }, []), []);
});
