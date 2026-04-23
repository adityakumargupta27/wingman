# 🚀 Wingman

> **A Discord-native career intelligence platform powered by Gemini and Playwright.**

Wingman automates and optimizes the job hunting pipeline directly inside Discord. It evaluates job descriptions against your resume, generates heavily tailored ATS-friendly PDFs on-the-fly, and provides an AI wingman for interview prep and salary negotiation.

---

## ✨ Features

- **🎯 Real-Time Evaluation Pipeline:** Just drop a job link or paste a JD in Discord. Wingman evaluates the role across 7 dimensions (cv match, role fit, culture, compensation, red flags) and gives you an instant A-F score.
- **📄 Dynamic PDF Generation:** Uses Playwright to generate an ATS-optimized PDF resume uniquely tailored to the specific Job Description.
- **🔍 Multi-Portal Scanning:** Scan for high-quality, relevant internship and full-time opportunities using AI.
- **🎤 Interview Prep:** Generate 10 tailored interview questions (behavioral, technical, culture fit) based on your exact CV gaps and the target role.
- **💰 Salary Negotiation Intelligence:** Get access to salary negotiation scripts and market data directly when you get an offer.
- **📊 SQLite Application Tracker:** All evaluated jobs are automatically logged. Track your entire application pipeline (Evaluated → Applied → Interview → Offer).
- **🛡️ Cloudflare Evasion:** Built-in Playwright scraper with window positioning tricks to securely scrape modern ATS portals like Workday, Lever, and Greenhouse.

---

## 🛠️ Architecture

Wingman uses a prompt-driven evaluation pipeline where **modes** (`modes/*.md`) act as pluggable configuration for the AI logic.

```text
wingman/
├── commands/         # Discord slash commands (/evaluate, /pdf, /scan, etc.)
├── lib/              # Core logic (gemini API, SQLite DB, Playwright scraper)
├── modes/            # Pluggable prompt engine logic
├── index.js          # Entry point & command router
└── data/             # Persistent user state and tracker (SQLite)
```

---

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- Discord Bot Token & Client ID
- Google Gemini API Key

### Installation

1. Clone the repository and install dependencies:
```bash
git clone https://github.com/adity/wingman.git
cd wingman
npm install
```

2. Configure environment:
```bash
cp .env.example .env
# Edit .env and add DISCORD_TOKEN, DISCORD_CLIENT_ID, GEMINI_API_KEY
```

3. Register slash commands with Discord:
```bash
# Register to a specific dev server (instant)
DISCORD_DEV_GUILD_ID=your_server_id npm run deploy

# Or register globally (takes up to 1hr)
npm run deploy
```

4. Run the bot:
```bash
npm start
```

---

## 🚢 Deployment

Wingman is ready to deploy to platforms like Railway or Fly.io.

**Using Docker (Fly.io / Render):**
A `Dockerfile` is included. It uses the `mcr.microsoft.com/playwright:v1.42.1-jammy` base image to ensure Playwright browser binaries are available.

**Using PM2 (VPS):**
```bash
npm install pm2 -g
pm2 start pm2.config.js
```

---

## 💻 Commands Reference

| Command | Description |
|---|---|
| `/evaluate [url or jd]` | Evaluate a job against your CV (returns A-F score & thread report) |
| `/scan [keyword]` | Scan portals for matching job opportunities |
| `/pdf [company] [role]` | Generate an ATS-optimized tailored resume |
| `/interview [role]` | Generate tailored interview questions |
| `/negotiate` | View salary negotiation scripts & market data |
| `/tracker view` | View your application pipeline |
| `/tracker update [id] [status]`| Update application status |
| `/cv set` | Upload your CV (.txt file) |
| `/cv show` | Display your saved CV |

---

## 📄 License
MIT License
