// Клиент HTTP-демона Kimi WebBridge: все команды идут одним POST на /command.
// Демон живёт на хосте, сервер — в Docker, поэтому любой сбой соединения
// превращаем в понятный BridgeError, а не в сырой TypeError от fetch.

export class BridgeError extends Error {
  /**
   * @param {string} code  extension_not_connected | daemon_unreachable | bad_reply | код демона
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = 'BridgeError';
    this.code = code;
  }
}

/**
 * @param {{ baseUrl?: string, session?: string, fetchImpl?: typeof fetch }} [opts]
 */
export function createBridge({
  baseUrl = process.env.WEBBRIDGE_URL ?? 'http://127.0.0.1:10086',
  session = 'jobfit',
  fetchImpl = fetch,
} = {}) {
  const root = baseUrl.replace(/\/+$/, '');

  // Общий путь для POST и GET: сеть и разбор JSON обрабатываются в одном месте.
  async function request(path, init) {
    let res;
    try {
      res = await fetchImpl(root + path, init);
    } catch (err) {
      throw new BridgeError('daemon_unreachable', `WebBridge недоступен (${root}): ${err?.message ?? err}`);
    }
    let body;
    try {
      body = await res.json();
    } catch {
      throw new BridgeError('bad_reply', `Ответ WebBridge не является JSON (HTTP ${res.status})`);
    }
    return body;
  }

  /** @returns {Promise<any>} поле data ответа демона */
  async function command(action, args = {}) {
    const body = await request('/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, args, session }),
    });
    // Конверт обязан быть объектом с булевым ok — иначе это не наш демон.
    if (body === null || typeof body !== 'object' || typeof body.ok !== 'boolean') {
      throw new BridgeError('bad_reply', 'Ответ WebBridge не соответствует формату {ok, data|error}');
    }
    if (!body.ok) {
      const e = body.error ?? {};
      throw new BridgeError(e.code ?? 'unknown', e.message ?? 'Ошибка WebBridge без описания');
    }
    return body.data;
  }

  async function navigate(url, { newTab = false, groupTitle } = {}) {
    const args = { url, newTab };
    if (groupTitle) args.group_title = groupTitle;
    const data = await command('navigate', args);
    return { url: data?.url ?? url, tabId: data?.tabId };
  }

  async function evaluate(code) {
    const data = await command('evaluate', { code });
    return data?.value;
  }

  async function status() {
    return request('/status', { method: 'GET' });
  }

  return { command, navigate, evaluate, status };
}
