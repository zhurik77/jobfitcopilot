/**
 * Bulk ATS scoring — финальный проход.
 * Берёт все вакансии с описанием, прогоняет LLM ATS-матчинг + Fit.
 * Без обогащения, без откликов.
 *
 * Запуск: node --experimental-vm-modules server/src/bulk-ats-final.mjs
 */

import { createDb } from './db.js';
import { createLlmClient } from './core/llm.js';

const DB_PATH = process.env.DB_PATH || 'C:\\Users\\MacUniverse_IT\\AppData\\Local\\Temp\\jobfit-eval.db';
const CONCURRENCY = 3;

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log('=== BULK ATS SCORING — FINAL PASS ===');
  console.log(`DB: ${DB_PATH}`);

  const db = createDb(DB_PATH);
  const llm = createLlmClient();

  const resumes = db.listResumes();
  console.log(`Резюме: ${resumes.length}`);
  for (const r of resumes) console.log(`  ${r.name}`);

  const pipeline = db.listPipeline({ status: 'found', limit: 99999 }).filter(v => Boolean(v.description));
  console.log(`\nВакансий с описанием: ${pipeline.length}`);

  if (resumes.length === 0 || pipeline.length === 0) {
    console.log('Нет данных для скоринга.');
    return;
  }

  let drafted = 0, skipped = 0, errors = 0;
  const bestMatches = [];

  for (let i = 0; i < pipeline.length; i += CONCURRENCY) {
    const batch = pipeline.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async (v) => {
        try {
          const fresh = db.getVacancy(v.key);
          if (!fresh || !fresh.description) return { v, error: 'no_description' };
          return { v, result: await llm.processVacancyWorkflow({ vacancy: fresh, resumes, db }) };
        } catch (err) {
          return { v, error: err.message };
        }
      })
    );

    for (const r of results) {
      if (r.status === 'fulfilled') {
        const { v, result, error } = r.value;
        if (error) { errors++; }
        else if (result.status === 'drafted') {
          drafted++;
          bestMatches.push({
            title: v.title, company: v.company, salary: v.salary, url: v.url,
            resume: result.chosenResume, fitScore: result.fitScore, key: v.key,
          });
        } else { skipped++; }
      } else { errors++; }
    }

    if ((i + CONCURRENCY) % 30 === 0 || i + CONCURRENCY >= pipeline.length) {
      const done = Math.min(i + CONCURRENCY, pipeline.length);
      console.log(`  ${done}/${pipeline.length} | drafted: ${drafted} | skipped: ${skipped} | errors: ${errors}`);
    }
    await sleep(200);
  }

  // ===== РЕЗУЛЬТАТЫ =====
  console.log('\n' + '='.repeat(70));
  console.log('=== РЕЗУЛЬТАТЫ BULK ATS-СКОРИНГА ===');
  console.log('='.repeat(70));
  console.log(`Обработано: ${drafted + skipped + errors}`);
  console.log(`  Drafted (лучшие совпадения): ${drafted}`);
  console.log(`  Skipped (низкое соответствие): ${skipped}`);
  console.log(`  Errors: ${errors}`);

  bestMatches.sort((a, b) => (b.fitScore || 0) - (a.fitScore || 0));

  console.log('\n--- ТОП-50 ЛУЧШИХ СОВПАДЕНИЙ ---');
  const topN = Math.min(50, bestMatches.length);
  for (let i = 0; i < topN; i++) {
    const m = bestMatches[i];
    console.log(`${String(i+1).padStart(3)}. | ${(m.title||'').slice(0,45).padEnd(45)} | ${(m.company||'').slice(0,18).padEnd(18)} | ${(m.salary||'').slice(0,15).padEnd(15)} | ${(m.resume||'').slice(0,22).padEnd(22)} | ${m.fitScore}`);
  }

  console.log('\n--- СВОДКА ПО РЕЗЮМЕ ---');
  const byResume = {};
  for (const m of bestMatches) {
    if (!byResume[m.resume]) byResume[m.resume] = { count: 0, scores: [] };
    byResume[m.resume].count++;
    byResume[m.resume].scores.push(m.fitScore);
  }
  for (const [name, data] of Object.entries(byResume).sort((a,b) => b[1].count - a[1].count)) {
    const avg = (data.scores.reduce((a,b)=>a+b,0)/data.scores.length).toFixed(1);
    console.log(`  ${name.padEnd(35)} — ${data.count} совпадений, средний Fit: ${avg}`);
  }

  console.log('\nГотово! Статус drafted — в веб-панели.');
}

main().catch(err => { console.error('Ошибка:', err); process.exit(1); });
