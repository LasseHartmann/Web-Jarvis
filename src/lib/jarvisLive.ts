"use client";

import {
  GoogleGenAI,
  Modality,
  type FunctionCall,
  type LiveServerMessage,
  type Session,
} from "@google/genai";
import { JarvisAudioEngine } from "@/lib/liveAudio";
import { JarvisSensorHub } from "@/lib/sensors";
import {
  JarvisTimerManager,
  getLocalMemoryBrief,
  handleLocalMemoryFallback,
} from "@/lib/timers";
import {
  JARVIS_LIVE_FUNCTION_DECLARATIONS,
  JARVIS_LIVE_SYSTEM_INSTRUCTION,
} from "@/lib/tools";
import { JarvisWakeWordEngine } from "@/lib/wakeWord";
import type {
  CorePalette,
  JarvisCoreState,
  LiveTokenResponse,
  VoiceFilterMode,
  WakeSensitivity,
} from "@/types/jarvis";

const SILENCE_AUTO_SLEEP_MS = 45_000;
const VOICE_ACTIVITY_THRESHOLD = 0.065;
const MAX_POST_WAKE_CHUNKS = 90; // ~5.7 seconds of 64ms 16kHz PCM chunks

const SERVER_TOOLS = new Set([
  "deep_think",
  "get_weather",
  "get_location_context",
  "memory_store",
  "spotify_control",
  "google_calendar",
  "google_gmail",
  "google_tasks",
]);

interface WakeLockSentinelLike {
  released: boolean;
  release: () => Promise<void>;
}

export interface JarvisLiveListener {
  onStateChange: (state: JarvisCoreState) => void;
  onPaletteChange: (palette: CorePalette) => void;
  onPasscodeRequired: () => void;
  onVisionPulse: () => void;
}

export class JarvisLiveController {
  public readonly audio = new JarvisAudioEngine();
  public readonly sensors = new JarvisSensorHub();
  public readonly wakeWord = new JarvisWakeWordEngine();
  public readonly timers = new JarvisTimerManager();

  private session: Session | null = null;
  private state: JarvisCoreState = "idle";
  private palette: CorePalette = "cyan";
  private listener: JarvisLiveListener | null = null;

  private armed = false;
  private closingLive = false;
  private pendingStandby = false;
  private lastActivityAt = 0;
  private silenceTimer: ReturnType<typeof setInterval> | null = null;
  private wakeLock: WakeLockSentinelLike | null = null;
  private boundVisibilityHandler: (() => void) | null = null;

  // One-breath post-wake audio buffering ("Hey Jarvis, skip this song")
  private bufferingPostWake = false;
  private postWakeAudioQueue: string[] = [];
  private postWakePeakLevel = 0;

  // Gemini Live session resumption handle for seamless long sessions
  private resumptionHandle: string | null = null;
  private reconnecting = false;

  public attach(listener: JarvisLiveListener) {
    this.listener = listener;

    this.wakeWord.setOnWake(() => {
      if (this.state === "standby") {
        void this.wakeLiveSession(false);
      }
    });

    this.timers.start((finishedTimer) => {
      this.audio.playTone("wake");
      this.sensors.vibrate([80, 60, 80, 60, 120]);
      if (this.session && !this.closingLive) {
        this.lastActivityAt = Date.now();
        try {
          this.session.sendClientContent({
            turns: [
              {
                role: "user",
                parts: [
                  {
                    text: `[System alert: The countdown timer labeled "${finishedTimer.label}" just reached zero. Announce this calmly to the user right away.]`,
                  },
                ],
              },
            ],
            turnComplete: true,
          });
        } catch {
          this.audio.speakFallbackNotice(
            `Sir, your ${finishedTimer.label} timer is complete.`
          );
        }
      } else {
        this.audio.speakFallbackNotice(
          `Sir, your ${finishedTimer.label} timer is complete.`
        );
      }
    });

    this.audio.setCallbacks({
      onPcmInt16: (pcm16) => {
        if (this.state === "standby") {
          this.wakeWord.pushPcm16(pcm16);
        }
      },
      onPcmBase64: (base64Pcm16k) => {
        const level = this.audio.getInputLevel();

        // Capture continuous speech spoken right after "Hey Jarvis" while Live WSS connects
        if (this.bufferingPostWake && !this.session && !this.closingLive) {
          if (level > this.postWakePeakLevel) {
            this.postWakePeakLevel = level;
          }
          this.postWakeAudioQueue.push(base64Pcm16k);
          if (this.postWakeAudioQueue.length > MAX_POST_WAKE_CHUNKS) {
            this.postWakeAudioQueue.shift();
          }
          return;
        }

        if (!this.session || this.closingLive) return;
        if (level > VOICE_ACTIVITY_THRESHOLD) {
          this.lastActivityAt = Date.now();
        }
        try {
          this.session.sendRealtimeInput({
            audio: {
              data: base64Pcm16k,
              mimeType: "audio/pcm;rate=16000",
            },
          });
        } catch {
          // Ignore send race during teardown
        }
      },
      onSpeakingChange: (speaking) => {
        if (this.closingLive) return;
        if (speaking) {
          this.lastActivityAt = Date.now();
          this.setState("speaking");
        } else if (this.pendingStandby) {
          this.pendingStandby = false;
          this.returnToStandby();
        } else if (this.session) {
          this.lastActivityAt = Date.now();
          this.setState("listening");
        }
      },
    });

    this.sensors.configure({
      onVideoFrame: (jpegBase64) => {
        if (!this.session || this.closingLive) return;
        try {
          this.session.sendRealtimeInput({
            video: {
              data: jpegBase64,
              mimeType: "image/jpeg",
            },
          });
        } catch {
          // Ignore send race during teardown
        }
      },
      onFramePulse: () => {
        this.listener?.onVisionPulse();
      },
      getMicLevel: () => this.audio.getInputLevel(),
    });
  }

  public getState(): JarvisCoreState {
    return this.state;
  }

  private setState(next: JarvisCoreState) {
    this.state = next;
    this.listener?.onStateChange(next);
  }

  public async handleCoreInteraction(): Promise<void> {
    if (this.state === "arming") return;

    if (this.state === "idle" || this.state === "error") {
      await this.armStandby();
    } else if (this.state === "standby") {
      await this.wakeLiveSession(false);
    } else {
      this.returnToStandby();
    }
  }

  public async armStandby(): Promise<void> {
    if (this.state === "arming" || this.armed) return;
    this.setState("arming");

    this.audio.unlockContexts();
    const motionPermPromise = this.sensors.requestMotionPermissionsInGesture();
    void this.acquireWakeLock();

    try {
      const authRes = await fetch("/api/auth");
      if (authRes.ok) {
        const auth = (await authRes.json()) as {
          passcodeRequired?: boolean;
          authenticated?: boolean;
        };
        if (auth.passcodeRequired && !auth.authenticated) {
          this.setState("idle");
          this.listener?.onPasscodeRequired();
          return;
        }
      }
    } catch {
      // Proceed; token check validates on wake
    }

    try {
      await this.audio.startMicrophone();
      this.sensors.setActiveMicId(this.audio.getActiveMicrophoneId());
    } catch {
      this.handleFailure(
        "Microphone permission is required so I can listen for Hey Jarvis, sir."
      );
      return;
    }

    await motionPermPromise;
    await Promise.all([
      this.sensors.startPassiveSensorsAndPreauthCamera(),
      this.wakeWord.load(),
    ]);

    this.armed = true;
    this.wakeWord.start();
    this.audio.playTone("arm");
    this.sensors.vibrate(20);
    this.setState("standby");
  }

  public async wakeLiveSession(isResume = false): Promise<void> {
    if (this.session || (this.state === "connecting" && !isResume)) return;
    if (!this.armed) {
      await this.armStandby();
      if (!this.armed) return;
    }

    this.closingLive = false;
    this.pendingStandby = false;
    this.wakeWord.stop();
    this.audio.unlockContexts();

    // Start buffering any immediate spoken command right after "Hey Jarvis"
    this.postWakeAudioQueue = [];
    this.postWakePeakLevel = 0;
    this.bufferingPostWake = !isResume;

    if (!isResume) {
      this.audio.playTone("wake");
      this.sensors.vibrate([22, 36, 22]);
      this.setState("connecting");
    }

    // Fetch live ephemeral token AND current cloud capabilities/memories in parallel
    let tokenData: LiveTokenResponse;
    let bootMeta: {
      integrations?: Record<string, boolean>;
      memories?: string[];
    } = {};

    try {
      const [tokenRes, metaRes] = await Promise.all([
        fetch("/api/live-token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            resumptionHandle: isResume ? this.resumptionHandle : undefined,
          }),
        }),
        fetch("/api/tools").catch(() => null),
      ]);

      if (tokenRes.status === 401) {
        this.bufferingPostWake = false;
        this.returnToStandby(true);
        this.listener?.onPasscodeRequired();
        return;
      }

      const json = await tokenRes.json();
      if (!tokenRes.ok) {
        this.bufferingPostWake = false;
        this.handleLiveErrorToStandby(
          json.error || "Unable to connect to the Gemini Live neural core, sir."
        );
        return;
      }
      tokenData = json as LiveTokenResponse;

      if (metaRes?.ok) {
        bootMeta = (await metaRes.json()) as {
          integrations?: Record<string, boolean>;
          memories?: string[];
        };
      }
    } catch {
      this.bufferingPostWake = false;
      this.handleLiveErrorToStandby(
        "Network appears unreachable at the moment, sir."
      );
      return;
    }

    if (!this.audio.isMicrophoneActive()) {
      try {
        await this.audio.startMicrophone();
        this.sensors.setActiveMicId(this.audio.getActiveMicrophoneId());
      } catch {
        this.bufferingPostWake = false;
        this.handleLiveErrorToStandby("Microphone input is unavailable, sir.");
        return;
      }
    }
    await this.sensors.startVisionStream();

    try {
      const ai = new GoogleGenAI({
        apiKey: tokenData.token,
        httpOptions: { apiVersion: tokenData.apiVersion },
      });

      const session = await ai.live.connect({
        model: tokenData.model,
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: tokenData.voiceName,
              },
            },
          },
          systemInstruction: {
            parts: [{ text: JARVIS_LIVE_SYSTEM_INSTRUCTION }],
          },
          tools: tokenData.includeSearch
            ? [
                { googleSearch: {} },
                { functionDeclarations: JARVIS_LIVE_FUNCTION_DECLARATIONS },
              ]
            : [{ functionDeclarations: JARVIS_LIVE_FUNCTION_DECLARATIONS }],
          ...(tokenData.compressionEnabled
            ? { contextWindowCompression: { slidingWindow: {} } }
            : {}),
          ...(tokenData.resumptionEnabled
            ? {
                sessionResumption:
                  isResume && this.resumptionHandle
                    ? { handle: this.resumptionHandle }
                    : {},
              }
            : {}),
        },
        callbacks: {
          onopen: () => {
            if (!this.closingLive) {
              this.reconnecting = false;
              this.lastActivityAt = Date.now();
              this.startSilenceWatchdog();
              this.setState("listening");
            }
          },
          onmessage: (message: LiveServerMessage) => {
            void this.handleServerMessage(message);
          },
          onerror: () => {
            if (!this.closingLive && !this.reconnecting) {
              this.handleLiveErrorToStandby(
                "The live audio link encountered an interruption, sir."
              );
            }
          },
          onclose: () => {
            if (!this.closingLive && !this.reconnecting && this.armed) {
              this.returnToStandby(true);
            }
          },
        },
      });

      this.session = session;
      this.lastActivityAt = Date.now();

      const bufferedAudio = this.postWakeAudioQueue;
      const hadImmediateSpeech =
        !isResume &&
        this.postWakePeakLevel >= 0.085 &&
        bufferedAudio.length >= 4;
      this.bufferingPostWake = false;
      this.postWakeAudioQueue = [];
      this.postWakePeakLevel = 0;

      if (!isResume) {
        const snapshot = this.sensors.getSnapshot(this.audio.isMicrophoneActive());
        const activeTimers = this.timers.listTimers();
        const combinedMemories = [
          ...(bootMeta.memories || []),
          ...getLocalMemoryBrief(),
        ].slice(0, 18);

        const connectedServices = Object.entries(bootMeta.integrations || {})
          .filter(([, enabled]) => enabled)
          .map(([name]) => name)
          .join(", ");

        const memoryNote =
          combinedMemories.length > 0
            ? ` Remembered user facts: ${combinedMemories.join(" | ")}.`
            : "";

        const timerNote =
          activeTimers.length > 0
            ? ` Active timers: ${activeTimers
                .map((t) => `${t.label} (${t.remainingSeconds}s left)`)
                .join(", ")}.`
            : "";

        if (hadImmediateSpeech) {
          // Inject silent context WITHOUT forcing a greeting, then stream the buffered command!
          session.sendClientContent({
            turns: [
              {
                role: "user",
                parts: [
                  {
                    text: `[Silent session context — do not greet or read this aloud; listen to the audio command arriving immediately next. Connected services: ${connectedServices || "weather, location, deepThink"}. Hardware: camera=${snapshot.cameraActive}, gps=${snapshot.gps.permission}, gyro=${snapshot.gyroscope.permission}, time=${snapshot.device.localTime}.${memoryNote}${timerNote}]`,
                  },
                ],
              },
            ],
            turnComplete: false,
          });

          for (const chunk of bufferedAudio) {
            session.sendRealtimeInput({
              audio: { data: chunk, mimeType: "audio/pcm;rate=16000" },
            });
          }
        } else {
          // User paused after "Hey Jarvis" — give a crisp British greeting
          session.sendClientContent({
            turns: [
              {
                role: "user",
                parts: [
                  {
                    text: `[Wake word detected. Do not read telemetry aloud. Acknowledge immediately in your refined British J.A.R.V.I.S. voice with just "Yes, sir?" or "At your service, sir." Connected services: ${connectedServices || "weather, location, deepThink"}. Hardware: camera=${snapshot.cameraActive} (${snapshot.cameras.length} total), gps=${snapshot.gps.permission}, gyro=${snapshot.gyroscope.permission}, time=${snapshot.device.localTime}.${memoryNote}${timerNote}]`,
                  },
                ],
              },
            ],
            turnComplete: true,
          });
        }
      }
    } catch {
      this.bufferingPostWake = false;
      this.postWakeAudioQueue = [];
      this.handleLiveErrorToStandby(
        "Could not open the Gemini Live WebSocket session, sir."
      );
    }
  }

  private async seamlessReconnect(): Promise<void> {
    if (this.reconnecting || this.closingLive || !this.resumptionHandle) return;
    this.reconnecting = true;
    const oldSession = this.session;
    this.session = null;
    if (oldSession) {
      try {
        oldSession.close();
      } catch {
        // Ignore
      }
    }
    await this.wakeLiveSession(true);
  }

  private startSilenceWatchdog() {
    this.stopSilenceWatchdog();
    this.silenceTimer = setInterval(() => {
      if (!this.session || this.closingLive) return;
      if (this.audio.isSpeaking() || this.state === "thinking") {
        this.lastActivityAt = Date.now();
        return;
      }
      if (Date.now() - this.lastActivityAt >= SILENCE_AUTO_SLEEP_MS) {
        this.returnToStandby();
      }
    }, 1000);
  }

  private stopSilenceWatchdog() {
    if (this.silenceTimer) {
      clearInterval(this.silenceTimer);
      this.silenceTimer = null;
    }
  }

  private async handleServerMessage(message: LiveServerMessage): Promise<void> {
    if (this.closingLive) return;

    // Track session resumption handles for transparent long-session continuity
    if (message.sessionResumptionUpdate?.newHandle) {
      this.resumptionHandle = message.sessionResumptionUpdate.newHandle;
    }

    if (message.serverContent?.interrupted) {
      this.lastActivityAt = Date.now();
      this.audio.interruptPlayback();
      this.setState("listening");
    }

    const parts = message.serverContent?.modelTurn?.parts;
    if (Array.isArray(parts)) {
      for (const part of parts) {
        const inline = part.inlineData;
        if (
          inline?.data &&
          (!inline.mimeType || inline.mimeType.startsWith("audio/pcm"))
        ) {
          this.lastActivityAt = Date.now();
          this.audio.enqueuePcm24k(inline.data);
        }
      }
    }

    const calls = message.toolCall?.functionCalls;
    if (Array.isArray(calls) && calls.length > 0) {
      this.lastActivityAt = Date.now();
      await this.executeToolCalls(calls);
    }

    // Transparently resume session before server closes long-running connection
    if (message.goAway && !this.closingLive) {
      if (this.resumptionHandle) {
        void this.seamlessReconnect();
      } else {
        this.returnToStandby();
      }
    }
  }

  private async invokeServerTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const enrichedArgs: Record<string, unknown> = { ...args };

    // Auto-inject live browser GPS for weather and location context when omitted
    if (name === "get_weather" || name === "get_location_context") {
      const snap = this.sensors.getSnapshot(this.audio.isMicrophoneActive());
      if (
        typeof enrichedArgs.latitude !== "number" &&
        typeof snap.gps.latitude === "number" &&
        typeof snap.gps.longitude === "number"
      ) {
        enrichedArgs.latitude = snap.gps.latitude;
        enrichedArgs.longitude = snap.gps.longitude;
      }
    }

    const res = await fetch("/api/tools", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, args: enrichedArgs }),
    });
    const data = (await res.json()) as Record<string, unknown>;

    // Seamless client localStorage fallback if Upstash Redis isn't configured yet
    if (name === "memory_store" && data.fallbackToClient) {
      return handleLocalMemoryFallback({
        action: String(enrichedArgs.action || "list").toLowerCase() as
          | "remember"
          | "recall"
          | "forget"
          | "list",
        key: typeof enrichedArgs.key === "string" ? enrichedArgs.key : undefined,
        fact: typeof enrichedArgs.fact === "string" ? enrichedArgs.fact : undefined,
        category:
          typeof enrichedArgs.category === "string"
            ? enrichedArgs.category
            : undefined,
        query:
          typeof enrichedArgs.query === "string" ? enrichedArgs.query : undefined,
      });
    }

    return data;
  }

  private async executeToolCalls(calls: FunctionCall[]): Promise<void> {
    if (!this.session || this.closingLive) return;

    this.setState("thinking");
    this.audio.playTone("tool");
    this.sensors.vibrate(22);

    const functionResponses: Array<{
      id?: string;
      name: string;
      response: Record<string, unknown>;
    }> = [];

    for (const call of calls) {
      const name = call.name || "";
      const args = (call.args as Record<string, unknown>) || {};
      let result: Record<string, unknown>;

      try {
        if (SERVER_TOOLS.has(name)) {
          result = await this.invokeServerTool(name, args);
        } else {
          switch (name) {
            case "get_sensor_telemetry": {
              await this.sensors.refreshMediaDevices();
              result = {
                ok: true,
                telemetry: {
                  ...this.sensors.getSnapshot(this.audio.isMicrophoneActive()),
                  activeTimers: this.timers.listTimers(),
                  voiceFilterMode: this.audio.getVoiceFilterMode(),
                  wakeWordSensitivity: this.wakeWord.getSensitivity(),
                },
              };
              break;
            }

            case "switch_camera":
              result = await this.sensors.switchCamera(
                String(args.target || "next")
              );
              break;

            case "inspect_all_cameras":
              result = await this.sensors.inspectAllCameras();
              break;

            case "set_camera_torch":
              result = await this.sensors.setTorch(Boolean(args.enabled));
              break;

            case "switch_microphone": {
              await this.sensors.refreshMediaDevices();
              const chosen = this.sensors.resolveMicrophoneTarget(
                String(args.target || "next")
              );
              if (!chosen) {
                result = { ok: false, message: "Matching microphone not found." };
              } else {
                await this.audio.startMicrophone(chosen.deviceId);
                this.sensors.setActiveMicId(this.audio.getActiveMicrophoneId());
                result = { ok: true, activeMicrophone: chosen.label };
              }
              break;
            }

            case "share_screen":
              result = await this.sensors.setScreenShare(Boolean(args.enabled));
              break;

            case "read_clipboard":
              result = await this.sensors.readClipboard();
              break;

            case "set_core_appearance": {
              const requested = String(args.palette || "cyan").toLowerCase();
              const allowed: CorePalette[] = [
                "cyan",
                "amber",
                "emerald",
                "crimson",
                "violet",
              ];
              const palette: CorePalette = allowed.includes(
                requested as CorePalette
              )
                ? (requested as CorePalette)
                : "cyan";
              this.palette = palette;
              this.listener?.onPaletteChange(palette);
              result = { ok: true, palette };
              break;
            }

            case "set_voice_filter": {
              const mode: VoiceFilterMode =
                String(args.mode || "hud").toLowerCase() === "natural"
                  ? "natural"
                  : "hud";
              this.audio.setVoiceFilterMode(mode);
              result = { ok: true, voiceFilterMode: mode };
              break;
            }

            case "set_wake_sensitivity": {
              const raw = String(args.level || "medium").toLowerCase();
              const level: WakeSensitivity =
                raw === "high" || raw === "low" ? raw : "medium";
              this.wakeWord.setSensitivity(level);
              result = { ok: true, wakeWordSensitivity: level };
              break;
            }

            case "manage_timers": {
              const action = String(args.action || "list").toLowerCase();
              if (action === "set") {
                const sec = Number(args.duration_seconds || 60);
                const timer = this.timers.setTimer(
                  String(args.label || "Timer"),
                  sec
                );
                result = {
                  ok: true,
                  set: {
                    label: timer.label,
                    durationSeconds: timer.durationSeconds,
                  },
                };
              } else if (action === "cancel") {
                result = {
                  ok: true,
                  ...this.timers.cancelTimer(String(args.target || "all")),
                };
              } else {
                result = { ok: true, timers: this.timers.listTimers() };
              }
              break;
            }

            case "power_down":
              this.pendingStandby = true;
              result = {
                ok: true,
                message:
                  "Returning to quiet Hey Jarvis standby once your brief goodbye finishes.",
              };
              break;

            default:
              result = { ok: false, error: `Unknown tool: ${name}` };
          }
        }
      } catch (err) {
        result = {
          ok: false,
          error: err instanceof Error ? err.message : "Tool execution error.",
        };
      }

      functionResponses.push({
        id: call.id,
        name,
        response: result,
      });
    }

    if (this.session && !this.closingLive) {
      this.lastActivityAt = Date.now();
      try {
        this.session.sendToolResponse({ functionResponses });
      } catch {
        // Ignore if socket closed mid-tool
      }
      if (!this.audio.isSpeaking()) {
        this.setState("listening");
      }
    }
  }

  public returnToStandby(silent = false): void {
    this.closingLive = true;
    this.pendingStandby = false;
    this.reconnecting = false;
    this.bufferingPostWake = false;
    this.postWakeAudioQueue = [];
    this.resumptionHandle = null;
    this.stopSilenceWatchdog();

    const sess = this.session;
    this.session = null;
    if (sess) {
      try {
        sess.close();
      } catch {
        // Ignore
      }
    }

    this.audio.interruptPlayback();
    this.sensors.stopVisionStream();

    if (!silent) {
      this.audio.playTone("sleep");
    }

    if (this.armed && this.audio.isMicrophoneActive()) {
      this.wakeWord.start();
      this.setState("standby");
    } else {
      this.armed = false;
      this.setState("idle");
    }
  }

  private handleLiveErrorToStandby(spokenMessage: string) {
    this.returnToStandby(true);
    this.audio.playTone("error");
    this.audio.speakFallbackNotice(spokenMessage);
    this.setState("error");
    setTimeout(() => {
      if (this.state === "error") {
        this.setState(this.armed ? "standby" : "idle");
      }
    }, 3200);
  }

  private handleFailure(spokenMessage: string) {
    this.dispose(true);
    this.audio.playTone("error");
    this.audio.speakFallbackNotice(spokenMessage);
    this.setState("error");
    setTimeout(() => {
      if (this.state === "error") {
        this.setState("idle");
      }
    }, 3200);
  }

  private async acquireWakeLock(): Promise<void> {
    if (typeof navigator === "undefined") return;
    const nav = navigator as Navigator & {
      wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinelLike> };
    };
    if (!nav.wakeLock) return;

    const requestLock = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        this.wakeLock = await nav.wakeLock!.request("screen");
      } catch {
        // Ignore if battery saver or OS rejects wake lock
      }
    };

    await requestLock();

    if (!this.boundVisibilityHandler) {
      this.boundVisibilityHandler = () => {
        if (this.armed && document.visibilityState === "visible") {
          void requestLock();
        }
      };
      document.addEventListener("visibilitychange", this.boundVisibilityHandler);
    }
  }

  private releaseWakeLock(): void {
    if (this.boundVisibilityHandler) {
      document.removeEventListener(
        "visibilitychange",
        this.boundVisibilityHandler
      );
      this.boundVisibilityHandler = null;
    }
    if (this.wakeLock && !this.wakeLock.released) {
      this.wakeLock.release().catch(() => {});
    }
    this.wakeLock = null;
  }

  public dispose(silent = true): void {
    this.closingLive = true;
    this.armed = false;
    this.pendingStandby = false;
    this.reconnecting = false;
    this.bufferingPostWake = false;
    this.postWakeAudioQueue = [];
    this.resumptionHandle = null;
    this.stopSilenceWatchdog();
    this.timers.stop();
    this.wakeWord.stop();

    const sess = this.session;
    this.session = null;
    if (sess) {
      try {
        sess.close();
      } catch {
        // Ignore
      }
    }

    this.audio.stopAll();
    this.sensors.stopAll();
    this.releaseWakeLock();

    if (!silent) {
      this.audio.playTone("sleep");
    }
    this.setState("idle");
  }
}
