# J.A.R.V.I.S. — Pure Voice & Sensor AI Core

A zero-UI, voice-only animated **J.A.R.V.I.S.** assistant powered by the **Google Gemini Live API** (`@google/genai`) and local in-browser **"Hey Jarvis"** wake-word detection (`openWakeWord` via ONNX/WASM), hosted via GitHub and Vercel.

## How It Works

1. **Open the page** — you see only the breathing 3D animated holographic J.A.R.V.I.S. core (no menus, buttons, or chat panels).
2. **Tap once** (or press `Space`) — pre-authorizes browser permissions (microphone, cameras, GPS, gyroscope/accelerometer), immediately releases the camera so the camera LED stays **OFF**, acquires Screen Wake Lock, and arms **local `"Hey Jarvis"` wake-word standby** at **zero Gemini API cost**.
3. **Say `"Hey Jarvis"`** *(or tap again to force-wake)* — plays a Stark wake chime, connects live to Gemini Native Audio, turns camera vision on, and greets you in a refined British RP voice (*"Yes, sir?"* / *"At your service, sir."*).
4. **Auto-sleep to standby** — after ~45 seconds of silence, when you say *"Jarvis, power down"*, or if you tap the core while awake, J.A.R.V.I.S. closes the Gemini Live link, turns the camera off, and quietly returns to `"Hey Jarvis"` standby.

## Voice & Acoustic Polish

- **British RP Accent & J.A.R.V.I.S. Cadence**: Native-audio persona steering with cultured British phrasing and understated baritone delivery (`Charon` default voice; override via `GEMINI_LIVE_VOICE`).
- **Real-Time "Stark HUD" Web Audio DSP**: Zero-latency EQ (high-pass, warm baritone body, 2.9 kHz consonant presence), broadcast dynamics compression, and an ultra-subtle 8.5 ms holographic room sheen — toggleable anytime by voice (*"disable voice filter"* / *"enable HUD voice filter"*).

## Browser Sensors & Capabilities (When Permitted)

- **Local Wake Word**: 3-stage `openWakeWord` ONNX pipeline (`melspectrogram.onnx` → `embedding_model.onnx` → `hey_jarvis_v0.1.onnx`) running 100% locally in WebAssembly (`onnxruntime-web`). Sensitivity tunable by voice (`set_wake_sensitivity`).
- **All Microphones**: 16 kHz PCM capture via `AudioWorklet`, device enumeration, and voice switching (`switch_microphone`).
- **All Cameras + Live Vision**: ~1 fps live vision when awake, voice switching (`switch_camera`: front / back / next / off), sequential sweep of every camera (`inspect_all_cameras`), mobile flashlight (`set_camera_torch`), and screen sharing (`share_screen`).
- **GPS, Gyroscope & Accelerometer**: Live coordinates/altitude/speed/heading, 3D tilt/compass heading (with iOS `requestPermission()` + live 3D parallax on the animated core).
- **System Telemetry**: Battery, network speed/latency, ambient light (lux), local time/timezone, screen/device specs, clipboard reading (`read_clipboard`), haptics, Google Search grounding, and voice-switchable core color palettes (`cyan`, `amber`, `emerald`, `crimson`, `violet`).

## Local Setup & Vercel Deployment

1. Copy `.env.example` to `.env.local` and set `GEMINI_API_KEY=...` (from [Google AI Studio](https://aistudio.google.com/apikey)).
2. Run locally:
   ```powershell
   npm install
   npm run dev
   ```
3. On **Vercel**, set `GEMINI_API_KEY` (and optionally `GEMINI_LIVE_VOICE`, `GEMINI_LIVE_MODEL`, `JARVIS_ACCESS_PASSCODE`, `AUTH_SECRET`) in **Project Settings → Environment Variables**.
   *(The `postinstall` / `prebuild` script automatically stages the required `onnxruntime-web` CPU WASM binary into `public/ort/`.)*
