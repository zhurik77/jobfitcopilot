<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/hero-dark.svg">
    <img src="docs/hero.svg" width="100%" alt="Job Fit Copilot — AI Chrome extension for vacancy fit analysis and ATS resume audit">
  </picture>
</p>

<h1 align="center">Job Fit Copilot v0.6.0</h1>
<p align="center">
  > AI assistant for job-fit analysis, deep ATS resume audit, multi-resume comparison, and cover letter generation —
  > works entirely in your browser, no backend required.
</p>

<p align="center">
  <a href="https://github.com/zhurik77/jobfitcopilot/actions"><img src="https://img.shields.io/github/actions/workflow/status/zhurik77/jobfitcopilot/ci.yml?branch=master&label=CI&logo=github" alt="CI"></a>
  <a href="https://github.com/zhurik77/jobfitcopilot/releases/latest"><img src="https://img.shields.io/github/v/release/zhurik77/jobfitcopilot?label=release&logo=googlechrome" alt="Latest release"></a>
  <a href="https://github.com/zhurik77/jobfitcopilot/stargazers"><img src="https://img.shields.io/github/stars/zhurik77/jobfitcopilot?style=flat&label=stars&logo=github" alt="GitHub stars"></a>
  <img src="https://img.shields.io/badge/license-MIT-4A7FD4" alt="License: MIT">
  <img src="https://img.shields.io/badge/manifest-v3-F2A33C" alt="Manifest V3">
  <img src="https://img.shields.io/badge/design-iOS%20HIG-FF9500" alt="Design: iOS HIG">
  <a href="https://github.com/zhurik77/jobfitcopilot/releases/latest"><img src="https://img.shields.io/badge/download-latest_release-success" alt="Download latest release"></a>
</p>

<p align="center">
  <a href="https://zhurik77.github.io/jobfitcopilot">Site</a> ·
  <a href="#quick-start">Quick Start</a> ·
  <a href="#features">Features</a> ·
  <a href="#models--providers">Models & Providers</a> ·
  <a href="#how-it-differs">How It Differs</a> ·
  <a href="PRIVACY.md">Privacy</a> ·
  <a href="CHANGELOG.md">Changelog</a>
</p>

<p align="center">
  <a href="README.md"><strong>Русская версия »</strong></a>
</p>

---

> All job-hunting tools help you send more applications.
> This one helps you send the *right* ones.

Job Fit Copilot is a Chrome extension (Manifest V3) that analyzes how well you match a job posting, performs a deep ATS-style audit of your resume, compares multiple resumes against a vacancy, and generates tailored cover letters — all without sending your data to any third-party server.

**Core philosophy:** the LLM runs on *your* API key, the analysis stays in *your* browser, and applications are only sent after *your* explicit approval.

---

## Quick Start

1. **Clone the repo:**
   ```bash
   git clone https://github.com/zhurik77/jobfitcopilot.git
   ```
2. **Load in Chrome:**
   Go to `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select `jobfitcopilot/`.
3. **Configure API key:**
   Open extension settings (⚙) → paste your provider key ([NVIDIA NIM](https://build.nvidia.com/), [OpenAI](https://platform.openai.com/api-keys), or [Anthropic](https://console.anthropic.com/)).
4. **Open a vacancy** on hh.ru (or any supported job board) → click the extension icon → the side panel opens with analysis.

---

## Features

### 1. Vacancy Fit Check
Paste a vacancy URL → get a structured analysis: role match, skills gap, experience alignment, and a **Fit Score** (0–100). The score is deterministic (formula-based), not a LLM guess.

### 2. ATS Resume Audit
Deep resume analysis simulating how real ATS systems see you:
- Keyword match density (exact + normalized)
- Section completeness and structure
- Experience timeline parsing
- RU/EN bilingual handling
- Actionable rewrite suggestions for each section

### 3. Multi-Resume Ranking
Upload several resumes → rank them against a vacancy by fit score. See which version of your resume works best for a specific role.

### 4. Cover Letter Generation
Generates tailored cover letters with strict anti-cliché filtering — no "I'm very interested," "highly qualified," or other empty phrases.

### 5. Candidate Profile
Consolidated resume summary with saved ATS scores, line-by-line experience breakdown with reformulations, top-20 role matching, and a fix checklist.

### 6. Analytics & Reports
Search metrics, verdict distribution charts, and exportable reports.

### 7. Application Funnel (FSM)
Track your applications through states: `draft → analyzing → reviewed → approved → submitted → responded`. Nothing is sent to an employer without your explicit approval in the panel.

### 8. Autopilot (Optional)
Batch-process vacancies with human-in-the-loop: the LLM analyzes, you review and approve, only then it submits.

---

## Models & Providers

| Provider | Models | Cost | Notes |
|----------|--------|------|-------|
| **NVIDIA NIM** | Llama 3.1 70B / 405B, Nemotron 4  | Free tier (thousands of requests/day) | Recommended default |
| **OpenAI** | GPT-4o, GPT-4o-mini | Paid | Most compatible |
| **Anthropic** | Claude 3.5 Sonnet / Opus | Paid | Best ATS analysis quality |

No local model required. Bring your own API key — the extension sends prompts directly to the LLM provider.

---

## How It Differs

1. **Deterministic scoring.** Fit Score is computed by a formula (keyword overlap, section weights), not hallucinated by the LLM. The LLM only handles analysis and generation.
2. **No backend.** Everything runs in your browser + direct LLM API calls. No data leaves your machine except to the LLM provider you chose.
3. **Real ATS simulation.** Resume audit mimics real ATS parsers: section detection, tenure calculation, keyword normalization, not just "ask GPT to rate it."
4. **Multi-resume comparison.** Upload several CVs and see which one scores highest for a specific role — data-driven resume optimization.
5. **Strict cliché filter.** Cover letter prompts are blocked from generating "I'm interested," "highly qualified," and other empty buzzwords.
6. **Reads only the active tab.** Doesn't scrape vacancies in the background, doesn't bypass auth, doesn't submit applications for you — a deliberate constraint, not a limitation.

---

## Stack

- **Manifest V3** (`storage`, `activeTab`, `scripting`, `sidePanel`, `tabs`)
- **Direct LLM Provider APIs**: NVIDIA NIM / OpenAI / Anthropic
- **Node.js server** (optional): MCP protocol + REST API for autopilot, analytics, and batch processing
- **SQLite** (via `better-sqlite3`): local data persistence
- **Pure CSS** side panel (iOS HIG design, no frameworks)

---

## Screenshots

| Feature | Preview |
|---------|---------|
| Vacancy Fit Check | ![](docs/screenshot-fit.jpg) |
| ATS Resume Audit | ![](docs/screenshot-ats-audit.jpg) |
| Multi-Resume Ranking | ![](docs/screenshot-compare.jpg) |
| Analytics | ![](docs/screenshot-analytics.jpg) |

---

## Roadmap

- [x] Fit Score & ATS audit
- [x] Multi-resume ranking
- [x] Cover letter generation
- [x] Application funnel (FSM)
- [x] Analytics & reports
- [ ] LinkedIn job board adapter
- [ ] Habr Career adapter
- [ ] Resume versioning & history
- [ ] Salary range estimation
- [ ] Interview question prediction from vacancy

---

## License

MIT — see [LICENSE](LICENSE).

## Support

If Job Fit Copilot helps you, consider supporting development:
👉 **[Support on T-Bank](https://www.tbank.ru/cf/1cYvs7KjikV)**
