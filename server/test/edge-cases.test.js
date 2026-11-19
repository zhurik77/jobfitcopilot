// Крайние случаи для scoring, API, health и инфраструктуры.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeFitScore, rankResumeMatches } from '../src/core/scoring.js';

describe('computeFitScore — null/NaN/undefined guards', () => {
  test('null = BASE_SCORE 50', () => {
    assert.equal(computeFitScore(null), 50);
  });

  test('undefined = BASE_SCORE 50', () => {
    assert.equal(computeFitScore(undefined), 50);
  });

  test('NaN в hard_requirements_coverage_percent = 0', () => {
    assert.equal(computeFitScore({ hard_requirements_coverage_percent: NaN }), 0);
  });

  test('NaN в overall_match_score = 0', () => {
    assert.equal(computeFitScore({ overall_match_score: NaN }), 0);
  });

  test('Infinity = clamp к 100', () => {
    assert.equal(computeFitScore({ hard_requirements_coverage_percent: Infinity }), 100);
  });

  test('-Infinity = clamp к 0', () => {
    assert.equal(computeFitScore({ hard_requirements_coverage_percent: -Infinity }), 0);
  });

  test('отрицательные значения = 0', () => {
    assert.equal(computeFitScore({ hard_requirements_coverage_percent: -50 }), 0);
  });

  test('строки вместо чисел = Number() преобразование', () => {
    const score = computeFitScore({ hard_requirements_coverage_percent: '80', overall_match_score: '90' });
    assert.equal(typeof score, 'number');
    assert(score >= 0 && score <= 100);
  });

  test('отсутствие полей = 0 (hard=0, overall=0)', () => {
    assert.equal(computeFitScore({}), 0);
  });

  test('только hard = weighted formula', () => {
    const score = computeFitScore({ hard_requirements_coverage_percent: 100 });
    // 0.3 * 100 + 0.7 * 0 = 30
    assert.equal(score, 30);
  });

  test('только overall = weighted formula', () => {
    const score = computeFitScore({ overall_match_score: 80 });
    // 0.3 * 0 + 0.7 * 80 = 56
    assert.equal(score, 56);
  });
});

describe('rankResumeMatches — edge cases', () => {
  test('пустой массив = пустой массив', () => {
    assert.deepEqual(rankResumeMatches([]), []);
  });

  test('один элемент = rank 1, recommended', () => {
    const items = [{ resumeId: 1, name: 'A', result: { hard_requirements_coverage_percent: 80, overall_match_score: 70 } }];
    const ranked = rankResumeMatches(items);
    assert.equal(ranked.length, 1);
    assert.equal(ranked[0].rank, 1);
    assert.equal(ranked[0].recommended, true);
  });

  test('null/undefined в массиве = фильтруется', () => {
    const items = [
      { resumeId: 1, name: 'A', result: { hard_requirements_coverage_percent: 80, overall_match_score: 70 } },
      null,
      undefined,
    ];
    const ranked = rankResumeMatches(items);
    assert.equal(ranked.length, 1);
  });

  test('элемент без result фильтруется, не падает', () => {
    const items = [{ resumeId: 1, name: 'A' }];
    const ranked = rankResumeMatches(items);
    assert.equal(ranked.length, 0);
  });

  test('элемент с result = null фильтруется, не падает', () => {
    const items = [{ resumeId: 1, name: 'A', result: null }];
    const ranked = rankResumeMatches(items);
    assert.equal(ranked.length, 0); // фильтр отсеивает s.result=null
  });

  test('элемент с result = undefined фильтруется, не падает', () => {
    const items = [{ resumeId: 1, name: 'A', result: undefined }];
    const ranked = rankResumeMatches(items);
    assert.equal(ranked.length, 0);
  });

  test('тай-брейк: одинаковые hard — сортировка по overall', () => {
    const items = [
      { resumeId: 1, name: 'A', result: { hard_requirements_coverage_percent: 80, overall_match_score: 70 } },
      { resumeId: 2, name: 'B', result: { hard_requirements_coverage_percent: 80, overall_match_score: 90 } },
    ];
    const ranked = rankResumeMatches(items);
    assert.equal(ranked[0].name, 'B'); // B выше по overall
    assert.equal(ranked[1].name, 'A');
  });

  test('полное равенство = порядок входа сохраняется', () => {
    const items = [
      { resumeId: 1, name: 'A', result: { hard_requirements_coverage_percent: 50, overall_match_score: 50 } },
      { resumeId: 2, name: 'B', result: { hard_requirements_coverage_percent: 50, overall_match_score: 50 } },
    ];
    const ranked = rankResumeMatches(items);
    assert.equal(ranked[0].name, 'A');
    assert.equal(ranked[1].name, 'B');
  });
});
