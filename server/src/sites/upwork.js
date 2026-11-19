// ⚠️ Селекторы взяты из content-scripts/extractor-upwork.js и НЕ проверены на живом сайте Upwork.
// При сбое сверяться с DevTools и править списки в extractUpwork.
//
// Адаптер читает одну вакансию в браузере пользователя (его сессия через WebBridge).
// Поиска и отклика здесь нет: этот сайт пока только для чтения.

import { snippet } from './hh.js';

const LOGIN_RE = /\/login|\/authwall|\/ab\/account-security/;

// Код, который исполняется на странице: обычная функция, без ссылок на модульные
// переменные. Навыки возвращаем отдельно: склеивать их с описанием будем уже в Node,
// чтобы готовность (непустое описание) не зависела от навыков.
function extractUpwork() {
  const pick = (selectors) => {
    for (const s of selectors) {
      const el = document.querySelector(s);
      if (el && el.innerText && el.innerText.trim()) return el.innerText.trim();
    }
    return '';
  };
  const skills = Array.from(
    document.querySelectorAll('[data-test="Skill"], [data-test="Attrs"] [data-test="Attr"], .skills-list .air3-token'),
  ).map((el) => (el.innerText || '').trim()).filter(Boolean);
  return {
    url: location.href,
    title: pick(['[data-test="job-header"] h4', '.job-details-card h4', 'h4.h5', 'h1']),
    // Имя клиента Upwork обычно не показывает: берём блок активности клиента.
    company: pick(['[data-test="client-info"]', '[data-test="ClientActivity"]']),
    salary: pick(['[data-test="Budget"]', '[data-test="budget"]', '[data-test="HourlyRate"]']),
    description: pick(['[data-test="Description"]', '[data-test="job-description"]', '.job-description']),
    skills,
  };
}

function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function parseJson(raw) {
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    throw fail('bad_reply', 'Страница вернула не-JSON из evaluate');
  }
}

// Id Upwork — токен «~<hex>» в последнем сегменте пути вакансии, например
// /jobs/Build-Landing-Page_~01abcdef0123/. Токен сохраняем с тильдой, как он
// написан в адресе. Query в сохранённый адрес не попадает.
function parseUpwork(input) {
  const raw = String(input ?? '').trim();
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw fail('bad_id', `Не удалось разобрать адрес вакансии Upwork: ${raw}`);
  }
  const host = u.hostname.toLowerCase();
  if (host !== 'upwork.com' && !host.endsWith('.upwork.com')) {
    throw fail('bad_id', `Не похоже на Upwork: ${raw}`);
  }
  const m = u.pathname.match(/^\/jobs\/[^/]*(~[0-9a-f]+)/i);
  if (!m) throw fail('bad_id', `Не удалось определить id вакансии Upwork: ${raw}`);
  return { id: m[1], url: `${u.origin}${u.pathname}` };
}

/**
 * @param {{ navigate: Function, evaluate: Function }} bridge
 * @param {{ waitMs?: number, pollMs?: number, sleep?: (ms: number) => Promise<void> }} [opts]
 */
export function createUpwork(bridge, {
  waitMs = 15000,
  pollMs = 500,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
} = {}) {
  const run = async (fn) => parseJson(await bridge.evaluate(snippet(fn)));

  // Опрос по счётчику, а не по Date.now(): в тестах sleep пустой, и время не идёт.
  async function readVacancy(url) {
    await bridge.navigate(url);
    const attempts = Math.max(1, Math.ceil(waitMs / pollMs));
    for (let i = 0; i < attempts; i++) {
      const p = await run(extractUpwork);
      if (LOGIN_RE.test(p?.url ?? '')) {
        throw fail('login_required', 'Upwork просит войти в аккаунт: залогиньтесь в браузере');
      }
      // Ждём описание, а не заголовок: страница дорисовывается после загрузки.
      if (p && p.description) return p;
      await sleep(pollMs);
    }
    throw fail('timeout', `Не дождались описания вакансии за ${waitMs} мс (${url})`);
  }

  return {
    async getVacancy(url) {
      const { id, url: pageUrl } = parseUpwork(url);
      const v = await readVacancy(pageUrl);
      // Формат как в extractor-upwork.js: навыки дописываются к описанию строкой.
      const description = v.skills.length
        ? `${v.description}\n\nSkills: ${v.skills.join(', ')}`
        : v.description;
      return {
        id,
        source: 'upwork',
        url: pageUrl,
        title: v.title,
        company: v.company,
        salary: v.salary,
        experience: '',
        description,
        skills: [],
      };
    },
  };
}
