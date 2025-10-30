# Jurnal Harian Automation Bot

Automates the daily journal submission flow on the SIMPEG portal using Puppeteer. The script signs in with the provided credentials, fills in the activity form, and saves a proof screenshot (`proof.png`) for record keeping.

## Prerequisites
- Node.js 20+ (Puppeteer bundles Chromium, so no separate browser install is required)
- npm (ships with Node.js)
- Optional: Docker Desktop (for the Windows batch script runner)

## Setup
1. Install dependencies:
   ```bash
   npm install
   ```
2. Create a `.env` file in the project root (never commit this). At minimum set:
   ```ini
   NIP=your_nip_here
   PASSWORD=your_password_here
   ```
   You can also override defaults for `JOURNAL_TEXT`, `JAM_MULAI`, `SKP_VALUE`, etc. Set `JOURNAL_TIMEZONE` (default: `Asia/Jakarta`) if you need the journal to follow a specific timezone when picking the date and driving the browser’s clock. See the inline comments in `.env` for the complete list.

## Running the Bot
- **Directly with Node.js**
  ```bash
  npm start
  ```
  The bot will log progress to the console and save the proof screenshot as `proof.png` when it finishes.

- **Via Docker on Windows (`run.bat`)**
  ```powershell
  .\run.bat
  ```
  This script builds an image, runs the container with your `.env`, and copies the generated `proof.png` back to the host.

## Output
- `proof.png` – full-page screenshot generated after a successful journal submission.

## Uploading Changes
When you're ready to publish your work:
```bash
git add .
git commit -m "Add automation bot and docs"
git push origin main
```
Make sure `.env` and proof screenshots remain untracked (already covered in `.gitignore`).
