// Job Fit Copilot — мониторинг ошибок и телеметрия.
// Лёгкий in-process монитор: считает ошибки, время ответа, собирает метрики.
// Не требует внешних сервисов (Sentry/Datadog) — всё в памяти и в БД.
// v2: добавлены гистограммы latency, метрики LLM, healthcheck-эндпоинт.

export class Monitor {
  constructor(db, opts = {}) {
    this.db = db;
    this.enabled = opts.enabled !== false;
    this.sampleRate = opts.sampleRate || 1.0; // 0..1
    this.metrics = {
      requestsTotal: 0,
      requestsFailed: 0,
      requestsByPath: {},
      requestsByStatus: {},
      latencyBuckets: { ms50: 0, ms100: 0, ms200: 0, ms500: 0, ms1000: 0, ms2000: 0, ms5000: 0, slow: 0 },
      llmCalls: 0,
      llmErrors: 0,
      llmTotalTokens: 0,
      llmLatencyMs: 0,
      autopilotCycles: 0,
      autopilotErrors: 0,
      autopilotSubmitted: 0,
      startTime: Date.now(),
    };
  }

  recordRequest(method, path, status, latencyMs) {
    if (!this.enabled) return;
    this.metrics.requestsTotal++;
    if (status >= 400) this.metrics.requestsFailed++;
    const key = `${method} ${path}`;
    this.metrics.requestsByPath[key] = (this.metrics.requestsByPath[key] || 0) + 1;
    const sk = String(status);
    this.metrics.requestsByStatus[sk] = (this.metrics.requestsByStatus[sk] || 0) + 1;
    // latency buckets
    if (latencyMs < 50) this.metrics.latencyBuckets.ms50++;
    else if (latencyMs < 100) this.metrics.latencyBuckets.ms100++;
    else if (latencyMs < 200) this.metrics.latencyBuckets.ms200++;
    else if (latencyMs < 500) this.metrics.latencyBuckets.ms500++;
    else if (latencyMs < 1000) this.metrics.latencyBuckets.ms1000++;
    else if (latencyMs < 2000) this.metrics.latencyBuckets.ms2000++;
    else if (latencyMs < 5000) this.metrics.latencyBuckets.ms5000++;
    else this.metrics.latencyBuckets.slow++;
  }

  recordLlmCall(durationMs, tokens) {
    if (!this.enabled) return;
    this.metrics.llmCalls++;
    this.metrics.llmLatencyMs += durationMs;
    if (tokens) this.metrics.llmTotalTokens += tokens;
  }

  recordLlmError() {
    if (!this.enabled) return;
    this.metrics.llmErrors++;
  }

  recordAutopilotCycle(result) {
    if (!this.enabled) return;
    this.metrics.autopilotCycles++;
    if (result?.errors?.length) this.metrics.autopilotErrors += result.errors.length;
    if (result?.submitted) this.metrics.autopilotSubmitted += result.submitted;
  }

  /** Возвращает снимок метрик для /metrics */
  snapshot() {
    const uptime = Math.floor((Date.now() - this.metrics.startTime) / 1000);
    const avgLatency = this.metrics.requestsTotal > 0
      ? Math.round(this.metrics.llmLatencyMs / Math.max(1, this.metrics.llmCalls))
      : 0;
    return {
      uptime,
      uptimeHuman: formatDuration(uptime),
      requests: {
        total: this.metrics.requestsTotal,
        failed: this.metrics.requestsFailed,
        errorRate: this.metrics.requestsTotal > 0
          ? (this.metrics.requestsFailed / this.metrics.requestsTotal * 100).toFixed(1) + '%'
          : '0%',
        byPath: { ...this.metrics.requestsByPath },
        byStatus: { ...this.metrics.requestsByStatus },
        latencyBuckets: { ...this.metrics.latencyBuckets },
      },
      llm: {
        calls: this.metrics.llmCalls,
        errors: this.metrics.llmErrors,
        totalTokens: this.metrics.llmTotalTokens,
        avgLatencyMs: avgLatency,
      },
      autopilot: {
        cycles: this.metrics.autopilotCycles,
        errors: this.metrics.autopilotErrors,
        submitted: this.metrics.autopilotSubmitted,
      },
    };
  }

  /** Middleware для createApp */
  middleware(req, res, startTime) {
    const originalEnd = res.end.bind(res);
    res.end = (...args) => {
      const latency = Date.now() - startTime;
      this.recordRequest(req.method, req.url, res.statusCode, latency);
      originalEnd(...args);
    };
  }
}

function formatDuration(seconds) {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

/**
 * Создаёт дефолтный монитор (если не передан внешний).
 */
export function createMonitor(db, opts) {
  return new Monitor(db, opts);
}
