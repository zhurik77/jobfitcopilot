// Клиент для подключения к OpenAI-совместимому LLM-ендпоинту.
// Позволяет серверу автономно выполнять тяжелые LLM-задачи (ATS-матчинг, Fit-анализ,
// генерацию писем без клише и ответы на вопросы работодателя) через кастомный endpoint.
import { PROMPTS, letterPrompt } from './prompts.js';
import { lintLetter } from './letter-lint.js';
import { computeFitScore, rankResumeMatches } from './scoring.js';

export class LlmError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'LlmError';
    this.code = code;
    this.details = details;
  }
}

export function createLlmClient({
  baseUrl = process.env.CUSTOM_LLM_URL ?? process.env.OPENAI_BASE_URL ?? 'http://127.0.0.1:8000/v1',
  model = process.env.CUSTOM_LLM_MODEL ?? 'gpt-4o-mini',
  apiKey = process.env.CUSTOM_LLM_API_KEY ?? '',
  fetchImpl = fetch,
  timeoutMs = 120000,
  monitor,
} = {}) {
  // Убираем хвостовой слеш
  const root = baseUrl.replace(/\/+$/, '');

  /** Вспомогательный запрос к эндпоинту чат-комплишенов */
  async function chatCompletion({ messages, temperature = 0.2, maxTokens = 2000, jsonMode = false }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const startTime = Date.now();

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
        if (monitor) monitor.recordLlmError();
        throw new LlmError('llm_http_error', `HTTP ${res.status} от LLM: ${text}`);
      }

      const data = await res.json();
      const duration = Date.now() - startTime;
      const tokens = data?.usage?.total_tokens || 0;
      if (monitor) monitor.recordLlmCall(duration, tokens);

      const content = data?.choices?.[0]?.message?.content;
      if (!content) {
        throw new LlmError('llm_empty_response', 'LLM вернул пустой ответ');
      }

      return content.trim();
    } catch (err) {
      if (err.name === 'AbortError') {
        if (monitor) monitor.recordLlmError();
        throw new LlmError('llm_timeout', `Таймаут запроса к LLM (${timeoutMs} мс)`);
      }
      if (err instanceof LlmError) {
        if (!err.message.startsWith('LLM вернул пустой') && !err.message.startsWith('LLM вернула невалидный')) {
          if (monitor) monitor.recordLlmError();
        }
        throw err;
      }
      if (monitor) monitor.recordLlmError();
      throw new LlmError('llm_connection_failed', `Не удалось подключиться к LLM (${root}): ${err.message}`);
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

  /** ATS-аудит резюме: ключевые слова, структура, опыт, метрики */
  async function auditResume(resumeText) {
    const raw = await chatCompletion({
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
  "keyword_match_score": 90,
  "structure_score": 70,
  "experience_relevance_score": 85,
  "metrics_density_score": 80,
  "strengths": ["...", "..."],
  "weaknesses": ["...", "..."],
  "recommendations": ["...", "..."]
}`
        },
        { role: 'user', content: `Проведи ATS-аудит этого резюме:\n\n${resumeText}` }
      ],
      temperature: 0.1,
      maxTokens: 2000,
      jsonMode: true,
    });

    return parseJsonSafely(raw);
  }

  /** ATS-матчинг: сравнение резюме с требованиями вакансии */
  async function matchAts(resumeText, vacancyText) {
    const raw = await chatCompletion({
      messages: [
        {
          role: 'system',
          content: PROMPTS.atsMatch
        },
        { role: 'user', content: `ВАКАНСИЯ:\n${vacancyText}\n\nРЕЗЮМЕ:\n${resumeText}` }
      ],
      temperature: 0.1,
      maxTokens: 3000,
      jsonMode: true,
    });

    return parseJsonSafely(raw);
  }

  /** Анализ соответствия: насколько кандидат подходит под вакансию */
  async function analyzeFit(resumeText, vacancyText) {
    const raw = await chatCompletion({
      messages: [
        {
          role: 'system',
          content: PROMPTS.fitCheck
        },
        { role: 'user', content: `ВАКАНСИЯ:\n${vacancyText}\n\nРЕЗЮМЕ:\n${resumeText}` }
      ],
      temperature: 0.1,
      maxTokens: 3000,
      jsonMode: true,
    });

    return parseJsonSafely(raw);
  }

  /** Генерация сопроводительного письма с линтингом и повторными попытками */
  async function generateLetter({ vacancyText, resumeText, lang = 'ru', tone = 'confident', maxLintAttempts = 3 }) {
    const messages = [
      {
        role: 'system',
        content: letterPrompt(lang, tone)
      },
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

      const planMatch = raw.match(/ПЛАН:\s*([\s\S]*?)(?=ТЕКСТ:|$)/);
      const textMatch = raw.match(/ТЕКСТ:\s*([\s\S]*)/);

      lastPlan = planMatch ? planMatch[1].trim() : '';
      lastText = textMatch ? textMatch[1].trim() : raw.trim();
      lastLint = lintLetter(lastText);

      if (lastLint.ok) break;
    }

    return { text: lastText, plan: lastPlan, lint: lastLint };
  }

  /** Ответы на вопросы работодателя */
  async function answerQuestions({ vacancy, resumeText }) {
    const form = vacancy.form;
    if (!form?.questions?.length) return [];

    const questionsText = form.questions.map((q, i) => {
      const options = q.options?.length ? `\n  Варианты: ${q.options.join(', ')}` : '';
      const multiple = q.multiple ? ' (можно несколько)' : '';
      return `${i + 1}. [${q.id}] ${q.title}${options}${multiple}`;
    }).join('\n');

    const raw = await chatCompletion({
      messages: [
        {
          role: 'system',
          content: `Ты — помощник по заполнению форм отклика на вакансии.
Ответь на вопросы работодателя на основе резюме кандидата.
Для каждого вопроса верни объект с id и текстом ответа (или values для выбора).
Если вопрос с выбором — выбери наиболее подходящий вариант.
Верни JSON-массив: [{ "id": "q1", "text": "..." }]`
        },
        {
          role: 'user',
          content: `Вакансия: ${vacancy.title}\nКомпания: ${vacancy.company}\n\nВопросы:\n${questionsText}\n\nРезюме:\n${resumeText}`
        }
      ],
      temperature: 0.1,
      maxTokens: 2000,
      jsonMode: true,
    });

    return parseJsonSafely(raw);
  }

  /** Полный конвейер обработки вакансии */
  async function processVacancyWorkflow({ vacancy, resumes, db }) {
    const key = vacancy.key;
    const status = vacancy.status;
    const vacancyText = vacancy.description;

    if (!vacancyText) {
      return { status: 'no_description', key };
    }

    // ATS-матчинг всех резюме
    const matchResults = [];
    for (const resume of resumes) {
      try {
        const match = await matchAts(resume.text, vacancyText);
        const score = computeFitScore(match);
        matchResults.push({ resumeId: resume.id, name: resume.name, result: match, score });
      } catch (err) {
        console.warn(`[llm] matchAts failed for ${resume.name}: ${err.message}`);
      }
    }

    if (matchResults.length === 0) {
      return { status: 'no_match', key };
    }

    // Выбор лучшего резюме
    const ranked = rankResumeMatches(matchResults);
    const chosen = ranked[0];
    const fitScore = chosen.score;

    // Генерация письма
    const letterGen = await generateLetter({
      vacancyText,
      resumeText: resumes.find(r => r.id === chosen.resumeId)?.text || '',
    });

    // Сохранение результатов
    db.setStatus(key, 'scored');
    db.setChoice(key, chosen.resumeId, null);

    if (letterGen.text) {
      const savedLetter = db.saveLetter({
        vacancyKey: key,
        resumeId: chosen.resumeId,
        text: letterGen.text,
        plan: letterGen.plan,
        lint: letterGen.lint
      });

      db.setStatus(key, 'drafted');
      db.setChoice(key, chosen.resumeId, savedLetter.id);

      console.log(`[llm] Вакансия ${key}: письмо сгенерировано (ошибки: ${letterGen.lint?.ok ? 'нет' : 'есть'})`);

      return {
        status: 'drafted',
        key,
        chosenResume: chosen.name,
        fitScore,
        letterId: savedLetter.id,
        lintOk: letterGen.lint?.ok ?? false,
      };
    }

    return {
      status: 'no_letter',
      key,
      chosenResume: chosen.name,
      fitScore,
    };
  }

  /** Проверка доступности LLM-эндпоинта */
  async function status() {
    try {
      const res = await fetchImpl(`${root}/health`, {
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const data = await res.json();
        return { ok: true, model, details: data };
      }
      return { ok: false, model, status: res.status };
    } catch (err) {
      return { ok: false, model, error: err.message };
    }
  }

  return {
    chatCompletion,
    auditResume,
    matchAts,
    analyzeFit,
    generateLetter,
    answerQuestions,
    processVacancyWorkflow,
    status,
  };
}
