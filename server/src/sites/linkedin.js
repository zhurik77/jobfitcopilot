// ⚠️ Селекторы взяты из content-scripts/extractor-linkedin.js и НЕ проверены на живом сайте LinkedIn.
// При сбое сверяться с DevTools и править списки в extractLinkedin.
//
// Адаптер читает одну вакансию в браузере пользователя (его сессия через WebBridge).
// Поиска и отклика здесь нет: этот сайт пока только для чтения.

import { snippet } from './hh.js';

const LOGIN_RE = /\/login|\/authwall|\/ab\/account-security/;

// Код, который исполняется на странице: обычная функция, без ссылок на модульные
// переменные (в странице их не будет). Вызывается на каждом опросе.
// LinkedIn — SPA: заголовок появляется раньше описания, поэтому опрос ждёт
// непустое описание, а не первый найденный заголовок.
function extractLinkedin() {
  const pick = (selectors) => {
    for (const s of selectors) {
      const el = document.querySelector(s);
      if (el && el.innerText && el.innerText.trim()) return el.innerText.trim();
    }
    return '';
  };
  return {
    url: location.href,
    title: pick([
      '.job-details-jobs-unified-top-card__job-title h1',
      '.job-details-jobs-unified-top-card__job-title',
      '.jobs-unified-top-card__job-title',
      'h1.t-24',
      'h1',
    ]),
    company: pick([
      '.job-details-jobs-unified-top-card__company-name a',
      '.job-details-jobs-unified-top-card__company-name',
      '.jobs-unified-top-card__company-name a',
      '.jobs-unified-top-card__company-name',
    ]),
    // Инсайты верхней карточки: локация, занятость, иногда вилка зарплаты.
    salary: pick([
      '.job-details-jobs-unified-top-card__job-insight',
      '.jobs-unified-top-card__job-insight',
    ]),
    description: pick([
      '#job-details',
      '.jobs-description-content__text',
      '.jobs-box__html-content',
      'article.jobs-description__container',
    ]),
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

// Принимаем только ссылки на linkedin.com: иначе адаптер открыл бы чужой сайт.
// Id берём из пути /jobs/view/<digits>; если его там нет, то из ?currentJobId=<digits>.
// Для пути адрес сохраняем без query. Для currentJobId query нужен (без него id
// не найти), поэтому адрес сохраняем как есть.
function parseLinkedin(input) {
  const raw = String(input ?? '').trim();
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw fail('bad_id', `Не удалось разобрать адрес вакансии LinkedIn: ${raw}`);
  }
  const host = u.hostname.toLowerCase();
  if (host !== 'linkedin.com' && !host.endsWith('.linkedin.com')) {
    throw fail('bad_id', `Не похоже на LinkedIn: ${raw}`);
  }
  const m = u.pathname.match(/\/jobs\/view\/(\d+)/);
  if (m) return { id: m[1], url: `${u.origin}${u.pathname}` };
  const cur = u.searchParams.get('currentJobId');
  if (cur && /^\d+$/.test(cur)) return { id: cur, url: raw };
  throw fail('bad_id', `Не удалось определить id вакансии LinkedIn: ${raw}`);
}

/**
 * @param {{ navigate: Function, evaluate: Function }} bridge
 * @param {{ waitMs?: number, pollMs?: number, sleep?: (ms: number) => Promise<void> }} [opts]
 */
export function createLinkedin(bridge, {
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
      const p = await run(extractLinkedin);
      // Редирект на вход проверяем раньше описания: на странице входа описания нет.
      if (LOGIN_RE.test(p?.url ?? '')) {
        throw fail('login_required', 'LinkedIn просит войти в аккаунт: залогиньтесь в браузере');
      }
      if (p && p.description) return p;
      await sleep(pollMs);
    }
    throw fail('timeout', `Не дождались описания вакансии за ${waitMs} мс (${url})`);
  }

  return {
    async getVacancy(url) {
      const { id, url: pageUrl } = parseLinkedin(url);
      const v = await readVacancy(pageUrl);
      return {
        id,
        source: 'linkedin',
        url: pageUrl,
        title: v.title,
        company: v.company,
        salary: v.salary,
        experience: '',
        description: v.description,
        skills: [],
      };
    },
  };
}
