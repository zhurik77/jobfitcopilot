// Сборка адаптеров по сайтам и маршрутизация по адресу или имени источника.
// Маршрут выбирается по hostname целиком (или по поддомену через точку): подстрока
// не годится, иначе «nothh.ru» или «hh.ru.example.com» попали бы в адаптер hh.

import { createHh } from './hh.js';
import { createLinkedin } from './linkedin.js';
import { createUpwork } from './upwork.js';

const isDomain = (host, domain) => host === domain || host.endsWith('.' + domain);

/**
 * @param {{ navigate: Function, evaluate: Function }} bridge
 * @param {{ waitMs?: number, pollMs?: number, sleep?: (ms: number) => Promise<void> }} [opts]
 *   передаётся всем адаптерам как есть
 */
export function createSites(bridge, opts = {}) {
  const hh = createHh(bridge, opts);
  const linkedin = createLinkedin(bridge, opts);
  const upwork = createUpwork(bridge, opts);
  // Map, а не объект: source вида «constructor» или «__proto__» не должен находить адаптер.
  const bySource = new Map([
    ['hh.ru', hh],
    ['linkedin', linkedin],
    ['upwork', upwork],
  ]);

  return {
    hh,
    linkedin,
    upwork,
    forUrl(url) {
      let host;
      try {
        host = new URL(String(url)).hostname.toLowerCase();
      } catch {
        return null;
      }
      if (isDomain(host, 'hh.ru')) return hh;
      if (isDomain(host, 'linkedin.com')) return linkedin;
      if (isDomain(host, 'upwork.com')) return upwork;
      return null;
    },
    forSource(source) {
      return bySource.get(source) ?? null;
    },
  };
}
