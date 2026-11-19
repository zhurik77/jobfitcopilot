// Job Fit Copilot — i18n: загрузка локалей, интерполяция, переключение языка.
// Подключается через <script> в panel.html / options.html или importScripts в background.js.
// Все строки UI берутся из shared/locales/{lang}.json.
(function () {
  const STORAGE_KEY = 'jfc_lang';
  const DEFAULT_LANG = 'ru';

  /** Загруженные сообщения: { key: string } */
  let messages = {};
  let currentLang = DEFAULT_LANG;

  /**
   * Простая интерполяция: "Привет, {name}!" + { name: "Анна" } → "Привет, Анна!"
   */
  function interpolate(template, vars) {
    if (!vars) return template;
    return template.replace(/\{(\w+)\}/g, (_, key) => {
      const val = vars[key];
      return val !== undefined && val !== null ? String(val) : `{${key}}`;
    });
  }

  /**
   * Загружает файл локали и сохраняет в messages.
   * @param {string} lang — код языка ('ru', 'en')
   * @param {boolean} [persist=true] — сохранить выбор в chrome.storage.local
   */
  async function loadLocale(lang, persist = true) {
    lang = lang || DEFAULT_LANG;
    try {
      // В extension-контексте грузим через fetch(chrome.runtime.getURL)
      // В Node/тестах — через fs
      let data;
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
        const url = chrome.runtime.getURL(`shared/locales/${lang}.json`);
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        data = await resp.json();
      } else {
        // fallback для тестов / Node — синхронная заглушка
        data = {};
      }
      messages = data;
      currentLang = lang;
      if (persist && typeof chrome !== 'undefined' && chrome.storage) {
        await chrome.storage.local.set({ [STORAGE_KEY]: lang });
      }
      return data;
    } catch (err) {
      console.warn(`[i18n] Failed to load locale "${lang}":`, err.message);
      // fallback: пустой объект — код работает без перевода
      messages = {};
      currentLang = lang;
      return {};
    }
  }

  /**
   * Возвращает перевод по ключу с опциональной интерполяцией.
   * Если ключ не найден, возвращает сам ключ (видны непереведённые строки).
   * @param {string} key
   * @param {object} [vars] — переменные для подстановки
   * @returns {string}
   */
  function t(key, vars) {
    const template = messages[key];
    if (template === undefined || template === null) return key;
    return interpolate(template, vars);
  }

  /**
   * Применяет текущую локаль к DOM: проставляет data-i18n и data-i18n-placeholder.
   * Вызывается после загрузки локали и при переключении языка.
   */
  function applyToDom() {
    if (typeof document === 'undefined') return;
    // Элементы с data-i18n — заменяем textContent
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (key) el.textContent = t(key);
    });
    // Элементы с data-i18n-placeholder — заменяем placeholder
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const key = el.getAttribute('data-i18n-placeholder');
      if (key) el.placeholder = t(key);
    });
    // Элементы с data-i18n-title — заменяем title
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
      const key = el.getAttribute('data-i18n-title');
      if (key) el.title = t(key);
    });
    // Элементы с data-i18n-value — заменяем value
    document.querySelectorAll('[data-i18n-value]').forEach(el => {
      const key = el.getAttribute('data-i18n-value');
      if (key) el.value = t(key);
    });
  }

  /**
   * Переключает язык и обновляет DOM.
   * @param {string} lang
   */
  async function setLanguage(lang) {
    await loadLocale(lang);
    applyToDom();
    // Dispatch custom event для динамических компонентов
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('jfc:langchange', { detail: { lang: currentLang } }));
    }
  }

  /** Возвращает текущий код языка */
  function getLanguage() {
    return currentLang;
  }

  /**
   * Инициализация: загружаем сохранённый язык или авто-определяем.
   */
  async function init() {
    let lang = DEFAULT_LANG;
    try {
      if (typeof chrome !== 'undefined' && chrome.storage) {
        const stored = await chrome.storage.local.get(STORAGE_KEY);
        if (stored[STORAGE_KEY]) lang = stored[STORAGE_KEY];
      }
    } catch (_) { /* ignore */ }
    await loadLocale(lang, false);
    applyToDom();
    // Навешиваем слушатель на select языка, если есть
    if (typeof document !== 'undefined') {
      const sel = document.getElementById('opt-lang');
      if (sel && !sel.dataset.i18nInit) {
        sel.dataset.i18nInit = '1';
        sel.addEventListener('change', () => setLanguage(sel.value));
      }
    }
    return currentLang;
  }

  // Экспорт в globalThis
  globalThis.JFC_I18N = { t, init, setLanguage, getLanguage, loadLocale, applyToDom, interpolate };

  // Авто-инициализация после загрузки DOM
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  }
})();
