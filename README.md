# J.A.R.V.I.S. Web App

A holographic **J.A.R.V.I.S.** AI command interface built with **Next.js (App Router, TypeScript)**, **Tailwind CSS**, and the official **`@google/genai`** SDK, ready to push to **GitHub** and deploy on **Vercel**.

## Features

- **Reactive Arc-Reactor Core**: 60fps HTML5 Canvas visualizer driven by live Web Audio API microphone frequencies (`AnalyserNode`) and system states (`STANDBY`, `LISTENING`, `THINKING`, `SPEAKING`, `TOOL_ACTIVE`).
- **Streaming Gemini Command Console**: Real-time streamed Markdown replies, code blocks, multimodal image vision (upload, drag-and-drop, or paste), and **Google Search Grounding** with clickable source citations.
- **Voice Interaction**: Click-to-speak microphone dictation + spoken J.A.R.V.I.S. replies (Web Speech API) and subtle Web Audio HUD chimes.
- **Autonomous HUD Tools (Gemini Function Calling)**:
  - `start_timer` / `cancel_timer` — live countdown chronometers with completion alerts
  - `add_task` / `complete_task` — prioritized Mission Queue
  - `save_note` — persistent Memory Bank notes
  - `set_hud_theme` — live switching between **Arc Cyan**, **Amber Alert**, and **Stealth Emerald**
  - `clear_console` — start a fresh session
- **Production-Ready API Key Security**:
  - `GEMINI_API_KEY` stays strictly on the server inside Next.js Route Handlers (`/api/chat`, `/api/models`, `/api/live-token`).
  - Optional **Security Clearance Gate** (`JARVIS_ACCESS_PASSCODE` + HMAC-signed `HttpOnly` cookie + per-IP rate limiting) protects your API quota on public Vercel URLs.
  - Optional **Session BYOK** field in Settings (stored only in browser `sessionStorage`) for quick local testing.
- **Phase 2 Foundation Included**: `/api/live-token` (short-lived ephemeral tokens via `ai.authTokens.create`) and `public/audio-worklet-processor.js` (16 kHz PCM capture) ready for real-time duplex Gemini Live voice.

## Local Setup

1. Copy `.env.example` to `.env.local`:
   ```powershell
   Copy-Item .env.example .env.local
   ```
2. Add your Google AI Studio Gemini API key to `.env.local`:
   ```env
   GEMINI_API_KEY=your_real_gemini_api_key
   ```
   *(Optional: set `JARVIS_ACCESS_PASSCODE` and `AUTH_SECRET` to test the Security Clearance Gate locally.)*
3. Start the development server:
   ```powershell
   npm install
   npm run dev
   ```
4. Open `http://localhost:3000`.

## Pushing to GitHub

1. Create a new empty repository on [github.com/new](https://github.com/new) (e.g., `jarvis`).
2. Connect and push from `D:\Source\jarvis`:
   ```powershell
   git remote add origin https://github.com/<your-username>/jarvis.git
   git branch -M main
   git push -u origin main
   ```
   *(Double-check `git status` — `.env.local` is ignored by `.gitignore` and must never be committed.)*

## Deploying to Vercel

### Option A — GitHub Auto-Deploy (Recommended)
1. Go to [vercel.com/new](https://vercel.com/new) and import your `jarvis` GitHub repository.
2. Under **Environment Variables**, add:
   - `GEMINI_API_KEY` *(required)*
   - `JARVIS_ACCESS_PASSCODE` *(strongly recommended so strangers cannot spend your API quota)*
   - `AUTH_SECRET` *(generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`) *
3. Click **Deploy**. Every push to `main` automatically redeploys over HTTPS (required for browser microphone permissions).

### Option B — Vercel CLI
```powershell
vercel
vercel env add GEMINI_API_KEY
vercel env add JARVIS_ACCESS_PASSCODE
vercel env add AUTH_SECRET
vercel --prod
```
