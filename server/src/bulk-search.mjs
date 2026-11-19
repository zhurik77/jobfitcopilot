/**
 * Bulk search & ATS scoring — обходит все страницы всех поисков (до 2000 вакансий),
 * обогащает описания, прогоняет LLM ATS-матчинг и Fit-анализ, собирает лучшие совпадения.
 * Ни одного отклика не отправляет.
 *
 * Запуск: node --experimental-vm-modules server/src/bulk-search.mjs
 */

import { createDb } from './db.js';
import { createBridge } from './bridge.js';
import { createSites } from './sites/index.js';
import { createLlmClient } from './core/llm.js';

const DB_PATH = process.env.DB_PATH || 'C:\\Users\\MacUniverse_IT\\AppData\\Local\\Temp\\jobfit-eval.db';
const MAX_VACANCIES = 2000;
const MAX_PAGES_PER_SEARCH = 40; // hh.ru лимит
const CONCURRENCY = 3; // параллельных LLM-запросов

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  console.log('=== BULK SEARCH & ATS SCORING ===');
  console.log(`DB: ${DB_PATH}`);
  console.log(`Лимит вакансий: ${MAX_VACANCIES}`);
  console.log('');

  const bridge = createBridge();
  const sites = createSites(bridge);
  const db = createDb(DB_PATH);
  const llm = createLlmClient();

  const resumes = db.listResumes();
  console.log(`Резюме: ${resumes.length}`);
  for (const r of resumes) {
    console.log(`  [${r.id.slice(0, 12)}] ${r.name}`);
  }

  const searches = (db.listSearches() || []).filter(s => s.enabled);
  console.log(`\nПоисков: ${searches.length}`);
  for (const s of searches) {
    console.log(`  [${s.id.slice(0, 12)}] ${s.name} — "${s.text}"`);
  }

  // ===== ФАЗА 1: Сбор вакансий (все страницы) =====
  console.log('\n=== ФАЗА 1: Сбор вакансий ===');
  let totalDiscovered = 0;
  let totalSkipped = 0;

  for (const s of searches) {
    console.log(`\n--- Поиск: ${s.name} ---`);
    let page = 0;
    let emptyPages = 0;

    let consecutiveErrors = 0;

    while (page < MAX_PAGES_PER_SEARCH && totalDiscovered < MAX_VACANCIES) {
      try {
        const res = await sites.hh.search({
          text: s.text,
          area: s.area || 113,
          page,
          filters: { ...s.filters, order_by: 'publication_time' },
        });

        const items = res.items || [];
        console.log(`  Страница ${page + 1}: ${items.length} вакансий (total: ${res.total || '?'})`);

        if (items.length === 0) {
          emptyPages++;
          if (emptyPages >= 2) break;
          page++;
          continue;
        }
        emptyPages = 0;
        consecutiveErrors = 0; // сброс счётчика ошибок

        for (const item of items) {
          if (totalDiscovered >= MAX_VACANCIES) break;
          const saved = db.upsertVacancy({
            source: 'hh.ru',
            id: item.id,
            url: item.url,
            title: item.title,
            company: item.employer,
            salary: item.salary,
            experience: item.experience,
            address: item.address,
            snippet: item.snippet,
          });
          if (saved) totalDiscovered++;
        }

        db.touchSearch(s.id);
        page++;

        // Пауза между страницами
        if (items.length >= 20) await sleep(1500);
      } catch (err) {
        console.error(`  Ошибка на странице ${page + 1}: ${err.message}`);
        consecutiveErrors++;
        // hh.ru часто отдаёт всего 3-5 страниц. Две ошибки подряд = конец выдачи.
        if (consecutiveErrors >= 2) {
          console.log(`  Две ошибки подряд — завершаем поиск «${s.name}»`);
          break;
        }
        totalSkipped++;
        page++;
        await sleep(3000);
      }
    }
    console.log(`  Итого по поиску: ${totalDiscovered} новых вакансий`);
  }

  console.log(`\nВсего собрано: ${totalDiscovered} новых вакансий, ошибок: ${totalSkipped}`);

  // ===== ФАЗА 2: Обогащение описаний =====
  console.log('\n=== ФАЗА 2: Обогащение описаний ===');
  const toEnrich = (db.listPipeline({ status: 'found', limit: MAX_VACANCIES }) || [])
    .filter(v => !v.description)
    .slice(0, MAX_VACANCIES);

  console.log(`Нужно обогатить: ${toEnrich.length} вакансий`);
  let enriched = 0;

  for (let i = 0; i < toEnrich.length; i++) {
    const v = toEnrich[i];
    try {
      const full = await sites.hh.getVacancy(v.id || v.key.slice(v.key.indexOf(':') + 1));
      if (full?.description) {
        db.upsertVacancy({
          source: v.source || 'hh.ru',
          id: v.id,
          description: full.description,
          skills: full.skills || [],
        });
        enriched++;
      }
      if ((i + 1) % 20 === 0) {
        console.log(`  Обогащено: ${enriched}/${toEnrich.length}`);
      }
      await sleep(800); // пауза между запросами
    } catch (err) {
      console.error(`  Ошибка обогащения ${v.key}: ${err.message}`);
      await sleep(2000);
    }
  }
  console.log(`Обогащено: ${enriched} вакансий`);

  // ===== ФАЗА 3: ATS-матчинг и Fit-анализ =====
  console.log('\n=== ФАЗА 3: ATS-матчинг и Fit-анализ ===');
  const readyToScore = (db.listPipeline({ status: 'found', limit: MAX_VACANCIES }) || [])
    .filter(v => Boolean(v.description));

  console.log(`Готово к скорингу: ${readyToScore.length} вакансий`);

  if (resumes.length === 0) {
    console.log('Нет резюме для матчинга. Завершение.');
    return;
  }

  let scored = 0;
  let drafted = 0;
  let skipped = 0;
  const bestMatches = [];

  // Обрабатываем с ограниченной конкурентностью
  for (let i = 0; i < readyToScore.length; i += CONCURRENCY) {
    const batch = readyToScore.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async (v) => {
        try {
          const result = await llm.processVacancyWorkflow({ vacancy: v, resumes, db });
          return { v, result };
        } catch (err) {
          return { v, error: err.message };
        }
      })
    );

    for (const r of results) {
      if (r.status === 'fulfilled') {
        const { v, result } = r.value;
        if (result.error) {
          skipped++;
        } else if (result.status === 'drafted') {
          drafted++;
          bestMatches.push({
            title: v.title,
            company: v.company,
            salary: v.salary,
            url: v.url,
            resume: result.chosenResume,
            fitScore: result.fitScore,
            key: v.key,
          });
        } else if (result.status === 'skipped') {
          skipped++;
        }
        scored++;
      } else {
        skipped++;
        scored++;
      }
    }

    if ((i + CONCURRENCY) % 30 === 0 || i + CONCURRENCY >= readyToScore.length) {
      console.log(`  Прогресс: ${Math.min(i + CONCURRENCY, readyToScore.length)}/${readyToScore.length} | drafted: ${drafted} | skipped: ${skipped}`);
    }

    // Пауза между батчами
    await sleep(500);
  }

  // ===== РЕЗУЛЬТАТЫ =====
  console.log('\n' + '='.repeat(60));
  console.log('=== РЕЗУЛЬТАТЫ BULK ATS-СКОРИНГА ===');
  console.log('='.repeat(60));
  console.log(`Всего обработано вакансий: ${scored}`);
  console.log(`  Drafted (лучшие совпадения): ${drafted}`);
  console.log(`  Skipped (низкое соответствие): ${skipped}`);

  // Топ-50 лучших совпадений
  bestMatches.sort((a, b) => (b.fitScore || 0) - (a.fitScore || 0));

  console.log('\n--- ТОП-50 ЛУЧШИХ СОВПАДЕНИЙ ---');
  console.log('Рейтинг | Вакансия | Компания | Зарплата | Резюме | Fit Score');
  console.log('-'.repeat(100));

  const topN = Math.min(50, bestMatches.length);
  for (let i = 0; i < topN; i++) {
    const m = bestMatches[i];
    console.log(`${String(i + 1).padStart(3)}. | ${(m.title || '').slice(0, 40).padEnd(40)} | ${(m.company || '').slice(0, 20).padEnd(20)} | ${(m.salary || '').slice(0, 18).padEnd(18)} | ${(m.resume || '').slice(0, 20).padEnd(20)} | ${m.fitScore}`);
  }

  // Сводка по резюме
  console.log('\n--- СВОДКА ПО РЕЗЮМЕ ---');
  const byResume = {};
  for (const m of bestMatches) {
    if (!byResume[m.resume]) byResume[m.resume] = { count: 0, scores: [] };
    byResume[m.resume].count++;
    byResume[m.resume].scores.push(m.fitScore);
  }
  for (const [name, data] of Object.entries(byResume).sort((a, b) => b[1].count - a[1].count)) {
    const avg = (data.scores.reduce((a, b) => a + b, 0) / data.scores.length).toFixed(1);
    console.log(`  ${name.padEnd(30)} — ${data.count} совпадений, средний Fit: ${avg}`);
  }

  console.log('\nГотово! Лучшие совпадения видны в веб-панели (статус: drafted).');
}

main().catch(err => {
  console.error('Ошибка:', err);
  process.exit(1);
});
