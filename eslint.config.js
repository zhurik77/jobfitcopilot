// Гейт, которого не хватало: до v0.4.5 единственной автоматической проверкой
// был `node --check`, а он видит только синтаксис. Из-за этого в релиз уехали
// вызовы buildAtsAuditReportHtml/buildAnalyticsReportHtml, которых не
// существовало, и ReferenceError на ensureSavedResumes в options.js.
// Правило no-undef ловит ровно этот класс ошибок.

// Проглоченная ошибка в catch и `_`-заглушка в деструктуризации — осознанный
// приём в этом коде (сетевые сбои и необязательные поля), а не забытые переменные.

const UNUSED_VARS = {
  args: 'none',
  caughtErrors: 'none',
  ignoreRestSiblings: true,
  varsIgnorePattern: '^_',
};

// Один общий набор глобалов: расширение и сервер используют пересекающиеся
// окружения (fetch/URL/Blob есть и в Chrome, и в Node 18+), а лишние глобалы
// в no-undef ничего не ломают — правило ловит только обращения к несуществующим.
// Собранные бандлы (docs/assets, server/public) из линта исключены.
export default [
  {
    ignores: [
      'docs/assets/**',
      'server/public/**',
      'site/**',
      'node_modules/**',
      'server/node_modules/**',
      'dist/**',
      'graphify-out/**',
    ],
  },
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        chrome: 'readonly',
        require: 'readonly',
        module: 'writable',
        process: 'readonly',
        console: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        globalThis: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        queueMicrotask: 'readonly',
        structuredClone: 'readonly',
        fetch: 'readonly',
        Blob: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        Headers: 'readonly',
        Request: 'readonly',
        Response: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
        AbortController: 'readonly',
        performance: 'readonly',
        crypto: 'readonly',
        document: 'readonly',
        window: 'readonly',
        navigator: 'readonly',
        location: 'readonly',
        history: 'readonly',
        matchMedia: 'readonly',
        navigation: 'readonly',
        importScripts: 'readonly',
        MutationObserver: 'readonly',
        ResizeObserver: 'readonly',
        IntersectionObserver: 'readonly',
        DOMParser: 'readonly',
        CustomEvent: 'readonly',
        Event: 'readonly',
        EventTarget: 'readonly',
        HTMLElement: 'readonly',
        Node: 'readonly',
        CSS: 'readonly',
        alert: 'readonly',
        confirm: 'readonly',
        prompt: 'readonly',
        getComputedStyle: 'readonly',
        requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly',
        localStorage: 'readonly',
        sessionStorage: 'readonly',
        indexedDB: 'readonly',
        caches: 'readonly',
        clients: 'readonly',
        self: 'readonly',
        addEventListener: 'readonly',
        removeEventListener: 'readonly',
        dispatchEvent: 'readonly',
        postMessage: 'readonly',
        onmessage: 'writable',
        FileReader: 'readonly',
        FormData: 'readonly',
        Buffer: 'readonly',
        JFC: 'readonly',
      },
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['error', UNUSED_VARS],
    },
  },
];
