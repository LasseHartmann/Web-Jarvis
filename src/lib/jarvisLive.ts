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
import type {
  CorePalette,
  JarvisCoreState,
  LiveTokenResponse,
} from "@/types/jarvis";

export interface JarvisLiveListener {
  onStateChange: (state: JarvisCoreState) => void;
  onPaletteChange: (palette: CorePalette) => void;
  onPasscodeRequired: () => void;
  onVisionPulse: () => void;
}

export class JarvisLiveController {
  public readonly audio = new JarvisAudioEngine();
  public readonly sensors = new JarvisSensorHub();

  private session: Session | null = null;
  private state: JarvisCoreState = "idle";
  private palette: CorePalette = "cyan";
  private listener: JarvisLiveListener | null = null;
  private shuttingDown = false;
  private pendingPowerDown = false;

  public attach(listener: JarvisLiveListener) {
    this.listener = listener;

    this.audio.setCallbacks({
      onPcmChunk: (base64Pcm16k) => {
        if (!this.session || this.shuttingDown) return;
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
        if (this.shuttingDown) return;
        if (speaking) {
          this.setState("speaking");
        } else if (this.pendingPowerDown) {
          this.pendingPowerDown = false;
          this.deactivate();
        } else if (this.session) {
          this.setState("listening");
        }
      },
    });

    this.sensors.configure({
      onVideoFrame: (jpegBase64) => {
        if (!this.session || this.shuttingDown) return;
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

  public async toggle(): Promise<void> {
    if (this.state === "idle" || this.state === "error") {
      await this.activate();
    } else {
      this.deactivate();
    }
  }

  public async activate(): Promise<void> {
    if (this.state === "connecting" || this.session) return;

    this.shuttingDown = false;
    this.pendingPowerDown = false;
    this.setState("connecting");

    // 1. Unlock audio contexts & iOS motion permissions synchronously in gesture
    this.audio.unlockContexts();
    const motionPermPromise = this.sensors.requestMotionPermissionsInGesture();
    this.audio.playTone("wake");

    // 2. Request short-lived constrained ephemeral token from our Vercel server
    let tokenData: LiveTokenResponse;
    try {
      const res = await fetch("/api/live-token", { method: "POST" });
      if (res.status === 401) {
        this.setState("idle");
        this.listener?.onPasscodeRequired();
        return;
      }
      const json = await res.json();
      if (!res.ok) {
        this.handleFailure(
          json.error || "Unable to connect to the Gemini Live neural core."
        );
        return;
      }
      tokenData = json as LiveTokenResponse;
    } catch {
      this.handleFailure("Network unreachable. Cannot establish live voice link.");
      return;
    }

    // 3. Start microphone capture (essential for voice-only assistant)
    try {
      await this.audio.startMicrophone();
      this.sensors.setActiveMicId(this.audio.getActiveMicrophoneId());
    } catch {
      this.handleFailure(
        "Microphone permission is required so I can hear you. Please allow microphone access in your browser."
      );
      return;
    }

    // 4. Start all remaining permitted sensors (cameras, GPS, gyro, accel, battery, network, light)
    await motionPermPromise;
    await this.sensors.startAllSensors();

    // 5. Connect directly to Gemini Live API over WSS using the ephemeral token
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
            if (!this.shuttingDown) {
              this.setState("listening");
            }
          },
          onmessage: (message: LiveServerMessage) => {
            void this.handleServerMessage(message);
          },
          onerror: () => {
            if (!this.shuttingDown) {
              this.handleFailure("Live audio link encountered an error.");
            }
          },
          onclose: () => {
            if (!this.shuttingDown) {
              this.cleanupToIdle();
            }
          },
        },
      });

      this.session = session;

      // Send initial live sensor summary so J.A.R.V.I.S. knows granted sensors & greets user
      const snapshot = this.sensors.getSnapshot(this.audio.isMicrophoneActive());
      session.sendClientContent({
        turns: [
          {
            role: "user",
            parts: [
              {
                text: `[System boot telemetry — do not read raw JSON aloud. Greet the user briefly as J.A.R.V.I.S. in one calm sentence confirming you are online. Active sensors: camera=${snapshot.cameraActive} (${snapshot.cameras.length} detected), mic=${snapshot.microphoneActive} (${snapshot.microphones.length} detected), gps=${snapshot.gps.permission}, gyroscope=${snapshot.gyroscope.permission}, battery=${snapshot.battery.levelPercent ?? "unknown"}%, localTime=${snapshot.device.localTime}.]`,
              },
            ],
          },
        ],
        turnComplete: true,
      });
    } catch {
      this.handleFailure(
        "Could not open the Gemini Live WebSocket session. Verify your GEMINI_API_KEY supports Gemini Live audio."
      );
    }
  }

  private async handleServerMessage(message: LiveServerMessage): Promise<void> {
    if (this.shuttingDown) return;

    // Immediate barge-in interruption
    if (message.serverContent?.interrupted) {
      this.audio.interruptPlayback();
      this.setState("listening");
    }

    // Stream incoming 24kHz PCM voice chunks straight into Web Audio playback
    const parts = message.serverContent?.modelTurn?.parts;
    if (Array.isArray(parts)) {
      for (const part of parts) {
        const inline = part.inlineData;
        if (
          inline?.data &&
          (!inline.mimeType || inline.mimeType.startsWith("audio/pcm"))
        ) {
          this.audio.enqueuePcm24k(inline.data);
        }
      }
    }

    // Execute Live Function Calls (sensors, multi-camera, torch, mic, screen, appearance)
    const calls = message.toolCall?.functionCalls;
    if (Array.isArray(calls) && calls.length > 0) {
      await this.executeToolCalls(calls);
    }

    if (message.goAway && !this.shuttingDown) {
      this.cleanupToIdle();
    }
  }

  private async executeToolCalls(calls: FunctionCall[]): Promise<void> {
    if (!this.session || this.shuttingDown) return;

    this.setState("thinking");
    this.audio.playTone("tool");
    this.sensors.vibrate(25);

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
              telemetry: this.sensors.getSnapshot(
                this.audio.isMicrophoneActive()
              ),
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

          case "power_down": {
            this.pendingPowerDown = true;
            result = {
              ok: true,
              message:
                "Standing down after your closing remark. Say a brief goodbye.",
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

    if (this.session && !this.shuttingDown) {
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

  private handleFailure(spokenMessage: string) {
    this.cleanupSessionAndHardware();
    this.audio.playTone("error");
    this.audio.speakFallbackNotice(spokenMessage);
    this.setState("error");
    setTimeout(() => {
      if (this.state === "error") {
        this.setState("idle");
      }
    }, 3200);
  }

  private cleanupSessionAndHardware() {
    this.shuttingDown = true;
    const sess = this.session;
    this.session = null;
    if (sess) {
      try {
        sess.close();
      } catch {
        // Ignore close error
      }
    }
    this.audio.stopAll();
    this.sensors.stopAll();
  }

  private cleanupToIdle() {
    this.cleanupSessionAndHardware();
    this.shuttingDown = false;
    this.setState("idle");
  }

  public deactivate(): void {
    this.audio.playTone("sleep");
    this.cleanupToIdle();
  }
}
