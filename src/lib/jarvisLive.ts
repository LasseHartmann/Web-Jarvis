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

  public attach(listener: JarvisLiveListener) {
    this.listener = listener;

    this.wakeWord.setOnWake(() => {
      if (this.state === "standby") {
        void this.wakeLiveSession();
      }
    });

    this.audio.setCallbacks({
      onPcmInt16: (pcm16) => {
        if (this.state === "standby") {
          this.wakeWord.pushPcm16(pcm16);
        }
      },
      onPcmBase64: (base64Pcm16k) => {
        if (!this.session || this.closingLive) return;
        if (this.audio.getInputLevel() > VOICE_ACTIVITY_THRESHOLD) {
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

  /**
   * Primary tap / Space interaction:
   * - From `idle` / `error`: pre-authorize all sensors once, turn camera off, and arm "Hey Jarvis" standby.
   * - From `standby`: manually force-wake J.A.R.V.I.S. immediately.
   * - From active live (`connecting` / `listening` / `speaking` / `thinking`): sleep back to "Hey Jarvis" standby.
   */
  public async handleCoreInteraction(): Promise<void> {
    if (this.state === "arming") return;

    if (this.state === "idle" || this.state === "error") {
      await this.armStandby();
    } else if (this.state === "standby") {
      await this.wakeLiveSession();
    } else {
      this.returnToStandby();
    }
  }

  public async armStandby(): Promise<void> {
    if (this.state === "arming" || this.armed) return;
    this.setState("arming");

    // 1. Unlock Web Audio + request iOS gyroscope/accelerometer permissions inside user gesture
    this.audio.unlockContexts();
    const motionPermPromise = this.sensors.requestMotionPermissionsInGesture();
    void this.acquireWakeLock();

    // 2. Verify clearance status up front so hands-free "Hey Jarvis" never hits a 401 surprise later
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
      // Proceed; token check will validate on wake
    }

    // 3. Start local microphone capture (kept alive at zero Gemini API cost for wake-word detection)
    try {
      await this.audio.startMicrophone();
      this.sensors.setActiveMicId(this.audio.getActiveMicrophoneId());
    } catch {
      this.handleFailure(
        "Microphone permission is required so I can listen for Hey Jarvis, sir."
      );
      return;
    }

    // 4. Pre-authorize cameras/GPS/gyro once, immediately turn camera OFF, and load local ONNX wake-word
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

  public async wakeLiveSession(): Promise<void> {
    if (this.session || this.state === "connecting") return;
    if (!this.armed) {
      await this.armStandby();
      if (!this.armed) return;
    }

    this.closingLive = false;
    this.pendingStandby = false;
    this.wakeWord.stop();
    this.audio.unlockContexts();
    this.audio.playTone("wake");
    this.sensors.vibrate([22, 36, 22]);
    this.setState("connecting");

    // Mint short-lived constrained ephemeral token from our Vercel server
    let tokenData: LiveTokenResponse;
    try {
      const res = await fetch("/api/live-token", { method: "POST" });
      if (res.status === 401) {
        this.returnToStandby(true);
        this.listener?.onPasscodeRequired();
        return;
      }
      const json = await res.json();
      if (!res.ok) {
        this.handleLiveErrorToStandby(
          json.error || "Unable to connect to the Gemini Live neural core, sir."
        );
        return;
      }
      tokenData = json as LiveTokenResponse;
    } catch {
      this.handleLiveErrorToStandby(
        "Network appears unreachable at the moment, sir."
      );
      return;
    }

    // Ensure mic is still active & turn live camera vision ON
    if (!this.audio.isMicrophoneActive()) {
      try {
        await this.audio.startMicrophone();
        this.sensors.setActiveMicId(this.audio.getActiveMicrophoneId());
      } catch {
        this.handleLiveErrorToStandby("Microphone input is unavailable, sir.");
        return;
      }
    }
    await this.sensors.startVisionStream();

    // Open direct WSS Gemini Live session using the ephemeral token
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
        },
        callbacks: {
          onopen: () => {
            if (!this.closingLive) {
              this.lastActivityAt = Date.now();
              this.startSilenceWatchdog();
              this.setState("listening");
            }
          },
          onmessage: (message: LiveServerMessage) => {
            void this.handleServerMessage(message);
          },
          onerror: () => {
            if (!this.closingLive) {
              this.handleLiveErrorToStandby(
                "The live audio link encountered an interruption, sir."
              );
            }
          },
          onclose: () => {
            if (!this.closingLive && this.armed) {
              this.returnToStandby(true);
            }
          },
        },
      });

      this.session = session;
      this.lastActivityAt = Date.now();

      // Send silent wake trigger so J.A.R.V.I.S. responds with a crisp British greeting
      const snapshot = this.sensors.getSnapshot(this.audio.isMicrophoneActive());
      session.sendClientContent({
        turns: [
          {
            role: "user",
            parts: [
              {
                text: `[Wake word detected. Do not read telemetry aloud. Acknowledge immediately in your British J.A.R.V.I.S. voice with just "Yes, sir?" or "At your service, sir." Active hardware: camera=${snapshot.cameraActive} (${snapshot.cameras.length} total), gps=${snapshot.gps.permission}, gyro=${snapshot.gyroscope.permission}.]`,
              },
            ],
          },
        ],
        turnComplete: true,
      });
    } catch {
      this.handleLiveErrorToStandby(
        "Could not open the Gemini Live WebSocket session, sir."
      );
    }
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

    if (message.goAway && !this.closingLive) {
      this.returnToStandby();
    }
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
        switch (name) {
          case "get_sensor_telemetry": {
            await this.sensors.refreshMediaDevices();
            result = {
              ok: true,
              telemetry: {
                ...this.sensors.getSnapshot(this.audio.isMicrophoneActive()),
                voiceFilterMode: this.audio.getVoiceFilterMode(),
                wakeWordSensitivity: this.wakeWord.getSensitivity(),
              },
            };
            break;
          }

          case "switch_camera": {
            result = await this.sensors.switchCamera(
              String(args.target || "next")
            );
            break;
          }

          case "inspect_all_cameras": {
            result = await this.sensors.inspectAllCameras();
            break;
          }

          case "set_camera_torch": {
            result = await this.sensors.setTorch(Boolean(args.enabled));
            break;
          }

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

          case "share_screen": {
            result = await this.sensors.setScreenShare(Boolean(args.enabled));
            break;
          }

          case "read_clipboard": {
            result = await this.sensors.readClipboard();
            break;
          }

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

          case "power_down": {
            this.pendingStandby = true;
            result = {
              ok: true,
              message:
                "Returning to quiet Hey Jarvis standby once your brief goodbye finishes.",
            };
            break;
          }

          default:
            result = { ok: false, error: `Unknown tool: ${name}` };
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
    this.stopSilenceWatchdog();

    const sess = this.session;
    this.session = null;
    if (sess) {
      try {
        sess.close();
      } catch {
        // Ignore close error
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
    this.stopSilenceWatchdog();
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
