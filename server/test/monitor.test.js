import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Monitor, createMonitor } from '../src/monitor.js';

function fakeDb() {
  return { getSettings: async () => ({}), updateSettings: async () => {} };
}

test('Monitor: disabled by opts', () => {
  const m = new Monitor(fakeDb(), { enabled: false });
  m.recordRequest('GET', '/api/test', 200, 30);
  assert.equal(m.metrics.requestsTotal, 0);
});

test('Monitor: records requests and latency buckets', () => {
  const m = new Monitor(fakeDb());
  m.recordRequest('GET', '/api/test', 200, 30);
  m.recordRequest('POST', '/api/vacancies', 201, 150);
  m.recordRequest('GET', '/api/test', 500, 3000);

  assert.equal(m.metrics.requestsTotal, 3);
  assert.equal(m.metrics.requestsFailed, 1);
  assert.equal(m.metrics.requestsByPath['GET /api/test'], 2);
  assert.equal(m.metrics.requestsByStatus['200'], 1);
  assert.equal(m.metrics.requestsByStatus['500'], 1);
  assert.equal(m.metrics.latencyBuckets.ms50, 1);
  assert.equal(m.metrics.latencyBuckets.ms200, 1);
  assert.equal(m.metrics.latencyBuckets.ms5000, 1);
});

test('Monitor: records LLM calls', () => {
  const m = new Monitor(fakeDb());
  m.recordLlmCall(500, 150);
  m.recordLlmCall(300, 200);
  m.recordLlmError();

  assert.equal(m.metrics.llmCalls, 2);
  assert.equal(m.metrics.llmTotalTokens, 350);
  assert.equal(m.metrics.llmLatencyMs, 800);
  assert.equal(m.metrics.llmErrors, 1);
});

test('Monitor: records autopilot cycles', () => {
  const m = new Monitor(fakeDb());
  m.recordAutopilotCycle({ submitted: 3, errors: ['err1'] });
  m.recordAutopilotCycle({ submitted: 1, errors: [] });

  assert.equal(m.metrics.autopilotCycles, 2);
  assert.equal(m.metrics.autopilotErrors, 1);
  assert.equal(m.metrics.autopilotSubmitted, 4);
});

test('Monitor: snapshot returns structured data', () => {
  const m = new Monitor(fakeDb());
  m.recordRequest('GET', '/api/health', 200, 10);
  m.recordLlmCall(500, 100);
  m.recordAutopilotCycle({ submitted: 1, errors: [] });

  const snap = m.snapshot();
  assert.ok(typeof snap.uptime === 'number');
  assert.ok(typeof snap.uptimeHuman === 'string');
  assert.equal(snap.requests.total, 1);
  assert.equal(snap.requests.failed, 0);
  assert.equal(snap.llm.calls, 1);
  assert.equal(snap.autopilot.cycles, 1);
  assert.equal(snap.autopilot.submitted, 1);
});

test('Monitor: middleware wraps res.end', async () => {
  const m = new Monitor(fakeDb());
  const req = { method: 'GET', url: '/api/test' };
  let ended = false;
  const res = {
    end: (...args) => { ended = true; return args; },
    writeHead: () => {},
  };

  m.middleware(req, res, Date.now());
  assert.equal(typeof res.end, 'function');
});

test('createMonitor: returns Monitor instance', () => {
  const m = createMonitor(fakeDb());
  assert.ok(m instanceof Monitor);
  assert.equal(m.enabled, true);
});

test('Monitor: empty snapshot does not throw', () => {
  const m = new Monitor(fakeDb());
  const snap = m.snapshot();
  assert.ok(snap.uptime >= 0);
  assert.equal(snap.requests.total, 0);
  assert.equal(snap.llm.calls, 0);
  assert.equal(snap.autopilot.cycles, 0);
});
