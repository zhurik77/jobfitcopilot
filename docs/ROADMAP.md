# Roadmap — Job Fit Copilot

## v0.6.0 (текущий релиз)
- [x] **Docker Compose** — единый `docker-compose up` для всего стека (сервер + панель)
- [x] **Telegram/Discord бот** — бот уведомлений (`server/src/telegram.js`, long-polling)
- [x] **Multi-language support** — i18n-движок (`shared/i18n.js`), локали ru/en (`shared/locales/`)
- [x] **CI/CD improvements** — автоматический билд Chrome Extension, multi-platform Docker-образ в ghcr.io
- [x] **Error monitoring** — встроенный мониторинг (`server/src/monitor.js`, `/metrics` endpoint)
- [x] **Расширенные тесты** — 301 тест (66 panel/i18n + 235 server), 100% покрытие core-функций

## v0.7.0
- [ ] **HR Expert Review** — интеграция с экспертами HR для ручной верификации ATS-анализа
- [ ] **Habr / VC.ru статья** — публикация кейса разработки
- [ ] **Product Hunt launch** — англоязычный запуск
- [ ] **Docker Compose production** — healthcheck, backup БД, автообновление Docker-образа из ghcr.io

## v0.6.1 (следующий релиз)
- [x] **Мониторинг v2** — гистограммы latency, метрики LLM (токены, ошибки), метрики автопилота, эндпоинт 
- [x] **Тесты мониторинга** — 19 тестов edge cases для Monitor
- [ ] **Product Hunt launch** — англоязычный запуск
- [ ] **Chrome Web Store публикация** — публикация расширения
- [ ] **Habr-статья** — публикация готовой статьи
- [ ] **HR-экспертная программа** — активный набор экспертов

## v1.0.0 (Stable)
- [ ] **Плагинная система** — адаптеры для новых сайтов как внешние плагины
- [ ] **Webhook интеграции** — Zapier/Make.com для кастомных пайплайнов
- [ ] **Open source community** — 500+ звезд, 50+ форков, активный чат

## Идеи на будущее
- AI-рекомендации по улучшению резюме на основе ATS-анализа
- Автоматическое заполнение профилей на hh.ru/LinkedIn
- Интеграция с CRM для рекрутеров
- Мобильное приложение (PWA)
