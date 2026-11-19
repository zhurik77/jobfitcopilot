/**
 * Bulk ATS scoring v2 — умный конвейер:
 * 1. Быстрый токен-фильтр (без LLM) по сниппету → топ-300 перспективных
 * 2. Обогащение описаний только для них
 * 3. Полный ATS-матчинг + Fit-анализ
 * Без откликов.
 *
 * Запуск: node --experimental-vm-modules server/src/bulk-ats.mjs
 */

import { createDb } from './db.js';
import { createBridge } from './bridge.js';
import { createSites } from './sites/index.js';
import { createLlmClient } from './core/llm.js';

const DB_PATH = process.env.DB_PATH || 'C:\\Users\\MacUniverse_IT\\AppData\\Local\\Temp\\jobfit-eval.db';
const TOP_CANDIDATES = 300;
const CONCURRENCY = 3;

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/** Быстрый токен-матчинг: какие вакансии лучше всего подходят к резюме */
function tokenScore(vacancy, resume) {
  const text = `${vacancy.title || ''} ${vacancy.company || ''} ${vacancy.snippet || ''} ${(vacancy.skills || []).join(' ')}`.toLowerCase();
  const resumeText = `${resume.text || ''} ${resume.title || ''} ${(resume.skills || []).join(' ')}`.toLowerCase();
  const tokens = resumeText.split(/[^a-zа-я0-9+#_]+/i).filter(w => w.length > 3);
  const unique = [...new Set(tokens)];
  let hits = 0;
  for (const t of unique) {
    if (text.includes(t)) hits++;
  }
  return unique.length > 0 ? hits / unique.length : 0;
}

async function main() {
  console.log('=== BULK ATS SCORING v2 ===');
  console.log(`DB: ${DB_PATH}`);

  const bridge = createBridge();
  const sites = createSites(bridge);
  const db = createDb(DB_PATH);
  const llm = createLlmClient();

  const resumes = db.listResumes();
  console.log(`Резюме: ${resumes.length}`);
  for (const r of resumes) console.log(`  [${r.id.slice(0,12)}] ${r.name}`);

  const pipeline = db.listPipeline({ status: 'found', limit: 99999 }).filter(v => Boolean(v.snippet));
  console.log(`\nВакансий со сниппетом: ${pipeline.length}`);

  // ===== ФАЗА 1: Токен-фильтр =====
  console.log('\n=== ФАЗА 1: Токен-фильтр ===');
  const scored = [];
  for (const v of pipeline) {
    let bestScore = 0;
    let bestResume = null;
    for (const r of resumes) {
      const s = tokenScore(v, r);
      if (s > bestScore) { bestScore = s; bestResume = r.id; }
    }
    scored.push({ v, bestScore, bestResume });
  }

  scored.sort((a, b) => b.bestScore - a.bestScore);
  const topCandidates = scored.slice(0, TOP_CANDIDATES);
  console.log(`Отобрано топ-${TOP_CANDIDATES} кандидатов (порог совпадения: ${topCandidates[topCandidates.length-1].bestScore.toFixed(3)})`);

  // ===== ФАЗА 2: Обогащение описаний =====
  console.log('\n=== ФАЗА 2: Обогащение описаний ===');
  const needEnrich = topCandidates.filter(c => !c.v.description);
  console.log(`Нужно обогатить: ${needEnrich.length} вакансий`);
  let enriched = 0;

  for (let i = 0; i < needEnrich.length; i++) {
    const { v } = needEnrich[i];
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
      if ((i + 1) % 20 === 0) console.log(`  Обогащено: ${enriched}/${needEnrich.length}`);
      await sleep(600);
    } catch (err) {
      console.error(`  Ошибка обогащения ${v.key}: ${err.message}`);
      await sleep(2000);
    }
  }
  console.log(`Обогащено: ${enriched} вакансий`);

  // ===== ФАЗА 3: ATS-матчинг =====
  console.log('\n=== ФАЗА 3: ATS-матчинг + Fit-анализ ===');
  const readyToScore = topCandidates.filter(c => {
    const fresh = db.getVacancy(c.v.key);
    return fresh && Boolean(fresh.description);
  });
  console.log(`Готово к скорингу: ${readyToScore.length} вакансий`);

  if (readyToScore.length === 0) { console.log('Нет вакансий для скоринга.'); return; }

  let drafted = 0, skipped = 0, errors = 0;
  const bestMatches = [];

  for (let i = 0; i < readyToScore.length; i += CONCURRENCY) {
    const batch = readyToScore.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async ({ v }) => {
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

    if ((i + CONCURRENCY) % 30 === 0 || i + CONCURRENCY >= readyToScore.length) {
      console.log(`  Прогресс: ${Math.min(i + CONCURRENCY, readyToScore.length)}/${readyToScore.length} | drafted: ${drafted} | skipped: ${skipped} | errors: ${errors}`);
    }
    await sleep(300);
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
    console.log(`${String(i+1).padStart(3)}. | ${(m.title||'').slice(0,45).padEnd(45)} | ${(m.company||'').slice(0,20).padEnd(20)} | ${(m.salary||'').slice(0,15).padEnd(15)} | ${(m.resume||'').slice(0,22).padEnd(22)} | ${m.fitScore}`);
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
    console.log(`  ${name.padEnd(30)} — ${data.count} совпадений, средний Fit: ${avg}`);
  }

  console.log('\nГотово! Лучшие совпадения видны в веб-панели (статус: drafted).');
}

main().catch(err => { console.error('Ошибка:', err); process.exit(1); });
