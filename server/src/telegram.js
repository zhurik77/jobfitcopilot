// Job Fit Copilot — Telegram Bot: уведомления о новых вакансиях и статусах.
// Запускается как часть сервера (server/src/telegram.js) или отдельно.
// Использует long-polling (без webhook) для простоты деплоя.
import http from 'node:http';

const TELEGRAM_API = 'https://api.telegram.org/bot';

export class TelegramBot {
  constructor(token, db) {
    if (!token || token === 'YOUR_BOT_TOKEN') {
      console.warn('[telegram] No bot token configured — bot disabled');
      this.enabled = false;
      return;
    }
    this.token = token;
    this.db = db;
    this.enabled = true;
    this.offset = 0;
    this.pollTimer = null;
    this.chatIds = new Set();
  }

  /** Загружает сохранённые chat_id из БД */
  async init() {
    if (!this.enabled) return;
    try {
      const settings = await this.db.getSettings();
      if (settings && Array.isArray(settings.telegramChatIds)) {
        settings.telegramChatIds.forEach(id => this.chatIds.add(id));
      }
      console.log(`[telegram] Initialized with ${this.chatIds.size} subscribers`);
    } catch (err) {
      console.warn('[telegram] Failed to load subscribers:', err.message);
    }
  }

  /** Регистрирует новый chat_id */
  subscribe(chatId) {
    if (!this.enabled) return false;
    this.chatIds.add(chatId);
    this._persistChatIds();
    return true;
  }

  /** Отписывает chat_id */
  unsubscribe(chatId) {
    this.chatIds.delete(chatId);
    this._persistChatIds();
  }

  /** Отправляет сообщение всем подписчикам */
  async broadcast(text, opts = {}) {
    if (!this.enabled || !this.chatIds.size) return;
    const promises = [];
    for (const chatId of this.chatIds) {
      promises.push(this._sendMessage(chatId, text, opts).catch(err => {
        if (err.message && err.message.includes('403')) {
          // Бот заблокирован — отписываем
          this.chatIds.delete(chatId);
          this._persistChatIds();
        }
      }));
    }
    await Promise.allSettled(promises);
  }

  /** Отправляет уведомление о новой вакансии */
  async notifyNewVacancy(vacancy) {
    const text = [
      `🔍 *Новая вакансия найдена*`,
      `*${vacancy.title || 'Без названия'}*`,
      vacancy.company ? `🏢 ${vacancy.company}` : '',
      vacancy.salary ? `💰 ${vacancy.salary}` : '',
      vacancy.source ? `📎 ${vacancy.source}` : '',
      `\n[Открыть вакансию](${vacancy.url || vacancy.id})`,
    ].filter(Boolean).join('\n');
    await this.broadcast(text, { parse_mode: 'Markdown' });
  }

  /** Отправляет уведомление об изменении статуса */
  async notifyStatusChange(vacancy, oldStatus, newStatus) {
    const emojis = {
      found: '🔍', scored: '📊', drafted: '📝',
      awaiting_approval: '⏳', approved: '✅', sent: '📨',
      replied: '💬', invited: '🎉', rejected: '❌', skipped: '⏭️'
    };
    const text = [
      `${emojis[newStatus] || '🔄'} *Статус изменён*`,
      `*${vacancy.title || 'Без названия'}*`,
      `${vacancy.company ? '🏢 ' + vacancy.company : ''}`,
      `\`${oldStatus}\` → \`${newStatus}\``,
    ].filter(Boolean).join('\n');
    await this.broadcast(text, { parse_mode: 'Markdown' });
  }

  /** Запускает polling */
  startPolling(interval = 5000) {
    if (!this.enabled) return;
    this._poll(interval);
  }

  /** Останавливает polling */
  stop() {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  async _poll(interval) {
    try {
      const data = await this._api('getUpdates', {
        offset: this.offset,
        timeout: 30,
        allowed_updates: ['message'],
      });
      if (data.ok && Array.isArray(data.result)) {
        for (const update of data.result) {
          this.offset = update.update_id + 1;
          await this._handleUpdate(update);
        }
      }
    } catch (err) {
      console.warn('[telegram] Poll error:', err.message);
    }
    this.pollTimer = setTimeout(() => this._poll(interval), interval);
  }

  async _handleUpdate(update) {
    const msg = update.message;
    if (!msg || !msg.text) return;
    const chatId = msg.chat.id;
    const text = msg.text.trim();

    if (text === '/start') {
      this.subscribe(chatId);
      await this._sendMessage(chatId,
        '👋 *Job Fit Copilot Bot*\n\n'
        + 'Ты подписан на уведомления о новых вакансиях и изменениях статусов.\n\n'
        + 'Команды:\n'
        + '/start — подписаться\n'
        + '/stop — отписаться\n'
        + '/status — текущая статистика',
        { parse_mode: 'Markdown' }
      );
    } else if (text === '/stop') {
      this.unsubscribe(chatId);
      await this._sendMessage(chatId, '❌ Ты отписан от уведомлений.');
    } else if (text === '/status') {
      const stats = await this.db.stats();
      const msg = [
        '📊 *Статистика*',
        `Всего вакансий: ${stats.total || 0}`,
        `Активных: ${stats.active || 0}`,
        `Откликов: ${stats.sent || 0}`,
        `Приглашений: ${stats.invited || 0}`,
      ].join('\n');
      await this._sendMessage(chatId, msg, { parse_mode: 'Markdown' });
    }
  }

  async _sendMessage(chatId, text, opts = {}) {
    return this._api('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: opts.parse_mode || undefined,
      disable_web_page_preview: true,
    });
  }

  async _api(method, params) {
    const url = `${TELEGRAM_API}${this.token}/${method}`;
    const body = JSON.stringify(params);
    return new Promise((resolve, reject) => {
      const req = http.request(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`Telegram API parse error: ${data.substring(0, 200)}`));
          }
        });
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  async _persistChatIds() {
    try {
      const settings = await this.db.getSettings() || {};
      settings.telegramChatIds = [...this.chatIds];
      await this.db.updateSettings(settings);
    } catch (err) {
      console.warn('[telegram] Failed to persist chat IDs:', err.message);
    }
  }
}
