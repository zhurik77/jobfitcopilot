// Клиент для подключения к локальному OpenAI-совместимому прокси FastAPI_CDEKLLM.
// Позволяет серверу автономно выполнять тяжелые LLM-задачи (ATS-матчинг, Fit-анализ,
// генерацию писем без клише и ответы на вопросы работодателя) без внешних платных API.
import { PROMPTS, letterPrompt } from './prompts.js';
import { lintLetter } from './letter-lint.js';
import { computeFitScore, rankResumeMatches } from './scoring.js';

export class LlmError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

/**
 * Создаёт клиент для взаимодействия с FastAPI_CDEKLLM.
 * @param {{
 *   baseUrl?: string,
 *   model?: string,
 *   apiKey?: string,
 *   fetchImpl?: typeof fetch,
 *   timeoutMs?: number
 * }} opts
 */
export function createLlmClient({
  baseUrl = process.env.CDEK_LLM_URL ?? process.env.OPENAI_BASE_URL ?? 'http://127.0.0.1:8000/v1',
  model = process.env.CDEK_LLM_MODEL ?? 'yandex/deepseek-v4.1-flash',
  apiKey = process.env.CDEK_LLM_API_KEY ?? 'dummy',
  fetchImpl = fetch,
  timeoutMs = 120000,
} = {}) {
  // Убираем хвостовой слеш
  const root = baseUrl.replace(/\/+$/, '');

  /** Вспомогательный запрос к эндпоинту чат-комплишенов */
  async function chatCompletion({ messages, temperature = 0.2, maxTokens = 2000, jsonMode = false }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const body = {
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
      };

      if (jsonMode) {
        body.response_format = { type: 'json_object' };
      }

      const res = await fetchImpl(`${root}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text();
        throw new LlmError('cdek_llm_http_error', `FastAPI_CDEKLLM вернул HTTP ${res.status}: ${text}`);
      }

      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content;
      if (!content) {
        throw new LlmError('cdek_llm_empty_response', 'FastAPI_CDEKLLM вернул пустой ответ');
      }

      return content.trim();
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new LlmError('cdek_llm_timeout', `Таймаут запроса к FastAPI_CDEKLLM (${timeoutMs} мс)`);
      }
      if (err instanceof LlmError) throw err;
      throw new LlmError('cdek_llm_connection_failed', `Не удалось подключиться к FastAPI_CDEKLLM (${root}): ${err.message}`);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Извлекает валидный JSON даже если модель вернула markdown-обёртку ```json ... ``` */
  function parseJsonSafely(raw) {
    let clean = raw.trim();
    const match = clean.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (match) clean = match[1].trim();

    try {
      return JSON.parse(clean);
    } catch (err) {
      throw new LlmError('json_parse_error', `LLM вернула невалидный JSON: ${err.message}\nОтвет:\n${clean}`);
    }
  }

  /** Проверка статуса прокси CDEK */
  async function status() {
    try {
      // Пытаемся дёрнуть /health на родителе или /models
      const healthUrl = root.endsWith('/v1') ? root.replace(/\/v1$/, '/health') : `${root}/health`;
      const res = await fetchImpl(healthUrl, { method: 'GET' });
      if (res.ok) {
        const data = await res.json();
        return { connected: true, baseUrl: root, model, details: data };
      }
      // Фоллбек на список моделей
      const modelsRes = await fetchImpl(`${root}/models`, {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      });
      return { connected: modelsRes.ok, baseUrl: root, model, modelsStatus: modelsRes.status };
    } catch (err) {
      return { connected: false, baseUrl: root, model, error: err.message };
    }
  }

  /** ATS-сопоставление одного резюме с вакансией */
  async function matchAts({ vacancyText, resumeText }) {
    const prompt = `${PROMPTS.ats}\n\nВАКАНСИЯ:\n${vacancyText}\n\nРЕЗЮМЕ КАНДИДАТА:\n${resumeText}\n\nВерни ТОЛЬКО валидный JSON в указанном формате:`;
    const reply = await chatCompletion({
      messages: [
        { role: 'system', content: PROMPTS.ats },
        { role: 'user', content: `Сравни резюме с вакансией:\n\nВАКАНСИЯ:\n${vacancyText}\n\nРЕЗЮМЕ:\n${resumeText}` }
      ],
      temperature: 0.1,
      jsonMode: true,
    });
    return parseJsonSafely(reply);
  }

  /** Глубокий технический и смысловой ATS-аудит резюме */
  async function auditResume({ resumeText }) {
    const trimmed = resumeText.slice(0, 4500);
    const reply = await chatCompletion({
      messages: [
        {
          role: 'system',
          content: `Ты — эксперт по ATS и техническому рекрутингу на hh.ru.
Проведи глубокий технический аудит резюме кандидата.
Оцени по 4 критериям (0-100):
- keyword_match_score (35%)
- structure_score (20%)
- experience_relevance_score (25%)
- metrics_density_score (20%)
Вычисли взвешенный overall_ats_score.
Верни ТОЛЬКО валидный JSON без markdown:
{
  "overall_ats_score": 85,
  "score_breakdown": {
    "keyword_match_score": 85,
    "structure_score": 80,
    "experience_relevance_score": 85,
    "metrics_density_score": 90
  },
  "strengths": ["...", "..."],
  "gaps": ["..."],
  "top_recommendations": ["..."]
}`
        },
        { role: 'user', content: `Проведи аудит резюме кандидата:\n\n${trimmed}` }
      ],
      temperature: 0.1,
      maxTokens: 1000,
      jsonMode: true,
    });
    return parseJsonSafely(reply);
  }

  /** Fit-анализ вакансии по резюме */
  async function analyzeFit({ vacancyText, resumeText }) {
    const reply = await chatCompletion({
      messages: [
        { role: 'system', content: PROMPTS.fit },
        { role: 'user', content: `Оцени соответствие:\n\nВАКАНСИЯ:\n${vacancyText}\n\nРЕЗЮМЕ:\n${resumeText}` }
      ],
      temperature: 0.1,
      jsonMode: true,
    });
    return parseJsonSafely(reply);
  }

  /** Генерация сопроводительного письма с автоматическим исправлением ошибок линтера */
  async function generateLetter({ vacancyText, resumeText, lang = 'ru', tone = 'neutral', maxLintAttempts = 2 }) {
    const systemPrompt = letterPrompt(lang, tone);
    const messages = [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `Напиши сопроводительное письмо строго по правилам.\n\nВАКАНСИЯ:\n${vacancyText}\n\nРЕЗЮМЕ КАНДИДАТА:\n${resumeText}\n\nФормат ответа:\nСначала блок плана:\nПЛАН:\n1. ...\n2. ...\n\nЗатем текст письма:\nТЕКСТ:\n...`
      }
    ];

    let lastText = '';
    let lastPlan = '';
    let lastLint = null;

    for (let attempt = 1; attempt <= maxLintAttempts; attempt++) {
      const raw = await chatCompletion({ messages, temperature: 0.3 + (attempt * 0.1) });

      // Разделение плана и текста
      const planMatch = raw.match(/ПЛАН:\s*([\s\S]*?)(?=ТЕКСТ:|$)/i);
      const textMatch = raw.match(/ТЕКСТ:\s*([\s\S]*)/i);

      lastPlan = planMatch ? planMatch[1].trim() : 'Автоматический план';
      lastText = textMatch ? textMatch[1].trim() : raw.trim();

      lastLint = lintLetter(lastText, { lang });

      if (lastLint.ok) {
        return { plan: lastPlan, text: lastText, lint: lastLint, attempts: attempt };
      }

      // Если линтер нашёл ошибки, передаём их модели для самокоррекции
      const errorList = lastLint.issues
        .filter(i => i.severity === 'error')
        .map(i => `- ${i.rule}: ${i.message} (фрагмент: "${i.excerpt || ''}")`)
        .join('\n');

      messages.push({ role: 'assistant', content: raw });
      messages.push({
        role: 'user',
        content: `Письмо не прошло проверку качества. Исправь следующие ошибки и верни исправленный ТЕКСТ (120-180 слов, без клише, без формулировок выводов за читателя):\n${errorList}`
      });
    }

    return { plan: lastPlan, text: lastText, lint: lastLint, attempts: maxLintAttempts, needsManualReview: !lastLint.ok };
  }

  /** Ответы на вопросы работодателя из формы отклика на основе резюме */
  async function answerQuestions({ questions, resumeText, vacancyText }) {
    if (!questions || questions.length === 0) return [];

    const questionsFormatted = questions.map(q => {
      let desc = `ID: "${q.id}", Вопрос: "${q.text}", Тип: ${q.kind}`;
      if (q.kind === 'choice' && q.options) {
        desc += `, Варианты: [${q.options.map(o => `value: "${o.value}", label: "${o.label}"`).join('; ')}]`;
        if (q.allowsOwn) desc += ` (разрешён свой вариант: value "open")`;
      }
      return desc;
    }).join('\n');

    const prompt = `Ты заполняешь анкету работодателя для отклика на вакансию.
Опирайся СТРОГО на факты из резюме. Не придумывай того, чего в резюме нет.

РЕЗЮМЕ:
${resumeText}

ВАКАНСИЯ:
${vacancyText}

ВОПРОСЫ РАБОТОДАТЕЛЯ:
${questionsFormatted}

Верни JSON-массив с ответами вида:
[
  { "id": "идентификатор_вопроса", "text": "ответ для текстового вопроса" },
  { "id": "идентификатор_вопроса", "values": ["value_выбранного_варианта"] },
  { "id": "идентификатор_вопроса", "values": ["open"], "own": "свой вариант ответа" }
]
Если в резюме нет ответа на вопрос (например, зарплатные ожидания или точная дата выхода), оставь ответ пустым: { "id": "...", "text": "" }.`;

    const reply = await chatCompletion({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      jsonMode: true,
    });

    const parsed = parseJsonSafely(reply);
    return Array.isArray(parsed) ? parsed : (parsed.answers || []);
  }

  /** Комплексный автономный аудит и обработка вакансии через FSM */
  async function processVacancyWorkflow({ vacancy, resumes, db }) {
    const key = vacancy.key;
    const desc = vacancy.description || [vacancy.snippet, (vacancy.skills || []).join(', ')].filter(Boolean).join('\n') || '';
    const vacancyText = `Должность: ${vacancy.title}\nКомпания: ${vacancy.company || ''}\nОпыт: ${vacancy.experience || ''}\nЗарплата: ${vacancy.salary || ''}\nСтек и требования:\n${desc}`;

    // Глубокий интеллектуальный отбор пула резюме для ATS-матчинга
    // Извлекаем ключевые смысловые токены из вакансии (заголовок, стек, сниппет)
    const searchTokens = `${vacancy.title || ''} ${vacancy.snippet || ''} ${(vacancy.skills || []).join(' ')}`
      .toLowerCase()
      .split(/[^a-zа-я0-9+#_]+/i)
      .filter((w) => w.length > 2);

    const scoredCandidates = [...resumes].filter(r => r.text).map((r) => {
      const rLower = (r.text + ' ' + (r.title || r.name || '')).toLowerCase();
      let overlap = 0;
      for (const token of searchTokens) {
        if (rLower.includes(token)) overlap += 1;
      }
      return { resume: r, overlap };
    }).sort((a, b) => b.overlap - a.overlap);

    // Берём топ-3 наиболее релевантных резюме для глубокого LLM ATS-разбора
    const candidatePool = scoredCandidates.slice(0, 3).map((sc) => sc.resume);

    // 1. ATS Matching с кандидатами
    const scoredResumes = [];
    for (const r of candidatePool) {
      const resumeSnippet = r.text.slice(0, 5000);
      const atsResult = await matchAts({ vacancyText, resumeText: resumeSnippet });
      const overall = Number(atsResult.overall_match_score ?? 0);
      db.saveAnalysis({
        vacancyKey: key,
        resumeId: r.id,
        kind: 'ats',
        score: overall,
        verdict: overall >= 70 ? 'strong_match' : overall >= 50 ? 'moderate_match' : 'weak_match',
        payload: atsResult,
      });
      scoredResumes.push({ resumeId: r.id, name: r.name, result: atsResult });
    }

    if (scoredResumes.length === 0) {
      throw new LlmError('no_resumes', 'Нет резюме с текстом для сопоставления');
    }

    // 2. Ранжирование и выбор лучшего резюме
    const ranked = rankResumeMatches(scoredResumes);
    const best = ranked[0];
    const chosenResume = resumes.find(r => r.id === best.resumeId);

    // 3. Fit Analysis с лучшим резюме
    const fitResult = await analyzeFit({ vacancyText, resumeText: chosenResume.text.slice(0, 5000) });
    const fitScore = computeFitScore(fitResult);
    db.saveAnalysis({
      vacancyKey: key,
      resumeId: chosenResume.id,
      kind: 'fit',
      score: fitScore,
      verdict: fitResult.verdict ?? (fitScore >= 65 ? 'ОТКЛИКАТЬСЯ' : 'ПРОПУСТИТЬ'),
      payload: fitResult,
    });

    // Если вердикт «ПРОПУСТИТЬ» — сразу отправляем в skipped
    if (fitResult.verdict === 'ПРОПУСТИТЬ' || fitScore < 45) {
      db.setStatus(key, 'skipped', `Fit score ${fitScore}: ${fitResult.verdict || 'низкое соответствие'}`);
      return { status: 'skipped', key, fitScore, resumeId: chosenResume.id };
    }

    // Назначаем выбранное резюме и переводим в scored
    db.setChoice(key, { resumeId: chosenResume.id });
    db.setStatus(key, 'scored', `Выбрано резюме «${chosenResume.name}» (ATS: ${best.result.hard_requirements_coverage_percent ?? 0}%)`);

    // 4. Генерация письма
    const letterGen = await generateLetter({ vacancyText, resumeText: chosenResume.text.slice(0, 5000) });
    const savedLetter = db.saveLetter({
      vacancyKey: key,
      resumeId: chosenResume.id,
      lang: 'ru',
      plan: letterGen.plan,
      text: letterGen.text,
      lint: letterGen.lint,
    });
    db.setChoice(key, { letterId: savedLetter.id });
    db.setStatus(key, 'drafted', `Письмо подготовлено (слов: ${letterGen.lint?.stats?.words ?? 0}, ошибки: ${letterGen.lint?.ok ? 'нет' : 'есть'})`);

    return {
      status: 'drafted',
      key,
      chosenResume: chosenResume.name,
      fitScore,
      letterId: savedLetter.id,
      lintOk: letterGen.lint?.ok ?? false,
    };
  }

  return {
    status,
    chatCompletion,
    auditResume,
    matchAts,
    analyzeFit,
    generateLetter,
    answerQuestions,
    processVacancyWorkflow,
  };
}
