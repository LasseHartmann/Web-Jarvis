"use client";

import type { VoiceFilterMode } from "@/types/jarvis";

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64ToInt16(base64: string): Int16Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Int16Array(
    bytes.buffer,
    bytes.byteOffset,
    Math.floor(bytes.byteLength / 2)
  );
}

export class JarvisAudioEngine {
  private inputCtx: AudioContext | null = null;
  private outputCtx: AudioContext | null = null;
  private inputStream: MediaStream | null = null;
  private inputSource: MediaStreamAudioSourceNode | null = null;
  private inputAnalyser: AnalyserNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private fallbackProcessor: ScriptProcessorNode | null = null;

  // Output graph: source -> voiceInputGain -> (HUD DSP or Natural bypass) -> outputAnalyser -> destination
  private voiceInputGain: GainNode | null = null;
  private hudBranchGain: GainNode | null = null;
  private naturalBranchGain: GainNode | null = null;
  private outputAnalyser: AnalyserNode | null = null;
  private voiceFilterMode: VoiceFilterMode = "hud";

  private activeSources = new Set<AudioBufferSourceNode>();
  private nextPlayTime = 0;
  private speaking = false;

  private inputFreqData = new Uint8Array(128);
  private outputFreqData = new Uint8Array(128);

  private onPcmBase64: ((base64Pcm16k: string) => void) | null = null;
  private onPcmInt16: ((pcm16k: Int16Array) => void) | null = null;
  private onSpeakingChange: ((speaking: boolean) => void) | null = null;
  private activeDeviceId: string | null = null;

  public setCallbacks(callbacks: {
    onPcmBase64: (base64Pcm16k: string) => void;
    onPcmInt16: (pcm16k: Int16Array) => void;
    onSpeakingChange: (speaking: boolean) => void;
  }) {
    this.onPcmBase64 = callbacks.onPcmBase64;
    this.onPcmInt16 = callbacks.onPcmInt16;
    this.onSpeakingChange = callbacks.onSpeakingChange;
  }

  public setVoiceFilterMode(mode: VoiceFilterMode): void {
    this.voiceFilterMode = mode;
    const ctx = this.outputCtx;
    if (!ctx || !this.hudBranchGain || !this.naturalBranchGain) return;
    const now = ctx.currentTime;
    this.hudBranchGain.gain.setTargetAtTime(mode === "hud" ? 1 : 0, now, 0.03);
    this.naturalBranchGain.gain.setTargetAtTime(
      mode === "natural" ? 1 : 0,
      now,
      0.03
    );
  }

  public getVoiceFilterMode(): VoiceFilterMode {
    return this.voiceFilterMode;
  }

  /**
   * Must be invoked inside a user gesture so Safari/iOS/Chrome unlock audio.
   */
  public unlockContexts(): void {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return;

    if (!this.outputCtx || this.outputCtx.state === "closed") {
      const ctx = new AudioCtx({ sampleRate: 24000 });
      this.outputCtx = ctx;

      const voiceInput = ctx.createGain();
      voiceInput.gain.value = 1.0;
      this.voiceInputGain = voiceInput;

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.72;
      analyser.connect(ctx.destination);
      this.outputAnalyser = analyser;
      this.outputFreqData = new Uint8Array(analyser.frequencyBinCount);

      // Branch 1: Subtle "Stark HUD" Voice DSP Chain
      // Clean high-pass -> warm baritone shelf -> crisp British consonant presence
      // -> smooth broadcast compressor -> faint 8.5ms holographic workshop sheen
      const highPass = ctx.createBiquadFilter();
      highPass.type = "highpass";
      highPass.frequency.value = 92;
      highPass.Q.value = 0.7;

      const warmBaritone = ctx.createBiquadFilter();
      warmBaritone.type = "peaking";
      warmBaritone.frequency.value = 220;
      warmBaritone.Q.value = 1.0;
      warmBaritone.gain.value = 1.2;

      const presence = ctx.createBiquadFilter();
      presence.type = "peaking";
      presence.frequency.value = 2900;
      presence.Q.value = 1.1;
      presence.gain.value = 2.4;

      const airShelf = ctx.createBiquadFilter();
      airShelf.type = "highshelf";
      airShelf.frequency.value = 7200;
      airShelf.gain.value = 1.4;

      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -18;
      compressor.knee.value = 14;
      compressor.ratio.value = 3;
      compressor.attack.value = 0.008;
      compressor.release.value = 0.16;

      const dryGain = ctx.createGain();
      dryGain.gain.value = 0.96;

      const microDelay = ctx.createDelay(0.05);
      microDelay.delayTime.value = 0.0085;

      const sheenFilter = ctx.createBiquadFilter();
      sheenFilter.type = "bandpass";
      sheenFilter.frequency.value = 1850;
      sheenFilter.Q.value = 1.35;

      const wetGain = ctx.createGain();
      wetGain.gain.value = 0.075;

      const hudBranch = ctx.createGain();
      hudBranch.gain.value = this.voiceFilterMode === "hud" ? 1 : 0;
      this.hudBranchGain = hudBranch;

      voiceInput.connect(highPass);
      highPass.connect(warmBaritone);
      warmBaritone.connect(presence);
      presence.connect(airShelf);
      airShelf.connect(compressor);

      compressor.connect(dryGain);
      dryGain.connect(hudBranch);

      compressor.connect(microDelay);
      microDelay.connect(sheenFilter);
      sheenFilter.connect(wetGain);
      wetGain.connect(hudBranch);

      hudBranch.connect(analyser);

      // Branch 2: Unprocessed Natural Bypass
      const naturalBranch = ctx.createGain();
      naturalBranch.gain.value = this.voiceFilterMode === "natural" ? 1 : 0;
      this.naturalBranchGain = naturalBranch;
      voiceInput.connect(naturalBranch);
      naturalBranch.connect(analyser);
    }

    if (this.outputCtx.state === "suspended") {
      this.outputCtx.resume().catch(() => {});
    }

    if (!this.inputCtx || this.inputCtx.state === "closed") {
      this.inputCtx = new AudioCtx();
    }
    if (this.inputCtx.state === "suspended") {
      this.inputCtx.resume().catch(() => {});
    }
  }

  public async startMicrophone(deviceId?: string): Promise<MediaStream | null> {
    this.stopMicrophone();
    this.unlockContexts();

    const audioConstraints: MediaTrackConstraints = {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1,
    };
    if (deviceId) {
      audioConstraints.deviceId = { exact: deviceId };
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: audioConstraints,
      video: false,
    });
    this.inputStream = stream;
    const track = stream.getAudioTracks()[0];
    this.activeDeviceId = track?.getSettings().deviceId || deviceId || null;

    if (!this.inputCtx) return stream;
    if (this.inputCtx.state === "suspended") {
      await this.inputCtx.resume();
    }

    const source = this.inputCtx.createMediaStreamSource(stream);
    const analyser = this.inputCtx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.72;
    this.inputFreqData = new Uint8Array(analyser.frequencyBinCount);

    source.connect(analyser);
    this.inputSource = source;
    this.inputAnalyser = analyser;

    const dispatchChunk = (buffer: ArrayBuffer) => {
      if (this.onPcmInt16) {
        this.onPcmInt16(new Int16Array(buffer));
      }
      if (this.onPcmBase64) {
        this.onPcmBase64(arrayBufferToBase64(buffer));
      }
    };

    if (this.inputCtx.audioWorklet) {
      try {
        await this.inputCtx.audioWorklet.addModule("/audio-worklet-processor.js");
        const worklet = new AudioWorkletNode(
          this.inputCtx,
          "jarvis-pcm-capture"
        );
        worklet.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
          if (event.data) dispatchChunk(event.data);
        };
        analyser.connect(worklet);
        const silent = this.inputCtx.createGain();
        silent.gain.value = 0;
        worklet.connect(silent);
        silent.connect(this.inputCtx.destination);
        this.workletNode = worklet;
        return stream;
      } catch {
        // Fall through to ScriptProcessorNode fallback
      }
    }

    const processor = this.inputCtx.createScriptProcessor(2048, 1, 1);
    const inputRate = this.inputCtx.sampleRate;
    const ratio = inputRate / 16000;

    processor.onaudioprocess = (ev) => {
      const channel = ev.inputBuffer.getChannelData(0);
      const outLen = Math.floor(channel.length / ratio);
      const pcm = new Int16Array(outLen);
      for (let i = 0; i < outLen; i++) {
        const idx = Math.min(channel.length - 1, Math.floor(i * ratio));
        const s = Math.max(-1, Math.min(1, channel[idx]));
        pcm[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
      }
      dispatchChunk(pcm.buffer);
    };

    const silent = this.inputCtx.createGain();
    silent.gain.value = 0;
    analyser.connect(processor);
    processor.connect(silent);
    silent.connect(this.inputCtx.destination);
    this.fallbackProcessor = processor;

    return stream;
  }

  public getActiveMicrophoneId(): string | null {
    return this.activeDeviceId;
  }

  public isMicrophoneActive(): boolean {
    return Boolean(
      this.inputStream &&
        this.inputStream.getAudioTracks().some((t) => t.readyState === "live")
    );
  }

  public enqueuePcm24k(base64Pcm: string): void {
    if (!this.outputCtx || !this.voiceInputGain) {
      this.unlockContexts();
    }
    const ctx = this.outputCtx;
    const inputNode = this.voiceInputGain;
    if (!ctx || !inputNode) return;

    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }

    const pcm16 = base64ToInt16(base64Pcm);
    if (pcm16.length === 0) return;

    const buffer = ctx.createBuffer(1, pcm16.length, 24000);
    const channelData = buffer.getChannelData(0);
    for (let i = 0; i < pcm16.length; i++) {
      channelData[i] = pcm16[i] / 32768;
    }

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(inputNode);

    const now = ctx.currentTime;
    const startAt = Math.max(now + 0.015, this.nextPlayTime);
    this.nextPlayTime = startAt + buffer.duration;

    this.activeSources.add(src);
    if (!this.speaking) {
      this.speaking = true;
      this.onSpeakingChange?.(true);
    }

    src.onended = () => {
      this.activeSources.delete(src);
      if (this.activeSources.size === 0 && this.speaking) {
        this.speaking = false;
        this.onSpeakingChange?.(false);
      }
    };

    src.start(startAt);
  }

  public interruptPlayback(): void {
    for (const src of this.activeSources) {
      try {
        src.stop();
      } catch {
        // Ignore already-stopped nodes
      }
    }
    this.activeSources.clear();
    if (this.outputCtx) {
      this.nextPlayTime = this.outputCtx.currentTime;
    }
    if (this.speaking) {
      this.speaking = false;
      this.onSpeakingChange?.(false);
    }
  }

  public isSpeaking(): boolean {
    return this.speaking;
  }

  public getInputLevel(): number {
    if (!this.inputAnalyser) return 0;
    this.inputAnalyser.getByteFrequencyData(this.inputFreqData);
    let sum = 0;
    for (let i = 0; i < this.inputFreqData.length; i++) {
      sum += this.inputFreqData[i];
    }
    return Math.min(1, sum / (this.inputFreqData.length * 95));
  }

  public getOutputLevel(): number {
    if (!this.outputAnalyser || !this.speaking) return 0;
    this.outputAnalyser.getByteFrequencyData(this.outputFreqData);
    let sum = 0;
    for (let i = 0; i < this.outputFreqData.length; i++) {
      sum += this.outputFreqData[i];
    }
    return Math.min(1, sum / (this.outputFreqData.length * 85));
  }

  public getInputSpectrum(): Uint8Array {
    if (this.inputAnalyser) {
      this.inputAnalyser.getByteFrequencyData(this.inputFreqData);
    } else {
      this.inputFreqData.fill(0);
    }
    return this.inputFreqData;
  }

  public getOutputSpectrum(): Uint8Array {
    if (this.outputAnalyser && this.speaking) {
      this.outputAnalyser.getByteFrequencyData(this.outputFreqData);
    } else {
      this.outputFreqData.fill(0);
    }
    return this.outputFreqData;
  }

  public playTone(kind: "arm" | "wake" | "sleep" | "tool" | "error"): void {
    this.unlockContexts();
    const ctx = this.outputCtx;
    if (!ctx) return;
    const now = ctx.currentTime;

    const note = (
      freq: number,
      delay: number,
      dur: number,
      peak: number,
      type: OscillatorType = "sine"
    ) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, now + delay);
      gain.gain.setValueAtTime(0.0001, now + delay);
      gain.gain.exponentialRampToValueAtTime(peak, now + delay + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + delay);
      osc.stop(now + delay + dur + 0.03);
    };

    if (kind === "arm") {
      // Subtle low lock-in chime signaling local "Hey Jarvis" standby is armed
      note(293.66, 0, 0.24, 0.045, "sine");
      note(440, 0.09, 0.3, 0.04, "sine");
    } else if (kind === "wake") {
      // Crisp Stark Arc-Reactor wake chord
      note(329.63, 0, 0.26, 0.065, "sine");
      note(493.88, 0.06, 0.3, 0.06, "sine");
      note(659.25, 0.12, 0.38, 0.055, "triangle");
      note(987.77, 0.18, 0.42, 0.035, "sine");
    } else if (kind === "sleep") {
      note(523.25, 0, 0.2, 0.05, "sine");
      note(392.0, 0.1, 0.24, 0.045, "sine");
      note(261.63, 0.2, 0.34, 0.04, "sine");
    } else if (kind === "tool") {
      note(680, 0, 0.08, 0.035, "sine");
      note(1020, 0.055, 0.13, 0.035, "sine");
    } else {
      note(210, 0, 0.22, 0.06, "triangle");
      note(165, 0.18, 0.28, 0.06, "triangle");
    }
  }

  public speakFallbackNotice(text: string): void {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.0;
      utterance.pitch = 0.92;
      const voices = window.speechSynthesis.getVoices();
      const preferred =
        voices.find((v) =>
          /Google UK English Male|Microsoft George|Daniel|Arthur|en-GB/i.test(
            v.name || v.lang
          )
        ) || voices.find((v) => v.lang.startsWith("en"));
      if (preferred) utterance.voice = preferred;
      window.speechSynthesis.speak(utterance);
    } catch {
      // Ignore speech synthesis failures
    }
  }

  public stopMicrophone(): void {
    if (this.workletNode) {
      this.workletNode.port.onmessage = null;
      this.workletNode.disconnect();
      this.workletNode = null;
    }
    if (this.fallbackProcessor) {
      this.fallbackProcessor.onaudioprocess = null;
      this.fallbackProcessor.disconnect();
      this.fallbackProcessor = null;
    }
    if (this.inputSource) {
      this.inputSource.disconnect();
      this.inputSource = null;
    }
    if (this.inputAnalyser) {
      this.inputAnalyser.disconnect();
      this.inputAnalyser = null;
    }
    if (this.inputStream) {
      this.inputStream.getTracks().forEach((t) => t.stop());
      this.inputStream = null;
    }
    this.activeDeviceId = null;
  }

  public stopAll(): void {
    this.interruptPlayback();
    this.stopMicrophone();
  }
}
