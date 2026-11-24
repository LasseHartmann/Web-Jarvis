"use client";

let sharedAudioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctx) return null;
  if (!sharedAudioCtx || sharedAudioCtx.state === "closed") {
    sharedAudioCtx = new Ctx();
  }
  if (sharedAudioCtx.state === "suspended") {
    sharedAudioCtx.resume().catch(() => {});
  }
  return sharedAudioCtx;
}

export type HudSoundType = "activate" | "deactivate" | "tool" | "timer" | "error";

export function playHudChime(type: HudSoundType, enabled = true): void {
  if (!enabled) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;

  const tone = (
    freq: number,
    startOffset: number,
    duration: number,
    gainPeak: number,
    oscType: OscillatorType = "sine"
  ) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = oscType;
    osc.frequency.setValueAtTime(freq, now + startOffset);
    gain.gain.setValueAtTime(0.0001, now + startOffset);
    gain.gain.exponentialRampToValueAtTime(gainPeak, now + startOffset + 0.02);
    gain.gain.exponentialRampToValueAtTime(
      0.0001,
      now + startOffset + duration
    );
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now + startOffset);
    osc.stop(now + startOffset + duration + 0.02);
  };

  switch (type) {
    case "activate":
      tone(520, 0, 0.11, 0.06, "sine");
      tone(780, 0.07, 0.15, 0.06, "sine");
      break;
    case "deactivate":
      tone(640, 0, 0.09, 0.05, "sine");
      tone(420, 0.06, 0.13, 0.05, "sine");
      break;
    case "tool":
      tone(660, 0, 0.08, 0.05, "triangle");
      tone(990, 0.06, 0.12, 0.05, "sine");
      break;
    case "timer":
      tone(880, 0, 0.18, 0.09, "sine");
      tone(1174.66, 0.18, 0.2, 0.09, "sine");
      tone(1318.51, 0.38, 0.35, 0.09, "sine");
      break;
    case "error":
      tone(240, 0, 0.18, 0.06, "sawtooth");
      break;
  }
}

export function stripMarkdownForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " Code block omitted. ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_~>-]{1,3}/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function pickPreferredJarvisVoice(
  voices: SpeechSynthesisVoice[],
  preferredName?: string
): SpeechSynthesisVoice | null {
  if (voices.length === 0) return null;
  if (preferredName) {
    const exact = voices.find((v) => v.name === preferredName);
    if (exact) return exact;
  }

  const britishPatterns = [
    /Google UK English Male/i,
    /Microsoft George/i,
    /Microsoft Ryan/i,
    /Daniel/i,
    /Arthur/i,
    /en-GB/i,
  ];

  for (const pattern of britishPatterns) {
    const match = voices.find(
      (v) => pattern.test(v.name) || pattern.test(v.lang)
    );
    if (match) return match;
  }

  return voices.find((v) => v.lang.toLowerCase().startsWith("en")) || voices[0];
}

export function stopJarvisSpeech(): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
}

export function speakJarvisText(
  text: string,
  options: {
    voiceName?: string;
    rate?: number;
    onStart?: () => void;
    onEnd?: () => void;
  }
): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    options.onEnd?.();
    return;
  }

  const cleaned = stripMarkdownForSpeech(text);
  if (!cleaned) {
    options.onEnd?.();
    return;
  }

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(cleaned.slice(0, 1400));
  const voices = window.speechSynthesis.getVoices();
  const voice = pickPreferredJarvisVoice(voices, options.voiceName);
  if (voice) utterance.voice = voice;
  utterance.rate = options.rate ?? 1.04;
  utterance.pitch = 0.96;

  utterance.onstart = () => options.onStart?.();
  utterance.onend = () => options.onEnd?.();
  utterance.onerror = () => options.onEnd?.();

  window.speechSynthesis.speak(utterance);
}

export interface MicMonitorHandle {
  getLevel: () => number;
  stop: () => void;
}

export async function startMicMonitor(): Promise<MicMonitorHandle | null> {
  if (
    typeof window === "undefined" ||
    !navigator.mediaDevices?.getUserMedia
  ) {
    return null;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const ctx = getAudioContext();
    if (!ctx) {
      stream.getTracks().forEach((t) => t.stop());
      return null;
    }

    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 128;
    analyser.smoothingTimeConstant = 0.75;
    source.connect(analyser);

    const data = new Uint8Array(analyser.frequencyBinCount);

    return {
      getLevel: () => {
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          sum += data[i];
        }
        return Math.min(1, sum / (data.length * 110));
      },
      stop: () => {
        source.disconnect();
        analyser.disconnect();
        stream.getTracks().forEach((t) => t.stop());
      },
    };
  } catch {
    return null;
  }
}
