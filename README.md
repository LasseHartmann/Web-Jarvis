# J.A.R.V.I.S. — Pure Voice, Sensor & Cloud AI Core

A zero-UI, voice-only animated **J.A.R.V.I.S.** companion powered by **Google Gemini Live**, local in-browser **"Hey Jarvis"** wake-word detection (`openWakeWord` ONNX/WASM), Spotify, and Google Workspace — hosted via GitHub and Vercel.

## Capabilities

- **Zero-UI Animated 3D Core & PWA**: Full-screen 60fps reactive Fibonacci neural core, gyroscopic parallax tilt, installable standalone PWA (`manifest.webmanifest` + Arc-Reactor icons).
- **Local `"Hey Jarvis"` Wake Word + One-Breath Capture**: Tap once to pre-authorize sensors (camera stays off during standby) and arm zero-cost local wake-word listening with Screen Wake Lock. Continuous post-wake buffering lets you say *"Hey Jarvis, skip this song"* in one breath; auto-sleeps after 45s of silence or *"power down"*.
- **British RP J.A.R.V.I.S. Voice + Stark HUD DSP**: Cultured British Received Pronunciation steering + real-time Web Audio intercom EQ, broadcast compression, and subtle holographic room sheen (toggleable by voice).
- **Core Intelligence**: Gemini Pro **Deep-Think** escalation (`deep_think`), Gemini Live **Session Resumption + Context Compression**, **Voice-Only Safety Confirmations** on outbound/destructive actions, persistent **Long-Term Memory** (Upstash Redis cloud sync + browser `localStorage` fallback), and **Voice Timers** (work even in standby).
- **Zero-OAuth World Awareness**: Live **Open-Meteo Weather & Air Quality** + **OpenStreetMap / Google Places** reverse geocoding & nearby search using your live browser GPS.
- **Connected Integrations**:
  - **Spotify**: Play/pause/skip/volume/queue/search/playlists/like/device transfer across Spotify Connect (`/api/oauth/spotify/start`).
  - **Google Services**: Calendar (read/create/delete), Gmail (unread/search/read/draft/send), and Google Tasks (`/api/oauth/google/start`).
- **Browser Sensors**: All cameras (`switch_camera`, `inspect_all_cameras`, `set_camera_torch`, `share_screen`), all microphones (`switch_microphone`), GPS, gyroscope, accelerometer, battery, network, ambient light, clipboard, and haptics.

## Setup

See [.env.example](.env.example) for all environment variables. Only `GEMINI_API_KEY` is required to start; Spotify, Google Services, and Upstash Redis activate automatically once configured in `.env.local` or **Vercel → Project Settings → Environment Variables**.
