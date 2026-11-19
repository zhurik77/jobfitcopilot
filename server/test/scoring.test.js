import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeFitScore, rankResumeMatches } from '../src/core/scoring.js';

// Additional tests beyond those in core.test.js

test('computeFitScore: null/undefined = BASE_SCORE 50', () => {
  assert.equal(computeFitScore(null), 50);
  assert.equal(computeFitScore(undefined), 50);
});

test('computeFitScore: empty object = 0 (hard=0, overall=0)', () => {
  assert.equal(computeFitScore({}), 0);
});

test('computeFitScore: hard + overall weighted', () => {
  // hard=80, overall=90: 50 + round((80-50)*0.3 + (90-50)*0.7) = 50 + round(9+28) = 87
  assert.equal(computeFitScore({ hard_requirements_coverage_percent: 80, overall_match_score: 90 }), 87);
});

test('computeFitScore: only hard', () => {
  // hard=100, overall=0: 50 + round((100-50)*0.3 + (0-50)*0.7) = 50 + round(15-35) = 30
  assert.equal(computeFitScore({ hard_requirements_coverage_percent: 100 }), 30);
});

test('computeFitScore: only overall', () => {
  // hard=0, overall=100: 50 + round((0-50)*0.3 + (100-50)*0.7) = 50 + round(-15+35) = 70
  assert.equal(computeFitScore({ overall_match_score: 100 }), 70);
});

test('computeFitScore: boundary values', () => {
  assert.equal(computeFitScore({ hard_requirements_coverage_percent: 0, overall_match_score: 0 }), 0);
  // hard=100, overall=100: 50 + round(50*0.3 + 50*0.7) = 50 + 50 = 100
  assert.equal(computeFitScore({ hard_requirements_coverage_percent: 100, overall_match_score: 100 }), 100);
});

test('computeFitScore: string percentages', () => {
  assert.equal(computeFitScore({ hard_requirements_coverage_percent: '80', overall_match_score: '90' }), 87);
  assert.equal(computeFitScore({ hard_requirements_coverage_percent: 'abc', overall_match_score: 'xyz' }), 0);
});

test('computeFitScore: negative values clamped', () => {
  assert.equal(computeFitScore({ hard_requirements_coverage_percent: -50, overall_match_score: -50 }), 0);
  assert.equal(computeFitScore({ hard_requirements_coverage_percent: 200, overall_match_score: 200 }), 100);
});

test('rankResumeMatches: empty array', () => {
  assert.deepEqual(rankResumeMatches([]), []);
});

test('rankResumeMatches: null/undefined', () => {
  assert.deepEqual(rankResumeMatches(null), []);
  assert.deepEqual(rankResumeMatches(undefined), []);
});

test('rankResumeMatches: sorting by hard then overall', () => {
  const items = [
    { resumeId: 1, name: 'C', result: { hard_requirements_coverage_percent: 50, overall_match_score: 80 } },
    { resumeId: 2, name: 'A', result: { hard_requirements_coverage_percent: 80, overall_match_score: 60 } },
    { resumeId: 3, name: 'B', result: { hard_requirements_coverage_percent: 50, overall_match_score: 90 } },
  ];
  const ranked = rankResumeMatches(items);
  assert.equal(ranked[0].name, 'A');
  assert.equal(ranked[1].name, 'B');
  assert.equal(ranked[2].name, 'C');
});

test('rankResumeMatches: filters entries without result', () => {
  const items = [
    { resumeId: 1, name: 'A', result: { hard_requirements_coverage_percent: 80, overall_match_score: 90 } },
    { resumeId: 2, name: 'B', result: null },
    { resumeId: 3, name: 'C', result: { hard_requirements_coverage_percent: 70, overall_match_score: 80 } },
  ];
  const ranked = rankResumeMatches(items);
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].name, 'A');
  assert.equal(ranked[1].name, 'C');
});

test('rankResumeMatches: rounding percentages', () => {
  const items = [
    { resumeId: 1, name: 'A', result: { hard_requirements_coverage_percent: 80.6, overall_match_score: 90 } },
    { resumeId: 2, name: 'B', result: { hard_requirements_coverage_percent: 80.4, overall_match_score: 90 } },
  ];
  const ranked = rankResumeMatches(items);
  assert.equal(ranked[0].name, 'A');
  assert.equal(ranked[1].name, 'B');
});

test('rankResumeMatches: null items in array', () => {
  const items = [
    { resumeId: 1, name: 'A', result: { hard_requirements_coverage_percent: 80, overall_match_score: 90 } },
    null,
    undefined,
  ];
  const ranked = rankResumeMatches(items);
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].name, 'A');
});

test('rankResumeMatches: recommended flag for first only', () => {
  const items = [
    { resumeId: 1, name: 'A', result: { hard_requirements_coverage_percent: 90, overall_match_score: 90 } },
    { resumeId: 2, name: 'B', result: { hard_requirements_coverage_percent: 70, overall_match_score: 70 } },
  ];
  const ranked = rankResumeMatches(items);
  assert.equal(ranked[0].recommended, true);
  assert.equal(ranked[1].recommended, false);
});

test('rankResumeMatches: stable sort preserves input order on ties', () => {
  const items = [
    { resumeId: 1, name: 'First', result: { hard_requirements_coverage_percent: 50, overall_match_score: 50 } },
    { resumeId: 2, name: 'Second', result: { hard_requirements_coverage_percent: 50, overall_match_score: 50 } },
  ];
  const ranked = rankResumeMatches(items);
  assert.equal(ranked[0].name, 'First');
  assert.equal(ranked[1].name, 'Second');
});

test('rankResumeMatches: rank numbers are sequential', () => {
  const items = [
    { resumeId: 1, name: 'A', result: { hard_requirements_coverage_percent: 90, overall_match_score: 90 } },
    { resumeId: 2, name: 'B', result: { hard_requirements_coverage_percent: 70, overall_match_score: 70 } },
    { resumeId: 3, name: 'C', result: { hard_requirements_coverage_percent: 50, overall_match_score: 50 } },
  ];
  const ranked = rankResumeMatches(items);
  assert.equal(ranked[0].rank, 1);
  assert.equal(ranked[1].rank, 2);
  assert.equal(ranked[2].rank, 3);
});
