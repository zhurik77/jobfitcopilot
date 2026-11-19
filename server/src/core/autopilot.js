// Движок автономной работы (Autopilot Engine).
// Обеспечивает 95% времени фоновой работы без участия человека:
// 1. Поиск новых вакансий по расписанию
// 2. Обогащение описаний
// 3. ATS-матчинг и выбор лучшего резюме через LLM
// 4. Генерация и линтинг писем
// 5. Инспекция формы и автоответы на вопросы
// 6. Формирование очереди для 1-клик одобрения (5% времени человека)
// 7. Отправка одобренных с рандомизированной паузой и соблюдением суточных лимитов
// 8. Фоновый трекинг статусов откликов (приглашения/отказы)
import { unansweredQuestionIds } from '../api.js';

export class AutopilotEngine {
  /**
   * @param {{
   *   db: any,
   *   sites: any,
   *   bridge: any,
   *   llm: any,
   *   now?: () => number,
   *   sleep?: (ms: number) => Promise<void>
   * }} deps
   */
  constructor({ db, sites, bridge, llm, monitor, now = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
    this.db = db;
    this.sites = sites;
    this.bridge = bridge;
    this.llm = llm;
    this.monitor = monitor;
    this.now = now;
    this.sleep = sleep;

    this.timer = null;
    this.isRunning = false;
    this.isCycleRunning = false;
    this.lastRunAt = null;
    this.lastReport = null;

    // Конфигурация автопилота
    this.config = {
      enabled: false,
      intervalMin: 30,
      workHoursOnly: true,
      workHoursStart: 9,
      workHoursEnd: 20,
      batchSize: 5,
      autoSubmitApproved: true,
      minDelayJitterSec: 15, // рандомизация паузы отправки
    };
  }

  /** Проверка рабочих часов (по локальному времени) */
  isWithinWorkHours() {
    if (!this.config.workHoursOnly) return true;
    const currentHour = new Date(this.now()).getHours();
    return currentHour >= this.config.workHoursStart && currentHour < this.config.workHoursEnd;
  }

  /** Обновление настроек автопилота */
  updateConfig(patch = {}) {
    this.config = { ...this.config, ...patch };
    if (this.config.enabled && !this.isRunning) {
      this.start();
    } else if (!this.config.enabled && this.isRunning) {
      this.stop();
    }
    return this.config;
  }

  /** Статус автопилота */
  getStatus() {
    return {
      running: this.isRunning,
      isCycleRunning: this.isCycleRunning,
      config: this.config,
      isWithinWorkHours: this.isWithinWorkHours(),
      lastRunAt: this.lastRunAt,
      lastReport: this.lastReport,
    };
  }

  /** Запуск таймера автопилота */
  start() {
    if (this.timer) clearInterval(this.timer);
    this.isRunning = true;
    const intervalMs = Math.max(1, this.config.intervalMin) * 60 * 1000;
    this.timer = setInterval(() => {
      this.runCycle().catch((err) => console.error('[Autopilot] Ошибка цикла:', err));
    }, intervalMs);
    // Первый запуск в фоне
    setTimeout(() => {
      this.runCycle().catch((err) => console.error('[Autopilot] Ошибка первого запуска:', err));
    }, 1000);
  }

  /** Остановка таймера */
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isRunning = false;
  }

  /**
   * Полный рабочий такт конвейера
   * @param {{ force?: boolean }} opts
   */
  async runCycle(opts = {}) {
    if (this.isCycleRunning) {
      return { skipped: true, reason: 'cycle_already_in_progress' };
    }

    if (!opts.force && !this.isWithinWorkHours()) {
      return { skipped: true, reason: 'outside_work_hours' };
    }

    this.isCycleRunning = true;
    const report = {
      startedAt: this.now(),
      discovered: 0,
      enriched: 0,
      scored: 0,
      drafted: 0,
      queuedForApproval: 0,
      submitted: 0,
      syncedNegotiations: 0,
      alerts: [],
      errors: [],
    };

    try {
      // ФАЗА 1: Синхронизация статусов откликов с hh.ru (приглашения, отказы)
      await this._phaseSyncResponses(report);

      // ФАЗА 2: Отправка одобренных пользователем откликов (с рандомизированной паузой)
      if (this.config.autoSubmitApproved) {
        await this._phaseSubmitApproved(report);
      }

      // ФАЗА 3: Автоматический запуск сохранённых поисков
      await this._phaseRunSearches(report);

      // ФАЗА 4: Обогащение описаний вакансий (get_vacancy)
      await this._phaseEnrichVacancies(report);

      // ФАЗА 5: ATS-матчинг, выбор резюме и Fit-анализ через LLM
      await this._phaseScoreAndDraft(report);

      // ФАЗА 6: Проверка формы и перевод в awaiting_approval
      await this._phaseInspectAndQueue(report);

    } catch (err) {
      report.errors.push(`Общий сбой цикла автопилота: ${err.message}`);
    } finally {
      report.finishedAt = this.now();
      report.durationMs = report.finishedAt - report.startedAt;
      this.lastRunAt = report.finishedAt;
      this.lastReport = report;
      this.isCycleRunning = false;
    }

    if (this.monitor) this.monitor.recordAutopilotCycle(report);
    return report;
  }

  /** ФАЗА 1: Синхронизация откликов */
  async _phaseSyncResponses(report) {
    if (!this.sites?.hh?.listNegotiations) return;
    try {
      const negs = await this.sites.hh.listNegotiations();
      report.syncedNegotiations = negs.length;

      for (const neg of negs) {
        if (!neg.vacancyId) continue;
        const key = `hh.ru:${neg.vacancyId}`;
        const v = this.db.getVacancy(key);
        if (!v) continue;

        const t = String(neg.status || '').toLowerCase();
        let targetStatus = null;
        if (t.includes('приглаш') || t.includes('собесед')) {
          targetStatus = 'invited';
          report.alerts.push(`🎉 ПРИГЛАШЕНИЕ НА СОБЕСЕДОВАНИЕ: «${v.title}» в «${v.company || 'Компания'}»!`);
        } else if (t.includes('отказ')) {
          targetStatus = 'rejected';
        }

        if (targetStatus && v.status !== targetStatus) {
          this.db.setStatus(key, targetStatus, `Синхронизация hh.ru: ${neg.status}`);
          this.db.addEvent(key, 'hh_status_change', { from: v.status, to: targetStatus, statusText: neg.status });
        }
      }
    } catch (err) {
      report.errors.push(`Синхронизация откликов: ${err.message}`);
    }
  }

  /** ФАЗА 2: Отправка одобренных вакансий */
  async _phaseSubmitApproved(report) {
    const approvedList = this.db.listPipeline({ status: 'approved' }) || [];
    if (approvedList.length === 0) return;

    const settings = this.db.getSettings();
    const stats = this.db.stats();
    let sentToday = stats.sentToday || 0;

    for (const v of approvedList) {
      if (sentToday >= settings.dailyLimit) {
        report.alerts.push(`Достигнут дневной лимит отправок (${settings.dailyLimit}). Остальные ждут следующего дня.`);
        break;
      }

      const lastSent = this.db.lastSentAt();
      const baseDelayMs = (settings.minDelaySec || 45) * 1000;
      // Добавляем случайный джиттер 5..25 сек для имитации живого человека
      const jitterMs = Math.floor(Math.random() * (this.config.minDelayJitterSec || 15)) * 1000;
      const totalDelayMs = baseDelayMs + jitterMs;

      if (lastSent != null) {
        const timePassed = this.now() - lastSent;
        if (timePassed < totalDelayMs) {
          const waitMs = totalDelayMs - timePassed;
          await this.sleep(waitMs);
        }
      }

      const vacancyId = v.key.slice(v.key.indexOf(':') + 1);
      const letter = v.letterId ? this.db.getLetter(v.letterId) : null;
      const resume = v.resumeId ? this.db.getResume(v.resumeId) : null;

      if (!letter || !resume || !resume.externalId) {
        report.errors.push(`Вакансия ${v.key} одобрена, но отсутствует письмо или externalId резюме`);
        continue;
      }

      try {
        const submitRes = await this.sites.hh.submitResponse({
          vacancyId,
          resumeExternalId: resume.externalId,
          letter: letter.text,
          answers: v.answers || [],
          confirm: true,
        });

        if (submitRes?.confirmed) {
          this.db.setStatus(v.key, 'sent', 'Автопилот: отклик подтверждён');
          this.db.addEvent(v.key, 'submitted', { confirmed: true, resumeTitle: submitRes.resumeTitle });
          report.submitted++;
          sentToday++;
        } else {
          this.db.addEvent(v.key, 'submit_unconfirmed', { resumeTitle: submitRes?.resumeTitle });
          report.alerts.push(`Отправка ${v.key} не подтверждена. Требуется синхронизация.`);
        }
      } catch (err) {
        report.errors.push(`Ошибка отправки ${v.key}: ${err.message}`);
        this.db.addEvent(v.key, 'submit_failed', { error: err.message, code: err.code });
        if (['resume_hidden', 'answers_required', 'fill_mismatch'].includes(err.code)) {
          this.db.setStatus(v.key, 'awaiting_approval', `Ошибка отправки: ${err.message}`);
        }
      }
    }
  }

  /** ФАЗА 3: Выполнение сохранённых поисков */
  async _phaseRunSearches(report) {
    if (!this.sites?.hh?.search) return;
    const searches = (this.db.listSearches() || []).filter((s) => s.enabled);
    const settings = this.db.getSettings();

    for (const s of searches) {
      try {
        const res = await this.sites.hh.search({
          text: s.text,
          area: s.area || 113,
          filters: { ...s.filters, order_by: 'publication_time' }, // всегда свежие
        });

        this.db.touchSearch(s.id);

        for (const item of res.items || []) {
          // Проверка чёрного списка компаний и стоп-слов
          const emp = (item.employer || '').toLowerCase();
          const title = (item.title || '').toLowerCase();
          const inBlacklist = (settings.blacklistEmployers || []).some((b) => emp.includes(b.toLowerCase()));
          const hasStopWord = (settings.stopWords || []).some((sw) => title.includes(sw.toLowerCase()));

          if (inBlacklist || hasStopWord) continue;

          const saved = this.db.upsertVacancy({
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

          if (saved) report.discovered++;
        }
      } catch (err) {
        report.errors.push(`Поиск «${s.name}»: ${err.message}`);
      }
    }
  }

  /** ФАЗА 4: Обогащение описания */
  async _phaseEnrichVacancies(report) {
    if (!this.sites?.hh?.getVacancy) return;
    const foundList = (this.db.listPipeline({ status: 'found' }) || [])
      .filter((v) => !v.description)
      .slice(0, this.config.batchSize);

    for (const v of foundList) {
      try {
        const full = await this.sites.hh.getVacancy(v.id || v.key.slice(v.key.indexOf(':') + 1));
        if (full?.description) {
          this.db.upsertVacancy({
            source: v.source || 'hh.ru',
            id: v.id,
            description: full.description,
            skills: full.skills || [],
          });
          report.enriched++;
        }
      } catch (err) {
        report.errors.push(`Обогащение ${v.key}: ${err.message}`);
      }
    }
  }

  /** ФАЗА 5: Автономный скоринг, выбор резюме и письмо */
  async _phaseScoreAndDraft(report) {
    if (!this.llm?.processVacancyWorkflow) return;
    const readyToScore = (this.db.listPipeline({ status: 'found' }) || [])
      .filter((v) => Boolean(v.description))
      .slice(0, Math.min(3, this.config.batchSize));

    const resumes = this.db.listResumes();
    if (resumes.length === 0) return;

    for (const v of readyToScore) {
      try {
        const result = await this.llm.processVacancyWorkflow({ vacancy: v, resumes, db: this.db });
        if (result.status === 'drafted') {
          report.scored++;
          report.drafted++;
        }
      } catch (err) {
        report.errors.push(`LLM скоринг ${v.key}: ${err.message}`);
      }
    }
  }

  /** ФАЗА 6: Проверка формы и очередь на одобрение */
  async _phaseInspectAndQueue(report) {
    if (!this.sites?.hh?.inspectResponseForm) return;
    const draftedList = (this.db.listPipeline({ status: 'drafted' }) || [])
      .slice(0, this.config.batchSize);

    for (const v of draftedList) {
      const vacancyId = v.key.slice(v.key.indexOf(':') + 1);
      const resume = v.resumeId ? this.db.getResume(v.resumeId) : null;
      const letter = v.letterId ? this.db.getLetter(v.letterId) : null;

      try {
        const form = await this.sites.hh.inspectResponseForm(vacancyId, {
          resumeExternalId: resume?.externalId,
        });

        this.db.saveForm(v.key, form);

        if (form.resumeHidden) {
          report.alerts.push(`⚠️ Вакансия ${v.title}: резюме скрыто на hh.ru. Смените видимость в профиле.`);
          continue;
        }

        // Если в форме есть вопросы работодателя — пробуем автоответить через LLM
        let currentAnswers = v.answers || [];
        if (form.questions && form.questions.length > 0 && currentAnswers.length === 0 && this.llm?.answerQuestions && resume?.text) {
          const autoAnswers = await this.llm.answerQuestions({
            questions: form.questions,
            resumeText: resume.text,
            vacancyText: `${v.title}\n${v.description || ''}`,
          });
          if (autoAnswers && autoAnswers.length > 0) {
            this.db.saveAnswers(v.key, autoAnswers);
            currentAnswers = autoAnswers;
          }
        }

        const unanswered = unansweredQuestionIds(form, currentAnswers);
        if (unanswered.length === 0 && letter?.lint?.ok) {
          this.db.setStatus(v.key, 'awaiting_approval', 'Автопилот: готово к одобрению человеком');
          this.db.addEvent(v.key, 'queued_for_approval', { resumeTitle: resume?.title, letterId: letter.id });
          report.queuedForApproval++;
        } else if (unanswered.length > 0) {
          report.alerts.push(`Вакансия ${v.title}: требуется ручной ответ на вопросы работодателя (${unanswered.join(', ')})`);
        }
      } catch (err) {
        report.errors.push(`Инспекция формы ${v.key}: ${err.message}`);
      }
    }
  }
}
