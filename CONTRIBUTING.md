# Contributing to Job Fit Copilot

Спасибо за интерес к проекту! Мы рады любой помощи: от баг-репортов и идей до
кода и переводов.

## 🐛 Баги и идеи

- Открывайте [issue](https://github.com/zhurik77/jobfitcopilot/issues/new/choose),
  выбрав шаблон.
- Если сомневаетесь — просто опишите проблему в свободной форме, это лучше,
  чем ничего.

## 🧑‍💻 Код

1. Форкните репозиторий.
2. Создайте ветку от `master`: `git checkout -b feature/my-feature`.
3. Установите зависимости: `npm install` (сервер) и `cd site && npm install` (панель).
4. Запустите тесты: `npm test` — все должны быть зелёными.
5. Сделайте изменения, напишите тесты.
6. Запустите `npm run lint` — строгий проход.
7. Сделайте PR в `master`.

### Code Review Checklist

- [ ] Нет мёртвого кода, закомментированных блоков, `console.log` в production
- [ ] Все новые функции покрыты тестами (node:test + node:assert/strict)
- [ ] Обработка ошибок: осмысленные сообщения, не голые `throw e`
- [ ] Нет SQL-инъекций — все запросы через параметризованные `db.prepare()`
- [ ] Нет утечки чувствительных данных в ответах API
- [ ] Асинхронные операции имеют try/catch с логированием
- [ ] null/undefined проверены на границах

### Conventional Commits

Проект использует [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(llm): add DeepSeek ATS review integration
fix(api): handle empty resume list in ranking
docs(readme): add architecture diagram
test(scoring): add boundary value tests
refactor(db): extract migration logic
```

Типы: `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `ci`, `chore`.

### Dev окружение

```bash
# Сервер
cd server
npm install
npm run dev  # hot-reload через --watch

# Веб-панель
cd site
npm install
npm run dev  # Vite dev server

# Тесты
npm test              # все тесты
node --test test/xxx  # конкретный файл
```

## 📝 Стиль кода

- ES-модули (`import`/`export`), без CommonJS.
- `node:test` + `node:assert/strict` — без тестовых фреймворков.
- Имена функций — camelCase, константы — UPPER_SNAKE_CASE.
- Обработка ошибок: выбрасывать только осмысленные сообщения, не голые `throw e`.

## 📝 Переводы

README и документация — на русском. Перевод на английский приветствуется:
`README.en.md` или PR в `docs/`.

## 📬 Связь

- Issues на GitHub
- Telegram: [@jobfitcopilot_chat](https://t.me/jobfitcopilot_chat)
- Email: macuniverse.it@gmail.com
