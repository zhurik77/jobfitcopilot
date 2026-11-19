import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBridge, BridgeError } from '../src/bridge.js';

const reply = (body, status = 200) => ({ status, json: async () => body });

test('command: успешный конверт возвращает data и шлёт верный запрос', async () => {
  const calls = [];
  const bridge = createBridge({
    baseUrl: 'http://x:1/',
    session: 's1',
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return reply({ ok: true, data: { a: 1 } });
    },
  });
  assert.deepEqual(await bridge.command('ping', { k: 2 }), { a: 1 });
  assert.equal(calls[0].url, 'http://x:1/command');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[0].init.body), { action: 'ping', args: { k: 2 }, session: 's1' });
});

test('command: ok:false превращается в BridgeError с кодом демона', async () => {
  const bridge = createBridge({
    fetchImpl: async () => reply({ ok: false, error: { code: 'extension_not_connected', message: 'нет расширения' } }),
  });
  await assert.rejects(bridge.command('x'), (e) => {
    assert.ok(e instanceof BridgeError);
    assert.equal(e.code, 'extension_not_connected');
    assert.equal(e.message, 'нет расширения');
    return true;
  });
});

test('command: сбой соединения даёт daemon_unreachable', async () => {
  const bridge = createBridge({ fetchImpl: async () => { throw new TypeError('fetch failed'); } });
  await assert.rejects(bridge.command('x'), (e) => e instanceof BridgeError && e.code === 'daemon_unreachable');
});

test('command: ответ не конверт или не JSON даёт bad_reply', async () => {
  const notEnvelope = createBridge({ fetchImpl: async () => reply({ hello: 'world' }) });
  await assert.rejects(notEnvelope.command('x'), (e) => e.code === 'bad_reply');
  const notJson = createBridge({ fetchImpl: async () => ({ status: 502, json: async () => { throw new SyntaxError('x'); } }) });
  await assert.rejects(notJson.command('x'), (e) => e.code === 'bad_reply');
});

test('navigate: передаёт newTab и group_title, возвращает {url, tabId}', async () => {
  let sent;
  const bridge = createBridge({
    fetchImpl: async (_u, init) => {
      sent = JSON.parse(init.body);
      return reply({ ok: true, data: { success: true, url: 'https://hh.ru/', tabId: 7 } });
    },
  });
  const r = await bridge.navigate('https://hh.ru/', { newTab: true, groupTitle: 'jobfit' });
  assert.deepEqual(r, { url: 'https://hh.ru/', tabId: 7 });
  assert.equal(sent.action, 'navigate');
  assert.deepEqual(sent.args, { url: 'https://hh.ru/', newTab: true, group_title: 'jobfit' });
});

test('evaluate: возвращает value', async () => {
  const bridge = createBridge({
    fetchImpl: async () => reply({ ok: true, data: { type: 'string', value: '{"n":1}' } }),
  });
  assert.equal(await bridge.evaluate('(()=>1)()'), '{"n":1}');
});

test('status: GET /status', async () => {
  let seen;
  const bridge = createBridge({
    baseUrl: 'http://d',
    fetchImpl: async (url, init) => { seen = { url, init }; return reply({ running: true }); },
  });
  assert.deepEqual(await bridge.status(), { running: true });
  assert.equal(seen.url, 'http://d/status');
  assert.equal(seen.init.method, 'GET');
});
