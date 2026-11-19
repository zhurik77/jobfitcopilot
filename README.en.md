<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/hero-dark.svg">
    <img src="docs/hero.svg" width="100%" alt="Job Fit Copilot — AI Chrome Extension: Vacancy Fit Analysis & ATS Resume Audit">
  </picture>
</p>

<h1 align="center">Job Fit Copilot v0.6.1</h1>

<p align="center">
  <a href="https://github.com/zhurik77/jobfitcopilot/stargazers">
    <img src="https://img.shields.io/github/stars/zhurik77/jobfitcopilot?style=social" alt="GitHub stars">
  </a>
  <a href="https://github.com/zhurik77/jobfitcopilot/actions/workflows/ci.yml">
    <img src="https://github.com/zhurik77/jobfitcopilot/actions/workflows/ci.yml/badge.svg" alt="CI">
  </a>
  <a href="https://opensource.org/licenses/MIT">
    <img src="https://img.shields.io/badge/license-MIT-green" alt="MIT License">
  </a>
  <br>
  <img src="https://img.shields.io/badge/Chrome%20API-Manifest%20V3-4285F4" alt="Manifest V3">
  <img src="https://img.shields.io/badge/design-iOS%20HIG-FF9500" alt="Design: iOS HIG">
  <a href="https://github.com/zhurik77/jobfitcopilot/releases/latest"><img src="https://img.shields.io/badge/download-latest_release-success" alt="Download latest release"></a>
</p>

---

**Job Fit Copilot** is an open-source Chrome extension that analyzes resumes through an ATS (Applicant Tracking System) filter and scores their fit against job vacancies. Powered by LLMs (OpenAI, Anthropic Claude, DeepSeek, NVIDIA NIM), it helps job seekers optimize their resumes and recruiters screen candidates faster.

[🇷🇺 Русская версия](README.md) | [🐛 Report Bug](https://github.com/zhurik77/jobfitcopilot/issues/new?template=bug_report.md) | [💡 Feature Request](https://github.com/zhurik77/jobfitcopilot/discussions)

---

<p align="center">
  <a href="https://github.com/zhurik77/jobfitcopilot/stargazers">
    <img src="https://img.shields.io/github/stars/zhurik77/jobfitcopilot?style=for-the-badge&logo=github&label=⭐%20Star%20us%20on%20GitHub&color=gold" alt="Star us on GitHub">
  </a>
</p>

<p align="center">
  <b>🚀 Goal: 500 stars!</b> If this project helps you — give it a ⭐. It takes 10 seconds and helps others discover Job Fit Copilot.
  <br><a href="docs/STAR_TRACKER.md">📊 Growth Tracker</a> · <a href="https://github.com/zhurik77/jobfitcopilot/discussions">💬 Discussions</a> · <a href="https://t.me/jobfitcopilot_chat">✈️ Telegram</a>
</p>

---

## ✨ Features

### 🔍 Vacancy Fit Analysis
Paste a job description and your resume — get a detailed fit score with breakdowns by skills, experience, and education. AI explains *why* each factor was scored the way it was.

### 📊 ATS Resume Audit
Run your resume through an ATS compliance check. Get actionable suggestions to improve keyword matching, formatting, and section structure. See exactly what recruiters' ATS systems see.

### 📝 Cover Letter Generator
Generate tailored cover letters based on the job description and your resume. Supports multiple tones (professional, enthusiastic, neutral) and languages (English, Russian).

### 🔄 Multi-Resume Comparison
Compare multiple resumes side-by-side against the same vacancy. See which one scores highest and why.

### 🚀 Auto-Apply (Autopilot)
Automatically scan vacancies and apply with generated cover letters on supported platforms (hh.ru, LinkedIn, Upwork).

### 📈 Analytics Dashboard
Track your application history, scores over time, and success rates. Identify patterns in which resumes perform best.

### 🌐 Multi-Platform
Works on **hh.ru**, **LinkedIn**, **Upwork**, and any site via manual paste.

---

## 🖥️ Screenshots

| Analysis | ATS Audit | Analytics |
|:---:|:---:|:---:|
| <img src="docs/screenshots/analysis.png" width="250" alt="Vacancy fit analysis"> | <img src="docs/screenshots/ats-audit.png" width="250" alt="ATS resume audit"> | <img src="docs/screenshots/analytics.png" width="250" alt="Analytics dashboard"> |

---

## 🚀 Quick Start

### Prerequisites
- **Chrome** (version 88+) or any Chromium-based browser (Edge, Brave, Opera)
- An **API key** from one of the supported providers: OpenAI, Anthropic, DeepSeek, or NVIDIA

### Installation (Developer Mode)

1. Download the [latest release](https://github.com/zhurik77/jobfitcopilot/releases/latest) and unzip it, or clone the repo:
   ```bash
   git clone https://github.com/zhurik77/jobfitcopilot.git
   ```
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** and select the `jobfitcopilot` folder
5. Open the extension from the toolbar and go to **Settings** to enter your API key

### Configuration

1. Open the extension sidebar
2. Go to **Settings** (gear icon)
3. Enter at least one API key (OpenAI, Anthropic, DeepSeek, or NVIDIA)
4. Select your preferred AI model
5. (Optional) Paste your resume text in the **Profile** tab

---

## 🔧 Supported AI Providers

| Provider | Models | API Key Required |
|----------|--------|:---:|
| **OpenAI** | GPT-4o, GPT-4o-mini, GPT-4-turbo | ✅ |
| **Anthropic** | Claude 3.5 Sonnet, Claude 3 Opus, Claude 3 Haiku | ✅ |
| **DeepSeek** | DeepSeek V3, DeepSeek R1 | ✅ |
| **NVIDIA NIM** | Llama 3.1 Nemotron, Mistral Large, Mixtral 8x22B | ✅ |

---

## 🧪 Test Suite

**555+ tests** across all modules:

```
✓ i18n: ru.json loads with all keys
✓ i18n: en.json loads with all keys
✓ i18n: interpolation, fallback, edge cases
✓ server: 254 tests (routes, scoring, validation, error handling)
✓ server: rate limiting, CORS, auth
```

---

## 🤝 HR Expert Program

We are looking for **HR professionals and recruiters** to help calibrate our AI scoring system.

**Format:** 1–2 reviews per month (20–40 min each)
**Benefits:** Early access, co-authorship, LinkedIn recommendation

👉 [Learn more](docs/HR_EXPERT_REVIEW.md) | [Apply](https://github.com/zhurik77/jobfitcopilot/issues/new?template=hr_expert_application.md)

---

## 🛠️ Tech Stack

- **Chrome Extension** (Manifest V3) — Side Panel, Content Scripts, Service Worker
- **LLM Integration** — OpenAI SDK, Anthropic SDK, DeepSeek API, NVIDIA NIM API
- **Backend** (optional) — Node.js, Express, rate limiting, CORS
- **Testing** — Node.js built-in test runner (`node:test` + `node:assert`)
- **CI** — GitHub Actions (Linux + Windows + macOS)

---

## 📦 Project Structure

```
jobfitcopilot/
├── manifest.json          # Chrome Extension Manifest V3
├── background.js          # Service Worker (state, messaging, autopilot)
├── sidepanel/
│   ├── panel.html         # Main UI
│   ├── panel.js           # UI logic (1200+ lines)
│   └── panel.css          # iOS HIG design system
├── options/
│   ├── options.html       # Settings page
│   └── options.js         # Settings logic
├── content-scripts/       # Platform-specific extractors
├── shared/
│   ├── jfc.js             # Core library (JFC namespace)
│   ├── locales/
│   │   ├── en.json        # English (110+ keys)
│   │   └── ru.json        # Russian (110+ keys)
│   └── i18n.js            # i18n engine
├── server/                # Optional backend
│   ├── src/               # Express routes, scoring, middleware
│   └── test/              # 254 tests
└── test/                  # Extension tests
    └── i18n.test.js       # 16 i18n tests
```

---

## 🤝 Contributing

We welcome contributions of all kinds! See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

- 🐛 Found a bug? [Open an issue](https://github.com/zhurik77/jobfitcopilot/issues/new?template=bug_report.md)
- 💡 Have an idea? [Start a discussion](https://github.com/zhurik77/jobfitcopilot/discussions)
- 🌐 Want to help with translations? PRs welcome
- 👥 Know an HR expert? Send them [this link](docs/HR_EXPERT_REVIEW.md)

---

## 📈 Star History

[![Star History Chart](https://api.star-history.com/svg?repos=zhurik77/jobfitcopilot&type=Date)](https://star-history.com/#zhurik77/jobfitcopilot&Date)

---

## 💛 Support the Project

If Job Fit Copilot helps you, consider supporting development:
👉 **[Donate via T-Bank](https://www.tbank.ru/cf/1cYvs7KjikV)** (Russia)
👉 **[Sponsor on GitHub](https://github.com/sponsors/zhurik77)** (Global)

---

## 📄 License

MIT — see [LICENSE](LICENSE).

---

<p align="center">
  <a href="https://github.com/zhurik77/jobfitcopilot">⭐ Star on GitHub</a> ·
  <a href="https://t.me/jobfitcopilot_chat">💬 Telegram Chat</a> ·
  <a href="https://github.com/zhurik77/jobfitcopilot/discussions">🗣️ Discussions</a>
</p>
