import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractResumeSummary } from '../src/core/resume-summary.js';

test('extractResumeSummary: null/undefined returns null', () => {
  assert.equal(extractResumeSummary(null), null);
  assert.equal(extractResumeSummary(undefined), null);
});

test('extractResumeSummary: empty text', () => {
  const result = extractResumeSummary({ text: '' });
  assert.ok(result);
  assert.equal(result.wordCount, 0);
  assert.ok(Array.isArray(result.skills));
  assert.equal(result.facts.length, 0);
  assert.equal(result.salary, 'По договорённости');
  assert.equal(typeof result.experience, 'string');
  assert.equal(result.hasReview, false);
});

test('extractResumeSummary: base fields pass through', () => {
  const result = extractResumeSummary({
    id: 'res_123',
    name: 'Ivan Ivanov',
    text: 'Senior developer',
    source: 'hh.ru',
  });
  assert.equal(result.id, 'res_123');
  assert.equal(result.name, 'Ivan Ivanov');
  assert.equal(result.source, 'hh.ru');
});

test('extractResumeSummary: wordCount is correct', () => {
  const text = 'one two three four five six seven eight nine ten';
  const result = extractResumeSummary({ text });
  assert.equal(result.wordCount, 10);
});

test('extractResumeSummary: salary extracted', () => {
  const text = 'zp 150000-200000 rub exp 5 years';
  const result = extractResumeSummary({ text });
  assert.ok(result.compRange);
});

test('extractResumeSummary: skills extracted', () => {
  const text = 'Skills: JavaScript, React, Node.js, TypeScript, Python, Docker, PostgreSQL, Redis, Git, Linux';
  const result = extractResumeSummary({ text });
  assert.ok(result.skills.length > 0);
  assert.ok(result.skills.length <= 8);
});

test('extractResumeSummary: reviewScore passes through', () => {
  const result = extractResumeSummary({ text: 'text', reviewScore: 85 });
  assert.equal(result.reviewScore, 85);
  assert.equal(result.hasReview, true);
});

test('extractResumeSummary: atsReadiness calculated', () => {
  const words = Array.from({ length: 900 }, (_, i) => `word${i}`).join(' ');
  const text = `${words}\nSkills: JavaScript, React`;
  const result = extractResumeSummary({ text });
  assert.ok(result.atsReadiness > 0);
  assert.ok(result.atsReadiness <= 95);
});
