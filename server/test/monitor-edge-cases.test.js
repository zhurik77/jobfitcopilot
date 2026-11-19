// Edge cases для monitor, API и инфраструктуры.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Monitor } from '../src/monitor.js';

function fakeDb() {
  return { getSettings: async () => ({}), updateSettings: async () => {} };
}

test('Monitor: 0 latency не роняет бакет', () => {
  const m = new Monitor(fakeDb());
  m.recordRequest('GET', '/api/test', 200, 0);
  assert.equal(m.metrics.latencyBuckets.ms50, 1);
});

test('Monitor: 4999ms latency попадает в ms5000', () => {
  const m = new Monitor(fakeDb());
  m.recordRequest('GET', '/api/test', 200, 4999);
  assert.equal(m.metrics.latencyBuckets.ms5000, 1);
});

test('Monitor: 5000ms latency попадает в slow', () => {
  const m = new Monitor(fakeDb());
  m.recordRequest('GET', '/api/test', 200, 5000);
  assert.equal(m.metrics.latencyBuckets.slow, 1);
});

test('Monitor: 6000ms latency попадает в slow', () => {
  const m = new Monitor(fakeDb());
  m.recordRequest('GET', '/api/test', 200, 6000);
  assert.equal(m.metrics.latencyBuckets.slow, 1);
});

test('Monitor: recordLlmCall без токенов не падает', () => {
  const m = new Monitor(fakeDb());
  m.recordLlmCall(100);
  assert.equal(m.metrics.llmCalls, 1);
  assert.equal(m.metrics.llmTotalTokens, 0);
});

test('Monitor: recordAutopilotCycle без ошибок не падает', () => {
  const m = new Monitor(fakeDb());
  m.recordAutopilotCycle({});
  assert.equal(m.metrics.autopilotCycles, 1);
  assert.equal(m.metrics.autopilotErrors, 0);
});

test('Monitor: middleware не ломает res.end при ошибке', () => {
  const m = new Monitor(fakeDb());
  const req = { method: 'GET', url: '/api/test' };
  let called = false;
  const res = {
    end: function () { called = true; return this; },
    writeHead: () => {},
  };
  m.middleware(req, res, Date.now());
  assert.doesNotThrow(() => res.end('ok'));
  assert.equal(called, true);
});

test('Monitor: sampleRate хранится, enabled гейтит запись', () => {
  const m = new Monitor(fakeDb(), { sampleRate: 0.5 });
  assert.equal(m.sampleRate, 0.5);
  assert.equal(m.enabled, true);
  m.recordRequest('GET', '/api/test', 200, 10);
  assert.equal(m.metrics.requestsTotal, 1);
});

test('Monitor: uptimeHuman форматируется', () => {
  const m = new Monitor(fakeDb());
  // Старт был только что, uptime < 60s
  const snap = m.snapshot();
  assert.ok(snap.uptimeHuman.endsWith('s'), `Expected seconds, got: ${snap.uptimeHuman}`);
});

test('Monitor: errorRate = 0% при 0 запросах', () => {
  const m = new Monitor(fakeDb());
  const snap = m.snapshot();
  assert.equal(snap.requests.errorRate, '0%');
});

test('Monitor: 100% error rate', () => {
  const m = new Monitor(fakeDb());
  m.recordRequest('GET', '/api/test', 500, 10);
  const snap = m.snapshot();
  assert.equal(snap.requests.errorRate, '100.0%');
});
