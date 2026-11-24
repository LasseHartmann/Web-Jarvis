# J.A.R.V.I.S. — Pure Voice & Sensor AI Core

A zero-UI, voice-only animated **J.A.R.V.I.S.** assistant powered by the **Google Gemini Live API** (`@google/genai`), hosted via GitHub and Vercel.

## How It Works

1. Open the page — you see only the breathing 3D animated holographic J.A.R.V.I.S. core (no buttons, menus, or chat panels).
2. **Tap or click anywhere** (or press `Space`) to awaken J.A.R.V.I.S. and grant whichever browser permissions you allow.
3. Speak naturally — full-duplex speech-to-speech with instant barge-in interruption. Tap again or say *"Jarvis, power down"* to return to standby.

## Browser Sensors & Capabilities (When Permitted)

- **All Microphones**: 16 kHz PCM live audio streaming via `AudioWorklet`, full device enumeration, voice-triggered microphone switching (`switch_microphone`), and live ambient audio spectrum visualization.
- **All Cameras + Live Vision**: Continuous ~1 fps camera vision feed into Gemini Live, voice-triggered camera switching (`switch_camera`: front / back / next / off), sequential multi-camera sweep (`inspect_all_cameras`), and mobile flashlight control (`set_camera_torch`).
- **Screen Sharing**: Say *"look at my screen"* to stream your display (`share_screen`).
- **GPS / Geolocation**: Live latitude, longitude, accuracy, altitude, speed, and heading (`watchPosition`).
- **Gyroscope & Accelerometer**: Live 3D orientation (`alpha`/`beta`/`gamma`), compass heading, linear acceleration, rotation rate (including iOS `requestPermission()`), plus live 3D parallax tilt on the animated core.
- **Device & Environment Telemetry**: Battery level & charging state, network type/speed/latency, ambient light sensor (lux), local time & timezone, screen resolution & orientation, CPU cores, device memory, storage quota, clipboard reading (`read_clipboard`), haptic vibration, Google Search grounding, and voice-controlled core color palettes (`cyan`, `amber`, `emerald`, `crimson`, `violet`).

## Security on Vercel

- `GEMINI_API_KEY` stays strictly on the server inside `/api/live-token`, which mints single-use, constrained ephemeral tokens (`ai.authTokens.create`) so your browser connects directly to Gemini Live WebSockets without exposing your key or hitting Vercel serverless timeouts.
- Optionally set `JARVIS_ACCESS_PASSCODE` and `AUTH_SECRET` in Vercel Environment Variables to protect your deployed URL.

## Local Run

```powershell
Copy-Item .env.example .env.local
# Edit .env.local and set GEMINI_API_KEY=...
npm install
npm run dev
```

Open `http://localhost:3000` (or deploy to Vercel for HTTPS — required for camera, microphone, GPS, and gyroscope permissions on mobile devices).
