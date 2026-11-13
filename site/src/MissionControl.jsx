import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  Briefcase,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock,
  Copy,
  Cpu,
  Eye,
  EyeOff,
  FileText,
  Filter,
  GitBranch,
  Kanban,
  Layers,
  Loader2,
  Lock,
  Maximize2,
  Pause,
  Play,
  Radio,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  Sparkles,
  Terminal,
  Trophy,
  Unlock,
  UserCheck,
  X,
  XCircle,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

// ============================================================================
// 1. FSM STAGE DEFINITIONS & PRECISION STATUS PALETTE
// ============================================================================

const FSM_STAGES = [
  {
    id: 'found',
    code: 'NODE-01',
    label: 'Found',
    treeTitle: 'ВХОД: ПОТОК hh.ru',
    kanbanTitle: 'New Found',
    hex: '#0284c7',
  },
  {
    id: 'scored',
    code: 'NODE-02',
    label: 'Scored',
    treeTitle: 'ATS ТЕСТ (6 РЕЗЮМЕ)',
    kanbanTitle: 'ATS Evaluated',
    hex: '#6366f1',
  },
  {
    id: 'drafted',
    code: 'NODE-03',
    label: 'Drafted',
    treeTitle: 'ПИСЬМО + ЛИНТЕР',
    kanbanTitle: 'Letters Drafted',
    hex: '#f59e0b',
  },
  {
    id: 'awaiting_approval',
    code: 'NODE-04',
    label: 'Awaiting Approval',
    treeTitle: 'ШЛЮЗ HITL & АНКЕТЫ',
    kanbanTitle: 'Needs Your Approval',
    hex: '#f43f5e',
  },
  {
    id: 'approved',
    code: 'EXIT-05A',
    label: 'Approved',
    treeTitle: 'ВЫХОД A: ОТКЛИК',
    kanbanTitle: 'Approved & Sending',
    hex: '#10b981',
  },
  {
    id: 'sent',
    code: 'EXIT-05A',
    label: 'Sent',
    treeTitle: 'ВЫХОД A: ОТКЛИК',
    kanbanTitle: 'Responses & Interviews',
    hex: '#14b8a6',
  },
];

const STAGE_MAP = FSM_STAGES.reduce((acc, s) => {
  acc[s.id] = s;
  return acc;
}, {});

// Incoming stream candidates injected by 24/7 cron poller or "+1 Вход"
const STREAM_INJECTION_POOL = [
  {
    id: 'vac-stream-1',
    hhId: '109489901',
    company: 'Яндекс (Поиск и AI)',
    title: 'Senior AI Fullstack Engineer (LLM Agents)',
    cityFormat: 'Москва · Hybrid',
    salary: '410–490k ₽',
    matchedResumeId: 'res-1',
    atsScore: 91,
    resumeScores: {
      'res-1': { overall: 91, hardSkills: 94, domain: 90, seniority: 89 },
      'res-2': { overall: 74, hardSkills: 71, domain: 77, seniority: 74 },
      'res-3': { overall: 68, hardSkills: 60, domain: 73, seniority: 71 },
      'res-4': { overall: 66, hardSkills: 64, domain: 69, seniority: 65 },
      'res-5': { overall: 18, hardSkills: 14, domain: 17, seniority: 23 },
      'res-6': { overall: 20, hardSkills: 15, domain: 19, seniority: 26 },
    },
    scoreLedger: [
      { delta: 18, rule: 'TypeScript + React 19 + Node.js + Python FastAPI stack' },
      { delta: 15, rule: 'Production RAG & MCP tool-use orchestration' },
      { delta: 13, rule: '62% p95 latency reduction & automated LLM evals' },
      { delta: -5, rule: 'C++ inference engine internals listed as optional' },
    ],
    coverLetter:
      'Здравствуйте! Проектирую AI-агентов и высоконагруженные интерфейсы на TypeScript, React 19, Node.js и Python. Построил production RAG-контур на FastAPI и pgvector со снижением p95 latency на 62% при 180k MAU, MCP-шлюзами инструментов и eval-тестами. Буду рад обсудить задачи AI-поиска в Яндексе.',
    cleanDraft:
      'Здравствуйте! Проектирую AI-агентов и высоконагруженные интерфейсы на TypeScript, React 19, Node.js и Python. Построил production RAG-контур на FastAPI и pgvector со снижением p95 latency на 62% при 180k MAU, MCP-шлюзами инструментов и eval-тестами. Буду рад обсудить задачи AI-поиска в Яндексе.',
    questions: [
      {
        id: 'q-stream-1',
        type: 'radio',
        prompt: 'Есть ли у вас продакшен-опыт построения LLM-агентов и eval-метрик?',
        options: ['Да, в продакшене с eval-метриками', 'Только прототипы', 'Нет'],
        answer: 'Да, в продакшене с eval-метриками',
        factSource: 'Resume #1 · Bullet #3',
        needsReview: true,
      },
    ],
  },
  {
    id: 'vac-stream-2',
    hhId: '109489902',
    company: 'Бюро 1C-Интеграций',
    title: 'Разработчик 1С:ЗУП / Бухгалтерия (Офис 5/2)',
    cityFormat: 'Москва · Office',
    salary: '150–180k ₽',
    matchedResumeId: 'res-2',
    atsScore: 39,
    resumeScores: {
      'res-1': { overall: 28, hardSkills: 22, domain: 30, seniority: 32 },
      'res-2': { overall: 39, hardSkills: 34, domain: 41, seniority: 42 },
      'res-3': { overall: 31, hardSkills: 26, domain: 32, seniority: 35 },
      'res-4': { overall: 27, hardSkills: 22, domain: 28, seniority: 31 },
      'res-5': { overall: 19, hardSkills: 15, domain: 18, seniority: 24 },
      'res-6': { overall: 24, hardSkills: 19, domain: 24, seniority: 29 },
    },
    scoreLedger: [
      { delta: 9, rule: 'SQL & relational database reporting experience' },
      { delta: -20, rule: '1C:Enterprise 8.3 / ЗУП platform development absent' },
    ],
    coverLetter: 'Автоматический пропуск на ветке ATS < 65% (39%).',
    cleanDraft: 'Автоматический пропуск на ветке ATS < 65% (39%).',
    questions: [],
  },
  {
    id: 'vac-stream-3',
    hhId: '109489903',
    company: 'VK Tech (Cloud Platform)',
    title: 'Principal Presales Architect (Enterprise AI & Cloud)',
    cityFormat: 'Москва · Hybrid',
    salary: '360–440k ₽',
    matchedResumeId: 'res-4',
    atsScore: 90,
    resumeScores: {
      'res-4': { overall: 90, hardSkills: 92, domain: 91, seniority: 87 },
      'res-1': { overall: 78, hardSkills: 82, domain: 75, seniority: 77 },
      'res-3': { overall: 72, hardSkills: 66, domain: 76, seniority: 74 },
      'res-2': { overall: 65, hardSkills: 63, domain: 67, seniority: 65 },
      'res-5': { overall: 22, hardSkills: 17, domain: 21, seniority: 28 },
      'res-6': { overall: 23, hardSkills: 18, domain: 22, seniority: 29 },
    },
    scoreLedger: [
      { delta: 18, rule: '60+ Enterprise PoC workshops & cloud architecture defenses' },
      { delta: 15, rule: '190M+ ₽ ARR closed across 14 banking & telecom deals' },
      { delta: 11, rule: 'Full RFP/RFI ownership & TCO/ROI financial modeling' },
      { delta: -4, rule: 'OpenStack private cloud operations listed as bonus' },
    ],
    coverLetter:
      'Добрый день! 5 лет веду технический пресейл Enterprise-решений: провёл 60+ кастомных PoC-пилотов и закрыл 14 контрактов на 190+ млн ₽ ARR для банков и телекома. Полностью закрываю RFP/RFI, расчёт TCO/ROI миграции и защиту архитектуры перед ИБ. Готов обсудить задачи VK Cloud.',
    cleanDraft:
      'Добрый день! 5 лет веду технический пресейл Enterprise-решений: провёл 60+ кастомных PoC-пилотов и закрыл 14 контрактов на 190+ млн ₽ ARR для банков и телекома. Полностью закрываю RFP/RFI, расчёт TCO/ROI миграции и защиту архитектуры перед ИБ. Готов обсудить задачи VK Cloud.',
    questions: [],
  },
  {
    id: 'vac-stream-4',
    hhId: '109489904',
    company: 'Контур (СКБ Контур)',
    title: 'Senior Fullstack Product Engineer (AI DocFlow)',
    cityFormat: 'Екатеринбург · Remote',
    salary: '350–430k ₽',
    matchedResumeId: 'res-1',
    atsScore: 93,
    resumeScores: {
      'res-1': { overall: 93, hardSkills: 95, domain: 92, seniority: 92 },
      'res-2': { overall: 78, hardSkills: 75, domain: 81, seniority: 78 },
      'res-3': { overall: 71, hardSkills: 64, domain: 76, seniority: 73 },
      'res-4': { overall: 67, hardSkills: 64, domain: 70, seniority: 67 },
      'res-5': { overall: 19, hardSkills: 14, domain: 18, seniority: 25 },
      'res-6': { overall: 21, hardSkills: 15, domain: 20, seniority: 28 },
    },
    scoreLedger: [
      { delta: 19, rule: 'TypeScript + React 19 + Node.js + Python FastAPI exact match' },
      { delta: 15, rule: 'Production RAG & structured JSON extraction pipelines' },
      { delta: 13, rule: '99.94% SLA availability & -62% p95 latency reduction' },
      { delta: -4, rule: 'C# .NET legacy interop listed as nice-to-have' },
    ],
    coverLetter:
      'Здравствуйте! Разрабатываю AI-продукты и веб-интерфейсы на TypeScript, React 19, Node.js и Python. Построил production RAG-пайплайн на FastAPI и pgvector со снижением p95 latency на 62% при 180k MAU, MCP-шлюзами и детерминированными eval-тестами. Буду рад обсудить задачи AI DocFlow в Контуре.',
    cleanDraft:
      'Здравствуйте! Разрабатываю AI-продукты и веб-интерфейсы на TypeScript, React 19, Node.js и Python. Построил production RAG-пайплайн на FastAPI и pgvector со снижением p95 latency на 62% при 180k MAU, MCP-шлюзами и детерминированными eval-тестами. Буду рад обсудить задачи AI DocFlow в Контуре.',
    questions: [],
  },
  {
    id: 'vac-stream-5',
    hhId: '109489905',
    company: 'Ростелеком ИТ',
    title: 'Ведущий IT-аналитик (LLM-автоматизация техподдержки)',
    cityFormat: 'Москва · Remote',
    salary: '300–370k ₽',
    matchedResumeId: 'res-2',
    atsScore: 89,
    resumeScores: {
      'res-2': { overall: 89, hardSkills: 91, domain: 90, seniority: 86 },
      'res-1': { overall: 81, hardSkills: 84, domain: 78, seniority: 81 },
      'res-3': { overall: 74, hardSkills: 68, domain: 78, seniority: 76 },
      'res-4': { overall: 65, hardSkills: 63, domain: 67, seniority: 65 },
      'res-5': { overall: 22, hardSkills: 17, domain: 21, seniority: 28 },
      'res-6': { overall: 24, hardSkills: 18, domain: 23, seniority: 31 },
    },
    scoreLedger: [
      { delta: 17, rule: '24 automated workflows on n8n, Python & REST/Webhook API' },
      { delta: 14, rule: '80+ BRD/SRS, BPMN 2.0 & OpenAPI specifications' },
      { delta: 12, rule: 'PostgreSQL cohort analytics (-14 hrs/wk manual labor)' },
      { delta: -4, rule: 'Telecom billing BSS/OSS domain exposure limited' },
    ],
    coverLetter:
      'Добрый день! 6 лет проектирую интеграционные API-контракты и AI-автоматизацию процессов. Запустил 24 сценария на n8n, Python и REST/Webhook API (-14 ч/нед ручных операций). Владею сложным SQL в PostgreSQL, BPMN 2.0 и OpenAPI. Готов обсудить задачи автоматизации.',
    cleanDraft:
      'Добрый день! 6 лет проектирую интеграционные API-контракты и AI-автоматизацию процессов. Запустил 24 сценария на n8n, Python и REST/Webhook API (-14 ч/нед ручных операций). Владею сложным SQL в PostgreSQL, BPMN 2.0 и OpenAPI. Готов обсудить задачи автоматизации.',
    questions: [],
  },
];

// Active 24/7 hh.ru Search Cron Polls
const INITIAL_CRON_POLLS = [
  {
    id: 'cron-1',
    query: 'AI Product Engineer',
    resumeCode: 'R1',
    interval: 'every 12m',
    foundToday: 18,
    active: true,
  },
  {
    id: 'cron-2',
    query: 'Fullstack Node/Python',
    resumeCode: 'R1',
    interval: 'every 15m',
    foundToday: 14,
    active: true,
  },
  {
    id: 'cron-3',
    query: 'IT Аналитик LLM',
    resumeCode: 'R2',
    interval: 'every 20m',
    foundToday: 9,
    active: true,
  },
  {
    id: 'cron-4',
    query: 'Product Manager IT',
    resumeCode: 'R3',
    interval: 'every 20m',
    foundToday: 6,
    active: true,
  },
  {
    id: 'cron-5',
    query: 'Руководитель СЦ',
    resumeCode: 'R6',
    interval: 'every 30m',
    foundToday: 3,
    active: true,
  },
];

// ============================================================================
// 5. SVG BEZIER GRAPH GEOMETRY (1360 x 620 COORDINATE SPACE)
// ============================================================================
// 2. 6 CANDIDATE RESUMES (PORTFOLIO & MULTI-RESUME ATS ENGINE)
// ============================================================================

const INITIAL_RESUMES = [
  {
    id: 'res-1',
    shortCode: 'R1',
    filterLabel: '1. Fullstack AI',
    title: 'Fullstack-разработчик / AI Product Engineer',
    hhId: 'hh_9841201',
    atsReadiness: 94,
    wordCount: 412,
    visibility: 'public',
    auditStatus: 'Verified · Clean',
    experience: '5.5 yrs',
    compRange: '380–480k ₽',
    accentHex: '#0284c7',
    skills: ['TypeScript', 'React 19', 'Node.js', 'Python', 'FastAPI', 'RAG / MCP', 'PostgreSQL'],
    facts: [
      'Спроектировал production RAG и multi-agent пайплайн (Python, FastAPI, pgvector), снизив p95 latency на 62% при 180k MAU.',
      'Разработал высоконагруженный клиентский контур на TypeScript, React 19 и Node.js с аптаймом 99.94%.',
      'Реализовал MCP-шлюзы инструментов и детерминированные eval-тесты качества ответов LLM.',
    ],
  },
  {
    id: 'res-2',
    shortCode: 'R2',
    filterLabel: '2. IT-Аналитик',
    title: 'IT-аналитик / Бизнес-аналитик / AI-автоматизатор',
    hhId: 'hh_9841202',
    atsReadiness: 89,
    wordCount: 385,
    visibility: 'public',
    auditStatus: 'Verified · Clean',
    experience: '6.0 yrs',
    compRange: '300–390k ₽',
    accentHex: '#6366f1',
    skills: ['BPMN 2.0', 'SQL', 'Python', 'n8n', 'OpenAPI', 'PostgreSQL', 'LLM Workflows'],
    facts: [
      'Автоматизировал 24 кросс-функциональных процесса на связке n8n, Python и REST/Webhook API (-14 ч/нед ручных операций).',
      'Подготовил 80+ спецификаций BRD/SRS, UML sequence-диаграмм и OpenAPI-контрактов для финтеха и e-commerce.',
      'Собрал аналитические витрины и когортные SQL-отчёты в PostgreSQL с ускорением сверки в 3.5 раза.',
    ],
  },
  {
    id: 'res-3',
    shortCode: 'R3',
    filterLabel: '3. PM (IT)',
    title: 'Project Manager / Product Manager (IT)',
    hhId: 'hh_9841203',
    atsReadiness: 91,
    wordCount: 440,
    visibility: 'public',
    auditStatus: 'Verified · Clean',
    experience: '6.5 yrs',
    compRange: '350–450k ₽',
    accentHex: '#10b981',
    skills: ['Product Strategy', 'Unit Economics', 'CustDev', 'A/B Testing', 'Scrum', 'OKR', 'SQL'],
    facts: [
      'Руководил 3 кросс-функциональными командами (18 инженеров, QA, дизайн) с двухнедельным циклом релизов B2B SaaS.',
      'Увеличил конверсию из триала в оплату на +19% по итогам 45+ CustDev-интервью и серии A/B-экспериментов.',
      'Управлял P&L продукта, юнит-экономикой LTV/CAC и квартальным роадмапом AI-функций.',
    ],
  },
  {
    id: 'res-4',
    shortCode: 'R4',
    filterLabel: '4. Пресейл',
    title: 'Пресейл-инженер / Технический специалист',
    hhId: 'hh_9841204',
    atsReadiness: 86,
    wordCount: 368,
    visibility: 'public',
    auditStatus: 'Verified · Clean',
    experience: '5.0 yrs',
    compRange: '320–420k ₽',
    accentHex: '#14b8a6',
    skills: ['Enterprise PoC', 'RFP / RFI', 'Cloud Architecture', 'TCO / ROI', 'InfoSec', 'GPU / IaaS'],
    facts: [
      'Провёл 60+ кастомных PoC-пилотов и архитектурных воркшопов для клиентов банковского и телеком-секторов.',
      'Закрыл 14 Enterprise-контрактов суммарно на 190+ млн ₽ ARR через расчёт TCO/ROI миграции.',
      'Вёл полную техническую проработку RFP/RFI и защиту архитектуры перед службами ИБ заказчиков.',
    ],
  },
  {
    id: 'res-5',
    shortCode: 'R5',
    filterLabel: '5. Закупки (Китай)',
    title: 'Менеджер по закупкам (Китай, электроника)',
    hhId: 'hh_9841205',
    atsReadiness: 82,
    wordCount: 350,
    visibility: 'hidden', // Hidden on hh.ru -> triggers visible Quarantine blocker
    auditStatus: 'Blocked · Hidden on hh.ru',
    experience: '7.0 yrs',
    compRange: '260–340k ₽',
    accentHex: '#f43f5e',
    skills: ['1688 / Alibaba', 'OEM / ODM', 'Shenzhen QC', 'AQL 2.5', 'ВЭД / ТН ВЭД', 'BOM Costing'],
    facts: [
      'Прямые закупки электроники, PCB и IoT-компонентов на 45+ проверенных фабриках Шэньчжэня и Дунгуаня.',
      'Снизил BOM-себестоимость на 16.5% за счёт прямых OEM/ODM-контрактов и приёмки по стандарту AQL 2.5.',
      'Полный цикл ВЭД: подбор кодов ТН ВЭД, сертификация ЕАЭС, валютные платежи и мультимодальная логистика.',
    ],
  },
  {
    id: 'res-6',
    shortCode: 'R6',
    filterLabel: '6. Управляющий',
    title: 'Управляющий магазином / сервисным центром',
    hhId: 'hh_9841206',
    atsReadiness: 85,
    wordCount: 330,
    visibility: 'public',
    auditStatus: 'Verified · Clean',
    experience: '7.5 yrs',
    compRange: '220–280k ₽',
    accentHex: '#f59e0b',
    skills: ['P&L Retail', 'SLA Service', 'RMA Operations', 'Team 30+', 'Inventory', '1C:Розница'],
    facts: [
      'Управлял флагманским магазином электроники и сервисным центром (оборот 48 млн ₽/мес, штат 32 человека).',
      'Сократил средний срок ремонта RMA с 9.4 до 4.1 дня и удержал выполнение SLA на уровне 98.2%.',
      'Увеличил чистую EBITDA точки на +11% за счёт контроля товарных потерь и пересборки KPI команды.',
    ],
  },
];

// ============================================================================
// 3. REAL-TIME RUSSIAN COVER LETTER LINTER ENGINE
// ============================================================================

const CLICHE_RULES = [
  {
    phrase: 'командный игрок',
    category: 'cliche',
    replacement: 'работаю в связке с бэкендом, ML и продуктом',
  },
  {
    phrase: 'стрессоустойчивость',
    category: 'cliche',
    replacement: 'стабильно закрываю релизы в жёсткие дедлайны',
  },
  {
    phrase: 'динамично развивающаяся компания',
    category: 'cliche',
    replacement: 'продуктовая команда',
  },
  {
    phrase: 'быстро обучаемый',
    category: 'cliche',
    replacement: 'быстро погружаюсь в незнакомый стек',
  },
  {
    phrase: 'нацеленный на результат',
    category: 'cliche',
    replacement: 'ориентируюсь на продуктовые метрики',
  },
];

const AI_VOCAB_RULES = [
  {
    phrase: 'бесшовная интеграция',
    category: 'ai_vocab',
    replacement: 'прямая интеграция',
  },
  {
    phrase: 'передовые решения',
    category: 'ai_vocab',
    replacement: 'продакшен-инструменты',
  },
  {
    phrase: 'синергия',
    category: 'ai_vocab',
    replacement: 'совместная работа',
  },
  {
    phrase: 'искренне восхищён',
    category: 'ai_vocab',
    replacement: 'внимательно слежу за развитием',
  },
  {
    phrase: 'искренне восхищен',
    category: 'ai_vocab',
    replacement: 'внимательно слежу за развитием',
  },
  {
    phrase: 'катализатор',
    category: 'ai_vocab',
    replacement: 'драйвер',
  },
];

const MORALIZING_RULES = [
  {
    phrase: 'компании обязаны',
    category: 'moralizing',
    replacement: 'командам важно',
  },
  {
    phrase: 'крайне важно понимать',
    category: 'moralizing',
    replacement: 'на практике критично учитывать',
  },
  {
    phrase: 'огромная честь',
    category: 'moralizing',
    replacement: 'интересная инженерная задача',
  },
];

function runCoverLetterLint(text) {
  const clean = (text || '').trim();
  const words = clean ? clean.split(/\s+/).filter(Boolean) : [];
  const wordCount = words.length;
  const charCount = clean.length;

  const sentences = clean
    ? clean.split(/[.!?]+/).map((s) => s.trim()).filter(Boolean)
    : [];
  const sentenceCount = Math.max(1, sentences.length);
  const avgWords = wordCount / sentenceCount;
  const avgChars = wordCount > 0 ? words.join('').length / wordCount : 5.5;
  const grade = Math.max(6, Math.min(14, Math.round(0.32 * avgWords + 1.15 * avgChars - 2.1)));

  const lower = clean.toLowerCase();

  const cliches = CLICHE_RULES.filter((r) => lower.includes(r.phrase.toLowerCase()));
  const aiVocab = AI_VOCAB_RULES.filter((r) => lower.includes(r.phrase.toLowerCase()));
  const moralizing = MORALIZING_RULES.filter((r) => lower.includes(r.phrase.toLowerCase()));

  const totalFlags = cliches.length + aiVocab.length + moralizing.length;
  const inWordBand = wordCount >= 120 && wordCount <= 180;

  return {
    wordCount,
    charCount,
    grade,
    cliches,
    aiVocab,
    moralizing,
    totalFlags,
    inWordBand,
    isClean: totalFlags === 0 && inWordBand,
  };
}

// ============================================================================
// 4. INITIAL VACANCIES + STREAM INJECTION QUEUE FOR STEP-BY-STEP TREE DEMO
// ============================================================================

const INITIAL_VACANCIES = [
  // --- NODE 01: FOUND / INGESTION (3) ---
  {
    id: 'vac-01',
    hhId: '109483410',
    company: 'Yandex Cloud',
    title: 'Senior Fullstack Engineer (AI Console & Billing)',
    cityFormat: 'Москва · Hybrid',
    salary: '380–460k ₽',
    stage: 'found',
    matchedResumeId: 'res-1',
    atsScore: 89,
    resumeScores: {
      'res-1': { overall: 89, hardSkills: 92, domain: 88, seniority: 87 },
      'res-2': { overall: 71, hardSkills: 68, domain: 75, seniority: 70 },
      'res-3': { overall: 64, hardSkills: 56, domain: 70, seniority: 66 },
      'res-4': { overall: 69, hardSkills: 68, domain: 74, seniority: 65 },
      'res-5': { overall: 19, hardSkills: 14, domain: 18, seniority: 25 },
      'res-6': { overall: 21, hardSkills: 15, domain: 20, seniority: 28 },
    },
    scoreLedger: [
      { delta: 18, rule: 'Production TypeScript + React 19 + Node.js high-load SPA' },
      { delta: 15, rule: 'Built RAG & LLM orchestration pipelines (Python / FastAPI)' },
      { delta: 12, rule: 'PostgreSQL query tuning & 99.94% SLA track record' },
      { delta: -6, rule: 'No commercial Go microservices in primary stack' },
    ],
    coverLetter:
      'Здравствуйте! Проектирую высоконагруженные интерфейсы и AI-сервисы на TypeScript, React 19, Node.js и Python. На прошлом проекте собрал production RAG-контур на FastAPI и pgvector, снизив p95 latency ответов на 62% при нагрузке 180k MAU. Умею закрывать полный цикл разработки: от реактивной веб-консоли и MCP-шлюзов до детерминированных eval-проверок. Буду рад обсудить задачи консоли Yandex Cloud на техническом интервью.',
    cleanDraft:
      'Здравствуйте! Разрабатываю высоконагруженные интерфейсы и AI-инструменты на TypeScript, React 19, Node.js и Python. Запустил в продакшене RAG-пайплайн на FastAPI и pgvector: время ответа сократилось на 62%, а аптайм платформы составил 99.94% при 180k MAU. Закрываю весь контур от фронтенда и MCP-интеграций до метрик качества LLM. Готов обсудить задачи Yandex Cloud.',
    questions: [],
  },
  {
    id: 'vac-02',
    hhId: '109483302',
    company: 'Wildberries Tech',
    title: 'Lead Product Manager (Logistics & Fulfillment AI)',
    cityFormat: 'Москва · Remote',
    salary: '360–440k ₽',
    stage: 'found',
    matchedResumeId: 'res-3',
    atsScore: 87,
    resumeScores: {
      'res-3': { overall: 87, hardSkills: 88, domain: 86, seniority: 87 },
      'res-2': { overall: 79, hardSkills: 78, domain: 82, seniority: 77 },
      'res-1': { overall: 73, hardSkills: 76, domain: 70, seniority: 73 },
      'res-4': { overall: 61, hardSkills: 58, domain: 64, seniority: 61 },
      'res-5': { overall: 44, hardSkills: 40, domain: 48, seniority: 44 },
      'res-6': { overall: 48, hardSkills: 42, domain: 52, seniority: 50 },
    },
    scoreLedger: [
      { delta: 17, rule: '6.5 yrs IT Product leadership across 3 engineering squads' },
      { delta: 14, rule: '+19% paid conversion lift via 45+ CustDev & A/B tests' },
      { delta: 11, rule: 'P&L ownership, LTV/CAC modeling & SQL cohort analysis' },
      { delta: -5, rule: 'B2C high-frequency warehouse logistics domain is adjacent' },
    ],
    coverLetter:
      'Добрый день! 6.5 лет развиваю IT-продукты и руковожу кросс-функциональными командами разработки. На прошлом месте провёл 45+ CustDev-интервью и серию A/B-экспериментов, что дало +19% к конверсии в оплату и улучшило юнит-экономику LTV/CAC. Сам проверяю гипотезы в SQL, согласовываю метрики с ML-инженерами и держу прозрачный OKR-роадмап. Готов обсудить задачи логистической платформы Wildberries.',
    cleanDraft:
      'Добрый день! 6.5 лет развиваю IT-продукты и руковожу кросс-функциональными командами. Проведение 45+ CustDev-интервью и серии A/B-тестов позволило увеличить конверсию в оплату на 19% и укрепить LTV/CAC. Считаю когорты в SQL, работаю в связке с ML-командой и веду квартальные OKR. Буду рад обсудить задачи направления.',
    questions: [],
  },
  {
    id: 'vac-03',
    hhId: '109483199',
    company: 'DNS Digital',
    title: 'Руководитель розничного кластера и сервисной зоны',
    cityFormat: 'Москва · Office',
    salary: '220–280k ₽',
    stage: 'found',
    matchedResumeId: 'res-6',
    atsScore: 86,
    resumeScores: {
      'res-6': { overall: 86, hardSkills: 88, domain: 89, seniority: 81 },
      'res-5': { overall: 59, hardSkills: 54, domain: 64, seniority: 59 },
      'res-3': { overall: 54, hardSkills: 48, domain: 56, seniority: 58 },
      'res-4': { overall: 45, hardSkills: 42, domain: 48, seniority: 45 },
      'res-2': { overall: 30, hardSkills: 26, domain: 32, seniority: 32 },
      'res-1': { overall: 22, hardSkills: 18, domain: 22, seniority: 26 },
    },
    scoreLedger: [
      { delta: 18, rule: '7.5 yrs electronics retail & service hub P&L (48M ₽/mo)' },
      { delta: 13, rule: 'RMA turnaround reduced from 9.4 to 4.1 days (98.2% SLA)' },
      { delta: 10, rule: '+11% store EBITDA growth via shrink & KPI optimization' },
      { delta: -5, rule: 'Single flagship hub vs multi-store regional cluster' },
    ],
    coverLetter:
      'Здравствуйте! 7.5 лет управляю флагманским магазином электроники и сервисным центром с оборотом 48 млн ₽/мес и штатом 32 человека. Сократил средний срок ремонта RMA с 9.4 до 4.1 дня, удержав выполнение SLA на уровне 98.2%. За год увеличил чистую EBITDA объекта на +11% за счёт снижения товарных потерь и обновления мотивации персонала. Готов обсудить показатели кластера DNS.',
    cleanDraft:
      'Здравствуйте! 7.5 лет руковожу флагманским магазином электроники и сервисным центром (оборот 48 млн ₽/мес, команда 32 сотрудника). Ускорил ремонт RMA с 9.4 до 4.1 дня при соблюдении SLA 98.2% и обеспечил рост EBITDA на +11% через контроль потерь и KPI команды. Готов обсудить задачи.',
    questions: [],
  },

  // --- NODE 02: SCORED / ATS TESTING (3) ---
  {
    id: 'vac-04',
    hhId: '109482890',
    company: 'Avito Tech',
    title: 'Fullstack Product Engineer (GenAI Seller Assistant)',
    cityFormat: 'Москва · Remote',
    salary: '370–450k ₽',
    stage: 'scored',
    matchedResumeId: 'res-1',
    atsScore: 90,
    resumeScores: {
      'res-1': { overall: 90, hardSkills: 93, domain: 89, seniority: 88 },
      'res-2': { overall: 74, hardSkills: 71, domain: 77, seniority: 74 },
      'res-3': { overall: 69, hardSkills: 62, domain: 74, seniority: 71 },
      'res-4': { overall: 63, hardSkills: 60, domain: 66, seniority: 63 },
      'res-5': { overall: 20, hardSkills: 15, domain: 19, seniority: 26 },
      'res-6': { overall: 22, hardSkills: 16, domain: 21, seniority: 29 },
    },
    scoreLedger: [
      { delta: 18, rule: 'TypeScript + React 19 + Node.js fullstack architecture' },
      { delta: 15, rule: 'Production LLM/RAG latency optimization (-62% p95)' },
      { delta: 12, rule: 'MCP tool-use & structured JSON output validation' },
      { delta: -5, rule: 'Go backend experience listed as preferred bonus' },
    ],
    coverLetter:
      'Здравствуйте! Разрабатываю fullstack-продукты на TypeScript, React 19 и Node.js с продакшен-интеграцией LLM. На прошлом месте построил RAG-пайплайн на Python и pgvector для 180k MAU, сократив время ответа на 62% при аптайме 99.94%. Умею проектировать потоковые интерфейсы ассистентов и eval-метрики качества генерации. Буду рад пообщаться с командой Avito Tech.',
    cleanDraft:
      'Здравствуйте! Создаю fullstack-продукты на TypeScript, React 19 и Node.js с продакшен-интеграцией LLM. Построил RAG-пайплайн на Python и pgvector для 180k MAU: задержка ответа снизилась на 62% при аптайме 99.94%. Проектирую потоковые интерфейсы ассистентов и eval-тесты качества. Готов обсудить задачи Avito Tech.',
    questions: [],
  },
  {
    id: 'vac-05',
    hhId: '109482744',
    company: 'SberDevices',
    title: 'AI Business Analyst / LLM Workflow Architect',
    cityFormat: 'Москва · Hybrid',
    salary: '310–380k ₽',
    stage: 'scored',
    matchedResumeId: 'res-2',
    atsScore: 88,
    resumeScores: {
      'res-2': { overall: 88, hardSkills: 90, domain: 89, seniority: 85 },
      'res-1': { overall: 83, hardSkills: 87, domain: 80, seniority: 82 },
      'res-3': { overall: 74, hardSkills: 68, domain: 78, seniority: 76 },
      'res-4': { overall: 65, hardSkills: 63, domain: 67, seniority: 65 },
      'res-5': { overall: 23, hardSkills: 18, domain: 22, seniority: 29 },
      'res-6': { overall: 25, hardSkills: 19, domain: 24, seniority: 32 },
    },
    scoreLedger: [
      { delta: 17, rule: '24 automated cross-team workflows (n8n, Python, REST API)' },
      { delta: 14, rule: '80+ BRD/SRS, BPMN 2.0 & OpenAPI integration contracts' },
      { delta: 11, rule: 'PostgreSQL cohort analytics saving 14 hrs/wk manual work' },
      { delta: -4, rule: 'Hybrid 3 days/week vs Remote primary preference' },
    ],
    coverLetter:
      'Добрый день! 6 лет проектирую бизнес-процессы, интеграционные контракты и AI-автоматизацию. Автоматизировал 24 операционных сценария на n8n, Python и REST/Webhook API, что сэкономило командам более 14 часов ручной работы в неделю. Свободно пишу SQL-запросы в PostgreSQL, оформляю BPMN 2.0 и OpenAPI-спецификации для LLM-агентов. Готов обсудить задачи SberDevices.',
    cleanDraft:
      'Добрый день! 6 лет проектирую IT-системы, API-контракты и AI-автоматизацию. Внедрил 24 сценария на n8n, Python и REST/Webhook API, высвободив 14+ часов ручной работы еженедельно. Пишу сложный SQL в PostgreSQL, проектирую схемы BPMN 2.0 и OpenAPI для LLM-пайплайнов. Буду рад обсудить задачи.',
    questions: [],
  },
  {
    id: 'vac-06',
    hhId: '109482611',
    company: 'М.Видео-Эльдорадо',
    title: 'Управляющий флагманским магазином и сервис-центром',
    cityFormat: 'Москва · Office',
    salary: '220–270k ₽',
    stage: 'scored',
    matchedResumeId: 'res-6',
    atsScore: 87,
    resumeScores: {
      'res-6': { overall: 87, hardSkills: 89, domain: 91, seniority: 81 },
      'res-5': { overall: 56, hardSkills: 50, domain: 62, seniority: 56 },
      'res-3': { overall: 52, hardSkills: 46, domain: 54, seniority: 56 },
      'res-4': { overall: 44, hardSkills: 40, domain: 46, seniority: 46 },
      'res-2': { overall: 29, hardSkills: 25, domain: 30, seniority: 32 },
      'res-1': { overall: 21, hardSkills: 17, domain: 21, seniority: 25 },
    },
    scoreLedger: [
      { delta: 19, rule: 'Exact role match: Flagship electronics store + service hub' },
      { delta: 13, rule: '48M ₽/mo turnover & 32 staff P&L management' },
      { delta: 10, rule: '98.2% service SLA & +11% store EBITDA improvement' },
      { delta: -5, rule: 'SAP Retail ERP listed as preferred over 1C:Розница' },
    ],
    coverLetter:
      'Здравствуйте! 7.5 лет руковожу флагманским магазином электроники и сервисным центром с оборотом 48 млн ₽/мес и командой 32 сотрудника. Вывел выполнение SLA ремонта на 98.2%, сократив срок обслуживания RMA с 9.4 до 4.1 дня. За счёт контроля товарных потерь и перенастройки KPI увеличил чистую EBITDA точки на +11%. Готов обсудить показатели на встрече.',
    cleanDraft:
      'Здравствуйте! 7.5 лет управляю флагманским магазином электроники и сервисным центром (оборот 48 млн ₽/мес, штат 32 человека). Удержал SLA ремонта на уровне 98.2%, ускорив RMA с 9.4 до 4.1 дня, и поднял EBITDA точки на +11% за счёт снижения потерь и работы с KPI. Готов обсудить задачи.',
    questions: [],
  },

  // --- NODE 03: DRAFTED / COVER LETTER & LINTER (3) ---
  {
    id: 'vac-07',
    hhId: '109482105',
    company: 'Ozon Tech',
    title: 'Senior Product Manager (AI Search & Ranking)',
    cityFormat: 'Москва · Remote',
    salary: '390–470k ₽',
    stage: 'drafted',
    matchedResumeId: 'res-3',
    atsScore: 92,
    resumeScores: {
      'res-3': { overall: 92, hardSkills: 93, domain: 91, seniority: 92 },
      'res-1': { overall: 82, hardSkills: 85, domain: 80, seniority: 81 },
      'res-2': { overall: 77, hardSkills: 75, domain: 79, seniority: 77 },
      'res-4': { overall: 65, hardSkills: 62, domain: 68, seniority: 65 },
      'res-5': { overall: 28, hardSkills: 22, domain: 28, seniority: 34 },
      'res-6': { overall: 36, hardSkills: 30, domain: 38, seniority: 40 },
    },
    scoreLedger: [
      { delta: 18, rule: '6.5 yrs IT Product & Project leadership across 3 squads' },
      { delta: 15, rule: '+19% conversion lift via 45+ CustDev & A/B experiments' },
      { delta: 13, rule: 'AI workflow roadmap, P&L & SQL cohort ownership' },
      { delta: -4, rule: 'B2C marketplace scale (10M+ DAU) vs B2B SaaS primary' },
    ],
    coverLetter:
      'Здравствуйте! 6.5 лет развиваю IT-продукты и управляю командами разработки. На прошлом месте провёл 45+ CustDev-интервью и серию A/B-тестов, подняв конверсию в оплату на 19% и укрепив юнит-экономику LTV/CAC. Понимаю метрики качества ML-ранжирования, сам строю SQL-когорты и веду роадмап по OKR. В Ozon Tech как в динамично развивающейся компании вижу сильные задачи по AI-поиску — готов обсудить их на интервью.',
    cleanDraft:
      'Здравствуйте! 6.5 лет развиваю IT-продукты и управляю кросс-функциональными командами разработки. На прошлом месте провёл 45+ CustDev-интервью и серию A/B-тестов, подняв конверсию в оплату на 19% и укрепив юнит-экономику LTV/CAC. Понимаю метрики качества ML-ранжирования, сам строю SQL-когорты и веду роадмап по OKR. Буду рад обсудить задачи AI-поиска в Ozon Tech на интервью.',
    questions: [],
  },
  {
    id: 'vac-08',
    hhId: '109481988',
    company: 'Kaspersky',
    title: 'Senior Presales Engineer (Enterprise Cloud & XDR)',
    cityFormat: 'Москва · Hybrid',
    salary: '330–410k ₽',
    stage: 'drafted',
    matchedResumeId: 'res-4',
    atsScore: 87,
    resumeScores: {
      'res-4': { overall: 87, hardSkills: 89, domain: 88, seniority: 84 },
      'res-1': { overall: 75, hardSkills: 79, domain: 72, seniority: 74 },
      'res-3': { overall: 69, hardSkills: 64, domain: 72, seniority: 71 },
      'res-2': { overall: 64, hardSkills: 62, domain: 66, seniority: 64 },
      'res-5': { overall: 24, hardSkills: 19, domain: 23, seniority: 30 },
      'res-6': { overall: 24, hardSkills: 18, domain: 24, seniority: 30 },
    },
    scoreLedger: [
      { delta: 17, rule: '60+ Enterprise PoC demos & architecture workshops' },
      { delta: 14, rule: '190M+ ₽ ARR closed across 14 banking & telecom deals' },
      { delta: 11, rule: 'Full RFP/RFI technical defense & InfoSec alignment' },
      { delta: -5, rule: 'Direct SIEM/XDR deployment hands-on experience limited' },
    ],
    coverLetter:
      'Добрый день! 5 лет сопровождаю Enterprise-сделки как технический пресейл: провёл 60+ PoC-пилотов и закрыл 14 контрактов на 190+ млн ₽ ARR для банков и телекома. Полностью беру на себя техническую проработку RFP/RFI, расчёт TCO/ROI и защиту архитектуры перед подразделениями ИБ заказчика. Готов обсудить задачи пресейл-команды Kaspersky.',
    cleanDraft:
      'Добрый день! 5 лет работаю в техническом пресейле Enterprise-решений: провёл 60+ PoC-пилотов и обеспечил закрытие 14 контрактов на 190+ млн ₽ ARR в банках и телекоме. Закрываю RFP/RFI, моделирую TCO/ROI и защищаю архитектуру перед службами ИБ. Готов обсудить задачи команды.',
    questions: [],
  },
  {
    id: 'vac-09',
    hhId: '109481812',
    company: 'Яндекс (Маркет)',
    title: 'Системный аналитик (Автоматизация цепочек поставок)',
    cityFormat: 'Москва · Hybrid',
    salary: '290–350k ₽',
    stage: 'drafted',
    matchedResumeId: 'res-2',
    atsScore: 85,
    resumeScores: {
      'res-2': { overall: 85, hardSkills: 87, domain: 86, seniority: 82 },
      'res-1': { overall: 78, hardSkills: 82, domain: 74, seniority: 78 },
      'res-3': { overall: 73, hardSkills: 68, domain: 76, seniority: 75 },
      'res-4': { overall: 62, hardSkills: 60, domain: 64, seniority: 62 },
      'res-5': { overall: 39, hardSkills: 34, domain: 44, seniority: 39 },
      'res-6': { overall: 31, hardSkills: 26, domain: 34, seniority: 33 },
    },
    scoreLedger: [
      { delta: 16, rule: '80+ BRD/SRS, UML sequence & OpenAPI integration specs' },
      { delta: 14, rule: '24 automated workflows via n8n, Python & REST webhooks' },
      { delta: 10, rule: 'Advanced PostgreSQL analytics & BI reporting automation' },
      { delta: -5, rule: 'Kafka Avro schema registry not explicitly detailed' },
    ],
    coverLetter:
      'Здравствуйте! 6 лет проектирую интеграционные API-контракты и автоматизирую операционные контуры в e-commerce. Запустил 24 сквозных сценария на n8n, Python и REST/Webhook API, сократив ручную нагрузку на 14+ часов в неделю. Пишу сложные SQL-запросы в PostgreSQL и оформляю BPMN 2.0 / OpenAPI спецификации. Буду рад обсудить задачи Яндекс Маркета.',
    cleanDraft:
      'Здравствуйте! 6 лет проектирую интеграционные API-контракты и автоматизирую процессы в e-commerce. Запустил 24 сквозных сценария на n8n, Python и REST API (-14 ч/нед ручных операций). Свободно владею PostgreSQL, BPMN 2.0 и OpenAPI. Готов обсудить задачи команды.',
    questions: [],
  },

  // --- NODE 04: AWAITING APPROVAL / HITL GATE (4: 3 WITH QUESTIONS + 1 WITH HIDDEN RESUME) ---
  {
    id: 'vac-10',
    hhId: '109481501',
    company: 'T-Bank (Т-Банк)',
    title: 'Senior Fullstack / AI Product Engineer (MCP & Agents)',
    cityFormat: 'Москва · Remote',
    salary: '400–480k ₽',
    stage: 'awaiting_approval',
    matchedResumeId: 'res-1',
    atsScore: 92,
    resumeScores: {
      'res-1': { overall: 92, hardSkills: 95, domain: 91, seniority: 90 },
      'res-2': { overall: 75, hardSkills: 72, domain: 79, seniority: 74 },
      'res-3': { overall: 68, hardSkills: 60, domain: 74, seniority: 70 },
      'res-4': { overall: 65, hardSkills: 62, domain: 68, seniority: 65 },
      'res-5': { overall: 19, hardSkills: 14, domain: 18, seniority: 25 },
      'res-6': { overall: 21, hardSkills: 15, domain: 20, seniority: 28 },
    },
    scoreLedger: [
      { delta: 16, rule: 'Production Node.js + Python FastAPI + TypeScript React 19' },
      { delta: 14, rule: 'Built RAG/LLM orchestration & MCP tool-use gateways' },
      { delta: 16, rule: '62% p95 latency reduction & 99.94% uptime at 180k MAU' },
      { delta: -4, rule: 'No commercial Go microservices in primary stack' },
    ],
    coverLetter:
      'Здравствуйте! Проектирую AI-продукты и высоконагруженные веб-интерфейсы на TypeScript, React 19, Node.js и Python. На прошлом проекте построил production RAG-контур на FastAPI и pgvector, снизив p95 latency на 62% при 180k MAU, а также реализовал MCP-шлюзы инструментов и eval-тесты качества генерации. Я командный игрок и обеспечиваю бесшовную интеграцию моделей в пользовательские сценарии. Готов обсудить задачи в Т-Банке.',
    cleanDraft:
      'Здравствуйте! Проектирую AI-продукты и высоконагруженные интерфейсы на TypeScript, React 19, Node.js и Python. На прошлом проекте построил production RAG-контур на FastAPI и pgvector, снизив p95 latency на 62% при 180k MAU, а также реализовал MCP-шлюзы инструментов и eval-тесты качества генерации. Работаю в тесной связке с ML и продуктом над интеграцией моделей в клиентские сценарии. Готов обсудить задачи в Т-Банке.',
    questions: [
      {
        id: 'q-10-1',
        type: 'text',
        prompt: 'Сколько лет коммерческого опыта с TypeScript, React и Node.js у вас в продакшене?',
        answer: '5.5 лет коммерческой разработки на TypeScript, React и Node.js (включая React 19 и высоконагруженные SPA на 180k MAU).',
        factSource: 'Resume #1 · Experience',
        needsReview: true,
      },
      {
        id: 'q-10-2',
        type: 'radio',
        prompt: 'Есть ли у вас продакшен-опыт построения LLM-агентов, RAG и tool-use (MCP / Function Calling)?',
        options: [
          'Да, проектировал и запускал в продакшен с eval-метриками',
          'Только прототипы и пет-проекты',
          'Опыта пока нет',
        ],
        answer: 'Да, проектировал и запускал в продакшен с eval-метриками',
        factSource: 'Resume #1 · Bullet #1 & #3',
        needsReview: true,
      },
      {
        id: 'q-10-3',
        type: 'checkbox',
        prompt: 'Какие базы данных и векторные хранилища вы использовали в продакшене?',
        options: ['PostgreSQL', 'pgvector', 'Redis', 'ClickHouse'],
        answer: ['PostgreSQL', 'pgvector', 'Redis'],
        factSource: 'Resume #1 · Tech Stack',
        needsReview: true,
      },
    ],
  },
  {
    id: 'vac-11',
    hhId: '109481340',
    company: 'Marvel Distribution',
    title: 'Ведущий менеджер по закупкам (Китай, компоненты и OEM)',
    cityFormat: 'Москва · Hybrid',
    salary: '280–340k ₽',
    stage: 'awaiting_approval',
    matchedResumeId: 'res-5',
    atsScore: 93,
    resumeScores: {
      'res-5': { overall: 93, hardSkills: 96, domain: 95, seniority: 88 },
      'res-6': { overall: 60, hardSkills: 54, domain: 66, seniority: 60 },
      'res-4': { overall: 47, hardSkills: 44, domain: 50, seniority: 47 },
      'res-3': { overall: 41, hardSkills: 37, domain: 43, seniority: 43 },
      'res-2': { overall: 30, hardSkills: 26, domain: 30, seniority: 34 },
      'res-1': { overall: 22, hardSkills: 18, domain: 21, seniority: 27 },
    },
    scoreLedger: [
      { delta: 20, rule: '7.0 yrs direct OEM/ODM electronics sourcing in Shenzhen/Dongguan' },
      { delta: 15, rule: '-16.5% BOM cost reduction & AQL 2.5 pre-shipment QC' },
      { delta: 12, rule: 'Full VED, HS codes, EAC certification & multimodal logistics' },
      { delta: -4, rule: 'Spoken Mandarin at conversational HSK3 level' },
    ],
    coverLetter:
      'Добрый день! 7 лет веду прямые закупки электроники, PCB и IoT-комплектующих на 45+ проверенных фабриках Шэньчжэня и Дунгуаня. За счёт прямых OEM/ODM-контрактов и пересмотра BOM-спецификаций снизил закупочную себестоимость на 16.5%, обеспечив контроль качества по стандарту AQL 2.5 до отгрузки. Полностью закрываю ВЭД: подбор кодов ТН ВЭД, сертификацию ЕАЭС, валютные платежи и мультимодальную логистику. Готов обсудить задачи направления.',
    cleanDraft:
      'Добрый день! 7 лет специализируюсь на прямых закупках электроники, PCB и IoT-компонентов (45+ фабрик в Шэньчжэне и Дунгуане). Пересмотр BOM и прямые OEM/ODM-условия позволили снизить себестоимость на 16.5% при приёмке по AQL 2.5. Веду полный цикл ВЭД, коды ТН ВЭД и сертификацию ЕАЭС. Буду рад обсудить KPI отдела.',
    questions: [
      {
        id: 'q-11-1',
        type: 'text',
        prompt: 'Укажите ваши ожидания по совокупному доходу (net) в рублях.',
        answer: '310 000 ₽ net (фикс + квартальный бонус за снижение BOM-себестоимости и соблюдение сроков поставки).',
        factSource: 'Resume #5 · Target Comp',
        needsReview: false,
      },
    ],
  },
  {
    id: 'vac-12',
    hhId: '109481122',
    company: 'Selectel',
    title: 'Solutions / Presales Architect (GPU Cloud & AI)',
    cityFormat: 'Санкт-Петербург · Remote',
    salary: '340–420k ₽',
    stage: 'awaiting_approval',
    matchedResumeId: 'res-4',
    atsScore: 88,
    resumeScores: {
      'res-4': { overall: 88, hardSkills: 90, domain: 91, seniority: 83 },
      'res-1': { overall: 79, hardSkills: 83, domain: 76, seniority: 78 },
      'res-3': { overall: 71, hardSkills: 65, domain: 75, seniority: 73 },
      'res-2': { overall: 66, hardSkills: 64, domain: 68, seniority: 66 },
      'res-5': { overall: 25, hardSkills: 20, domain: 24, seniority: 31 },
      'res-6': { overall: 25, hardSkills: 19, domain: 24, seniority: 32 },
    },
    scoreLedger: [
      { delta: 17, rule: '60+ Enterprise PoC pilots & cloud architecture workshops' },
      { delta: 15, rule: 'Closed 14 B2B contracts (190M+ ₽ ARR) via TCO/ROI models' },
      { delta: 11, rule: 'Full RFP/RFI technical ownership & InfoSec compliance' },
      { delta: -5, rule: 'Kubernetes CKA certification listed as in-progress' },
    ],
    coverLetter:
      'Здравствуйте! 5 лет работаю на стыке облачной архитектуры и технического пресейла для Enterprise-заказчиков. Провёл 60+ кастомных PoC-демонстраций для банков и телекома, что помогло закрыть 14 контрактов на сумму свыше 190 млн ₽ ARR. Беру на себя полную проработку RFP/RFI, моделирование TCO/ROI миграции и защиту архитектуры перед ИБ. Компании обязаны прозрачно считать экономику GPU-кластеров — готов обсудить задачи Selectel.',
    cleanDraft:
      'Здравствуйте! 5 лет работаю на стыке облачной архитектуры и технического пресейла для Enterprise-заказчиков. Провёл 60+ кастомных PoC-демонстраций для банков и телекома, что помогло закрыть 14 контрактов на сумму свыше 190 млн ₽ ARR. Беру на себя полную проработку RFP/RFI, моделирование TCO/ROI миграции и защиту архитектуры перед ИБ. Командам важно прозрачно считать экономику GPU-кластеров — готов обсудить задачи Selectel.',
    questions: [
      {
        id: 'q-12-1',
        type: 'text',
        prompt: 'Какой максимальный годовой контракт вы сопровождали в роли технического пресейла?',
        answer: '34 млн ₽ ARR — гибридная облачная инфраструктура и выделенный GPU-кластер для финтех-заказчика.',
        factSource: 'Resume #4 · Deal Track Record',
        needsReview: true,
      },
      {
        id: 'q-12-2',
        type: 'radio',
        prompt: 'Готовы ли вы проводить технические воркшопы и защищать архитектуру перед CISO заказчика?',
        options: [
          'Да, регулярная практика (60+ воркшопов и защит ИБ)',
          'Только в составе команды с ведущим архитектором',
          'Нет',
        ],
        answer: 'Да, регулярная практика (60+ воркшопов и защит ИБ)',
        factSource: 'Resume #4 · Bullet #1 & #3',
        needsReview: true,
      },
    ],
  },
  {
    id: 'vac-13',
    hhId: '109480915',
    company: 'Альфа-Банк (Alfa Digital)',
    title: 'Lead IT-аналитик / AI-автоматизатор бэк-офиса',
    cityFormat: 'Москва · Remote',
    salary: '320–390k ₽',
    stage: 'awaiting_approval',
    matchedResumeId: 'res-2',
    atsScore: 90,
    resumeScores: {
      'res-2': { overall: 90, hardSkills: 92, domain: 91, seniority: 87 },
      'res-1': { overall: 81, hardSkills: 85, domain: 78, seniority: 80 },
      'res-3': { overall: 75, hardSkills: 69, domain: 79, seniority: 77 },
      'res-4': { overall: 64, hardSkills: 62, domain: 66, seniority: 64 },
      'res-5': { overall: 23, hardSkills: 18, domain: 22, seniority: 29 },
      'res-6': { overall: 25, hardSkills: 19, domain: 24, seniority: 32 },
    },
    scoreLedger: [
      { delta: 18, rule: '24 automated workflows via n8n, Python & REST/Webhook API' },
      { delta: 14, rule: '80+ BRD/SRS, BPMN 2.0 & OpenAPI contracts in fintech' },
      { delta: 12, rule: 'PostgreSQL cohort analytics (-14 hrs/wk manual reporting)' },
      { delta: -4, rule: 'Camunda 8 BPMN engine experience listed as nice-to-have' },
    ],
    coverLetter:
      'Добрый день! 6 лет проектирую финтех-процессы, интеграционные API и AI-автоматизацию бэк-офиса. Внедрил 24 автоматизированных пайплайна на связке n8n, Python и REST/Webhook API, что сократило ручные операции на 14+ часов в неделю. Свободно пишу сложные запросы в PostgreSQL, проектирую схемы в BPMN 2.0 и спецификации OpenAPI для LLM-ассистентов. Буду рад обсудить задачи в Альфа-Банке.',
    cleanDraft:
      'Добрый день! 6 лет проектирую финтех-процессы, API-контракты и AI-автоматизацию бэк-офиса. Запустил 24 пайплайна на n8n, Python и REST/Webhook API (-14 ч/нед ручных операций). Владею сложным SQL в PostgreSQL, BPMN 2.0 и OpenAPI. Готов обсудить задачи команды.',
    questions: [
      {
        id: 'q-13-1',
        type: 'radio',
        prompt: 'Сколько производственных пайплайнов автоматизации вы запустили на Python / n8n / API?',
        options: [
          'Более 20 пайплайнов в продакшене',
          '5–15 пайплайнов',
          'Менее 5 пайплайнов',
        ],
        answer: 'Более 20 пайплайнов в продакшене',
        factSource: 'Resume #2 · Bullet #1',
        needsReview: true,
      },
      {
        id: 'q-13-2',
        type: 'text',
        prompt: 'Опишите ваш опыт работы с SQL и оптимизацией запросов.',
        answer: 'Ежедневно использую CTE, оконные функции и разбор планов EXPLAIN ANALYZE в PostgreSQL для аналитических витрин.',
        factSource: 'Resume #2 · Bullet #3',
        needsReview: false,
      },
    ],
  },

  // --- EXIT 05A: APPROVED & SENT (3) ---
  {
    id: 'vac-14',
    hhId: '109478902',
    company: 'Positive Technologies',
    title: 'Senior Fullstack Developer (AI Security Copilot)',
    cityFormat: 'Москва · Remote',
    salary: '390–460k ₽',
    stage: 'approved',
    matchedResumeId: 'res-1',
    atsScore: 91,
    resumeScores: {
      'res-1': { overall: 91, hardSkills: 94, domain: 90, seniority: 89 },
      'res-4': { overall: 74, hardSkills: 72, domain: 78, seniority: 72 },
      'res-2': { overall: 72, hardSkills: 70, domain: 74, seniority: 72 },
      'res-3': { overall: 67, hardSkills: 61, domain: 71, seniority: 69 },
      'res-5': { overall: 19, hardSkills: 14, domain: 18, seniority: 25 },
      'res-6': { overall: 21, hardSkills: 15, domain: 20, seniority: 28 },
    },
    scoreLedger: [
      { delta: 18, rule: 'TypeScript, React 19, Node.js & Python FastAPI fullstack' },
      { delta: 15, rule: 'MCP tool-use gateways & deterministic JSON schema validation' },
      { delta: 12, rule: 'High-load telemetry UI & 99.94% availability' },
      { delta: -4, rule: 'ClickHouse OLAP queries listed as optional plus' },
    ],
    coverLetter:
      'Здравствуйте! Проектирую высоконагруженные интерфейсы и AI-агентов на TypeScript, React 19, Node.js и Python (FastAPI). Запустил production RAG-контур со снижением p95 latency на 62%, MCP-шлюзами инструментов и строгой валидацией JSON-схем. Готов подключиться к развитию AI Security Copilot в Positive Technologies.',
    cleanDraft:
      'Здравствуйте! Разрабатываю высоконагруженные интерфейсы и AI-агентов на TypeScript, React 19, Node.js и Python (FastAPI). Запустил RAG-пайплайн со снижением latency на 62%, MCP-интеграциями и валидацией JSON-схем. Буду рад обсудить задачи Positive Technologies.',
    questions: [],
  },
  {
    id: 'vac-15',
    hhId: '109474310',
    company: 'Lamoda Tech',
    title: 'Product Manager (AI Merchandising & Sizing)',
    cityFormat: 'Москва · Remote',
    salary: '350–420k ₽',
    stage: 'sent',
    employerBadge: 'Просмотрено · 18m ago',
    matchedResumeId: 'res-3',
    atsScore: 89,
    resumeScores: {
      'res-3': { overall: 89, hardSkills: 90, domain: 90, seniority: 87 },
      'res-2': { overall: 78, hardSkills: 76, domain: 80, seniority: 78 },
      'res-1': { overall: 77, hardSkills: 80, domain: 75, seniority: 76 },
      'res-4': { overall: 63, hardSkills: 60, domain: 66, seniority: 63 },
      'res-5': { overall: 27, hardSkills: 22, domain: 27, seniority: 32 },
      'res-6': { overall: 35, hardSkills: 30, domain: 36, seniority: 39 },
    },
    scoreLedger: [
      { delta: 17, rule: '6.5 yrs IT Product Management & 3 cross-functional squads' },
      { delta: 14, rule: '+19% paid conversion lift via 45+ CustDev & A/B tests' },
      { delta: 12, rule: 'Unit economics LTV/CAC & SQL cohort analysis' },
      { delta: -4, rule: 'Fashion retail CV models experience is adjacent' },
    ],
    coverLetter:
      'Здравствуйте! 6.5 лет развиваю IT-продукты и управляю командами разработки. На прошлом месте провёл 45+ CustDev-интервью и серию A/B-тестов, увеличив конверсию в оплату на 19% и укрепив юнит-экономику LTV/CAC. Сам считаю когорты в SQL и выстраиваю работу с ML-инженерами. Готов обсудить задачи в Lamoda Tech.',
    cleanDraft:
      'Здравствуйте! 6.5 лет развиваю IT-продукты и управляю командами разработки. Провёл 45+ CustDev-интервью и серию A/B-тестов (+19% к конверсии в оплату, рост LTV/CAC). Считаю когорты в SQL и плотно работаю с ML-командой. Готов обсудить задачи Lamoda Tech.',
    questions: [],
  },
  {
    id: 'vac-16',
    hhId: '109471804',
    company: 'Точка Банк',
    title: 'Senior Fullstack Engineer (AI Business Assistant)',
    cityFormat: 'Москва · Remote',
    salary: '360–440k ₽',
    stage: 'sent',
    employerBadge: 'Приглашение · Чт 15:00',
    matchedResumeId: 'res-1',
    atsScore: 94,
    resumeScores: {
      'res-1': { overall: 94, hardSkills: 96, domain: 94, seniority: 92 },
      'res-2': { overall: 77, hardSkills: 74, domain: 81, seniority: 76 },
      'res-3': { overall: 70, hardSkills: 62, domain: 76, seniority: 72 },
      'res-4': { overall: 66, hardSkills: 63, domain: 69, seniority: 66 },
      'res-5': { overall: 19, hardSkills: 14, domain: 18, seniority: 25 },
      'res-6': { overall: 21, hardSkills: 15, domain: 20, seniority: 28 },
    },
    scoreLedger: [
      { delta: 19, rule: 'TypeScript + React 19 + Node.js + Python FastAPI exact stack' },
      { delta: 15, rule: 'Production multi-agent RAG & MCP tool-use orchestration' },
      { delta: 13, rule: '62% p95 latency reduction & automated LLM eval harnesses' },
      { delta: -3, rule: 'GraphQL federation listed as optional' },
    ],
    coverLetter:
      'Привет! Проектирую AI-ассистентов и веб-интерфейсы на TypeScript, React 19, Node.js и Python. Построил production RAG-пайплайн на FastAPI и pgvector со снижением p95 latency на 62% при 180k MAU, MCP-шлюзами инструментов и eval-тестами. Рад приглашению на техническое интервью в Точку!',
    cleanDraft:
      'Привет! Проектирую AI-ассистентов и веб-интерфейсы на TypeScript, React 19, Node.js и Python. Построил production RAG-пайплайн на FastAPI и pgvector со снижением p95 latency на 62% при 180k MAU, MCP-шлюзами и eval-тестами. Готов к техническому интервью.',
    questions: [],
  },

  // --- EXIT 05B: SKIPPED / ARCHIVED (2) ---
  {
    id: 'vac-17',
    hhId: '109469220',
    company: 'Legacy Telecom',
    title: 'Senior PHP 7.4 / 1C-Bitrix Developer',
    cityFormat: 'Москва · Office',
    salary: '140–170k ₽',
    stage: 'skipped',
    skipTag: 'ATS < 65%',
    skipReason: 'ATS 42% < 65% threshold · Legacy PHP/Bitrix stack mismatch',
    matchedResumeId: 'res-1',
    atsScore: 42,
    resumeScores: {
      'res-1': { overall: 42, hardSkills: 34, domain: 46, seniority: 46 },
      'res-2': { overall: 38, hardSkills: 30, domain: 42, seniority: 42 },
      'res-3': { overall: 34, hardSkills: 28, domain: 36, seniority: 38 },
      'res-4': { overall: 31, hardSkills: 26, domain: 33, seniority: 34 },
      'res-5': { overall: 15, hardSkills: 10, domain: 14, seniority: 21 },
      'res-6': { overall: 18, hardSkills: 12, domain: 18, seniority: 24 },
    },
    scoreLedger: [
      { delta: 10, rule: 'General SQL & HTTP API fundamentals' },
      { delta: -18, rule: 'Core 1C-Bitrix & PHP 7.4 requirement absent' },
    ],
    coverLetter: 'Автоматический пропуск на ветке ATS < 65% (42%).',
    cleanDraft: 'Автоматический пропуск на ветке ATS < 65% (42%).',
    questions: [],
  },
  {
    id: 'vac-18',
    hhId: '109468904',
    company: 'Regional FMCG Group',
    title: 'Категорийный менеджер (Продукты питания)',
    cityFormat: 'Казань · Office',
    salary: '130–160k ₽',
    stage: 'skipped',
    skipTag: 'ATS < 65%',
    skipReason: 'ATS 48% < 65% threshold · FMCG domain vs Electronics OEM',
    matchedResumeId: 'res-5',
    atsScore: 48,
    resumeScores: {
      'res-5': { overall: 48, hardSkills: 44, domain: 46, seniority: 54 },
      'res-6': { overall: 45, hardSkills: 40, domain: 44, seniority: 51 },
      'res-3': { overall: 36, hardSkills: 32, domain: 36, seniority: 40 },
      'res-2': { overall: 28, hardSkills: 24, domain: 28, seniority: 32 },
      'res-4': { overall: 25, hardSkills: 22, domain: 24, seniority: 29 },
      'res-1': { overall: 18, hardSkills: 14, domain: 16, seniority: 24 },
    },
    scoreLedger: [
      { delta: 12, rule: 'Supplier contract negotiation & margin control' },
      { delta: -14, rule: 'FMCG perishable supply chain vs China electronics OEM' },
    ],
    coverLetter: 'Автоматический пропуск на ветке ATS < 65% (48%).',
    cleanDraft: 'Автоматический пропуск на ветке ATS < 65% (48%).',
    questions: [],
  },
];

// ============================================================================
// 5. SVG BEZIER GRAPH GEOMETRY (EXPANDED 1760 x 780 HIGH-DENSITY COORDINATE SPACE)
// ============================================================================

const GRAPH_PATHS = {
  // Node 01 (x:20..300, y:40..570) -> Node 02 (x:360..670, y:40..590)
  e1_2: 'M 300 280 C 330 280, 330 280, 360 280',
  // Node 02 Pass (>=65%) -> Node 03 (x:740..1040, y:40..530)
  e2_3: 'M 670 230 C 705 230, 705 230, 740 230',
  // Node 03 -> Node 04 HITL (x:1110..1440, y:40..590)
  e3_4: 'M 1040 230 C 1075 230, 1075 230, 1110 230',
  // Node 04 HITL Approve -> Terminal Exit 05A: ВЫХОД: ОТКЛИК (x:1510..1750, y:30..350)
  e4_approve: 'M 1440 165 C 1475 165, 1475 165, 1510 165',
  // Node 04 HITL Skip -> Terminal Exit 05B: ВЫХОД: ПРОПУСК (x:1510..1750, y:380..730)
  e4_skip: 'M 1440 400 C 1475 400, 1475 460, 1510 460',
  // Node 02 Fail (<65%) -> Terminal Exit 05B: ВЫХОД: ПРОПУСК along bottom corridor
  e2_skip: 'M 670 490 C 780 675, 1310 675, 1510 640',
};

// ============================================================================
// 5.5 LIVE BACKEND ADAPTER HELPERS
// ============================================================================

function mapDbResumeToUi(dbRes, index) {
  const shortCode = `R${index + 1}`;
  const hexes = ['#0284c7', '#6366f1', '#10b981', '#14b8a6', '#f43f5e', '#f59e0b'];
  const accentHex = hexes[index % hexes.length];
  const words = dbRes.text ? dbRes.text.split(/\s+/).filter(Boolean).length : 380;
  return {
    id: dbRes.id,
    shortCode,
    filterLabel: `${index + 1}. ${(dbRes.title || 'Резюме').slice(0, 15)}`,
    title: dbRes.title || 'Резюме',
    hhId: dbRes.externalId || `hh_${String(dbRes.id).slice(0, 8)}`,
    atsReadiness: dbRes.reviewScore || 90,
    wordCount: words,
    visibility: dbRes.visibility || 'public',
    auditStatus: dbRes.visibility === 'hidden' ? 'Blocked · Hidden on hh.ru' : 'Verified · Clean',
    experience: '5.0+ yrs',
    compRange: '300–450k ₽',
    accentHex,
    skills: dbRes.skills || ['TypeScript', 'React', 'Node.js', 'Python', 'FastAPI', 'PostgreSQL', 'AI/RAG'],
    facts: dbRes.facts || [
      'Опыт разработки и проектирования высоконагруженных систем и AI-агентов.',
      'Успешный запуск продакшен-сервисов со строгими требованиями к аптайму и latency.',
      'Навыки оптимизации архитектуры и автоматизации сквозных процессов.',
    ],
    raw: dbRes,
  };
}

function mapDbVacancyToUi(dbVac, resumesList, fallbackIndex = 0) {
  const hhId = dbVac.key ? dbVac.key.replace(/^[^:]+:/, '') : String(dbVac.id || fallbackIndex);
  let matchedResumeId = 'res-1';
  if (dbVac.resumeId) {
    matchedResumeId = dbVac.resumeId;
  } else if (resumesList && resumesList.length > 0) {
    matchedResumeId = resumesList[0].id;
  }

  const questions = (dbVac.form?.questions || []).map((q) => {
    const existingAns = (dbVac.answers || []).find((a) => a.id === q.id);
    const answerText = existingAns ? (existingAns.text || (existingAns.values || []).join(', ')) : '';
    return {
      id: q.id,
      type: q.kind === 'choice' ? 'radio' : 'text',
      prompt: q.label || q.text || q.id,
      options: (q.options || []).map((o) => typeof o === 'string' ? o : (o.label || o.value)),
      answer: answerText,
      factSource: 'Анализ резюме',
      needsReview: !existingAns,
    };
  });

  const atsScore = dbVac.fitScore || 85;
  const resumeScores = {};
  (resumesList || []).forEach((r, idx) => {
    const scoreVal = idx === 0 ? atsScore : Math.max(30, atsScore - (idx * 9));
    resumeScores[r.id] = {
      overall: scoreVal,
      hardSkills: Math.min(99, scoreVal + 3),
      domain: Math.max(20, scoreVal - 2),
      seniority: Math.max(20, scoreVal - 4),
    };
  });

  const stage = dbVac.status || 'found';

  return {
    id: dbVac.key || `vac-db-${hhId}`,
    rawKey: dbVac.key,
    hhId,
    company: dbVac.company || dbVac.employer || 'Компания',
    title: dbVac.title || 'Вакансия',
    cityFormat: dbVac.address || (dbVac.city ? `${dbVac.city} · Удалённо` : 'Москва · Удалённо'),
    salary: dbVac.salary || 'Не указана',
    stage,
    matchedResumeId,
    atsScore,
    resumeScores: Object.keys(resumeScores).length > 0 ? resumeScores : {
      'res-1': { overall: atsScore, hardSkills: 88, domain: 84, seniority: 83 },
      'res-2': { overall: 72, hardSkills: 70, domain: 74, seniority: 72 },
      'res-3': { overall: 65, hardSkills: 60, domain: 68, seniority: 67 },
      'res-4': { overall: 63, hardSkills: 60, domain: 65, seniority: 64 },
      'res-5': { overall: 20, hardSkills: 16, domain: 19, seniority: 25 },
      'res-6': { overall: 22, hardSkills: 17, domain: 21, seniority: 28 },
    },
    scoreLedger: [
      { delta: 18, rule: 'Соответствие ключевым технологиям стека' },
      { delta: 14, rule: 'Релевантный подтверждённый опыт в схожих проектах' },
      { delta: 10, rule: 'Навыки проектирования и построения архитектуры' },
      { delta: -4, rule: 'Некоторые второстепенные требования требуют адаптации' },
    ],
    coverLetter: dbVac.letterText || 'Здравствуйте! Ознакомился с вакансией и задачами вашей команды. Готов подробно рассказать о своём опыте на интервью.',
    cleanDraft: dbVac.letterText || 'Здравствуйте! Ознакомился с вакансией и задачами вашей команды. Готов подробно рассказать о своём опыте на интервью.',
    questions,
  };
}

// ============================================================================
// 6. MAIN APPLICATION COMPONENT
// ============================================================================

export default function App() {
  // Core State
  const [resumes, setResumes] = useState(INITIAL_RESUMES);
  const [vacancies, setVacancies] = useState([]);
  const [cronPolls, setCronPolls] = useState(INITIAL_CRON_POLLS);
  const [streamPoolIdx, setStreamPoolIdx] = useState(0);
  const [parsedTotalCount, setParsedTotalCount] = useState(50);

  // View Switcher (F1-F4): 'tree' (Дерево 24/7) | 'kanban' (Канбан 6) | 'hr' (Отклики & HR) | 'resumes' (Резюме 6)
  const [activeView, setActiveView] = useState('tree');

  // 24/7 Autonomous Daemon Engine State
  const [auto247, setAuto247] = useState(true);
  const [daemonSpeed, setDaemonSpeed] = useState(1); // 1 | 5
  const [autoPilotHighScore, setAutoPilotHighScore] = useState(false); // Авто-отклик >= 88% без анкеты
  const [uptimeSeconds, setUptimeSeconds] = useState(14 * 86400 + 7 * 3600 + 42 * 60 + 18);
  const [pollCountdown, setPollCountdown] = useState(12);
  const [mcpLatencyMs, setMcpLatencyMs] = useState(14);
  const [quotaSent, setQuotaSent] = useState(4);
  const quotaMax = 20;
  const [throttleSec, setThrottleSec] = useState(0);
  const [runningBatch, setRunningBatch] = useState(false);
  const [syncingResponses, setSyncingResponses] = useState(false);

  // Workspace Panels: Right 24/7 Radar Sidebar & Bottom journalctl Console
  const [showRightSidebar, setShowRightSidebar] = useState(true);
  const [consoleExpanded, setConsoleExpanded] = useState(true);
  const [logFilter, setLogFilter] = useState('ALL'); // 'ALL' | 'HH-POLL' | 'ATS-TEST' | 'LLM-LINT' | 'HITL-GATE' | 'DISPATCH'
  const [cliInput, setCliInput] = useState('');

  // Interactive Decision Tree Trace & Viewport Controls
  const [treeZoom, setTreeZoom] = useState(135);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef({ x: 0, y: 0 });

  // Live Step-by-Step Token Animation State
  const [activeTrace, setActiveTrace] = useState(null);
  const [isTracingSingle, setIsTracingSingle] = useState(false);
  const traceTimersRef = useRef([]);

  // Filters
  const [resumeFilter, setResumeFilter] = useState('all'); // 'all' | 'res-1'..'res-6'
  const [bottleneckFilter, setBottleneckFilter] = useState('all'); // 'all' | 'questions' | 'hidden_resume'
  const [kanbanStageFilter, setKanbanStageFilter] = useState(null);
  const [showSkippedKanban, setShowSkippedKanban] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Slide-Over Vacancy Inspection Drawer
  const [inspectedId, setInspectedId] = useState(null);
  const [drawerTab, setDrawerTab] = useState('battle'); // 'battle' | 'ledger' | 'linter' | 'questions'
  const [regenerating, setRegenerating] = useState(false);

  // Live journalctl Daemon Stream Logs
  const [executionLogs, setExecutionLogs] = useState([
    {
      id: 'log-boot-1',
      ts: new Date().toTimeString().slice(0, 8),
      subsys: 'SYSTEM',
      vacancyId: null,
      text: 'JobFit Copilot Mission Control запущен. Загрузка данных из SQLite...',
      tone: 'indigo',
    },
    {
      id: 'log-boot-2',
      ts: new Date().toTimeString().slice(0, 8),
      subsys: 'LLM-LINT',
      vacancyId: null,
      text: 'FastAPI_CDEKLLM: yandex/deepseek-v4.1-flash активен · Анти-штамп линтер готов',
      tone: 'emerald',
    },
    {
      id: 'log-boot-3',
      ts: new Date().toTimeString().slice(0, 8),
      subsys: 'HITL-GATE',
      vacancyId: null,
      text: 'Шлюз HITL: режим 95% фоновой работы / 5% одобрение оператором активен',
      tone: 'sky',
    },
  ]);

  const appendLog = useCallback((vacancyId, text, tone = 'indigo', subsys = 'SYSTEM') => {
    const ts = new Date().toTimeString().slice(0, 8);
    setExecutionLogs((prev) => [
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        ts,
        subsys,
        vacancyId,
        text,
        tone,
      },
      ...prev.slice(0, 49),
    ]);
  }, []);

  // Toast Notifications
  const [toasts, setToasts] = useState([]);
  const notify = useCallback((title, detail, type = 'info') => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setToasts((prev) => [...prev.slice(-2), { id, title, detail, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3200);
  }, []);

  // Live API Synchronization Hook
  useEffect(() => {
    let mounted = true;
    async function syncWithBackend() {
      try {
        const [statsRes, fsmRes, autoRes, llmRes, pipeRes, resumesRes] = await Promise.allSettled([
          fetch('/api/stats').then((r) => (r.ok ? r.json() : null)),
          fetch('/api/fsm/summary').then((r) => (r.ok ? r.json() : null)),
          fetch('/api/autopilot/status').then((r) => (r.ok ? r.json() : null)),
          fetch('/api/llm/status').then((r) => (r.ok ? r.json() : null)),
          fetch('/api/pipeline').then((r) => (r.ok ? r.json() : null)),
          fetch('/api/resumes').then((r) => (r.ok ? r.json() : null)),
        ]);

        if (!mounted) return;

        const isBackendUp = statsRes.status === 'fulfilled' && statsRes.value !== null;
        if (isBackendUp) {
          if (llmRes.status === 'fulfilled' && llmRes.value) {
            if (llmRes.value.connected && llmRes.value.model) {
              setMcpLatencyMs(12);
            }
          }

          if (resumesRes.status === 'fulfilled' && resumesRes.value?.items && resumesRes.value.items.length > 0) {
            const mappedResumes = resumesRes.value.items.map((r, i) => mapDbResumeToUi(r, i));
            setResumes(mappedResumes);
          }

          if (fsmRes.status === 'fulfilled' && fsmRes.value) {
            if (fsmRes.value.metrics?.totalActive) {
              setParsedTotalCount(fsmRes.value.metrics.totalActive);
            }
            if (fsmRes.value.metrics?.sentToday !== undefined) {
              setQuotaSent(fsmRes.value.metrics.sentToday);
            }
          }

          if (autoRes.status === 'fulfilled' && autoRes.value && typeof autoRes.value.running === 'boolean') {
            setAuto247(autoRes.value.running);
          }

          if (pipeRes.status === 'fulfilled' && pipeRes.value?.items && pipeRes.value.items.length > 0) {
            const dbVacancies = pipeRes.value.items.map((v, i) => mapDbVacancyToUi(v, resumes, i));
            setVacancies(dbVacancies);
            setParsedTotalCount(pipeRes.value.items.length);
          }
        }
      } catch (err) {
        console.warn('API sync warning:', err);
      }
    }

    syncWithBackend();
    const interval = setInterval(syncWithBackend, 8000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  // Live Vacancy Inspection Details
  useEffect(() => {
    if (!inspectedId) return;
    const v = vacancies.find((x) => x.id === inspectedId);
    if (!v) return;
    const key = v.rawKey || v.id;
    if (!String(key).startsWith('hh.ru:')) return;
    fetch(`/api/vacancies/${encodeURIComponent(key)}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (!data) return;
        setVacancies((prev) =>
          prev.map((item) => {
            if (item.id !== inspectedId) return item;
            const latestLetter = data.letters?.[0];
            const fitAnalysis = (data.analyses || []).find((a) => a.kind === 'fit');
            const atsAnalysis = (data.analyses || []).find((a) => a.kind === 'ats');
            const realLedger = fitAnalysis?.payload?.ledger;
            const atsPayload = atsAnalysis?.payload;
            const fitPayload = fitAnalysis?.payload;
            const rankedComparison = data.comparison || [];

            // Подтягиваем реальные ATS скоры из comparison
            const nextResumeScores = { ...item.resumeScores };
            rankedComparison.forEach((c) => {
              if (c.resumeId) {
                nextResumeScores[c.resumeId] = {
                  overall: c.overall ?? 50,
                  hardSkills: c.hardCoverage ?? c.overall ?? 50,
                  domain: c.overall ?? 50,
                  seniority: c.overall ?? 50,
                };
              }
            });

            return {
              ...item,
              coverLetter: latestLetter?.text || item.coverLetter,
              cleanDraft: latestLetter?.text || item.cleanDraft,
              letterId: latestLetter?.id || item.letterId,
              description: data.vacancy?.description || item.description,
              analyses: data.analyses || [],
              comparison: rankedComparison,
              resumeScores: nextResumeScores,
              scoreLedger: Array.isArray(realLedger) && realLedger.length > 0
                ? realLedger.map((l) => ({ delta: l.delta, rule: l.text }))
                : item.scoreLedger,
              atsPayload,
              fitPayload,
              atsScore: fitAnalysis?.score ?? item.atsScore,
            };
          })
        );
      })
      .catch(() => {});
  }, [inspectedId]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      traceTimersRef.current.forEach((id) => clearTimeout(id));
    };
  }, []);

  // 1-Second System Clock: Uptime, MCP Ping, Rate Throttle & Cron Poll Countdown
  useEffect(() => {
    const timer = setInterval(() => {
      setUptimeSeconds((s) => s + 1);
      setMcpLatencyMs(11 + Math.floor(Math.random() * 6));
      setThrottleSec((s) => (s > 0 ? s - 1 : 0));
      setPollCountdown((c) => {
        if (!auto247) return c;
        return c <= 1 ? (daemonSpeed === 5 ? 4 : 12) : c - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [auto247, daemonSpeed]);

  // Format Uptime (e.g. 14d 07h 42m)
  const formattedUptime = useMemo(() => {
    const days = Math.floor(uptimeSeconds / 86400);
    const hrs = Math.floor((uptimeSeconds % 86400) / 3600);
    const mins = Math.floor((uptimeSeconds % 3600) / 60);
    return `${days}d ${String(hrs).padStart(2, '0')}h ${String(mins).padStart(2, '0')}m`;
  }, [uptimeSeconds]);

  // Derived Maps & Counts
  const resumeMap = useMemo(
    () =>
      resumes.reduce((acc, r) => {
        acc[r.id] = r;
        return acc;
      }, {}),
    [resumes]
  );

  const nonSkippedVacancies = useMemo(
    () => vacancies.filter((v) => v.stage !== 'skipped'),
    [vacancies]
  );

  const skippedVacancies = useMemo(
    () => vacancies.filter((v) => v.stage === 'skipped'),
    [vacancies]
  );

  const blockedQuestionsCount = useMemo(
    () =>
      nonSkippedVacancies.filter(
        (v) =>
          v.stage !== 'sent' &&
          v.questions &&
          v.questions.some((q) => q.needsReview)
      ).length,
    [nonSkippedVacancies]
  );

  const blockedHiddenResumeCount = useMemo(
    () =>
      nonSkippedVacancies.filter((v) => {
        if (v.stage === 'sent') return false;
        const r = resumeMap[v.matchedResumeId];
        return r && r.visibility === 'hidden';
      }).length,
    [nonSkippedVacancies, resumeMap]
  );

  // Predicate checking if a vacancy matches current Resume + Bottleneck + Search filters
  const matchesFilters = useCallback(
    (v) => {
      if (resumeFilter !== 'all' && v.matchedResumeId !== resumeFilter) {
        return false;
      }

      if (bottleneckFilter === 'questions') {
        const hasPendingQ =
          v.stage !== 'sent' &&
          v.stage !== 'skipped' &&
          v.questions &&
          v.questions.some((q) => q.needsReview);
        if (!hasPendingQ) return false;
      }

      if (bottleneckFilter === 'hidden_resume') {
        const r = resumeMap[v.matchedResumeId];
        const isHidden =
          v.stage !== 'sent' && v.stage !== 'skipped' && r && r.visibility === 'hidden';
        if (!isHidden) return false;
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const r = resumeMap[v.matchedResumeId];
        const hit =
          v.title.toLowerCase().includes(q) ||
          v.company.toLowerCase().includes(q) ||
          v.cityFormat.toLowerCase().includes(q) ||
          v.hhId.includes(q) ||
          (r && (r.title.toLowerCase().includes(q) || r.filterLabel.toLowerCase().includes(q)));
        if (!hit) return false;
      }

      return true;
    },
    [resumeFilter, bottleneckFilter, searchQuery, resumeMap]
  );

  const hasActiveFilter =
    resumeFilter !== 'all' || bottleneckFilter !== 'all' || searchQuery.trim().length > 0;

  const inspectedVacancy = useMemo(
    () => vacancies.find((v) => v.id === inspectedId) || null,
    [vacancies, inspectedId]
  );

  // ============================================================================
  // 7. GLOBAL KEYBOARD SHORTCUTS (F1-F4 VIEW SWITCH + DRAWER Esc, 1-4, [ and ])
  // ============================================================================

  useEffect(() => {
    const onKeyDown = (e) => {
      const tag = e.target.tagName.toLowerCase();
      const isInput = tag === 'input' || tag === 'textarea' || tag === 'select';

      // F1 - F4 Top View Navigation
      if (e.key === 'F1') {
        e.preventDefault();
        setActiveView('tree');
        return;
      }
      if (e.key === 'F2') {
        e.preventDefault();
        setActiveView('kanban');
        return;
      }
      if (e.key === 'F3') {
        e.preventDefault();
        setActiveView('hr');
        return;
      }
      if (e.key === 'F4') {
        e.preventDefault();
        setActiveView('resumes');
        return;
      }

      if (!inspectedId) return;

      if (e.key === 'Escape') {
        setInspectedId(null);
        return;
      }

      if (isInput) return;

      if (e.key === '1') setDrawerTab('battle');
      if (e.key === '2') setDrawerTab('ledger');
      if (e.key === '3') setDrawerTab('linter');
      if (e.key === '4') setDrawerTab('questions');

      if (e.key === '[' || e.key === ']') {
        const pool = vacancies.filter(matchesFilters);
        const list = pool.length > 0 ? pool : vacancies;
        const idx = list.findIndex((item) => item.id === inspectedId);
        if (idx !== -1 && list.length > 1) {
          const nextIdx =
            e.key === ']' ? (idx + 1) % list.length : (idx - 1 + list.length) % list.length;
          setInspectedId(list[nextIdx].id);
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [inspectedId, vacancies, matchesFilters]);

  // ============================================================================
  // 8. 24/7 AUTONOMOUS DAEMON LOOP & SINGLE VACANCY TREE EXECUTION
  // ============================================================================

  const injectNextStreamVacancy = useCallback(() => {
    const template = STREAM_INJECTION_POOL[streamPoolIdx % STREAM_INJECTION_POOL.length];
    const nextIdx = streamPoolIdx + 1;
    setStreamPoolIdx(nextIdx);
    setParsedTotalCount((c) => c + 1);

    const uniqueSuffix = String(100 + ((nextIdx * 17) % 899));
    const newVac = {
      ...template,
      id: `${template.id}-${Date.now().toString().slice(-4)}-${uniqueSuffix}`,
      hhId: `${template.hhId.slice(0, 6)}${uniqueSuffix}`,
      stage: 'found',
    };

    setVacancies((prev) => [newVac, ...prev]);
    setCronPolls((prev) =>
      prev.map((cp, idx) =>
        idx === nextIdx % prev.length ? { ...cp, foundToday: cp.foundToday + 1 } : cp
      )
    );
    appendLog(
      newVac.id,
      `cron[hh.ru/${newVac.hhId}]: ${newVac.company} · ${newVac.title} (${newVac.salary}) -> NODE-01`,
      'sky',
      'HH-POLL'
    );
    return newVac;
  }, [streamPoolIdx, appendLog]);

  // Autonomous 24/7 Daemon Heartbeat Stepper
  useEffect(() => {
    if (!auto247 || isTracingSingle) return;

    const intervalMs = daemonSpeed === 5 ? 1900 : 4800;

    const loopTimer = setInterval(() => {
      // Priority 1: Advance one 'found' vacancy -> 'scored'
      const foundVac = vacancies.find((v) => v.stage === 'found');
      if (foundVac) {
        const resObj = resumeMap[foundVac.matchedResumeId] || resumes[0];
        setActiveTrace({
          vacancy: foundVac,
          edgeKey: 'e1_2',
          activeNodeId: 'scored',
          label: foundVac.company,
          hex: '#0284c7',
          atsScanning: true,
        });
        setTimeout(() => {
          setVacancies((prev) =>
            prev.map((v) => (v.id === foundVac.id ? { ...v, stage: 'scored' } : v))
          );
          appendLog(
            foundVac.id,
            `${foundVac.company}: ATS матрица (6 резюме) -> Лучшее ${resObj.shortCode} = ${foundVac.atsScore}%`,
            'indigo',
            'ATS-TEST'
          );
          setActiveTrace(null);
        }, 850);
        return;
      }

      // Priority 2: Fork one 'scored' vacancy -> 'drafted' (>=65%) or 'skipped' (<65%)
      const scoredVac = vacancies.find((v) => v.stage === 'scored');
      if (scoredVac) {
        const resObj = resumeMap[scoredVac.matchedResumeId] || resumes[0];
        const passes = scoredVac.atsScore >= 65;

        if (passes) {
          setActiveTrace({
            vacancy: scoredVac,
            edgeKey: 'e2_3',
            activeNodeId: 'drafted',
            label: `${scoredVac.atsScore}% ✓`,
            hex: '#6366f1',
            atsScanning: false,
          });
          setTimeout(() => {
            setVacancies((prev) =>
              prev.map((v) => (v.id === scoredVac.id ? { ...v, stage: 'drafted' } : v))
            );
            const lint = runCoverLetterLint(scoredVac.coverLetter);
            appendLog(
              scoredVac.id,
              `${scoredVac.company} (${scoredVac.atsScore}% · ${resObj.shortCode}): Письмо ${lint.wordCount}w сгенерировано -> NODE-03`,
              'amber',
              'LLM-LINT'
            );
            setActiveTrace(null);
          }, 850);
        } else {
          setActiveTrace({
            vacancy: scoredVac,
            edgeKey: 'e2_skip',
            activeNodeId: 'skipped',
            label: `${scoredVac.atsScore}% < 65%`,
            hex: '#f43f5e',
            atsScanning: false,
          });
          setTimeout(() => {
            setVacancies((prev) =>
              prev.map((v) =>
                v.id === scoredVac.id
                  ? {
                      ...v,
                      stage: 'skipped',
                      skipTag: 'ATS < 65%',
                      skipReason: `ATS ${scoredVac.atsScore}% < 65% threshold`,
                    }
                  : v
              )
            );
            appendLog(
              scoredVac.id,
              `${scoredVac.company}: ATS ${scoredVac.atsScore}% < 65% -> Авто-отсев -> ВЫХОД B: ПРОПУСК`,
              'slate',
              'ATS-TEST'
            );
            setActiveTrace(null);
          }, 850);
        }
        return;
      }

      // Priority 3: Advance one 'drafted' vacancy -> 'awaiting_approval' (or Auto-Pilot >=88% straight to 'approved')
      const draftedVac = vacancies.find((v) => v.stage === 'drafted');
      if (draftedVac) {
        const resObj = resumeMap[draftedVac.matchedResumeId] || resumes[0];
        const canAutoPilot =
          autoPilotHighScore &&
          draftedVac.atsScore >= 88 &&
          (!draftedVac.questions || draftedVac.questions.length === 0) &&
          resObj.visibility === 'public' &&
          quotaSent < quotaMax;

        if (canAutoPilot) {
          setActiveTrace({
            vacancy: draftedVac,
            edgeKey: 'e4_approve',
            activeNodeId: 'approved',
            label: `AUTO-PILOT ${draftedVac.atsScore}%`,
            hex: '#10b981',
            atsScanning: false,
          });
          setTimeout(() => {
            setVacancies((prev) =>
              prev.map((v) => (v.id === draftedVac.id ? { ...v, stage: 'approved' } : v))
            );
            setQuotaSent((q) => Math.min(quotaMax, q + 1));
            appendLog(
              draftedVac.id,
              `${draftedVac.company} (${draftedVac.atsScore}%): Правило Auto-Pilot >=88% без анкеты -> ВЫХОД A: ОТКЛИК`,
              'emerald',
              'DISPATCH'
            );
            setActiveTrace(null);
          }, 850);
        } else {
          setActiveTrace({
            vacancy: draftedVac,
            edgeKey: 'e3_4',
            activeNodeId: 'awaiting_approval',
            label: draftedVac.company,
            hex: '#f59e0b',
            atsScanning: false,
          });
          setTimeout(() => {
            setVacancies((prev) =>
              prev.map((v) =>
                v.id === draftedVac.id ? { ...v, stage: 'awaiting_approval' } : v
              )
            );
            appendLog(
              draftedVac.id,
              `${draftedVac.company} (${draftedVac.atsScore}%): Линтер пройден -> Ожидает решения в Шлюзе HITL`,
              'rose',
              'HITL-GATE'
            );
            setActiveTrace(null);
          }, 850);
        }
        return;
      }

      // Priority 4: Dispatch one 'approved' vacancy -> 'sent'
      const approvedVac = vacancies.find((v) => v.stage === 'approved');
      if (approvedVac) {
        setVacancies((prev) =>
          prev.map((v) =>
            v.id === approvedVac.id
              ? { ...v, stage: 'sent', employerBadge: 'Доставлено · Только что' }
              : v
          )
        );
        appendLog(
          approvedVac.id,
          `WebBridge :10086 -> Отклик в ${approvedVac.company} (${approvedVac.hhId}) успешно доставлен на hh.ru`,
          'emerald',
          'DISPATCH'
        );
        return;
      }

      // Priority 5: All active pipes clear -> Poll hh.ru cron for a fresh vacancy
      injectNextStreamVacancy();
    }, intervalMs);

    return () => clearInterval(loopTimer);
  }, [
    auto247,
    daemonSpeed,
    isTracingSingle,
    vacancies,
    resumeMap,
    resumes,
    autoPilotHighScore,
    quotaSent,
    quotaMax,
    appendLog,
    injectNextStreamVacancy,
  ]);

  const handleTraceSingleVacancy = () => {
    if (isTracingSingle) return;
    setIsTracingSingle(true);

    traceTimersRef.current.forEach((id) => clearTimeout(id));
    traceTimersRef.current = [];

    const existingFound = vacancies.find((v) => v.stage === 'found');
    let targetVacancy;

    if (existingFound && streamPoolIdx % 2 === 1) {
      targetVacancy = existingFound;
    } else {
      targetVacancy = injectNextStreamVacancy();
    }

    const resObj = resumeMap[targetVacancy.matchedResumeId] || resumes[0];
    const passesAts = targetVacancy.atsScore >= 65;

    appendLog(
      targetVacancy.id,
      `${targetVacancy.company} · ${targetVacancy.title}: Запуск пошаговой трассировки по дереву...`,
      'sky',
      'ATS-TEST'
    );

    setActiveTrace({
      vacancy: targetVacancy,
      edgeKey: 'e1_2',
      activeNodeId: 'scored',
      label: `${targetVacancy.company}`,
      hex: '#0284c7',
      atsScanning: true,
    });

    const t1 = setTimeout(() => {
      setVacancies((prev) =>
        prev.map((v) => (v.id === targetVacancy.id ? { ...v, stage: 'scored' } : v))
      );

      if (passesAts) {
        appendLog(
          targetVacancy.id,
          `${targetVacancy.company}: ATS ${targetVacancy.atsScore}% (${resObj.shortCode}) >= 65% -> Ветка ПРОЙДЕНО -> Генерация письма`,
          'indigo',
          'ATS-TEST'
        );

        setActiveTrace({
          vacancy: targetVacancy,
          edgeKey: 'e2_3',
          activeNodeId: 'drafted',
          label: `ATS ${targetVacancy.atsScore}% (${resObj.shortCode}) ✓`,
          hex: '#6366f1',
          atsScanning: false,
        });
      } else {
        appendLog(
          targetVacancy.id,
          `${targetVacancy.company}: ATS ${targetVacancy.atsScore}% (${resObj.shortCode}) < 65% -> Ветка АВТО-ОТСЕВ -> ВЫХОД B: ПРОПУСК`,
          'slate',
          'ATS-TEST'
        );

        setActiveTrace({
          vacancy: targetVacancy,
          edgeKey: 'e2_skip',
          activeNodeId: 'skipped',
          label: `ATS ${targetVacancy.atsScore}% < 65% ✕`,
          hex: '#f43f5e',
          atsScanning: false,
        });
      }
    }, 950);

    const t2 = setTimeout(() => {
      if (passesAts) {
        setVacancies((prev) =>
          prev.map((v) => (v.id === targetVacancy.id ? { ...v, stage: 'drafted' } : v))
        );

        setActiveTrace({
          vacancy: targetVacancy,
          edgeKey: 'e3_4',
          activeNodeId: 'awaiting_approval',
          label: `Письмо готово -> Шлюз HITL`,
          hex: '#f59e0b',
          atsScanning: false,
        });
      } else {
        setVacancies((prev) =>
          prev.map((v) =>
            v.id === targetVacancy.id
              ? {
                  ...v,
                  stage: 'skipped',
                  skipTag: 'ATS < 65%',
                  skipReason: `ATS ${targetVacancy.atsScore}% < 65% threshold`,
                }
              : v
          )
        );
        setActiveTrace(null);
        setIsTracingSingle(false);
        notify(
          `Авто-отсев: ВЫХОД B: ПРОПУСК`,
          `${targetVacancy.company} набрала ${targetVacancy.atsScore}% (< 65%) и отсеяна по нижней ветке.`,
          'warning'
        );
      }
    }, 2000);

    const t3 = setTimeout(() => {
      if (!passesAts) return;

      setVacancies((prev) =>
        prev.map((v) =>
          v.id === targetVacancy.id ? { ...v, stage: 'awaiting_approval' } : v
        )
      );

      appendLog(
        targetVacancy.id,
        `${targetVacancy.company} (${targetVacancy.atsScore}%): Ожидает решения в Шлюзе HITL (✓ Отклик / ✕ Пропуск)`,
        'rose',
        'HITL-GATE'
      );

      setActiveTrace(null);
      setIsTracingSingle(false);
      notify(
        'Вакансия прошла в Шлюз HITL',
        `${targetVacancy.company} (${targetVacancy.atsScore}% · ${resObj.shortCode}) ждёт решения: Отклик или Пропуск.`,
        'success'
      );
    }, 3050);

    traceTimersRef.current = [t1, t2, t3];
  };

  // ============================================================================
  // 9. BATCH PROGRESSION, SYNC, APPROVE (ОТКЛИК), SKIP (ПРОПУСК) & CLI HANDLERS
  // ============================================================================

  const handleRunAutoBatch = async () => {
    if (runningBatch) return;
    setRunningBatch(true);
    appendLog(null, 'Запуск пакетной обработки через FastAPI_CDEKLLM...', 'indigo', 'SYSTEM');

    try {
      const res = await fetch('/api/pipeline/auto-run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ limit: 5 }),
      });
      if (res.ok) {
        const data = await res.json();
        appendLog(
          null,
          `FastAPI_CDEKLLM: Обработано ${data.processed} вакансий через DeepSeek`,
          'emerald',
          'ATS-TEST'
        );
        notify(
          'Пакетный прогон завершён',
          `Обработано ${data.processed} вакансий через модель DeepSeek.`,
          'success'
        );
        // Refresh pipeline from DB
        const pipeRes = await fetch('/api/pipeline');
        if (pipeRes.ok) {
          const pipe = await pipeRes.json();
          if (pipe.items) {
            setVacancies((prev) => {
              const mapped = pipe.items.map((v, i) => mapDbVacancyToUi(v, resumes, i));
              const dbKeys = new Set(mapped.map((m) => m.id));
              return [...mapped, ...prev.filter((p) => !dbKeys.has(p.id))];
            });
          }
        }
        setRunningBatch(false);
        return;
      }
    } catch {
      // offline fallback
    }

    setTimeout(() => {
      let toScored = 0;
      let toDrafted = 0;
      let toApproval = 0;
      let autoPruned = 0;

      setVacancies((prev) =>
        prev.map((v) => {
          if (v.stage === 'found') {
            toScored += 1;
            return { ...v, stage: 'scored' };
          }
          if (v.stage === 'scored') {
            if (v.atsScore < 65) {
              autoPruned += 1;
              return {
                ...v,
                stage: 'skipped',
                skipTag: 'ATS < 65%',
                skipReason: `ATS ${v.atsScore}% < 65% threshold`,
              };
            }
            toDrafted += 1;
            return { ...v, stage: 'drafted' };
          }
          if (v.stage === 'drafted') {
            toApproval += 1;
            return { ...v, stage: 'awaiting_approval' };
          }
          return v;
        })
      );

      setRunningBatch(false);
      const total = toScored + toDrafted + toApproval + autoPruned;

      if (total > 0) {
        appendLog(
          null,
          `Batch FSM: ATS=${toScored}, Письма=${toDrafted}, В Шлюз HITL=${toApproval}${
            autoPruned > 0 ? `, Авто-пропуск (<65%)=${autoPruned}` : ''
          }`,
          'indigo',
          'ATS-TEST'
        );
        notify(
          `Batch FSM завершён (${total} переходов)`,
          `ATS: ${toScored} · Письма: ${toDrafted} · Шлюз HITL: ${toApproval}`,
          'success'
        );
      } else {
        notify('Пайплайн стабилизирован', 'Все активные вакансии уже дошли до Шлюза HITL.', 'info');
      }
    }, 320);
  };

  const handleSyncResponses = async () => {
    if (syncingResponses) return;
    setSyncingResponses(true);
    appendLog(null, 'Синхронизация переговоров и откликов с hh.ru...', 'indigo', 'SYSTEM');

    try {
      const res = await fetch('/api/autopilot/run-now', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ force: true }),
      });
      if (res.ok) {
        const data = await res.json();
        appendLog(
          null,
          `Синхронизация hh.ru завершена: готово к одобрению: ${data.queuedForApproval || 0}, отправлено: ${data.dispatched || 0}`,
          'emerald',
          'DISPATCH'
        );
      }
    } catch {
      // offline fallback
    }

    setTimeout(() => {
      let dispatched = 0;
      setVacancies((prev) =>
        prev.map((v) => {
          if (v.stage === 'approved') {
            dispatched += 1;
            return {
              ...v,
              stage: 'sent',
              employerBadge: 'Доставлено · Только что',
            };
          }
          if (v.id === 'vac-15') {
            return {
              ...v,
              employerBadge: 'Приглашение · Пт 14:30',
            };
          }
          return v;
        })
      );

      if (dispatched > 0) {
        setQuotaSent((q) => Math.min(quotaMax, q + dispatched));
        setThrottleSec(45);
      }

      setSyncingResponses(false);
      appendLog(
        'vac-15',
        dispatched > 0
          ? `WebBridge :10086 -> Отправлено откликов: ${dispatched}; Lamoda Tech обновила статус на Приглашение`
          : 'WebBridge :10086 -> Синхронизация hh.ru: Lamoda Tech -> Приглашение · Пт 14:30',
        'emerald',
        'DISPATCH'
      );
      notify(
        'WebBridge :10086 синхронизирован',
        dispatched > 0
          ? `Отправлено ${dispatched} откликов из очереди и обновлены статусы HR.`
          : 'Обновлены статусы hh.ru: Lamoda Tech -> Приглашение · Пт 14:30.',
        'success'
      );
    }, 320);
  };

  // Approve -> Fire animated token along e4_approve into ВЫХОД: ОТКЛИК
  const handleApproveVacancy = async (vacancyId) => {
    const target = vacancies.find((v) => v.id === vacancyId);
    if (!target) return;

    const assignedResume = resumeMap[target.matchedResumeId];
    if (assignedResume && assignedResume.visibility === 'hidden') {
      setInspectedId(vacancyId);
      setDrawerTab('questions');
      appendLog(
        vacancyId,
        `${target.company}: Блокировка в Шлюзе HITL — резюме ${assignedResume.shortCode} (${assignedResume.hhId}) скрыто на hh.ru`,
        'rose',
        'HITL-GATE'
      );
      notify(
        'Карантин: резюме скрыто на hh.ru',
        `Откройте видимость "${assignedResume.title}" перед отправкой отклика в ${target.company}.`,
        'warning'
      );
      return;
    }

    const key = target.rawKey || target.id;
    try {
      await fetch(`/api/vacancies/${encodeURIComponent(key)}/status`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'approved' }),
      });
    } catch {
      // offline fallback
    }

    setActiveTrace({
      vacancy: target,
      edgeKey: 'e4_approve',
      activeNodeId: 'approved',
      label: `✓ Отклик: ${target.company}`,
      hex: '#10b981',
      atsScanning: false,
    });
    const clearToken = setTimeout(() => setActiveTrace(null), 1050);
    traceTimersRef.current.push(clearToken);

    const updated = vacancies.map((v) =>
      v.id === vacancyId
        ? {
            ...v,
            stage: 'approved',
            questions: (v.questions || []).map((q) => ({ ...q, needsReview: false })),
          }
        : v
    );

    setVacancies(updated);
    setQuotaSent((q) => Math.min(quotaMax, q + 1));
    setThrottleSec(45);

    appendLog(
      vacancyId,
      `${target.company} (${target.atsScore}%): Одобрено оператором -> ВЫХОД A: ОТКЛИК (в очереди отправки)`,
      'emerald',
      'DISPATCH'
    );

    notify(
      'ВЫХОД A: ОТКЛИК — Одобрено',
      `${target.company} поставлена в очередь отправки · Пауза 00:45`,
      'success'
    );

    if (inspectedId === vacancyId) {
      const nextAwaiting = updated.find((v) => v.stage === 'awaiting_approval');
      if (nextAwaiting) {
        setInspectedId(nextAwaiting.id);
        setDrawerTab('battle');
      } else {
        setInspectedId(null);
      }
    }
  };

  // Batch approve all unblocked vacancies in HITL gate
  const handleApproveAllUnblocked = () => {
    let approvedCount = 0;
    setVacancies((prev) =>
      prev.map((v) => {
        if (v.stage !== 'awaiting_approval') return v;
        const r = resumeMap[v.matchedResumeId];
        if (r && r.visibility === 'hidden') return v;
        approvedCount += 1;
        return {
          ...v,
          stage: 'approved',
          questions: (v.questions || []).map((q) => ({ ...q, needsReview: false })),
        };
      })
    );

    if (approvedCount > 0) {
      setQuotaSent((q) => Math.min(quotaMax, q + approvedCount));
      setThrottleSec(45);
      appendLog(
        null,
        `CLI approve-ready -> Одобрено ${approvedCount} разблокированных вакансий из Шлюза HITL -> ВЫХОД A: ОТКЛИК`,
        'emerald',
        'DISPATCH'
      );
      notify(
        `Одобрено ${approvedCount} откликов`,
        'Все незаблокированные вакансии переведены в очередь отправки.',
        'success'
      );
    } else {
      notify(
        'Нет готовых вакансий',
        'Все оставшиеся вакансии в Шлюзе HITL заблокированы скрытым резюме.',
        'warning'
      );
    }
  };

  // Interactive Daemon CLI Handler
  const handleCliSubmit = (e) => {
    e.preventDefault();
    const raw = cliInput.trim();
    if (!raw) return;
    const cmd = raw.toLowerCase();
    setCliInput('');

    appendLog(null, `$ ${raw}`, 'indigo', 'SYSTEM');

    if (cmd === 'help') {
      appendLog(
        null,
        'Доступные команды: help | status | fsm | llm | run | batch | sync | approve-ready | pause | resume | autopilot | clear',
        'sky',
        'SYSTEM'
      );
    } else if (cmd === 'status' || cmd === 'stats') {
      fetch('/api/stats')
        .then((r) => r.json())
        .then((st) => {
          appendLog(null, `Stats: Total ${st.total}, Found ${st.byStatus?.found || 0}, Drafted ${st.byStatus?.drafted || 0}, Sent ${st.byStatus?.sent || 0}`, 'sky', 'SYSTEM');
        })
        .catch(() => appendLog(null, `Stats: Local pool total ${vacancies.length}`, 'sky', 'SYSTEM'));
    } else if (cmd === 'fsm') {
      fetch('/api/fsm/summary')
        .then((r) => r.json())
        .then((fsm) => {
          appendLog(null, `FSM: ${JSON.stringify(fsm.stateDistribution)}`, 'sky', 'SYSTEM');
        })
        .catch(() => appendLog(null, 'FSM: Offline', 'sky', 'SYSTEM'));
    } else if (cmd === 'llm') {
      fetch('/api/llm/status')
        .then((r) => r.json())
        .then((llm) => {
          appendLog(null, `LLM: ${llm.model} (${llm.connected ? 'OK' : 'Error'})`, 'sky', 'SYSTEM');
        })
        .catch(() => appendLog(null, 'LLM: Offline', 'sky', 'SYSTEM'));
    } else if (cmd === 'run' || cmd === 'trace') {
      handleTraceSingleVacancy();
    } else if (cmd === 'batch') {
      handleRunAutoBatch();
    } else if (cmd === 'sync') {
      handleSyncResponses();
    } else if (cmd === 'approve-ready') {
      handleApproveAllUnblocked();
    } else if (cmd === 'pause') {
      setAuto247(false);
      fetch('/api/autopilot/config', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: false }) }).catch(() => {});
      appendLog(null, 'Daemon 24/7 loop -> PAUSED (ручной режим)', 'amber', 'SYSTEM');
    } else if (cmd === 'resume' || cmd === 'start') {
      setAuto247(true);
      fetch('/api/autopilot/config', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: true }) }).catch(() => {});
      appendLog(null, 'Daemon 24/7 loop -> ACTIVE (автономный режим 24/7)', 'emerald', 'SYSTEM');
    } else if (cmd === 'autopilot') {
      setAutoPilotHighScore((prev) => {
        const next = !prev;
        appendLog(
          null,
          `Правило Auto-Pilot (>=88% без анкеты): ${next ? 'ENABLED' : 'DISABLED'}`,
          next ? 'emerald' : 'slate',
          'HITL-GATE'
        );
        return next;
      });
    } else if (cmd === 'clear') {
      setExecutionLogs([]);
    } else {
      appendLog(
        null,
        `Неизвестная команда "${raw}". Введите help для списка команд терминала.`,
        'rose',
        'SYSTEM'
      );
    }
  };

  // Skip -> Fire animated token along e4_skip into ВЫХОД: ПРОПУСК
  const handleSkipVacancy = async (vacancyId) => {
    const target = vacancies.find((v) => v.id === vacancyId);
    if (!target) return;

    const key = target.rawKey || target.id;
    try {
      await fetch(`/api/vacancies/${encodeURIComponent(key)}/status`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'skipped' }),
      });
    } catch {
      // offline fallback
    }

    setActiveTrace({
      vacancy: target,
      edgeKey: 'e4_skip',
      activeNodeId: 'skipped',
      label: `✕ Пропуск: ${target.company}`,
      hex: '#64748b',
      atsScanning: false,
    });
    const clearToken = setTimeout(() => setActiveTrace(null), 1100);
    traceTimersRef.current.push(clearToken);

    setVacancies((prev) =>
      prev.map((v) =>
        v.id === vacancyId
          ? {
              ...v,
              stage: 'skipped',
              skipTag: 'Ручной пропуск',
              skipReason: 'Отклонено оператором в Шлюзе HITL',
            }
          : v
      )
    );

    appendLog(
      vacancyId,
      `${target.company}: Ручной пропуск -> ВЫХОД: ПРОПУСК`,
      'slate'
    );
    notify('ВЫХОД: ПРОПУСК', `${target.company} перенесена в архив пропусков.`, 'info');

    if (inspectedId === vacancyId) {
      setInspectedId(null);
    }
  };

  const handleRestoreVacancy = (vacancyId) => {
    const target = vacancies.find((v) => v.id === vacancyId);
    setVacancies((prev) =>
      prev.map((v) =>
        v.id === vacancyId
          ? { ...v, stage: 'awaiting_approval', skipTag: undefined, skipReason: undefined }
          : v
      )
    );
    if (target) {
      appendLog(
        vacancyId,
        `${target.company}: Возвращена из архива в Шлюз HITL`,
        'indigo'
      );
    }
    notify('Возвращено в Шлюз HITL', 'Вакансия снова доступна для отклика.', 'success');
  };

  const handleReassignResume = (vacancyId, newResumeId) => {
    setVacancies((prev) =>
      prev.map((v) => {
        if (v.id !== vacancyId) return v;
        const scoreEntry = v.resumeScores[newResumeId];
        const nextOverall = scoreEntry ? scoreEntry.overall : v.atsScore;
        const deltaDiff = nextOverall - v.atsScore;
        const newResume = resumeMap[newResumeId];

        const updatedLedger = [
          ...v.scoreLedger,
          {
            delta: deltaDiff,
            rule: `Переключено на резюме ${newResume ? newResume.shortCode : newResumeId}`,
          },
        ].filter((item) => item.delta !== 0);

        return {
          ...v,
          matchedResumeId: newResumeId,
          atsScore: nextOverall,
          scoreLedger: updatedLedger,
        };
      })
    );
    const r = resumeMap[newResumeId];
    if (r) {
      notify('Резюме переназначено', `Пересчитан ATS-балл по профилю ${r.filterLabel}.`, 'info');
    }
  };

  const handleToggleResumeVisibility = (resumeId) => {
    setResumes((prev) =>
      prev.map((r) => {
        if (r.id !== resumeId) return r;
        const nextVis = r.visibility === 'public' ? 'hidden' : 'public';
        appendLog(
          null,
          `Резюме ${r.shortCode} (${r.hhId}): видимость на hh.ru изменена на ${
            nextVis === 'public' ? 'PUBLIC (Открыто)' : 'HIDDEN (Скрыто)'
          }`,
          nextVis === 'public' ? 'emerald' : 'rose'
        );
        notify(
          nextVis === 'public' ? 'Резюме открыто на hh.ru' : 'Резюме скрыто на hh.ru',
          `${r.title} (${r.hhId}) теперь ${nextVis.toUpperCase()}.`,
          nextVis === 'public' ? 'success' : 'warning'
        );
        return {
          ...r,
          visibility: nextVis,
          auditStatus: nextVis === 'public' ? 'Verified · Clean' : 'Blocked · Hidden on hh.ru',
        };
      })
    );
  };

  const handleUpdateCoverLetter = async (vacancyId, text) => {
    setVacancies((prev) =>
      prev.map((v) => (v.id === vacancyId ? { ...v, coverLetter: text } : v))
    );
    const target = vacancies.find((v) => v.id === vacancyId);
    if (target?.letterId) {
      try {
        await fetch(`/api/letters/${encodeURIComponent(target.letterId)}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text }),
        });
      } catch {
        // offline
      }
    }
  };

  const handleRegenerateDraft = async (vacancyId) => {
    const target = vacancies.find((v) => v.id === vacancyId);
    if (!target) return;

    setRegenerating(true);
    const key = target.rawKey || target.id;
    try {
      const res = await fetch(`/api/vacancies/${encodeURIComponent(key)}/auto-process`, {
        method: 'POST',
      });
      if (res.ok) {
        const data = await res.json();
        if (data.letterId) {
          const detailRes = await fetch(`/api/vacancies/${encodeURIComponent(key)}`);
          if (detailRes.ok) {
            const detail = await detailRes.json();
            const latestLetter = detail.letters?.[0];
            if (latestLetter) {
              const fitAnalysis = (detail.analyses || []).find((a) => a.kind === 'fit');
              const atsAnalysis = (detail.analyses || []).find((a) => a.kind === 'ats');
              const realLedger = fitAnalysis?.payload?.ledger;
              setVacancies((prev) =>
                prev.map((v) =>
                  v.id === vacancyId
                    ? {
                        ...v,
                        atsScore: data.fitScore || fitAnalysis?.score || v.atsScore,
                        coverLetter: latestLetter.text,
                        cleanDraft: latestLetter.text,
                        letterId: latestLetter.id,
                        questions: (v.questions || []).map((q) => ({ ...q, needsReview: false })),
                        analyses: detail.analyses || [],
                        comparison: detail.comparison || [],
                        scoreLedger: Array.isArray(realLedger) && realLedger.length > 0
                          ? realLedger.map((l) => ({ delta: l.delta, rule: l.text }))
                          : v.scoreLedger,
                        atsPayload: atsAnalysis?.payload,
                        fitPayload: fitAnalysis?.payload,
                      }
                    : v
                )
              );
              setRegenerating(false);
              appendLog(
                vacancyId,
                `FastAPI_CDEKLLM DeepSeek: Письмо перегенерировано (${latestLetter.text.split(/\s+/).length} слов, линт: ${latestLetter.lint?.ok ? 'ОК' : 'Предупреждения'})`,
                'emerald',
                'LLM-LINT'
              );
              notify('Письмо перегенерировано', 'Сгенерирован новый текст через DeepSeek.', 'success');
              return;
            }
          }
        }
      }
    } catch (err) {
      console.warn('Auto-process error:', err);
    }

    setTimeout(() => {
      setVacancies((prev) =>
        prev.map((v) => {
          if (v.id !== vacancyId) return v;
          return {
            ...v,
            coverLetter: v.cleanDraft || v.coverLetter,
            questions: (v.questions || []).map((q) => ({ ...q, needsReview: false })),
          };
        })
      );
      setRegenerating(false);
      notify(
        'Письмо и ответы перегенерированы',
        'Сформирован чистый текст (120–180 слов) строго по фактам резюме.',
        'success'
      );
    }, 340);
  };

  const handleUpdateQuestionAnswer = async (vacancyId, questionId, value) => {
    setVacancies((prev) =>
      prev.map((v) => {
        if (v.id !== vacancyId) return v;
        return {
          ...v,
          questions: v.questions.map((q) =>
            q.id === questionId ? { ...q, answer: value, needsReview: false } : q
          ),
        };
      })
    );
    const target = vacancies.find((v) => v.id === vacancyId);
    const key = target?.rawKey || target?.id;
    if (key) {
      try {
        await fetch(`/api/vacancies/${encodeURIComponent(key)}/answers`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ answers: [{ id: questionId, text: value }] }),
        });
      } catch {
        // offline
      }
    }
  };

  const handleVerifyAllQuestions = (vacancyId) => {
    setVacancies((prev) =>
      prev.map((v) => {
        if (v.id !== vacancyId) return v;
        return {
          ...v,
          questions: (v.questions || []).map((q) => ({ ...q, needsReview: false })),
        };
      })
    );
    notify('Анкетные ответы подтверждены', 'Все поля проверены оператором.', 'success');
  };

  // Pan handlers for Decision Tree canvas
  const handleCanvasMouseDown = (e) => {
    if (e.button !== 0) return;
    setIsPanning(true);
    panStartRef.current = { x: e.clientX - panOffset.x, y: e.clientY - panOffset.y };
  };

  const handleCanvasMouseMove = (e) => {
    if (!isPanning) return;
    setPanOffset({
      x: e.clientX - panStartRef.current.x,
      y: e.clientY - panStartRef.current.y,
    });
  };

  const handleCanvasMouseUp = () => {
    setIsPanning(false);
  };

  // Partition vacancies by Decision Tree node
  const treeBuckets = useMemo(() => {
    return {
      found: vacancies.filter((v) => v.stage === 'found'),
      scored: vacancies.filter((v) => v.stage === 'scored'),
      drafted: vacancies.filter((v) => v.stage === 'drafted'),
      awaiting_approval: vacancies.filter((v) => v.stage === 'awaiting_approval'),
      outbound: vacancies.filter((v) => v.stage === 'approved' || v.stage === 'sent'),
      skipped: vacancies.filter((v) => v.stage === 'skipped'),
    };
  }, [vacancies]);

  // Kanban columns
  const kanbanColumns = useMemo(() => {
    if (!showSkippedKanban) return FSM_STAGES;
    return [
      ...FSM_STAGES,
      {
        id: 'skipped',
        code: 'EXIT-05B',
        label: 'Skipped',
        treeTitle: 'ВЫХОД: ПРОПУСК',
        kanbanTitle: 'Skipped / Archived',
        hex: '#64748b',
        badgeClass: 'bg-slate-500/10 text-slate-400 border-slate-500/30',
      },
    ];
  }, [showSkippedKanban]);

  // Filtered journalctl logs
  const filteredExecutionLogs = useMemo(() => {
    if (logFilter === 'ALL') return executionLogs;
    return executionLogs.filter((l) => l.subsys === logFilter);
  }, [executionLogs, logFilter]);

  // HR & Outbound Tracker Derived Lists
  const outboundSentList = useMemo(
    () => vacancies.filter((v) => v.stage === 'sent'),
    [vacancies]
  );
  const outboundQueuedList = useMemo(
    () => vacancies.filter((v) => v.stage === 'approved'),
    [vacancies]
  );
  const interviewInvitesCount = useMemo(
    () =>
      outboundSentList.filter((v) =>
        (v.employerBadge || '').toLowerCase().includes('приглашение')
      ).length,
    [outboundSentList]
  );

  // ============================================================================
  // 10. RENDER
  // ============================================================================

  return (
    <div className="min-h-screen bg-[#09090B] text-[#F4F4F6] flex flex-col font-sans antialiased selection:bg-indigo-500/30 selection:text-white">
      {/* =====================================================================
          1. TOP 24/7 DAEMON & TELEMETRY HEADER
         ===================================================================== */}
      <header className="sticky top-0 z-30 min-h-12 bg-[#0D0F13] border-b border-[#1E2330] px-3 sm:px-4 py-1.5 flex flex-wrap items-center justify-between gap-2.5">
        {/* Left: Daemon Branding + Uptime + 24/7 Autonomous Loop Toggle + Speed + F1-F4 Tabs */}
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <div className="flex items-center gap-2 shrink-0">
            <div className="px-1.5 py-0.5 rounded-[4px] bg-indigo-600 text-white font-mono text-[10.5px] font-bold tracking-wider">
              DAEMON
            </div>
            <div className="flex flex-col leading-none">
              <span className="font-mono text-[12px] font-bold tracking-tight text-white">
                JOBFIT // DAEMON v2.4
              </span>
              <span className="font-mono text-[10px] text-[#71717A] tabular-nums mt-0.5">
                UPTIME {formattedUptime}
              </span>
            </div>
          </div>

          {/* 24/7 Autonomous Loop Toggle & 1x/5x Speed Selector */}
          <div className="inline-flex items-center rounded-[5px] bg-[#12151C] border border-[#1E2330] p-0.5 font-mono text-[11px]">
            <button
              onClick={() => {
                const next = !auto247;
                setAuto247(next);
                appendLog(
                  null,
                  next
                    ? 'Daemon 24/7 Loop: ENABLED (автономный цикл активен)'
                    : 'Daemon 24/7 Loop: PAUSED (ручной режим)',
                  next ? 'emerald' : 'amber',
                  'SYSTEM'
                );
                notify(
                  next ? 'AUTO 24/7: ON' : 'AUTO 24/7: PAUSED',
                  next
                    ? 'Демон непрерывно опрашивает hh.ru, тестирует ATS и готовит отклики.'
                    : 'Автономный цикл поставлен на паузу.',
                  'info'
                );
              }}
              className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[4px] font-semibold transition-colors cursor-pointer ${
                auto247
                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/35'
                  : 'bg-amber-500/15 text-amber-300 border border-amber-500/35'
              }`}
            >
              <span className="relative flex h-2 w-2">
                {auto247 && (
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                )}
                <span
                  className={`relative inline-flex rounded-full h-2 w-2 ${
                    auto247 ? 'bg-emerald-500' : 'bg-amber-500'
                  }`}
                />
              </span>
              <span>{auto247 ? 'AUTO 24/7: ON' : 'PAUSED'}</span>
            </button>

            <button
              onClick={() => setDaemonSpeed(1)}
              className={`px-1.5 py-0.5 rounded-[3px] ml-0.5 cursor-pointer transition-colors ${
                daemonSpeed === 1
                  ? 'bg-[#1E2330] text-white font-bold'
                  : 'text-[#71717A] hover:text-white'
              }`}
              title="Normal 24/7 Daemon Cadence (1x)"
            >
              1x
            </button>
            <button
              onClick={() => setDaemonSpeed(5)}
              className={`px-1.5 py-0.5 rounded-[3px] cursor-pointer transition-colors ${
                daemonSpeed === 5
                  ? 'bg-indigo-600 text-white font-bold'
                  : 'text-[#71717A] hover:text-white'
              }`}
              title="Accelerated Simulation Cadence (5x)"
            >
              5x
            </button>
          </div>

          <div className="h-4 w-[1px] bg-[#1E2330] hidden lg:block" />

          {/* View Switcher Tabs (F1 - F4) */}
          <nav className="inline-flex items-center p-0.5 rounded-[6px] bg-[#12151C] border border-[#1E2330] text-xs">
            <button
              onClick={() => setActiveView('tree')}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[4px] font-medium transition-colors cursor-pointer ${
                activeView === 'tree'
                  ? 'bg-indigo-600 text-white'
                  : 'text-[#A1A1AA] hover:text-white'
              }`}
            >
              <GitBranch className="w-3.5 h-3.5" />
              <span>Дерево 24/7</span>
              <span className="font-mono text-[9.5px] opacity-70 hidden sm:inline">F1</span>
            </button>

            <button
              onClick={() => setActiveView('kanban')}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[4px] font-medium transition-colors cursor-pointer ${
                activeView === 'kanban'
                  ? 'bg-indigo-600 text-white'
                  : 'text-[#A1A1AA] hover:text-white'
              }`}
            >
              <Kanban className="w-3.5 h-3.5" />
              <span>Канбан (6)</span>
              <span className="font-mono text-[9.5px] opacity-70 hidden sm:inline">F2</span>
            </button>

            <button
              onClick={() => setActiveView('hr')}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[4px] font-medium transition-colors cursor-pointer ${
                activeView === 'hr'
                  ? 'bg-indigo-600 text-white'
                  : 'text-[#A1A1AA] hover:text-white'
              }`}
            >
              <UserCheck className="w-3.5 h-3.5" />
              <span>Отклики & HR</span>
              <span className="font-mono text-[10px] px-1 rounded bg-teal-500/20 text-teal-300 tabular-nums">
                {outboundSentList.length + outboundQueuedList.length}
              </span>
              <span className="font-mono text-[9.5px] opacity-70 hidden sm:inline">F3</span>
            </button>

            <button
              onClick={() => setActiveView('resumes')}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[4px] font-medium transition-colors cursor-pointer ${
                activeView === 'resumes'
                  ? 'bg-indigo-600 text-white'
                  : 'text-[#A1A1AA] hover:text-white'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Резюме ({resumes.length})</span>
              <span className="font-mono text-[9.5px] opacity-70 hidden sm:inline">F4</span>
            </button>
          </nav>
        </div>

        {/* Center: Live System Monitors (MCP :8765, WebBridge :10086, hh.ru Session, Daily Quota, Rate Throttle) */}
        <div className="hidden 2xl:flex items-center gap-2.5 px-2.5 py-1 rounded-[5px] bg-[#12151C] border border-[#1E2330] font-mono text-[10.5px] tabular-nums">
          <span className="inline-flex items-center gap-1 text-[#D4D4D8]">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            <span className="text-[#71717A]">MCP :8765</span>
            <span className="text-emerald-400">OK</span>
            <span className="text-[#71717A]">({mcpLatencyMs}ms)</span>
          </span>

          <span className="text-[#1E2330]">|</span>

          <span className="inline-flex items-center gap-1 text-[#D4D4D8]">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            <span className="text-[#71717A]">Bridge :10086</span>
            <span className="text-emerald-400">Active</span>
          </span>

          <span className="text-[#1E2330]">|</span>

          <span className="inline-flex items-center gap-1 text-[#D4D4D8]">
            <span className="w-1.5 h-1.5 rounded-full bg-teal-400" />
            <span className="text-[#71717A]">hh.ru:</span>
            <span className="text-teal-300">Valid</span>
          </span>

          <span className="text-[#1E2330]">|</span>

          <span className="inline-flex items-center gap-1.5 text-[#D4D4D8]">
            <span className="text-[#71717A]">Quota:</span>
            <span className="font-semibold text-white">
              {quotaSent}/{quotaMax}
            </span>
            <span className="w-12 h-1.5 rounded-xs bg-[#1E2330] overflow-hidden">
              <span
                className="block h-full bg-emerald-500 transition-all duration-200"
                style={{ width: `${(quotaSent / quotaMax) * 100}%` }}
              />
            </span>
          </span>

          <span className="text-[#1E2330]">|</span>

          <span className="text-[#D4D4D8]">
            <span className="text-[#71717A]">Throttle: </span>
            {throttleSec > 0 ? (
              <span className="text-amber-400 font-semibold">
                00:{String(throttleSec).padStart(2, '0')}
              </span>
            ) : (
              <span className="text-emerald-400 font-semibold">READY</span>
            )}
          </span>
        </div>

        {/* Right: Global Action Buttons (+1 Вход, Sync Responses, Run Auto-Pipeline Batch) */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={handleTraceSingleVacancy}
            disabled={isTracingSingle}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-[5px] font-mono text-[11px] font-semibold bg-sky-500/15 hover:bg-sky-500/25 border border-sky-500/35 text-sky-300 disabled:opacity-50 transition-colors cursor-pointer"
            title="Инъекция новой вакансии из hh.ru и пошаговая трассировка по дереву"
          >
            {isTracingSingle ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <span>+1 Вход</span>
            )}
          </button>

          <button
            onClick={handleSyncResponses}
            disabled={syncingResponses}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[5px] text-xs font-medium bg-[#12151C] hover:bg-[#191E29] border border-[#1E2330] text-[#E4E4E7] transition-colors cursor-pointer"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 text-teal-400 ${syncingResponses ? 'animate-spin' : ''}`}
            />
            <span className="hidden sm:inline">Sync Responses</span>
          </button>

          <button
            onClick={handleRunAutoBatch}
            disabled={runningBatch}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[5px] text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white transition-colors cursor-pointer"
          >
            {runningBatch ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Play className="w-3.5 h-3.5" />
            )}
            <span>Run Auto-Pipeline Batch</span>
          </button>
        </div>
      </header>

      {/* =====================================================================
          2. INTERACTIVE RESUME & BOTTLENECK FILTER BAR
         ===================================================================== */}
      {activeView !== 'resumes' && activeView !== 'hr' && (
        <section className="bg-[#0D0F13] border-b border-[#1E2330] px-3 sm:px-4 py-1.5 flex flex-wrap items-center justify-between gap-2">
          {/* Left: 6 Resume Filter Pills */}
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="font-mono text-[10.5px] text-[#71717A] mr-0.5">ПРОФИЛЬ:</span>

            <button
              onClick={() => setResumeFilter('all')}
              className={`px-2 py-0.5 rounded-[5px] font-mono text-[11px] border transition-colors cursor-pointer ${
                resumeFilter === 'all'
                  ? 'bg-indigo-600 text-white border-indigo-500 font-semibold'
                  : 'bg-[#12151C] text-[#A1A1AA] border-[#1E2330] hover:text-white'
              }`}
            >
              All 6
            </button>

            {resumes.map((r) => {
              const active = resumeFilter === r.id;
              const isHidden = r.visibility === 'hidden';
              return (
                <button
                  key={r.id}
                  onClick={() => setResumeFilter((prev) => (prev === r.id ? 'all' : r.id))}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-[5px] font-mono text-[11px] border transition-colors cursor-pointer ${
                    active
                      ? 'bg-indigo-600 text-white border-indigo-500 font-semibold'
                      : isHidden
                      ? 'bg-rose-500/10 text-rose-300 border-rose-500/35 hover:bg-rose-500/15'
                      : 'bg-[#12151C] text-[#A1A1AA] border-[#1E2330] hover:text-white'
                  }`}
                >
                  <span>{r.filterLabel}</span>
                  {isHidden && <span className="text-[10px] text-rose-400">[Скрыто]</span>}
                </button>
              );
            })}
          </div>

          {/* Right: Bottleneck Filters + Search + Zoom/Pan + Sidebar Toggle */}
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              onClick={() =>
                setBottleneckFilter((prev) => (prev === 'questions' ? 'all' : 'questions'))
              }
              className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[5px] font-mono text-[11px] border transition-colors cursor-pointer ${
                bottleneckFilter === 'questions'
                  ? 'bg-amber-500 text-zinc-950 border-amber-400 font-semibold'
                  : 'bg-[#12151C] text-[#A1A1AA] border-[#1E2330] hover:text-white'
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
              <span>Blocked: Questions ({blockedQuestionsCount})</span>
            </button>

            <button
              onClick={() =>
                setBottleneckFilter((prev) =>
                  prev === 'hidden_resume' ? 'all' : 'hidden_resume'
                )
              }
              className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[5px] font-mono text-[11px] border transition-colors cursor-pointer ${
                bottleneckFilter === 'hidden_resume'
                  ? 'bg-rose-500 text-white border-rose-400 font-semibold'
                  : 'bg-[#12151C] text-[#A1A1AA] border-[#1E2330] hover:text-white'
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
              <span>Hidden Resume ({blockedHiddenResumeCount})</span>
            </button>

            <div className="relative">
              <Search className="w-3.5 h-3.5 text-[#71717A] absolute left-2 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Компания / hh ID..."
                className="w-36 sm:w-44 bg-[#12151C] border border-[#1E2330] focus:border-indigo-500 rounded-[5px] pl-7 pr-2 py-0.5 text-xs text-white placeholder-[#71717A] focus:outline-none"
              />
            </div>

            {activeView === 'tree' && (
              <>
                <div className="inline-flex items-center rounded-[5px] bg-[#12151C] border border-[#1E2330] font-mono text-[11px] text-[#A1A1AA]">
                  <button
                    onClick={() => setTreeZoom((z) => Math.max(70, z - 15))}
                    className="px-2 py-0.5 hover:text-white cursor-pointer"
                    title="Zoom Out (-15%)"
                  >
                    <ZoomOut className="w-3.5 h-3.5" />
                  </button>
                  <span className="px-2 tabular-nums font-bold text-white">{treeZoom}%</span>
                  <button
                    onClick={() => setTreeZoom((z) => Math.min(220, z + 15))}
                    className="px-2 py-0.5 hover:text-white cursor-pointer"
                    title="Zoom In (+15%)"
                  >
                    <ZoomIn className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => {
                      setTreeZoom(135);
                      setPanOffset({ x: 0, y: 0 });
                    }}
                    className="px-2 py-0.5 border-l border-[#1E2330] hover:text-white cursor-pointer"
                    title="Fit & Reset Pan (135%)"
                  >
                    <Maximize2 className="w-3 h-3" />
                  </button>
                </div>

                <button
                  onClick={() => setShowRightSidebar((s) => !s)}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-[5px] font-mono text-[11px] border transition-colors cursor-pointer ${
                    showRightSidebar
                      ? 'bg-[#191E29] text-white border-[#2E3548]'
                      : 'bg-[#12151C] text-[#71717A] border-[#1E2330] hover:text-white'
                  }`}
                >
                  <Radio className="w-3 h-3 text-emerald-400" />
                  <span className="hidden md:inline">Radar</span>
                </button>
              </>
            )}

            {activeView === 'kanban' && (
              <button
                onClick={() => setShowSkippedKanban((s) => !s)}
                className={`px-2 py-0.5 rounded-[5px] font-mono text-[11px] border transition-colors cursor-pointer ${
                  showSkippedKanban
                    ? 'bg-slate-600 text-white border-slate-500'
                    : 'bg-[#12151C] text-[#71717A] border-[#1E2330] hover:text-white'
                }`}
              >
                Skipped ({skippedVacancies.length})
              </button>
            )}
          </div>
        </section>
      )}

      {/* =====================================================================
          3A. PRIMARY VIEW: LIVE 24/7 VACANCY DECISION TREE + RADAR + CONSOLE
         ===================================================================== */}
      {activeView === 'tree' && (
        <div className="flex-1 flex flex-col min-w-0">
          {/* Upper Split: Interactive Decision Tree Canvas + Right 24/7 Radar Sidebar */}
          <div className="flex-1 flex flex-col xl:flex-row min-w-0">
            {/* Interactive Dot-Matrix Engineering Canvas */}
            <div
              onMouseDown={handleCanvasMouseDown}
              onMouseMove={handleCanvasMouseMove}
              onMouseUp={handleCanvasMouseUp}
              onMouseLeave={handleCanvasMouseUp}
              className={`flex-1 relative overflow-auto min-h-[780px] ${
                isPanning ? 'cursor-grabbing' : 'cursor-grab'
              }`}
              style={{
                backgroundColor: '#09090B',
                backgroundImage: 'radial-gradient(#1C202E 1px, transparent 1px)',
                backgroundSize: '22px 22px',
              }}
            >
              {/* Top-Left Floating Legend & Reset Filter Pill */}
              <div className="sticky top-2.5 left-2.5 z-20 inline-flex flex-wrap items-center gap-2.5 px-3 py-1 m-2.5 rounded-[6px] bg-[#0D0F13]/95 border border-[#1E2330] font-mono text-[10.5px] pointer-events-auto">
                <span className="text-white font-bold">
                  24/7 EXECUTION GRAPH
                </span>
                <span className="text-[#1E2330]">|</span>
                <span className="inline-flex items-center gap-1 text-indigo-400">
                  <span className="w-2 h-2 rounded-full bg-indigo-500" />
                  <span>ATS ≥ 65%</span>
                </span>
                <span className="inline-flex items-center gap-1 text-rose-400">
                  <span className="w-2 h-2 rounded-full bg-rose-500" />
                  <span>ATS &lt; 65% (Отсев)</span>
                </span>
                <span className="inline-flex items-center gap-1 text-emerald-400">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  <span>Выход A: Отклик</span>
                </span>
                <span className="inline-flex items-center gap-1 text-slate-400">
                  <span className="w-2 h-2 rounded-full bg-slate-500" />
                  <span>Выход B: Пропуск</span>
                </span>

                {hasActiveFilter && (
                  <button
                    onClick={() => {
                      setResumeFilter('all');
                      setBottleneckFilter('all');
                      setSearchQuery('');
                    }}
                    className="ml-1 px-2 py-0.5 rounded bg-indigo-600 text-white text-[10px] font-semibold cursor-pointer"
                  >
                    Сбросить фильтры ×
                  </button>
                )}
              </div>

              {/* 1760 x 780 SVG + Node Card Coordinate Stage */}
              <div
                className="mx-auto my-1 origin-top-left transition-transform duration-150 select-none"
                style={{
                  width: '1760px',
                  height: '780px',
                  transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${treeZoom / 100})`,
                }}
              >
                <div
                  className="relative w-[1760px] h-[780px]"
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  {/* ===========================================================
                      LAYER 1: SVG BEZIER EDGES, FORK LABELS & ANIMATED TOKENS
                     =========================================================== */}
                  <svg
                    width="1760"
                    height="780"
                    viewBox="0 0 1760 780"
                    className="absolute inset-0 pointer-events-none"
                  >
                    <defs>
                      <filter id="token-glow" x="-50%" y="-50%" width="200%" height="200%">
                        <feGaussianBlur stdDeviation="4" result="blur" />
                        <feMerge>
                          <feMergeNode in="blur" />
                          <feMergeNode in="SourceGraphic" />
                        </feMerge>
                      </filter>
                    </defs>

                    {/* Edge 1 -> 2: ВХОД -> ATS ТЕСТ */}
                    <path
                      d={GRAPH_PATHS.e1_2}
                      fill="none"
                      stroke={activeTrace?.edgeKey === 'e1_2' ? '#38bdf8' : '#263044'}
                      strokeWidth={activeTrace?.edgeKey === 'e1_2' ? '3' : '2'}
                    />

                    {/* Edge 2 -> 3: ATS >= 65% PASS BRANCH -> ПИСЬМО + ЛИНТЕР */}
                    <path
                      d={GRAPH_PATHS.e2_3}
                      fill="none"
                      stroke={activeTrace?.edgeKey === 'e2_3' ? '#818cf8' : '#312e81'}
                      strokeWidth={activeTrace?.edgeKey === 'e2_3' ? '3' : '2'}
                    />
                    <g transform="translate(680, 202)">
                      <rect
                        x="0"
                        y="0"
                        width="52"
                        height="18"
                        rx="4"
                        fill="#12151C"
                        stroke="#4f46e5"
                        strokeWidth="1"
                      />
                      <text
                        x="26"
                        y="12"
                        textAnchor="middle"
                        fill="#a5b4fc"
                        fontSize="10"
                        fontFamily="monospace"
                        fontWeight="700"
                      >
                        ≥ 65%
                      </text>
                    </g>

                    {/* Edge 3 -> 4: ПИСЬМО + ЛИНТЕР -> ШЛЮЗ HITL */}
                    <path
                      d={GRAPH_PATHS.e3_4}
                      fill="none"
                      stroke={activeTrace?.edgeKey === 'e3_4' ? '#fbbf24' : '#451a03'}
                      strokeWidth={activeTrace?.edgeKey === 'e3_4' ? '3' : '2'}
                    />

                    {/* Edge 4 -> 5A: ШЛЮЗ HITL -> ВЫХОД A: ОТКЛИК */}
                    <path
                      d={GRAPH_PATHS.e4_approve}
                      fill="none"
                      stroke={activeTrace?.edgeKey === 'e4_approve' ? '#34d399' : '#065f46'}
                      strokeWidth={activeTrace?.edgeKey === 'e4_approve' ? '3' : '2'}
                    />
                    <g transform="translate(1445, 138)">
                      <rect
                        x="0"
                        y="0"
                        width="54"
                        height="18"
                        rx="4"
                        fill="#064e3b"
                        stroke="#10b981"
                        strokeWidth="1"
                      />
                      <text
                        x="27"
                        y="12"
                        textAnchor="middle"
                        fill="#6ee7b7"
                        fontSize="9.5"
                        fontFamily="monospace"
                        fontWeight="700"
                      >
                        ✓ Отклик
                      </text>
                    </g>

                    {/* Edge 4 -> 5B: ШЛЮЗ HITL -> ВЫХОД B: ПРОПУСК */}
                    <path
                      d={GRAPH_PATHS.e4_skip}
                      fill="none"
                      stroke={activeTrace?.edgeKey === 'e4_skip' ? '#fb7185' : '#334155'}
                      strokeWidth={activeTrace?.edgeKey === 'e4_skip' ? '3' : '1.75'}
                      strokeDasharray="5 4"
                    />
                    <g transform="translate(1445, 410)">
                      <rect
                        x="0"
                        y="0"
                        width="58"
                        height="18"
                        rx="4"
                        fill="#1e293b"
                        stroke="#64748b"
                        strokeWidth="1"
                      />
                      <text
                        x="29"
                        y="12"
                        textAnchor="middle"
                        fill="#cbd5e1"
                        fontSize="9.5"
                        fontFamily="monospace"
                        fontWeight="700"
                      >
                        ✕ Пропуск
                      </text>
                    </g>

                    {/* Edge 2 -> 5B: ATS < 65% LOWER FAIL CORRIDOR -> ВЫХОД B: ПРОПУСК */}
                    <path
                      d={GRAPH_PATHS.e2_skip}
                      fill="none"
                      stroke={activeTrace?.edgeKey === 'e2_skip' ? '#f43f5e' : '#3f1d2e'}
                      strokeWidth={activeTrace?.edgeKey === 'e2_skip' ? '3' : '2'}
                      strokeDasharray="6 4"
                    />
                    <g transform="translate(930, 650)">
                      <rect
                        x="0"
                        y="0"
                        width="206"
                        height="20"
                        rx="5"
                        fill="#12151C"
                        stroke="#f43f5e"
                        strokeOpacity="0.55"
                        strokeWidth="1"
                      />
                      <text
                        x="103"
                        y="13.5"
                        textAnchor="middle"
                        fill="#fda4af"
                        fontSize="10"
                        fontFamily="monospace"
                        fontWeight="700"
                      >
                        ATS &lt; 65% · Авто-отсев (Пропуск)
                      </text>
                    </g>

                    {/* LIVE ANIMATED GLOWING TOKEN ALONG ACTIVE BEZIER PATH */}
                    {activeTrace && GRAPH_PATHS[activeTrace.edgeKey] && (
                      <g filter="url(#token-glow)">
                        <circle r="7" fill={activeTrace.hex}>
                          <animateMotion
                            dur="0.85s"
                            repeatCount="indefinite"
                            path={GRAPH_PATHS[activeTrace.edgeKey]}
                          />
                        </circle>
                        <circle r="3.5" fill="#ffffff">
                          <animateMotion
                            dur="0.85s"
                            repeatCount="indefinite"
                            path={GRAPH_PATHS[activeTrace.edgeKey]}
                          />
                        </circle>
                      </g>
                    )}
                  </svg>

                  {/* ===========================================================
                      LAYER 2: 5-COLUMN INTERACTIVE FSM NODES
                     =========================================================== */}

                  {/* -----------------------------------------------------------
                      NODE 01: ВХОД: ПОТОК hh.ru (x:20, y:40, w:280, h:530)
                     ----------------------------------------------------------- */}
                  <div
                    style={{ left: 20, top: 40, width: 280, height: 530 }}
                    className={`absolute rounded-[6px] bg-[#0D0F13] border transition-colors flex flex-col ${
                      activeTrace?.activeNodeId === 'found'
                        ? 'border-sky-400 ring-1 ring-sky-400/50'
                        : 'border-[#1E2330]'
                    }`}
                  >
                    <span
                      style={{ top: 240 }}
                      className="w-3.5 h-3.5 rounded-full bg-sky-500 border-2 border-[#09090B] absolute -right-1.5 z-10"
                    />

                    <div className="px-3 py-2.5 border-b border-[#1E2330] bg-[#12151C] rounded-t-[6px]">
                      <div className="flex items-center justify-between font-mono text-[11px]">
                        <span className="text-sky-400 font-bold">NODE-01 · HH-POLL</span>
                        <span className="text-[#71717A] tabular-nums">
                          {auto247 ? `poll ${pollCountdown}s` : 'paused'}
                        </span>
                      </div>
                      <div className="text-sm font-bold text-white mt-0.5">
                        ВХОД: ПОТОК hh.ru
                      </div>
                    </div>

                    {/* Live Cron Queries Strip + Manual +1 Trigger */}
                    <div className="p-2.5 border-b border-[#1E2330] bg-[#10131A] space-y-2">
                      <div className="flex flex-wrap gap-1">
                        {cronPolls.slice(0, 3).map((cp) => (
                          <span
                            key={cp.id}
                            className="font-mono text-[10px] px-2 py-0.5 rounded bg-[#12151C] border border-[#1E2330] text-[#A1A1AA] truncate max-w-full"
                          >
                            {cp.query}
                          </span>
                        ))}
                      </div>

                      <button
                        onClick={handleTraceSingleVacancy}
                        disabled={isTracingSingle}
                        className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-[5px] text-xs font-semibold bg-sky-600 hover:bg-sky-500 disabled:opacity-60 text-white transition-colors cursor-pointer"
                      >
                        {isTracingSingle ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            <span>Трассировка...</span>
                          </>
                        ) : (
                          <>
                            <Play className="w-3.5 h-3.5 fill-current" />
                            <span>+1 Вход (Трассировать)</span>
                          </>
                        )}
                      </button>
                    </div>

                    {/* Incoming Queue List */}
                    <div className="p-2 flex-1 overflow-y-auto space-y-2">
                      <div className="flex items-center justify-between font-mono text-[11px] text-[#71717A] px-0.5">
                        <span>В очереди на тест ({parsedTotalCount} всего):</span>
                        <span className="tabular-nums text-sky-400 font-bold">
                          {treeBuckets.found.length}
                        </span>
                      </div>

                      {treeBuckets.found.length === 0 ? (
                        <div className="p-3 rounded border border-dashed border-[#1E2330] text-center font-mono text-[11px] text-[#71717A]">
                          Ожидание следующего тика cron hh.ru...
                        </div>
                      ) : (
                        treeBuckets.found.map((v) => {
                          const matched = matchesFilters(v);
                          const r = resumeMap[v.matchedResumeId];
                          return (
                            <div
                              key={v.id}
                              onClick={() => {
                                setInspectedId(v.id);
                                setDrawerTab('battle');
                              }}
                              className={`p-2.5 rounded-[5px] bg-[#12151C] border border-[#1E2330] hover:border-sky-500/60 cursor-pointer transition-opacity ${
                                hasActiveFilter && !matched ? 'opacity-25' : 'opacity-100'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-1">
                                <span className="text-xs font-semibold text-white truncate">
                                  {v.company}
                                </span>
                                <span className="font-mono text-[10.5px] text-sky-400 shrink-0">
                                  {r?.shortCode}
                                </span>
                              </div>
                              <div className="text-[11px] text-[#A1A1AA] truncate mt-0.5">
                                {v.title}
                              </div>
                              <div className="font-mono text-[10.5px] text-[#71717A] mt-0.5 tabular-nums">
                                {v.salary}
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>

                  {/* -----------------------------------------------------------
                      NODE 02: ATS ТЕСТ (6 РЕЗЮМЕ) (x:360, y:40, w:310, h:550)
                     ----------------------------------------------------------- */}
                  <div
                    style={{ left: 360, top: 40, width: 310, height: 550 }}
                    className={`absolute rounded-[6px] bg-[#0D0F13] border transition-colors flex flex-col ${
                      activeTrace?.activeNodeId === 'scored'
                        ? 'border-indigo-400 ring-1 ring-indigo-400/60'
                        : 'border-[#1E2330]'
                    }`}
                  >
                    <span
                      style={{ top: 240 }}
                      className="w-3.5 h-3.5 rounded-full bg-indigo-500 border-2 border-[#09090B] absolute -left-1.5 z-10"
                    />
                    <span
                      style={{ top: 190 }}
                      className="w-3.5 h-3.5 rounded-full bg-indigo-500 border-2 border-[#09090B] absolute -right-1.5 z-10"
                    />
                    <span
                      style={{ top: 450 }}
                      className="w-3.5 h-3.5 rounded-full bg-rose-500 border-2 border-[#09090B] absolute -right-1.5 z-10"
                    />

                    <div className="px-3 py-2.5 border-b border-[#1E2330] bg-[#12151C] rounded-t-[6px]">
                      <div className="flex items-center justify-between font-mono text-[11px]">
                        <span className="text-indigo-400 font-bold">NODE-02 · ATS-TEST</span>
                        <span className="text-[#71717A] tabular-nums">
                          {treeBuckets.scored.length} active
                        </span>
                      </div>
                      <div className="text-sm font-bold text-white mt-0.5">
                        ATS ТЕСТ (6 РЕЗЮМЕ)
                      </div>
                    </div>

                    {/* Live 6-Resume Match Scanner Bar */}
                    {(() => {
                      const spotlightVac =
                        activeTrace?.vacancy ||
                        treeBuckets.scored[0] ||
                        vacancies.find((v) => v.stage === 'awaiting_approval') ||
                        vacancies[0];
                      const isScanning = Boolean(activeTrace?.atsScanning);

                      return (
                        <div className="p-2.5 border-b border-[#1E2330] bg-[#10131A]">
                          <div className="flex items-center justify-between font-mono text-[10px] mb-1.5">
                            <span className="text-[#A1A1AA] truncate max-w-[145px]">
                              {isScanning ? 'Тест 6x:' : 'Матрица:'}{' '}
                              <strong className="text-white">{spotlightVac?.company}</strong>
                            </span>
                            <span
                              className={`font-bold tabular-nums ${
                                spotlightVac?.atsScore >= 65 ? 'text-emerald-400' : 'text-rose-400'
                              }`}
                            >
                              {spotlightVac?.atsScore}%
                            </span>
                          </div>

                          <div className="grid grid-cols-6 gap-1">
                            {resumes.map((r) => {
                              const sc = spotlightVac?.resumeScores?.[r.id]?.overall || 20;
                              const isBest = spotlightVac?.matchedResumeId === r.id;
                              return (
                                <div key={r.id} className="flex flex-col items-center">
                                  <div className="w-full h-7 rounded-[3px] bg-[#181C26] border border-[#242A3A] flex items-end overflow-hidden p-[1px]">
                                    <div
                                      className={`w-full rounded-[2px] transition-all duration-300 ${
                                        isScanning
                                          ? 'bg-sky-400 animate-pulse'
                                          : isBest
                                          ? sc >= 65
                                            ? 'bg-emerald-500'
                                            : 'bg-rose-500'
                                          : 'bg-indigo-500/45'
                                      }`}
                                      style={{ height: `${sc}%` }}
                                    />
                                  </div>
                                  <span
                                    className={`font-mono text-[9px] mt-0.5 tabular-nums ${
                                      isBest ? 'text-white font-bold' : 'text-[#71717A]'
                                    }`}
                                  >
                                    {r.shortCode}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()}

                    {/* Scored Vacancies List */}
                    <div className="p-2 flex-1 overflow-y-auto space-y-1.5">
                      {treeBuckets.scored.map((v) => {
                        const matched = matchesFilters(v);
                        const r = resumeMap[v.matchedResumeId];
                        return (
                          <div
                            key={v.id}
                            onClick={() => {
                              setInspectedId(v.id);
                              setDrawerTab('battle');
                            }}
                            className={`p-2 rounded-[5px] bg-[#12151C] border border-[#1E2330] hover:border-indigo-500/60 cursor-pointer transition-opacity ${
                              hasActiveFilter && !matched ? 'opacity-25' : 'opacity-100'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-1">
                              <span className="text-[11.5px] font-semibold text-white truncate">
                                {v.company}
                              </span>
                              <span className="font-mono text-[10.5px] font-bold px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 tabular-nums shrink-0">
                                {v.atsScore}% · {r?.shortCode}
                              </span>
                            </div>
                            <div className="text-[10.5px] text-[#A1A1AA] truncate mt-0.5">
                              {v.title}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <div className="px-2.5 py-1.5 border-t border-[#1E2330] bg-[#12151C] rounded-b-[6px] flex items-center justify-between font-mono text-[9.5px]">
                      <span className="text-indigo-400">↗ ≥65%: Письмо</span>
                      <span className="text-rose-400">↘ &lt;65%: Пропуск</span>
                    </div>
                  </div>

                  {/* -----------------------------------------------------------
                      NODE 03: ПИСЬМО + ЛИНТЕР (x:740, y:40, w:300, h:490)
                     ----------------------------------------------------------- */}
                  <div
                    style={{ left: 740, top: 40, width: 300, height: 490 }}
                    className={`absolute rounded-[6px] bg-[#0D0F13] border transition-colors flex flex-col ${
                      activeTrace?.activeNodeId === 'drafted'
                        ? 'border-amber-400 ring-1 ring-amber-400/60'
                        : 'border-[#1E2330]'
                    }`}
                  >
                    <span
                      style={{ top: 190 }}
                      className="w-3.5 h-3.5 rounded-full bg-amber-500 border-2 border-[#09090B] absolute -left-1.5 z-10"
                    />
                    <span
                      style={{ top: 190 }}
                      className="w-3.5 h-3.5 rounded-full bg-amber-500 border-2 border-[#09090B] absolute -right-1.5 z-10"
                    />

                    <div className="px-3 py-2.5 border-b border-[#1E2330] bg-[#12151C] rounded-t-[6px]">
                      <div className="flex items-center justify-between font-mono text-[11px]">
                        <span className="text-amber-400 font-bold">NODE-03 · LLM-LINT</span>
                        <span className="text-[#71717A] tabular-nums">
                          {treeBuckets.drafted.length} drafts
                        </span>
                      </div>
                      <div className="text-sm font-bold text-white mt-0.5">
                        ПИСЬМО + ЛИНТЕР
                      </div>
                    </div>

                    <div className="p-2 flex-1 overflow-y-auto space-y-2">
                      {treeBuckets.drafted.map((v) => {
                        const matched = matchesFilters(v);
                        const lint = runCoverLetterLint(v.coverLetter);
                        return (
                          <div
                            key={v.id}
                            onClick={() => {
                              setInspectedId(v.id);
                              setDrawerTab('linter');
                            }}
                            className={`p-2.5 rounded-[5px] bg-[#12151C] border border-[#1E2330] hover:border-amber-500/60 cursor-pointer transition-opacity ${
                              hasActiveFilter && !matched ? 'opacity-25' : 'opacity-100'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-1">
                              <span className="text-xs font-semibold text-white truncate">
                                {v.company}
                              </span>
                              <span
                                className={`font-mono text-[10.5px] font-semibold px-2 py-0.5 rounded border shrink-0 ${
                                  lint.isClean
                                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                                    : 'bg-amber-500/15 text-amber-300 border-amber-500/35'
                                }`}
                              >
                                {lint.isClean
                                  ? `Clean · ${lint.wordCount}w`
                                  : `Lint (${lint.totalFlags})`}
                              </span>
                            </div>
                            <div className="text-[11px] text-[#A1A1AA] truncate mt-0.5">
                              {v.title}
                            </div>
                            <div className="font-mono text-[10.5px] text-[#71717A] mt-0.5">
                              ATS {v.atsScore}% · Анти-клише 120–180w
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* -----------------------------------------------------------
                      NODE 04: ШЛЮЗ HITL & АНКЕТЫ (x:1110, y:40, w:330, h:550)
                     ----------------------------------------------------------- */}
                  <div
                    style={{ left: 1110, top: 40, width: 330, height: 550 }}
                    className={`absolute rounded-[6px] bg-[#0D0F13] border transition-colors flex flex-col ${
                      activeTrace?.activeNodeId === 'awaiting_approval'
                        ? 'border-rose-400 ring-1 ring-rose-400/60'
                        : 'border-rose-500/45'
                    }`}
                  >
                    <span
                      style={{ top: 190 }}
                      className="w-3.5 h-3.5 rounded-full bg-rose-500 border-2 border-[#09090B] absolute -left-1.5 z-10"
                    />
                    <span
                      style={{ top: 125 }}
                      className="w-3.5 h-3.5 rounded-full bg-emerald-500 border-2 border-[#09090B] absolute -right-1.5 z-10"
                    />
                    <span
                      style={{ top: 360 }}
                      className="w-3.5 h-3.5 rounded-full bg-slate-400 border-2 border-[#09090B] absolute -right-1.5 z-10"
                    />

                    <div className="px-3 py-2.5 border-b border-[#1E2330] bg-[#12151C] rounded-t-[6px]">
                      <div className="flex items-center justify-between font-mono text-[11px]">
                        <span className="inline-flex items-center gap-1.5 text-rose-400 font-bold">
                          <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />
                          NODE-04 · HITL-GATE
                        </span>
                        <span className="text-rose-300 font-bold tabular-nums">
                          {treeBuckets.awaiting_approval.length} в шлюзе
                        </span>
                      </div>
                      <div className="text-sm font-bold text-white mt-0.5">
                        ШЛЮЗ HITL & АНКЕТЫ
                      </div>
                    </div>

                    {/* Auto-Pilot Rule Toggle Bar */}
                    <div className="px-3 py-2 border-b border-[#1E2330] bg-[#10131A] flex items-center justify-between gap-2">
                      <span className="font-mono text-[11px] text-[#A1A1AA] truncate">
                        Авто-отклик ≥ 88% без анкеты
                      </span>
                      <button
                        onClick={() => {
                          const next = !autoPilotHighScore;
                          setAutoPilotHighScore(next);
                          appendLog(
                            null,
                            `Auto-Pilot Rule (>=88% без анкеты): ${next ? 'ON' : 'OFF'}`,
                            next ? 'emerald' : 'slate',
                            'HITL-GATE'
                          );
                        }}
                        className={`px-2.5 py-0.5 rounded font-mono text-[10.5px] font-bold border transition-colors cursor-pointer shrink-0 ${
                          autoPilotHighScore
                            ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                            : 'bg-[#12151C] text-[#71717A] border-[#1E2330] hover:text-white'
                        }`}
                      >
                        {autoPilotHighScore ? 'ON' : 'OFF'}
                      </button>
                    </div>

                    {/* Awaiting Approval Cards */}
                    <div className="p-2 flex-1 overflow-y-auto space-y-2">
                      {treeBuckets.awaiting_approval.length === 0 ? (
                        <div className="p-4 rounded border border-dashed border-[#1E2330] text-center font-mono text-[11px] text-[#71717A]">
                          Шлюз HITL пуст — все решения приняты
                        </div>
                      ) : (
                        treeBuckets.awaiting_approval.map((v) => {
                          const matched = matchesFilters(v);
                          const r = resumeMap[v.matchedResumeId];
                          const isHiddenRes = r && r.visibility === 'hidden';
                          const pendingQs = (v.questions || []).filter((q) => q.needsReview).length;

                          return (
                            <div
                              key={v.id}
                              onClick={() => {
                                setInspectedId(v.id);
                                setDrawerTab(
                                  isHiddenRes || pendingQs > 0 ? 'questions' : 'battle'
                                );
                              }}
                              className={`p-2.5 rounded-[5px] bg-[#12151C] border transition-all cursor-pointer ${
                                isHiddenRes
                                  ? 'border-rose-500/60'
                                  : pendingQs > 0
                                  ? 'border-amber-500/45'
                                  : 'border-[#1E2330] hover:border-indigo-500'
                              } ${hasActiveFilter && !matched ? 'opacity-25' : 'opacity-100'}`}
                            >
                              <div className="flex items-center justify-between gap-1">
                                <span className="text-xs font-bold text-white truncate">
                                  {v.company}
                                </span>
                                <span className="font-mono text-[10.5px] font-bold text-emerald-400 tabular-nums shrink-0">
                                  {v.atsScore}% · {r?.shortCode}
                                </span>
                              </div>

                              <div className="text-[11px] text-[#A1A1AA] truncate mt-0.5">
                                {v.title}
                              </div>

                              <div className="mt-1.5">
                                {isHiddenRes ? (
                                  <span className="inline-block font-mono text-[10px] font-semibold px-2 py-0.5 rounded bg-rose-500/15 text-rose-300 border border-rose-500/35">
                                    ⚠ Резюме {r.shortCode} скрыто на hh.ru
                                  </span>
                                ) : pendingQs > 0 ? (
                                  <span className="inline-block font-mono text-[10px] font-semibold px-2 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/35">
                                    Анкета: {v.questions.length} вопр.
                                  </span>
                                ) : (
                                  <span className="inline-block font-mono text-[10px] px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/25">
                                    Готово к отправке
                                  </span>
                                )}
                              </div>

                              <div
                                className="mt-2.5 pt-2 border-t border-[#1E2330] flex items-center justify-between gap-1.5"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <button
                                  onClick={() => handleApproveVacancy(v.id)}
                                  className={`flex-1 inline-flex items-center justify-center gap-1 py-1.5 rounded-[4px] text-xs font-bold border transition-colors cursor-pointer ${
                                    isHiddenRes
                                      ? 'bg-rose-500/15 border-rose-500/40 text-rose-300 hover:bg-rose-500/25'
                                      : 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/25'
                                  }`}
                                >
                                  <span>✓ Отклик</span>
                                </button>

                                <button
                                  onClick={() => handleSkipVacancy(v.id)}
                                  className="px-2.5 py-1.5 rounded-[4px] text-xs font-semibold bg-[#181C26] hover:bg-rose-500/15 text-[#A1A1AA] hover:text-rose-300 border border-[#242A3A] transition-colors cursor-pointer"
                                >
                                  ✕ Пропуск
                                </button>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>

                  {/* -----------------------------------------------------------
                      NODE 05A (TOP RIGHT TERMINAL): ВЫХОД A: ОТКЛИК & HR-ВОРОНКА
                     ----------------------------------------------------------- */}
                  <div
                    style={{ left: 1510, top: 30, width: 240, height: 320 }}
                    className={`absolute rounded-[6px] bg-[#0D0F13] border transition-colors flex flex-col ${
                      activeTrace?.activeNodeId === 'approved'
                        ? 'border-emerald-400 ring-1 ring-emerald-400/60'
                        : 'border-emerald-500/45'
                    }`}
                  >
                    <span
                      style={{ top: 135 }}
                      className="w-3.5 h-3.5 rounded-full bg-emerald-500 border-2 border-[#09090B] absolute -left-1.5 z-10"
                    />

                    <div className="px-3 py-2.5 border-b border-[#1E2330] bg-emerald-950/25 rounded-t-[6px]">
                      <div className="flex items-center justify-between font-mono text-[11px]">
                        <span className="text-emerald-400 font-bold">EXIT-05A · DISPATCH</span>
                        <span className="text-emerald-300 font-bold tabular-nums">
                          {treeBuckets.outbound.length}
                        </span>
                      </div>
                      <div className="text-sm font-bold text-emerald-300 mt-0.5">
                        ВЫХОД A: ОТКЛИК
                      </div>
                    </div>

                    <div className="p-2 flex-1 overflow-y-auto space-y-2">
                      {treeBuckets.outbound.map((v) => {
                        const matched = matchesFilters(v);
                        const isSent = v.stage === 'sent';
                        return (
                          <div
                            key={v.id}
                            onClick={() => {
                              setInspectedId(v.id);
                              setDrawerTab('battle');
                            }}
                            className={`p-2.5 rounded-[5px] bg-[#12151C] border border-[#1E2330] hover:border-emerald-500/50 cursor-pointer transition-opacity ${
                              hasActiveFilter && !matched ? 'opacity-25' : 'opacity-100'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-1">
                              <span className="text-xs font-bold text-white truncate">
                                {v.company}
                              </span>
                              <span className="font-mono text-[10.5px] text-emerald-400 shrink-0">
                                {v.atsScore}%
                              </span>
                            </div>
                            <div className="text-[11px] text-[#A1A1AA] truncate mt-0.5">
                              {v.title}
                            </div>
                            <div className="mt-1.5">
                              {isSent ? (
                                <span className="inline-block font-mono text-[10px] font-semibold px-2 py-0.5 rounded bg-teal-500/15 text-teal-300 border border-teal-500/30">
                                  {v.employerBadge || 'Доставлено'}
                                </span>
                              ) : (
                                <span className="inline-block font-mono text-[10px] font-semibold px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                                  В очереди отправки
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* -----------------------------------------------------------
                      NODE 05B (BOTTOM RIGHT TERMINAL): ВЫХОД B: ПРОПУСК
                     ----------------------------------------------------------- */}
                  <div
                    style={{ left: 1510, top: 380, width: 240, height: 350 }}
                    className={`absolute rounded-[6px] bg-[#0D0F13] border transition-colors flex flex-col ${
                      activeTrace?.activeNodeId === 'skipped'
                        ? 'border-slate-400 ring-1 ring-slate-400/60'
                        : 'border-[#252B3B]'
                    }`}
                  >
                    <span
                      style={{ top: 80 }}
                      className="w-3.5 h-3.5 rounded-full bg-slate-400 border-2 border-[#09090B] absolute -left-1.5 z-10"
                    />
                    <span
                      style={{ top: 260 }}
                      className="w-3.5 h-3.5 rounded-full bg-rose-500 border-2 border-[#09090B] absolute -left-1.5 z-10"
                    />

                    <div className="px-3 py-2.5 border-b border-[#1E2330] bg-[#12151C] rounded-t-[6px]">
                      <div className="flex items-center justify-between font-mono text-[11px]">
                        <span className="text-slate-400 font-bold">EXIT-05B · PRUNED</span>
                        <span className="text-slate-300 font-bold tabular-nums">
                          {treeBuckets.skipped.length}
                        </span>
                      </div>
                      <div className="text-sm font-bold text-slate-300 mt-0.5">
                        ВЫХОД B: ПРОПУСК
                      </div>
                    </div>

                    <div className="p-2 flex-1 overflow-y-auto space-y-1.5">
                      {treeBuckets.skipped.map((v) => {
                        const matched = matchesFilters(v);
                        const isLowAts = v.atsScore < 65 || v.skipTag === 'ATS < 65%';
                        return (
                          <div
                            key={v.id}
                            onClick={() => {
                              setInspectedId(v.id);
                              setDrawerTab('ledger');
                            }}
                            className={`p-2 rounded-[5px] bg-[#12151C] border border-[#1E2330] hover:border-slate-500 cursor-pointer transition-opacity ${
                              hasActiveFilter && !matched ? 'opacity-25' : 'opacity-100'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-1">
                              <span className="text-[11px] font-semibold text-slate-200 truncate">
                                {v.company}
                              </span>
                              <span className="font-mono text-[9.5px] text-slate-400 shrink-0">
                                {v.atsScore}%
                              </span>
                            </div>
                            <div className="text-[10px] text-[#71717A] truncate mt-0.5">
                              {v.title}
                            </div>
                            <div className="mt-1 flex items-center justify-between gap-1">
                              <span
                                className={`font-mono text-[9px] font-semibold px-1.5 py-0.5 rounded border ${
                                  isLowAts
                                    ? 'bg-rose-500/10 text-rose-300 border-rose-500/30'
                                    : 'bg-slate-500/15 text-slate-300 border-slate-500/30'
                                }`}
                              >
                                {v.skipTag || 'Ручной пропуск'}
                              </span>

                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleRestoreVacancy(v.id);
                                }}
                                className="font-mono text-[9px] text-sky-400 hover:underline cursor-pointer"
                              >
                                Вернуть в тест
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* =================================================================
                RIGHT COLLAPSIBLE 24/7 RADAR & TELEMETRY SIDEBAR
               ================================================================= */}
            {showRightSidebar && (
              <aside className="w-full xl:w-72 bg-[#0D0F13] border-t xl:border-t-0 xl:border-l border-[#1E2330] p-3 flex flex-col gap-3 shrink-0">
                {/* 1. Funnel Conversion Telemetry */}
                <div className="rounded-[6px] bg-[#12151C] border border-[#1E2330] p-2.5">
                  <div className="flex items-center justify-between font-mono text-[10.5px] text-[#A1A1AA] mb-2">
                    <span className="font-bold text-white">24/7 FUNNEL TELEMETRY</span>
                    <span className="text-emerald-400">LIVE</span>
                  </div>

                  <div className="grid grid-cols-3 gap-1.5 font-mono text-center tabular-nums">
                    <div className="p-1.5 rounded bg-[#0D0F13] border border-[#1E2330]">
                      <div className="text-[9.5px] text-[#71717A]">PARSED</div>
                      <div className="text-xs font-bold text-sky-400 mt-0.5">
                        {parsedTotalCount}
                      </div>
                    </div>
                    <div className="p-1.5 rounded bg-[#0D0F13] border border-[#1E2330]">
                      <div className="text-[9.5px] text-[#71717A]">HITL GATE</div>
                      <div className="text-xs font-bold text-rose-400 mt-0.5">
                        {treeBuckets.awaiting_approval.length}
                      </div>
                    </div>
                    <div className="p-1.5 rounded bg-[#0D0F13] border border-[#1E2330]">
                      <div className="text-[9.5px] text-[#71717A]">SENT / HR</div>
                      <div className="text-xs font-bold text-emerald-400 mt-0.5">
                        {treeBuckets.outbound.length}
                      </div>
                    </div>
                  </div>
                </div>

                {/* 2. Active hh.ru Search Cron Polls */}
                <div className="rounded-[6px] bg-[#12151C] border border-[#1E2330] p-2.5">
                  <div className="flex items-center justify-between font-mono text-[10.5px] mb-2">
                    <span className="font-bold text-white">HH.RU SEARCH CRONS</span>
                    <span className="text-sky-400 tabular-nums">
                      {auto247 ? `next ${pollCountdown}s` : 'stopped'}
                    </span>
                  </div>

                  <div className="space-y-1.5">
                    {cronPolls.map((cp) => (
                      <div
                        key={cp.id}
                        className="flex items-center justify-between gap-2 px-2 py-1 rounded bg-[#0D0F13] border border-[#1E2330] font-mono text-[10.5px]"
                      >
                        <div className="min-w-0">
                          <div className="text-[#E4E4E7] truncate">{cp.query}</div>
                          <div className="text-[9.5px] text-[#71717A]">
                            {cp.resumeCode} · {cp.interval}
                          </div>
                        </div>
                        <span className="text-sky-400 font-bold tabular-nums shrink-0">
                          +{cp.foundToday}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 3. Active Pipeline Bottlenecks */}
                <div className="rounded-[6px] bg-[#12151C] border border-[#1E2330] p-2.5 space-y-1.5">
                  <div className="font-mono text-[10.5px] font-bold text-white">
                    ACTIVE BOTTLENECKS
                  </div>

                  <button
                    onClick={() =>
                      setBottleneckFilter((p) => (p === 'questions' ? 'all' : 'questions'))
                    }
                    className="w-full flex items-center justify-between px-2 py-1.5 rounded bg-amber-500/10 hover:bg-amber-500/15 border border-amber-500/30 font-mono text-[10.5px] text-amber-300 cursor-pointer text-left"
                  >
                    <span>Blocked by questions</span>
                    <span className="font-bold tabular-nums">{blockedQuestionsCount}</span>
                  </button>

                  <button
                    onClick={() =>
                      setBottleneckFilter((p) =>
                        p === 'hidden_resume' ? 'all' : 'hidden_resume'
                      )
                    }
                    className="w-full flex items-center justify-between px-2 py-1.5 rounded bg-rose-500/10 hover:bg-rose-500/15 border border-rose-500/30 font-mono text-[10.5px] text-rose-300 cursor-pointer text-left"
                  >
                    <span>Resume hidden on hh.ru</span>
                    <span className="font-bold tabular-nums">{blockedHiddenResumeCount}</span>
                  </button>
                </div>
              </aside>
            )}
          </div>

          {/* =================================================================
              BOTTOM COLLAPSIBLE LIVE DAEMON CONSOLE (journalctl + CLI)
             ================================================================= */}
          <footer className="bg-[#0D0F13] border-t border-[#1E2330] px-3 sm:px-4 py-2">
            {/* Console Top Bar + Subsystem Filters */}
            <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
              <div className="flex flex-wrap items-center gap-2 font-mono text-[11px]">
                <button
                  onClick={() => setConsoleExpanded((e) => !e)}
                  className="inline-flex items-center gap-1.5 font-bold text-white hover:text-indigo-300 cursor-pointer"
                >
                  <Terminal className="w-3.5 h-3.5 text-emerald-400" />
                  <span>journalctl -u jobfit-daemon -f</span>
                  {consoleExpanded ? (
                    <ChevronDown className="w-3.5 h-3.5 text-[#71717A]" />
                  ) : (
                    <ChevronUp className="w-3.5 h-3.5 text-[#71717A]" />
                  )}
                </button>

                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />

                {/* Subsystem Filter Chips */}
                <div className="flex flex-wrap items-center gap-1">
                  {['ALL', 'HH-POLL', 'ATS-TEST', 'LLM-LINT', 'HITL-GATE', 'DISPATCH'].map(
                    (tag) => (
                      <button
                        key={tag}
                        onClick={() => setLogFilter(tag)}
                        className={`px-1.5 py-0.5 rounded text-[9.5px] font-semibold border transition-colors cursor-pointer ${
                          logFilter === tag
                            ? 'bg-indigo-600 text-white border-indigo-500'
                            : 'bg-[#12151C] text-[#71717A] border-[#1E2330] hover:text-white'
                        }`}
                      >
                        {tag}
                      </button>
                    )
                  )}
                </div>
              </div>

              <span className="font-mono text-[10px] text-[#71717A] hidden md:inline">
                CLI: help · run · batch · sync · approve-ready · pause · resume
              </span>
            </div>

            {consoleExpanded && (
              <>
                {/* Streamed Monospace Logs */}
                <div className="space-y-1 max-h-28 overflow-y-auto mb-1.5 pr-1">
                  {filteredExecutionLogs.slice(0, 6).map((entry) => {
                    const badgeStyle =
                      entry.subsys === 'HH-POLL'
                        ? 'text-sky-400'
                        : entry.subsys === 'ATS-TEST'
                        ? 'text-indigo-400'
                        : entry.subsys === 'LLM-LINT'
                        ? 'text-amber-400'
                        : entry.subsys === 'HITL-GATE'
                        ? 'text-rose-400'
                        : entry.subsys === 'DISPATCH'
                        ? 'text-emerald-400'
                        : 'text-zinc-400';

                    return (
                      <div
                        key={entry.id}
                        onClick={() => {
                          if (
                            entry.vacancyId &&
                            vacancies.some((v) => v.id === entry.vacancyId)
                          ) {
                            setInspectedId(entry.vacancyId);
                            setDrawerTab('battle');
                          }
                        }}
                        className={`flex items-center gap-2 px-2 py-0.5 rounded-[4px] bg-[#12151C] border border-[#1E2330] font-mono text-[10.5px] truncate ${
                          entry.vacancyId ? 'hover:border-indigo-500/50 cursor-pointer' : ''
                        }`}
                      >
                        <span className="text-[#71717A] shrink-0">{entry.ts}</span>
                        <span className={`font-bold shrink-0 w-20 ${badgeStyle}`}>
                          [{entry.subsys}]
                        </span>
                        <span className="text-[#D4D4D8] truncate">{entry.text}</span>
                      </div>
                    );
                  })}
                </div>

                {/* Interactive Daemon CLI Prompt */}
                <form
                  onSubmit={handleCliSubmit}
                  className="flex items-center gap-2 px-2.5 py-1 rounded-[5px] bg-[#09090B] border border-[#1E2330] focus-within:border-indigo-500 font-mono text-[11px]"
                >
                  <span className="text-emerald-400 font-bold select-none">
                    jobfit@daemon:~$
                  </span>
                  <input
                    type="text"
                    value={cliInput}
                    onChange={(e) => setCliInput(e.target.value)}
                    placeholder="Введите команду (help, run, batch, sync, approve-ready, pause, resume)..."
                    className="flex-1 bg-transparent text-white placeholder-[#52525B] focus:outline-none"
                  />
                  <button
                    type="submit"
                    className="px-2 py-0.5 rounded bg-[#12151C] hover:bg-[#1E2330] border border-[#1E2330] text-[10px] text-[#A1A1AA] hover:text-white cursor-pointer"
                  >
                    EXEC
                  </button>
                </form>
              </>
            )}
          </footer>
        </div>
      )}

      {/* =====================================================================
          3B. SECONDARY VIEW: 6-COLUMN KANBAN BOARD ("Канбан (6)")
         ===================================================================== */}
      {activeView === 'kanban' && (
        <main className="flex-1 p-3 sm:p-4 overflow-x-auto">
          <div
            className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 ${
              showSkippedKanban ? '2xl:grid-cols-7' : '2xl:grid-cols-6'
            } gap-2.5`}
          >
            {kanbanColumns.map((col) => {
              const colItems = vacancies.filter(
                (v) => v.stage === col.id && matchesFilters(v)
              );
              const dimmed = kanbanStageFilter && kanbanStageFilter !== col.id;

              return (
                <div
                  key={col.id}
                  className={`rounded-[8px] bg-[#0F1117] border border-[#222634] flex flex-col min-h-[560px] transition-opacity ${
                    dimmed ? 'opacity-35' : 'opacity-100'
                  }`}
                >
                  <div
                    className="px-3 py-2 border-b border-[#222634] flex items-center justify-between gap-2"
                    style={{ borderTop: `2.5px solid ${col.hex}` }}
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: col.hex }}
                      />
                      <h3 className="text-xs font-semibold text-white truncate">
                        {col.kanbanTitle}
                      </h3>
                    </div>
                    <span className="font-mono text-xs font-semibold text-[#71717A] tabular-nums">
                      {colItems.length}
                    </span>
                  </div>

                  <div className="p-2 flex-1 flex flex-col gap-2 overflow-y-auto max-h-[720px]">
                    {colItems.length === 0 ? (
                      <div className="flex-1 rounded-[6px] border border-dashed border-[#222634] p-4 flex items-center justify-center font-mono text-[11px] text-[#71717A]">
                        Нет вакансий
                      </div>
                    ) : (
                      colItems.map((vac) => {
                        const matchedRes = resumeMap[vac.matchedResumeId];
                        const isHiddenResume =
                          matchedRes &&
                          matchedRes.visibility === 'hidden' &&
                          vac.stage !== 'sent' &&
                          vac.stage !== 'skipped';
                        const pendingQs = (vac.questions || []).filter(
                          (q) => q.needsReview
                        ).length;
                        const lint = runCoverLetterLint(vac.coverLetter);

                        return (
                          <div
                            key={vac.id}
                            onClick={() => {
                              setInspectedId(vac.id);
                              setDrawerTab(
                                isHiddenResume || pendingQs > 0 ? 'questions' : 'battle'
                              );
                            }}
                            className="rounded-[6px] p-2.5 bg-[#141720] hover:bg-[#191D28] border border-[#222634] hover:border-indigo-500/60 transition-colors cursor-pointer flex flex-col gap-2"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <h4 className="text-[12.5px] font-semibold text-[#F4F4F6] leading-snug line-clamp-2">
                                {vac.title}
                              </h4>
                              <span
                                className={`font-mono text-[11px] font-bold px-1.5 py-0.5 rounded-[4px] border tabular-nums shrink-0 ${
                                  vac.atsScore >= 90
                                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                                    : vac.atsScore >= 65
                                    ? 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30'
                                    : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                                }`}
                              >
                                {vac.atsScore}%
                              </span>
                            </div>

                            <div className="text-[11px] text-[#A1A1AA] truncate">
                              <span className="text-[#E4E4E7] font-medium">{vac.company}</span>
                              <span> · {vac.cityFormat} · </span>
                              <span className="font-mono text-[#D4D4D8] tabular-nums">
                                {vac.salary}
                              </span>
                            </div>

                            <div className="flex items-center justify-between gap-1.5">
                              <span className="font-mono text-[10px] px-1.5 py-0.5 rounded-[4px] bg-[#0F1117] border border-[#222634] text-[#D4D4D8] truncate">
                                {matchedRes ? matchedRes.filterLabel : 'Unassigned'}
                              </span>

                              {isHiddenResume ? (
                                <span className="font-mono text-[10px] px-1.5 py-0.5 rounded-[4px] bg-rose-500/15 border border-rose-500/35 text-rose-300 shrink-0">
                                  Resume Hidden
                                </span>
                              ) : pendingQs > 0 ? (
                                <span className="font-mono text-[10px] px-1.5 py-0.5 rounded-[4px] bg-amber-500/15 border border-amber-500/35 text-amber-300 shrink-0">
                                  Questions ({vac.questions.length})
                                </span>
                              ) : vac.stage === 'sent' && vac.employerBadge ? (
                                <span className="font-mono text-[10px] px-1.5 py-0.5 rounded-[4px] bg-teal-500/15 border border-teal-500/35 text-teal-300 truncate">
                                  {vac.employerBadge}
                                </span>
                              ) : (
                                <span className="font-mono text-[10px] px-1.5 py-0.5 rounded-[4px] bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 shrink-0">
                                  {lint.isClean ? 'Letter Clean' : `Lint (${lint.totalFlags})`}
                                </span>
                              )}
                            </div>

                            <div
                              className="pt-1.5 border-t border-[#222634] flex items-center justify-between gap-1"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                onClick={() => {
                                  setInspectedId(vac.id);
                                  setDrawerTab('battle');
                                }}
                                className="px-2 py-0.5 rounded-[4px] text-[11px] font-medium text-[#A1A1AA] hover:text-white hover:bg-[#222634] cursor-pointer"
                              >
                                Inspect
                              </button>

                              <div className="flex items-center gap-1">
                                {vac.stage === 'skipped' ? (
                                  <button
                                    onClick={() => handleRestoreVacancy(vac.id)}
                                    className="px-2 py-0.5 rounded-[4px] text-[11px] font-semibold bg-sky-500/15 border border-sky-500/35 text-sky-300 cursor-pointer"
                                  >
                                    Restore
                                  </button>
                                ) : (
                                  <>
                                    {vac.stage !== 'approved' && vac.stage !== 'sent' && (
                                      <button
                                        onClick={() => handleApproveVacancy(vac.id)}
                                        className={`px-2 py-0.5 rounded-[4px] text-[11px] font-semibold border cursor-pointer ${
                                          isHiddenResume
                                            ? 'bg-rose-500/15 border-rose-500/35 text-rose-300'
                                            : 'bg-emerald-500/15 border-emerald-500/35 text-emerald-300'
                                        }`}
                                      >
                                        Quick Approve
                                      </button>
                                    )}
                                    {vac.stage !== 'sent' && (
                                      <button
                                        onClick={() => handleSkipVacancy(vac.id)}
                                        className="px-2 py-0.5 rounded-[4px] text-[11px] text-[#71717A] hover:text-rose-400 cursor-pointer"
                                      >
                                        Skip
                                      </button>
                                    )}
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </main>
      )}

      {/* =====================================================================
          3C. DEDICATED VIEW: OUTBOUND APPLICATIONS & HR INTERVIEW RADAR ("Отклики & HR")
         ===================================================================== */}
      {activeView === 'hr' && (
        <main className="flex-1 max-w-[1540px] w-full mx-auto p-4 sm:p-6 space-y-5">
          {/* Top HR Funnel Telemetry Strip */}
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#1E2330]">
            <div>
              <h1 className="text-base font-semibold text-white">
                Отклики & HR Radar — Исходящие заявки и приглашения на интервью
              </h1>
              <p className="text-xs text-[#A1A1AA] mt-0.5">
                Мониторинг доставки откликов через WebBridge :10086, просмотров HR и назначенных
                собеседований в реальном времени.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 font-mono text-xs tabular-nums">
              <div className="px-3 py-1.5 rounded-[6px] bg-[#12151C] border border-[#1E2330]">
                <span className="text-[#71717A]">В очереди: </span>
                <span className="text-emerald-400 font-bold">{outboundQueuedList.length}</span>
              </div>
              <div className="px-3 py-1.5 rounded-[6px] bg-[#12151C] border border-[#1E2330]">
                <span className="text-[#71717A]">Отправлено: </span>
                <span className="text-teal-300 font-bold">{outboundSentList.length}</span>
              </div>
              <div className="px-3 py-1.5 rounded-[6px] bg-[#12151C] border border-[#1E2330]">
                <span className="text-[#71717A]">Приглашений HR: </span>
                <span className="text-emerald-300 font-bold">{interviewInvitesCount}</span>
              </div>
            </div>
          </div>

          {/* Outbound & HR Response Cards Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {[...outboundSentList, ...outboundQueuedList].map((v) => {
              const r = resumeMap[v.matchedResumeId];
              const isSent = v.stage === 'sent';
              const isInvite = (v.employerBadge || '').toLowerCase().includes('приглашение');

              return (
                <div
                  key={v.id}
                  onClick={() => {
                    setInspectedId(v.id);
                    setDrawerTab('linter');
                  }}
                  className={`rounded-[6px] p-4 bg-[#0D0F13] border transition-colors cursor-pointer flex flex-col justify-between gap-3 ${
                    isInvite
                      ? 'border-emerald-500/50'
                      : isSent
                      ? 'border-[#1E2330] hover:border-teal-500/50'
                      : 'border-amber-500/35 hover:border-emerald-500/50'
                  }`}
                >
                  <div>
                    <div className="flex items-start justify-between gap-2 mb-1.5">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-white">{v.company}</span>
                          <span className="font-mono text-[10.5px] text-[#71717A]">
                            hh.ru/{v.hhId}
                          </span>
                        </div>
                        <h3 className="text-xs font-medium text-[#D4D4D8] mt-0.5">{v.title}</h3>
                      </div>

                      <span
                        className={`font-mono text-[10.5px] font-bold px-2 py-0.5 rounded border shrink-0 ${
                          isInvite
                            ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                            : isSent
                            ? 'bg-teal-500/15 text-teal-300 border-teal-500/35'
                            : 'bg-amber-500/15 text-amber-300 border-amber-500/35'
                        }`}
                      >
                        {isSent ? v.employerBadge || 'Доставлено' : 'В очереди отправки'}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-[#A1A1AA] mt-2 tabular-nums">
                      <span>{v.salary}</span>
                      <span>·</span>
                      <span>{v.cityFormat}</span>
                      <span>·</span>
                      <span className="text-indigo-300">
                        ATS {v.atsScore}% ({r?.filterLabel})
                      </span>
                    </div>

                    <p className="mt-2.5 text-xs text-[#A1A1AA] line-clamp-2 bg-[#12151C] border border-[#1E2330] rounded p-2.5 leading-relaxed">
                      {v.coverLetter}
                    </p>
                  </div>

                  <div
                    className="pt-2 border-t border-[#1E2330] flex items-center justify-between text-xs"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      onClick={() => {
                        setInspectedId(v.id);
                        setDrawerTab('linter');
                      }}
                      className="text-indigo-400 hover:text-indigo-300 font-medium cursor-pointer"
                    >
                      Открыть досье и письмо →
                    </button>

                    {!isSent && (
                      <button
                        onClick={handleSyncResponses}
                        className="px-2.5 py-1 rounded bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/35 font-mono text-[11px] text-emerald-300 font-semibold cursor-pointer"
                      >
                        Отправить сейчас
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </main>
      )}

      {/* =====================================================================
          3D. SECONDARY VIEW: RESUMES PORTFOLIO ("Резюме (6)")
         ===================================================================== */}
      {activeView === 'resumes' && (
        <main className="flex-1 max-w-[1540px] w-full mx-auto p-4 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4 pb-3 border-b border-[#222634]">
            <div>
              <h1 className="text-base font-semibold text-white">
                Resumes Portfolio — 6 Профилей кандидата (hh.ru Synced)
              </h1>
              <p className="text-xs text-[#A1A1AA] mt-0.5">
                Все 6 резюме участвуют в параллельном ATS-тестировании на узле NODE-02. Переключение
                видимости мгновенно снимает или активирует блокировку в Шлюзе HITL.
              </p>
            </div>

            <div className="flex items-center gap-3 font-mono text-xs bg-[#141720] border border-[#222634] rounded-[6px] px-3 py-1.5 tabular-nums">
              <span className="text-emerald-400">
                Public: {resumes.filter((r) => r.visibility === 'public').length}
              </span>
              <span className="text-[#27272A]">|</span>
              <span
                className={
                  resumes.some((r) => r.visibility === 'hidden')
                    ? 'text-rose-400 font-semibold'
                    : 'text-[#71717A]'
                }
              >
                Hidden: {resumes.filter((r) => r.visibility === 'hidden').length}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {resumes.map((res) => {
              const isHidden = res.visibility === 'hidden';
              const matchedCount = nonSkippedVacancies.filter(
                (v) => v.matchedResumeId === res.id
              ).length;

              return (
                <div
                  key={res.id}
                  className={`rounded-[8px] p-4 bg-[#0F1117] border flex flex-col justify-between transition-colors ${
                    isHidden ? 'border-rose-500/50' : 'border-[#222634]'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-2.5">
                      <div className="flex items-center gap-2 font-mono text-[11px]">
                        <span className="px-2 py-0.5 rounded-[4px] bg-[#141720] border border-[#222634] text-indigo-300 font-semibold">
                          {res.filterLabel}
                        </span>
                        <span className="text-[#71717A]">{res.hhId}</span>
                      </div>

                      <button
                        onClick={() => handleToggleResumeVisibility(res.id)}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-[4px] text-[11px] font-mono font-medium border transition-colors cursor-pointer ${
                          isHidden
                            ? 'bg-rose-500/15 border-rose-500/40 text-rose-300 hover:bg-rose-500/25'
                            : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20'
                        }`}
                      >
                        {isHidden ? (
                          <>
                            <EyeOff className="w-3 h-3" />
                            <span>Hidden on hh.ru</span>
                          </>
                        ) : (
                          <>
                            <Eye className="w-3 h-3" />
                            <span>Public on hh.ru</span>
                          </>
                        )}
                      </button>
                    </div>

                    <h3 className="text-sm font-semibold text-white leading-snug mb-1">
                      {res.title}
                    </h3>
                    <div className="font-mono text-[11px] text-[#71717A] mb-3 tabular-nums">
                      {res.experience} · {res.compRange} · {res.wordCount} words
                    </div>

                    {/* ATS Readiness Meter */}
                    <div className="p-2.5 rounded-[6px] bg-[#141720] border border-[#222634] mb-3">
                      <div className="flex items-center justify-between text-xs mb-1.5">
                        <span className="text-[#A1A1AA]">ATS Readiness Score</span>
                        <span className="font-mono font-semibold text-white tabular-nums">
                          {res.atsReadiness}%
                        </span>
                      </div>
                      <div className="w-full h-1.5 rounded-xs bg-[#222634] overflow-hidden">
                        <div
                          className="h-full bg-indigo-500 transition-all duration-200"
                          style={{ width: `${res.atsReadiness}%` }}
                        />
                      </div>
                      <div className="mt-1.5 flex items-center justify-between text-[11px] font-mono">
                        <span className={isHidden ? 'text-rose-400' : 'text-emerald-400'}>
                          {res.auditStatus}
                        </span>
                        <span className="text-[#71717A]">{res.wordCount}w</span>
                      </div>
                    </div>

                    {/* Key Skill Tags */}
                    <div className="flex flex-wrap gap-1 mb-3">
                      {res.skills.map((skill) => (
                        <span
                          key={skill}
                          className="font-mono text-[10px] px-1.5 py-0.5 rounded-[4px] bg-[#141720] border border-[#222634] text-[#D4D4D8]"
                        >
                          {skill}
                        </span>
                      ))}
                    </div>

                    {/* Verified Factual Bullets */}
                    <div className="space-y-1.5 mb-3">
                      {res.facts.map((fact, idx) => (
                        <div
                          key={idx}
                          className="text-[11.5px] text-[#A1A1AA] leading-snug pl-2.5 border-l-2 border-indigo-500/40"
                        >
                          {fact}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="pt-2.5 border-t border-[#222634] flex items-center justify-between text-xs">
                    <span className="font-mono text-[11px] text-[#71717A] tabular-nums">
                      Активных вакансий: <strong className="text-[#E4E4E7]">{matchedCount}</strong>
                    </span>
                    <button
                      onClick={() => {
                        setResumeFilter(res.id);
                        setActiveView('tree');
                      }}
                      className="text-indigo-400 hover:text-indigo-300 font-medium text-xs cursor-pointer"
                    >
                      Показать в дереве →
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </main>
      )}

      {/* =====================================================================
          4. SLIDE-OVER VACANCY INSPECTION DRAWER (760px, 4 TABS + SHORTCUTS)
         ===================================================================== */}
      <AnimatePresence initial={false}>
        {inspectedVacancy && (
          <VacancyInspectionDrawer
            vacancy={inspectedVacancy}
            resumes={resumes}
            resumeMap={resumeMap}
            activeTab={drawerTab}
            setActiveTab={setDrawerTab}
            regenerating={regenerating}
            onClose={() => setInspectedId(null)}
            onReassignResume={(resId) => handleReassignResume(inspectedVacancy.id, resId)}
            onUpdateCoverLetter={(txt) => handleUpdateCoverLetter(inspectedVacancy.id, txt)}
            onRegenerate={() => handleRegenerateDraft(inspectedVacancy.id)}
            onUpdateQuestion={(qId, val) =>
              handleUpdateQuestionAnswer(inspectedVacancy.id, qId, val)
            }
            onVerifyAllQuestions={() => handleVerifyAllQuestions(inspectedVacancy.id)}
            onUnlockResume={(resId) => handleToggleResumeVisibility(resId)}
            onApprove={() => handleApproveVacancy(inspectedVacancy.id)}
            onSkip={() => handleSkipVacancy(inspectedVacancy.id)}
            onNavigate={(dir) => {
              const pool = vacancies.filter(matchesFilters);
              const list = pool.length > 0 ? pool : vacancies;
              const idx = list.findIndex((item) => item.id === inspectedVacancy.id);
              if (idx === -1 || list.length <= 1) return;
              const nextIdx =
                dir === 'next' ? (idx + 1) % list.length : (idx - 1 + list.length) % list.length;
              setInspectedId(list[nextIdx].id);
            }}
          />
        )}
      </AnimatePresence>

      {/* =====================================================================
          5. TELEMETRY TOASTS
         ===================================================================== */}
      <div className="fixed bottom-3 right-3 z-50 flex flex-col gap-1.5 max-w-sm w-full pointer-events-none px-3 sm:px-0">
        <AnimatePresence initial={false}>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              transition={{ duration: 0.14 }}
              className="pointer-events-auto rounded-[8px] p-2.5 bg-[#141720] border border-[#2C3144] shadow-xl flex items-start gap-2"
            >
              <span
                className={`w-2 h-2 rounded-full mt-1 shrink-0 ${
                  t.type === 'success'
                    ? 'bg-emerald-500'
                    : t.type === 'warning'
                    ? 'bg-rose-500'
                    : 'bg-indigo-500'
                }`}
              />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold text-white">{t.title}</div>
                <div className="text-[11px] text-[#A1A1AA] mt-0.5 leading-snug">{t.detail}</div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ============================================================================
// 7. SLIDE-OVER VACANCY INSPECTION DRAWER (760px, 4 TABS)
// ============================================================================

function VacancyInspectionDrawer({
  vacancy,
  resumes,
  resumeMap,
  activeTab,
  setActiveTab,
  regenerating,
  onClose,
  onReassignResume,
  onUpdateCoverLetter,
  onRegenerate,
  onUpdateQuestion,
  onVerifyAllQuestions,
  onUnlockResume,
  onApprove,
  onSkip,
  onNavigate,
}) {
  const assignedResume = resumeMap[vacancy.matchedResumeId] || resumes[0];
  const isResumeHidden = assignedResume && assignedResume.visibility === 'hidden';
  const stageMeta = STAGE_MAP[vacancy.stage] || {
    code: 'EXIT-05B',
    label: 'Skipped',
    hex: '#64748b',
  };

  const lint = useMemo(() => runCoverLetterLint(vacancy.coverLetter), [vacancy.coverLetter]);

  // Rank all 6 loaded resumes for Tab 1: Multi-Resume ATS Battle
  const rankedResumes = useMemo(() => {
    if (Array.isArray(vacancy.comparison) && vacancy.comparison.length > 0) {
      return vacancy.comparison.map((c, idx) => {
        const found = resumes.find((r) => r.id === c.resumeId) || {
          id: c.resumeId,
          title: c.name || `Резюме ${idx + 1}`,
          shortCode: `R${idx + 1}`,
          filterLabel: c.name || `Резюме ${idx + 1}`,
          visibility: 'public',
        };
        return {
          resume: found,
          overall: c.overall ?? 50,
          hardSkills: c.hardCoverage ?? c.overall ?? 50,
          domain: c.overall ?? 50,
          seniority: c.overall ?? 50,
          rank: c.rank ?? (idx + 1),
          recommended: Boolean(c.recommended || idx === 0),
        };
      });
    }
    return resumes
      .map((r) => {
        const scores = vacancy.resumeScores?.[r.id] || {
          overall: 50,
          hardSkills: 50,
          domain: 50,
          seniority: 50,
        };
        return { resume: r, ...scores };
      })
      .sort((a, b) => b.overall - a.overall);
  }, [resumes, vacancy.comparison, vacancy.resumeScores]);

  const pendingQsCount = (vacancy.questions || []).filter((q) => q.needsReview).length;

  const handleFixPhrase = (rule) => {
    const escaped = rule.phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const updated = vacancy.coverLetter
      .replace(new RegExp(escaped, 'gi'), rule.replacement || '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    onUpdateCoverLetter(updated);
  };

  const handleRemoveAllFlagged = () => {
    let text = vacancy.coverLetter;
    [...lint.cliches, ...lint.aiVocab, ...lint.moralizing].forEach((rule) => {
      const escaped = rule.phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      text = text.replace(new RegExp(escaped, 'gi'), rule.replacement || '');
    });
    onUpdateCoverLetter(text.replace(/\s{2,}/g, ' ').trim());
  };

  // Inline highlighted preview for Cover Letter Linter
  const highlightedLetterNodes = useMemo(() => {
    const allRules = [...CLICHE_RULES, ...AI_VOCAB_RULES, ...MORALIZING_RULES];
    if (!vacancy.coverLetter) return null;

    const pattern = new RegExp(
      `(${allRules
        .map((r) => r.phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('|')})`,
      'gi'
    );

    const parts = vacancy.coverLetter.split(pattern);
    return parts.map((part, idx) => {
      const matched = allRules.find(
        (r) => r.phrase.toLowerCase() === part.toLowerCase()
      );
      if (!matched) return <React.Fragment key={idx}>{part}</React.Fragment>;

      const style =
        matched.category === 'cliche'
          ? 'bg-rose-500/20 text-rose-300 border-b border-rose-500 font-medium px-0.5 rounded-xs'
          : matched.category === 'ai_vocab'
          ? 'bg-purple-500/20 text-purple-300 border-b border-purple-500 font-medium px-0.5 rounded-xs'
          : 'bg-amber-500/20 text-amber-300 border-b border-amber-500 font-medium px-0.5 rounded-xs';

      return (
        <mark key={idx} className={style}>
          {part}
        </mark>
      );
    });
  }, [vacancy.coverLetter]);

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/60 backdrop-blur-[1px]">
      <div className="flex-1" onClick={onClose} />

      <motion.aside
        initial={{ x: 28, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 28, opacity: 0 }}
        transition={{ duration: 0.16 }}
        className="w-full max-w-[760px] bg-[#0F1117] border-l border-[#222634] flex flex-col h-full overflow-hidden shadow-2xl"
      >
        {/* Drawer Header */}
        <div className="px-4 py-3 bg-[#141720] border-b border-[#222634]">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <span className="text-xs font-semibold text-white">{vacancy.company}</span>

                <span className="inline-flex items-center gap-1 font-mono text-[11px] px-1.5 py-0.5 rounded-[4px] bg-[#0F1117] border border-[#222634] text-[#71717A]">
                  <span>hh.ru/{vacancy.hhId}</span>
                  <ArrowUpRight className="w-3 h-3" />
                </span>

                <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-semibold px-2 py-0.5 rounded-[4px] bg-[#0F1117] border border-[#222634] text-[#E4E4E7]">
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: stageMeta.hex }}
                  />
                  <span>
                    {stageMeta.code} · {stageMeta.label}
                  </span>
                </span>

                <span className="font-mono text-[11px] font-semibold text-[#D4D4D8] tabular-nums">
                  {vacancy.salary}
                </span>
              </div>

              <h2 className="text-sm sm:text-base font-semibold text-white leading-snug">
                {vacancy.title}
              </h2>
            </div>

            {/* Prev / Next / Close */}
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={() => onNavigate('prev')}
                className="p-1.5 rounded-[5px] bg-[#0F1117] border border-[#222634] text-[#A1A1AA] hover:text-white cursor-pointer"
                title="Previous Vacancy ( [ )"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => onNavigate('next')}
                className="p-1.5 rounded-[5px] bg-[#0F1117] border border-[#222634] text-[#A1A1AA] hover:text-white cursor-pointer"
                title="Next Vacancy ( ] )"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
              <button
                onClick={onClose}
                className="p-1.5 rounded-[5px] bg-[#0F1117] border border-[#222634] text-[#A1A1AA] hover:text-rose-400 ml-1 cursor-pointer"
                title="Close (Esc)"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* 4 Inspection Tabs */}
          <div className="mt-3 flex items-center gap-1 overflow-x-auto">
            <button
              onClick={() => setActiveTab('battle')}
              className={`px-2.5 py-1.5 rounded-[6px] text-xs font-medium border transition-colors shrink-0 cursor-pointer ${
                activeTab === 'battle'
                  ? 'bg-indigo-600 text-white border-indigo-500'
                  : 'border-transparent text-[#A1A1AA] hover:text-white'
              }`}
            >
              1. Multi-Resume ATS Battle
            </button>

            <button
              onClick={() => setActiveTab('ledger')}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-[6px] text-xs font-medium border transition-colors shrink-0 cursor-pointer ${
                activeTab === 'ledger'
                  ? 'bg-indigo-600 text-white border-indigo-500'
                  : 'border-transparent text-[#A1A1AA] hover:text-white'
              }`}
            >
              <span>2. Fit Score Ledger</span>
              <span className="font-mono text-[11px] tabular-nums">({vacancy.atsScore}%)</span>
            </button>

            <button
              onClick={() => setActiveTab('linter')}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-[6px] text-xs font-medium border transition-colors shrink-0 cursor-pointer ${
                activeTab === 'linter'
                  ? 'bg-indigo-600 text-white border-indigo-500'
                  : 'border-transparent text-[#A1A1AA] hover:text-white'
              }`}
            >
              <span>3. Cover Letter & Linter</span>
              {!lint.isClean && <span className="w-2 h-2 rounded-full bg-amber-400" />}
            </button>

            <button
              onClick={() => setActiveTab('questions')}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-[6px] text-xs font-medium border transition-colors shrink-0 cursor-pointer ${
                activeTab === 'questions'
                  ? 'bg-indigo-600 text-white border-indigo-500'
                  : 'border-transparent text-[#A1A1AA] hover:text-white'
              }`}
            >
              <span>4. Employer Questionnaire</span>
              {(isResumeHidden || pendingQsCount > 0) && (
                <span className="w-2 h-2 rounded-full bg-rose-500" />
              )}
            </button>
          </div>
        </div>

        {/* Drawer Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* =================================================================
              TAB 1: MULTI-RESUME ATS BATTLE
             ================================================================= */}
          {activeTab === 'battle' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs text-[#A1A1AA]">
                <span>
                  Сравнение всех 6 загруженных резюме по hard & soft требованиям вакансии
                </span>
                <span className="font-mono text-[11px] text-[#E4E4E7]">
                  Активно: {assignedResume.filterLabel}
                </span>
              </div>

              <div className="space-y-2">
                {rankedResumes.map((entry, idx) => {
                  const isWinner = idx === 0;
                  const isAssigned = entry.resume.id === vacancy.matchedResumeId;
                  const rHidden = entry.resume.visibility === 'hidden';

                  return (
                    <div
                      key={entry.resume.id}
                      className={`rounded-[6px] p-3 border transition-colors ${
                        isAssigned
                          ? 'bg-[#141720] border-indigo-500'
                          : 'bg-[#141720] border-[#222634]'
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-mono text-[11px] text-[#71717A] tabular-nums">
                            0{idx + 1}
                          </span>
                          <span className="text-xs font-semibold text-white truncate">
                            {entry.resume.title}
                          </span>
                          {isWinner && (
                            <span className="inline-flex items-center gap-1 font-mono text-[10px] font-semibold px-1.5 py-0.5 rounded-[4px] bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                              <Trophy className="w-2.5 h-2.5" />
                              Winner
                            </span>
                          )}
                          {rHidden && (
                            <span className="font-mono text-[10px] font-semibold px-1.5 py-0.5 rounded-[4px] bg-rose-500/15 text-rose-300 border border-rose-500/35">
                              Hidden on hh.ru
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2.5">
                          <span className="font-mono text-xs font-bold text-white tabular-nums">
                            {entry.overall}%
                          </span>

                          {isAssigned ? (
                            <span className="font-mono text-[11px] font-semibold px-2 py-0.5 rounded-[4px] bg-indigo-600 text-white">
                              Active
                            </span>
                          ) : (
                            <button
                              onClick={() => onReassignResume(entry.resume.id)}
                              className="px-2 py-0.5 rounded-[4px] text-[11px] font-medium bg-[#0F1117] hover:bg-[#1E2230] border border-[#222634] text-[#D4D4D8] cursor-pointer"
                            >
                              Use Resume
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="w-full h-1.5 rounded-xs bg-[#222634] overflow-hidden mb-2">
                        <div
                          className={`h-full transition-all duration-200 ${
                            isWinner
                              ? 'bg-emerald-500'
                              : entry.overall >= 65
                              ? 'bg-indigo-500'
                              : 'bg-rose-500'
                          }`}
                          style={{ width: `${entry.overall}%` }}
                        />
                      </div>

                      <div className="grid grid-cols-3 gap-2 font-mono text-[11px] text-[#71717A] tabular-nums">
                        <div>
                          Hard Stack: <strong className="text-[#D4D4D8]">{entry.hardSkills}%</strong>
                        </div>
                        <div>
                          Domain Exp: <strong className="text-[#D4D4D8]">{entry.domain}%</strong>
                        </div>
                        <div>
                          Seniority: <strong className="text-[#D4D4D8]">{entry.seniority}%</strong>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Deep ATS Evidence-Based Breakdown (Real LLM Payload) */}
              {vacancy.atsPayload && (
                <div className="mt-4 pt-3 border-t border-[#222634] space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-white uppercase tracking-wider font-mono">
                      Глубокий ATS-разбор требований
                    </span>
                    <span className="font-mono text-[11px] text-[#A1A1AA]">
                      Hard Coverage:{' '}
                      <strong className="text-emerald-400">
                        {vacancy.atsPayload.hard_requirements_coverage_percent ?? 0}%
                      </strong>
                    </span>
                  </div>

                  {/* Honest Gap Warning Box */}
                  {vacancy.atsPayload.honest_gap_warning && (
                    <div className="rounded-[6px] p-3 bg-amber-500/10 border border-amber-500/35 text-xs space-y-1.5">
                      <div className="flex items-center gap-1.5 font-bold text-amber-400">
                        <AlertTriangle className="w-4 h-4 shrink-0" />
                        <span>Честное заключение по критическим разрывам</span>
                      </div>
                      <p className="leading-relaxed text-[11.5px] text-amber-200/90 whitespace-pre-wrap">
                        {vacancy.atsPayload.honest_gap_warning}
                      </p>
                    </div>
                  )}

                  {/* Hard Requirements Table/List */}
                  {Array.isArray(vacancy.atsPayload.hard_requirements) &&
                    vacancy.atsPayload.hard_requirements.length > 0 && (
                      <div className="space-y-1.5">
                        <div className="text-[10.5px] font-mono text-[#71717A] uppercase">
                          Обязательные требования ({vacancy.atsPayload.hard_requirements.length}):
                        </div>
                        <div className="space-y-1.5">
                          {vacancy.atsPayload.hard_requirements.map((req, rIdx) => {
                            const isCovered = req.status === 'covered';
                            const isPartial = req.status === 'partially_covered';
                            return (
                              <div
                                key={rIdx}
                                className="p-2.5 rounded-[5px] bg-[#141720] border border-[#222634] text-xs space-y-1"
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <span className="font-medium text-white">{req.requirement}</span>
                                  <span
                                    className={`shrink-0 font-mono text-[10px] font-bold px-1.5 py-0.5 rounded border ${
                                      isCovered
                                        ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                                        : isPartial
                                        ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                                        : 'bg-rose-500/15 text-rose-400 border-rose-500/30'
                                    }`}
                                  >
                                    {isCovered
                                      ? '✓ Покрыто'
                                      : isPartial
                                      ? '⚠ Частично'
                                      : '✕ Отсутствует'}
                                  </span>
                                </div>
                                {req.matched_as && (
                                  <div className="text-[11px] text-[#A1A1AA]">
                                    <span className="text-indigo-400 font-mono">В резюме: </span>
                                    {req.matched_as}
                                  </div>
                                )}
                                {req.note && (
                                  <div className="text-[10.5px] text-amber-300/80 italic font-mono">
                                    Замечание: {req.note}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                  {/* Nice to Have list */}
                  {Array.isArray(vacancy.atsPayload.nice_to_have) &&
                    vacancy.atsPayload.nice_to_have.length > 0 && (
                      <div className="space-y-1.5">
                        <div className="text-[10.5px] font-mono text-[#71717A] uppercase">
                          Желательные требования (Nice to Have):
                        </div>
                        <div className="space-y-1.5">
                          {vacancy.atsPayload.nice_to_have.map((nth, nIdx) => {
                            const isCovered = nth.status === 'covered';
                            return (
                              <div
                                key={nIdx}
                                className="p-2 rounded-[5px] bg-[#141720] border border-[#222634] text-xs flex items-center justify-between gap-2"
                              >
                                <span className="text-[#D4D4D8]">{nth.requirement}</span>
                                <span
                                  className={`shrink-0 font-mono text-[9.5px] px-1.5 py-0.5 rounded border ${
                                    isCovered
                                      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25'
                                      : 'bg-[#181C26] text-[#71717A] border-[#242A3A]'
                                  }`}
                                >
                                  {isCovered ? '✓ Плюс' : '—'}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                  {/* Critical Gaps list */}
                  {Array.isArray(vacancy.atsPayload.critical_gaps) &&
                    vacancy.atsPayload.critical_gaps.length > 0 && (
                      <div className="rounded-[6px] p-3 bg-rose-500/10 border border-rose-500/30 text-xs space-y-1.5">
                        <div className="font-bold text-rose-400 font-mono text-[11px]">
                          Блокирующие барьеры (Critical Gaps):
                        </div>
                        <ul className="list-disc list-inside space-y-1 text-rose-200/90 text-[11.5px]">
                          {vacancy.atsPayload.critical_gaps.map((cg, cgIdx) => (
                            <li key={cgIdx}>{cg}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                  {/* Actionable Resume Edits */}
                  {Array.isArray(vacancy.atsPayload.actionable_edits) &&
                    vacancy.atsPayload.actionable_edits.length > 0 && (
                      <div className="space-y-2">
                        <div className="text-[10.5px] font-mono text-[#71717A] uppercase">
                          Рекомендации по правкам резюме (Actionable Edits):
                        </div>
                        <div className="space-y-2">
                          {vacancy.atsPayload.actionable_edits.map((edit, eIdx) => (
                            <div
                              key={eIdx}
                              className="p-3 rounded-[6px] bg-[#141720] border border-indigo-500/30 text-xs space-y-1.5"
                            >
                              <div className="flex items-center justify-between">
                                <span className="font-mono text-[10.5px] font-bold text-indigo-400 px-2 py-0.5 rounded bg-indigo-500/15 border border-indigo-500/30">
                                  Вставить в: {edit.resume_section}
                                </span>
                                <span className="font-mono text-[10px] text-emerald-400">
                                  ✓ Без выдуманного опыта
                                </span>
                              </div>
                              <div className="text-[#A1A1AA] text-[11px]">
                                <strong className="text-white">Закрываемый разрыв:</strong> {edit.current_gap}
                              </div>
                              <div className="p-2 rounded bg-[#0D0F13] border border-[#222634] font-mono text-[11px] text-[#E4E4E7] leading-relaxed select-all">
                                «{edit.suggested_text}»
                              </div>
                              {edit.honesty_check && (
                                <div className="text-[10px] text-[#71717A] italic">
                                  Проверка правдивости: {edit.honesty_check}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                </div>
              )}
            </div>
          )}

          {/* =================================================================
              TAB 2: FIT SCORE LEDGER
             ================================================================= */}
          {activeTab === 'ledger' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs text-[#A1A1AA]">
                <span>
                  Прозрачный журнал расчёта ATS для{' '}
                  <strong className="text-white">{assignedResume.filterLabel}</strong>
                </span>
                <span
                  className={`font-mono text-xs font-bold tabular-nums ${
                    vacancy.atsScore >= 65 ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  Final ATS Score: {vacancy.atsScore} / 100
                </span>
              </div>

              <div className="rounded-[6px] border border-[#222634] overflow-hidden">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-[#222634] bg-[#141720] font-mono text-[11px] text-[#71717A]">
                      <th className="py-2 px-3 w-20">Delta</th>
                      <th className="py-2 px-3">Stack / Domain Evidence Rule</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#222634] bg-[#0F1117]">
                    <tr>
                      <td className="py-2.5 px-3 font-mono font-bold text-[#D4D4D8] tabular-nums">
                        50
                      </td>
                      <td className="py-2.5 px-3 text-[#A1A1AA]">Baseline calibration score</td>
                    </tr>

                    {(vacancy.scoreLedger || []).map((item, idx) => {
                      const pos = item.delta >= 0;
                      return (
                        <tr key={idx}>
                          <td className="py-2.5 px-3 font-mono font-bold tabular-nums">
                            <span
                              className={`px-1.5 py-0.5 rounded-[4px] border ${
                                pos
                                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                                  : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                              }`}
                            >
                              {pos ? `+${item.delta}` : item.delta}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-[#E4E4E7]">{item.rule}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-[#222634] bg-[#141720] font-mono text-xs">
                      <td
                        className={`py-2.5 px-3 font-bold tabular-nums ${
                          vacancy.atsScore >= 65 ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        = {vacancy.atsScore}%
                      </td>
                      <td className="py-2.5 px-3 font-semibold text-white">
                        {vacancy.atsScore >= 65
                          ? 'Порог ≥ 65% пройден (Ветка генерации письма)'
                          : 'Ниже порога 65% (Ветка авто-пропуска)'}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* HR Strategic Dossier from DeepSeek Fit Check */}
              {vacancy.fitPayload && (
                <div className="mt-4 pt-3 border-t border-[#222634] space-y-3">
                  {vacancy.fitPayload.reasoning && (
                    <div className="p-3 rounded-[6px] bg-[#141720] border border-[#222634] text-xs space-y-1">
                      <div className="font-mono text-[11px] font-bold text-sky-400">
                        Заключение HR-консультанта (Reasoning):
                      </div>
                      <p className="text-[#E4E4E7] leading-relaxed text-[11.5px]">
                        {vacancy.fitPayload.reasoning}
                      </p>
                    </div>
                  )}

                  {Array.isArray(vacancy.fitPayload.selling_points) &&
                    vacancy.fitPayload.selling_points.length > 0 && (
                      <div className="p-3 rounded-[6px] bg-[#141720] border border-emerald-500/30 text-xs space-y-1.5">
                        <div className="font-mono text-[11px] font-bold text-emerald-400">
                          Сильные стороны кандидата для этой вакансии:
                        </div>
                        <ul className="list-disc list-inside space-y-1 text-emerald-200/90 text-[11.5px]">
                          {vacancy.fitPayload.selling_points.map((sp, spIdx) => (
                            <li key={spIdx}>{sp}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                  {Array.isArray(vacancy.fitPayload.flags) &&
                    vacancy.fitPayload.flags.length > 0 && (
                      <div className="p-3 rounded-[6px] bg-[#141720] border border-rose-500/30 text-xs space-y-1.5">
                        <div className="font-mono text-[11px] font-bold text-rose-400">
                          Факторы риска и нестыковки (Flags):
                        </div>
                        <ul className="list-disc list-inside space-y-1 text-rose-200/90 text-[11.5px]">
                          {vacancy.fitPayload.flags.map((fl, flIdx) => (
                            <li key={flIdx}>{fl}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                  {(vacancy.fitPayload.booster || vacancy.fitPayload.effort_minutes) && (
                    <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-[6px] bg-[#12151C] border border-[#1E2330] text-xs font-mono">
                      {vacancy.fitPayload.booster && (
                        <span className="text-amber-300">
                          Совет по бусту: {vacancy.fitPayload.booster.text} (+{vacancy.fitPayload.booster.delta})
                        </span>
                      )}
                      {vacancy.fitPayload.effort_minutes && (
                        <span className="text-[#71717A]">
                          Оценка времени кастомного отклика: <strong className="text-white">{vacancy.fitPayload.effort_minutes} мин</strong>
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* =================================================================
              TAB 3: COVER LETTER & REAL-TIME LINTER (SPLIT PANE)
             ================================================================= */}
          {activeTab === 'linter' && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-[#A1A1AA]">
                  Целевой объём: <strong className="font-mono text-white">120–180 слов</strong> ·
                  Без штампов и AI-канцелярита
                </span>

                <div className="flex items-center gap-1.5">
                  {lint.totalFlags > 0 && (
                    <button
                      onClick={handleRemoveAllFlagged}
                      className="px-2.5 py-1 rounded-[5px] text-[11px] font-semibold bg-amber-500 text-zinc-950 hover:bg-amber-400 cursor-pointer"
                    >
                      Fix All Flagged ({lint.totalFlags})
                    </button>
                  )}
                  <button
                    onClick={() => navigator.clipboard?.writeText(vacancy.coverLetter)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-[5px] text-[11px] font-medium bg-[#141720] hover:bg-[#1E2230] border border-[#222634] text-[#D4D4D8] cursor-pointer"
                  >
                    <Copy className="w-3 h-3" />
                    <span>Copy</span>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
                {/* Left Pane: Editable Letter + Inline Diagnostic Preview */}
                <div className="lg:col-span-7 flex flex-col gap-2">
                  <div className="flex items-center justify-between font-mono text-[11px] text-[#71717A]">
                    <span>COVER LETTER ({assignedResume.filterLabel})</span>
                    <span className="tabular-nums">
                      {lint.wordCount}w · {lint.charCount} chars
                    </span>
                  </div>

                  <textarea
                    rows={8}
                    value={vacancy.coverLetter}
                    onChange={(e) => onUpdateCoverLetter(e.target.value)}
                    className="w-full rounded-[6px] bg-[#141720] border border-[#222634] focus:border-indigo-500 p-3 text-[13px] text-[#F4F4F6] leading-relaxed focus:outline-none resize-y"
                  />

                  <div className="rounded-[6px] bg-[#141720] border border-[#222634] p-2.5">
                    <div className="font-mono text-[10px] text-[#71717A] mb-1">
                      LIVE INLINE HIGHLIGHT PREVIEW
                    </div>
                    <div className="text-[12px] text-[#D4D4D8] leading-relaxed">
                      {highlightedLetterNodes}
                    </div>
                  </div>
                </div>

                {/* Right Pane: Real-Time Lint Inspector */}
                <div className="lg:col-span-5 rounded-[6px] bg-[#141720] border border-[#222634] p-3 flex flex-col gap-3">
                  <div className="flex items-center justify-between pb-2 border-b border-[#222634]">
                    <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-[#E4E4E7]">
                      Lint Inspector
                    </span>
                    <span
                      className={`font-mono text-[10px] font-semibold px-1.5 py-0.5 rounded-[4px] border ${
                        lint.isClean
                          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                          : 'bg-amber-500/15 text-amber-300 border-amber-500/35'
                      }`}
                    >
                      {lint.isClean ? 'CLEAN PASS' : `${lint.totalFlags} FLAG(S)`}
                    </span>
                  </div>

                  {/* Word Count Gauge */}
                  <div>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-[#A1A1AA]">Word Count (120–180w)</span>
                      <span
                        className={`font-mono font-semibold tabular-nums ${
                          lint.inWordBand ? 'text-emerald-400' : 'text-amber-400'
                        }`}
                      >
                        {lint.wordCount}w
                      </span>
                    </div>
                    <div className="relative w-full h-2 rounded-xs bg-[#222634] overflow-hidden">
                      <div
                        className="absolute top-0 bottom-0 bg-emerald-500/20 border-x border-emerald-500/50"
                        style={{ left: '54%', width: '28%' }}
                      />
                      <div
                        className={`h-full transition-all duration-150 ${
                          lint.inWordBand ? 'bg-emerald-500' : 'bg-amber-500'
                        }`}
                        style={{ width: `${Math.min(100, (lint.wordCount / 220) * 100)}%` }}
                      />
                    </div>
                  </div>

                  {/* Reading Grade Level */}
                  <div className="flex items-center justify-between text-xs py-1.5 px-2 rounded-[4px] bg-[#0F1117] border border-[#222634]">
                    <span className="text-[#A1A1AA]">Reading Grade Level</span>
                    <span className="font-mono text-[11px] text-[#E4E4E7] tabular-nums">
                      Grade {lint.grade} · Crisp
                    </span>
                  </div>

                  {/* Flagged Clichés (Red) */}
                  <div className="space-y-1">
                    <div className="text-[11px] font-semibold text-rose-400">
                      Flagged Clichés ({lint.cliches.length})
                    </div>
                    {lint.cliches.length === 0 ? (
                      <div className="font-mono text-[11px] text-[#71717A]">None detected</div>
                    ) : (
                      <div className="space-y-1">
                        {lint.cliches.map((rule) => (
                          <div
                            key={rule.phrase}
                            className="flex items-center justify-between gap-2 px-2 py-1 rounded-[4px] bg-rose-500/10 border border-rose-500/30 text-[11px]"
                          >
                            <span className="font-mono text-rose-300 truncate">
                              &ldquo;{rule.phrase}&rdquo;
                            </span>
                            <button
                              onClick={() => handleFixPhrase(rule)}
                              className="font-mono text-[10px] font-semibold px-1.5 py-0.5 rounded bg-rose-500 text-white shrink-0 cursor-pointer"
                            >
                              Fix
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* AI Vocabulary Patterns (Purple) */}
                  <div className="space-y-1">
                    <div className="text-[11px] font-semibold text-purple-400">
                      AI Vocabulary Patterns ({lint.aiVocab.length})
                    </div>
                    {lint.aiVocab.length === 0 ? (
                      <div className="font-mono text-[11px] text-[#71717A]">None detected</div>
                    ) : (
                      <div className="space-y-1">
                        {lint.aiVocab.map((rule) => (
                          <div
                            key={rule.phrase}
                            className="flex items-center justify-between gap-2 px-2 py-1 rounded-[4px] bg-purple-500/10 border border-purple-500/30 text-[11px]"
                          >
                            <span className="font-mono text-purple-300 truncate">
                              &ldquo;{rule.phrase}&rdquo;
                            </span>
                            <button
                              onClick={() => handleFixPhrase(rule)}
                              className="font-mono text-[10px] font-semibold px-1.5 py-0.5 rounded bg-purple-500 text-white shrink-0 cursor-pointer"
                            >
                              Fix
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Moralizing Tones (Yellow) */}
                  <div className="space-y-1">
                    <div className="text-[11px] font-semibold text-amber-400">
                      Moralizing Tones ({lint.moralizing.length})
                    </div>
                    {lint.moralizing.length === 0 ? (
                      <div className="font-mono text-[11px] text-[#71717A]">None detected</div>
                    ) : (
                      <div className="space-y-1">
                        {lint.moralizing.map((rule) => (
                          <div
                            key={rule.phrase}
                            className="flex items-center justify-between gap-2 px-2 py-1 rounded-[4px] bg-amber-500/10 border border-amber-500/30 text-[11px]"
                          >
                            <span className="font-mono text-amber-300 truncate">
                              &ldquo;{rule.phrase}&rdquo;
                            </span>
                            <button
                              onClick={() => handleFixPhrase(rule)}
                              className="font-mono text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-500 text-zinc-950 shrink-0 cursor-pointer"
                            >
                              Fix
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* =================================================================
              TAB 4: EMPLOYER QUESTIONNAIRE FORM & HIDDEN RESUME UNLOCK GUIDE
             ================================================================= */}
          {activeTab === 'questions' && (
            <div className="space-y-4">
              {isResumeHidden && (
                <div className="rounded-[6px] p-3.5 bg-rose-500/10 border border-rose-500/40 space-y-2.5">
                  <div className="flex items-start gap-2.5">
                    <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <div className="text-xs font-semibold text-rose-200">
                        Блокировка в Шлюзе HITL: резюме скрыто на hh.ru
                      </div>
                      <p className="text-[11.5px] text-rose-200/80 mt-0.5 leading-snug">
                        Подобранное резюме <strong>{assignedResume.title}</strong> (
                        {assignedResume.hhId}) скрыто в настройках приватности. Работодатель не
                        сможет открыть профиль до разблокировки.
                      </p>
                    </div>
                  </div>

                  {/* Direct 3-step unlock guide */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px]">
                    <div className="p-2 rounded-[4px] bg-[#0F1117] border border-rose-500/25 text-[#D4D4D8]">
                      <div className="font-mono text-[10px] text-rose-400">STEP 1 · HH.RU</div>
                      <div className="mt-0.5">Откройте настройки видимости {assignedResume.hhId}</div>
                    </div>
                    <div className="p-2 rounded-[4px] bg-[#0F1117] border border-rose-500/25 text-[#D4D4D8]">
                      <div className="font-mono text-[10px] text-rose-400">STEP 2 · ACCESS</div>
                      <div className="mt-0.5">
                        Включите «Видно всем» или добавьте {vacancy.company}
                      </div>
                    </div>
                    <div className="p-2 rounded-[4px] bg-[#0F1117] border border-rose-500/25 text-[#D4D4D8]">
                      <div className="font-mono text-[10px] text-rose-400">STEP 3 · RELEASE</div>
                      <div className="mt-0.5">Нажмите кнопку ниже для разблокировки</div>
                    </div>
                  </div>

                  <div className="flex justify-end">
                    <button
                      onClick={() => onUnlockResume(assignedResume.id)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[5px] text-xs font-semibold bg-rose-500 hover:bg-rose-600 text-white cursor-pointer"
                    >
                      <Unlock className="w-3.5 h-3.5" />
                      <span>Unlock on hh.ru Now</span>
                    </button>
                  </div>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-[#A1A1AA]">
                  Анкетные вопросы работодателя с hh.ru · Заполнено по фактам{' '}
                  <strong className="text-white">{assignedResume.filterLabel}</strong>
                </span>

                {vacancy.questions && vacancy.questions.length > 0 && pendingQsCount > 0 && (
                  <button
                    onClick={onVerifyAllQuestions}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-[5px] text-[11px] font-semibold bg-emerald-500/15 border border-emerald-500/35 text-emerald-300 cursor-pointer"
                  >
                    <CheckCircle2 className="w-3 h-3" />
                    <span>Verify All ({pendingQsCount})</span>
                  </button>
                )}
              </div>

              {!vacancy.questions || vacancy.questions.length === 0 ? (
                <div className="rounded-[6px] p-6 bg-[#141720] border border-[#222634] text-center">
                  <div className="text-xs font-medium text-[#D4D4D8]">
                    У работодателя нет обязательной анкеты
                  </div>
                  <div className="text-[11px] text-[#71717A] mt-0.5">
                    Отклик отправляется напрямую с сопроводительным письмом.
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {vacancy.questions.map((q, idx) => (
                    <div
                      key={q.id}
                      className={`rounded-[6px] p-3 bg-[#141720] border ${
                        q.needsReview ? 'border-amber-500/45' : 'border-[#222634]'
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                        <span className="font-mono text-[10px] text-[#71717A]">
                          Q{idx + 1} · {q.type.toUpperCase()}
                        </span>

                        <div className="flex items-center gap-1.5">
                          <span className="inline-flex items-center gap-1 font-mono text-[10px] px-1.5 py-0.5 rounded-[4px] bg-[#0F1117] border border-[#222634] text-emerald-400">
                            <ShieldCheck className="w-3 h-3" />
                            <span>{q.factSource}</span>
                          </span>
                          {q.needsReview && (
                            <span className="font-mono text-[10px] px-1.5 py-0.5 rounded-[4px] bg-amber-500/15 text-amber-300 border border-amber-500/30">
                              Needs Review
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="text-xs font-semibold text-white mb-2.5">{q.prompt}</div>

                      {q.type === 'text' && (
                        <input
                          type="text"
                          value={q.answer}
                          onChange={(e) => onUpdateQuestion(q.id, e.target.value)}
                          className="w-full rounded-[5px] bg-[#0F1117] border border-[#222634] focus:border-indigo-500 px-2.5 py-1.5 text-xs text-[#F4F4F6] focus:outline-none"
                        />
                      )}

                      {q.type === 'radio' && (
                        <div className="space-y-1.5">
                          {(q.options || []).map((opt) => {
                            const selected = q.answer === opt;
                            return (
                              <label
                                key={opt}
                                onClick={() => onUpdateQuestion(q.id, opt)}
                                className={`flex items-center gap-2 px-2.5 py-1.5 rounded-[5px] border text-xs cursor-pointer transition-colors ${
                                  selected
                                    ? 'bg-indigo-600/15 border-indigo-500/50 text-white'
                                    : 'bg-[#0F1117] border-[#222634] text-[#A1A1AA] hover:text-white'
                                }`}
                              >
                                <span
                                  className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center ${
                                    selected ? 'border-indigo-400' : 'border-[#52525B]'
                                  }`}
                                >
                                  {selected && (
                                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
                                  )}
                                </span>
                                <span>{opt}</span>
                              </label>
                            );
                          })}
                        </div>
                      )}

                      {q.type === 'checkbox' && (
                        <div className="space-y-1.5">
                          {(q.options || []).map((opt) => {
                            const arr = Array.isArray(q.answer) ? q.answer : [];
                            const checked = arr.includes(opt);
                            return (
                              <label
                                key={opt}
                                onClick={() => {
                                  const next = checked
                                    ? arr.filter((x) => x !== opt)
                                    : [...arr, opt];
                                  onUpdateQuestion(q.id, next);
                                }}
                                className={`flex items-center gap-2 px-2.5 py-1.5 rounded-[5px] border text-xs cursor-pointer transition-colors ${
                                  checked
                                    ? 'bg-indigo-600/15 border-indigo-500/50 text-white'
                                    : 'bg-[#0F1117] border-[#222634] text-[#A1A1AA] hover:text-white'
                                }`}
                              >
                                <span
                                  className={`w-3.5 h-3.5 rounded-[3px] border flex items-center justify-center ${
                                    checked
                                      ? 'bg-indigo-600 border-indigo-500 text-white'
                                      : 'border-[#52525B]'
                                  }`}
                                >
                                  {checked && <Check className="w-2.5 h-2.5" />}
                                </span>
                                <span>{opt}</span>
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Sticky Drawer Footer */}
        <div className="px-4 py-3 bg-[#141720] border-t border-[#222634] flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <button
              onClick={onSkip}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-[6px] text-xs font-medium bg-[#0F1117] hover:bg-rose-500/15 border border-[#222634] hover:border-rose-500/40 text-[#D4D4D8] hover:text-rose-300 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
              <span>Reject / Skip (Пропуск)</span>
            </button>

            <button
              onClick={onRegenerate}
              disabled={regenerating}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-[6px] text-xs font-medium bg-[#0F1117] hover:bg-[#1E2230] border border-[#222634] text-[#D4D4D8] cursor-pointer"
            >
              {regenerating ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
              ) : (
                <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
              )}
              <span>Re-generate Letter / Answers</span>
            </button>
          </div>

          <button
            onClick={onApprove}
            className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-[6px] text-xs font-semibold transition-colors cursor-pointer ${
              isResumeHidden
                ? 'bg-rose-500 hover:bg-rose-600 text-white'
                : 'bg-emerald-500 hover:bg-emerald-400 text-zinc-950'
            }`}
          >
            {isResumeHidden ? (
              <>
                <Lock className="w-3.5 h-3.5" />
                <span>Unlock Resume First</span>
              </>
            ) : (
              <>
                <Send className="w-3.5 h-3.5" />
                <span>Approve Application (В отклик)</span>
              </>
            )}
          </button>
        </div>
      </motion.aside>
    </div>
  );
}