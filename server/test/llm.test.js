import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLlmClient, LlmError } from '../src/core/llm.js';

test('createLlmClient: status check', async () => {
  const fakeFetch = async (url) => {
    if (url.includes('/health')) {
      return { ok: true, json: async () => ({ status: 'ok', model: 'test-model' }) };
    }
    return { ok: false, status: 404 };
  };

  const client = createLlmClient({ fetchImpl: fakeFetch, baseUrl: 'http://localhost:8000/v1' });
  const st = await client.status();
  assert.equal(st.connected, true);
  assert.equal(st.details.status, 'ok');
});

test('createLlmClient: chatCompletion parsing & error handling', async () => {
  const fakeFetchOk = async () => ({
    ok: true,
    json: async () => ({
      choices: [{ message: { content: '{"verdict": "ОТКЛИКАТЬСЯ", "ledger": []}' } }]
    })
  });

  const client = createLlmClient({ fetchImpl: fakeFetchOk });
  const reply = await client.analyzeFit({ vacancyText: 'Job', resumeText: 'Resume' });
  assert.equal(reply.verdict, 'ОТКЛИКАТЬСЯ');

  // Ошибка 500
  const fakeFetch500 = async () => ({
    ok: false,
    status: 500,
    text: async () => 'Internal server error'
  });
  const clientErr = createLlmClient({ fetchImpl: fakeFetch500 });
  await assert.rejects(
    async () => clientErr.analyzeFit({ vacancyText: 'Job', resumeText: 'Resume' }),
    (err) => err instanceof LlmError && err.code === 'cdek_llm_http_error'
  );
});

test('createLlmClient: generateLetter with lint formatting', async () => {
  const fakeLetter = `ПЛАН:
1. Опыт в Node.js
2. Релевантный проект

ТЕКСТ:
Здравствуйте. В проекте MacUniverse я разрабатывал распределённую систему на Node.js и PostgreSQL, сократив время отклика API на 40%. Готов реализовать интеграцию вашего сервиса с внешними провайдерами. Предлагаю обсудить детали на интервью.`;

  const fakeFetch = async () => ({
    ok: true,
    json: async () => ({
      choices: [{ message: { content: fakeLetter } }]
    })
  });

  const client = createLlmClient({ fetchImpl: fakeFetch });
  const res = await client.generateLetter({ vacancyText: 'Node.js Dev', resumeText: 'Developer' });
  assert.ok(res.text.includes('Здравствуйте'));
  assert.ok(res.plan.includes('Опыт в Node.js'));
  assert.equal(typeof res.lint.ok, 'boolean');
});
