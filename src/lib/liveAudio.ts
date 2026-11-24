"use client";

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
  return new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
}

export class JarvisAudioEngine {
  private inputCtx: AudioContext | null = null;
  private outputCtx: AudioContext | null = null;
  private inputStream: MediaStream | null = null;
  private inputSource: MediaStreamAudioSourceNode | null = null;
  private inputAnalyser: AnalyserNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private fallbackProcessor: ScriptProcessorNode | null = null;

  private outputAnalyser: AnalyserNode | null = null;
  private outputGain: GainNode | null = null;
  private activeSources = new Set<AudioBufferSourceNode>();
  private nextPlayTime = 0;
  private speaking = false;

  private inputFreqData = new Uint8Array(128);
  private outputFreqData = new Uint8Array(128);

  private onPcmChunk: ((base64Pcm16k: string) => void) | null = null;
  private onSpeakingChange: ((speaking: boolean) => void) | null = null;
  private activeDeviceId: string | null = null;

  public setCallbacks(callbacks: {
    onPcmChunk: (base64Pcm16k: string) => void;
    onSpeakingChange: (speaking: boolean) => void;
  }) {
    this.onPcmChunk = callbacks.onPcmChunk;
    this.onSpeakingChange = callbacks.onSpeakingChange;
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
      this.outputCtx = new AudioCtx({ sampleRate: 24000 });
      this.outputAnalyser = this.outputCtx.createAnalyser();
      this.outputAnalyser.fftSize = 256;
      this.outputAnalyser.smoothingTimeConstant = 0.72;
      this.outputGain = this.outputCtx.createGain();
      this.outputGain.gain.value = 1.0;
      this.outputGain.connect(this.outputAnalyser);
      this.outputAnalyser.connect(this.outputCtx.destination);
      this.outputFreqData = new Uint8Array(this.outputAnalyser.frequencyBinCount);
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

    // Prefer AudioWorklet for zero-jank 16kHz downsampling off the main thread
    if (this.inputCtx.audioWorklet) {
      try {
        await this.inputCtx.audioWorklet.addModule("/audio-worklet-processor.js");
        const worklet = new AudioWorkletNode(
          this.inputCtx,
          "jarvis-pcm-capture"
        );
        worklet.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
          if (event.data && this.onPcmChunk) {
            this.onPcmChunk(arrayBufferToBase64(event.data));
          }
        };
        analyser.connect(worklet);
        // Connect through silent gain so Chromium keeps processing graph active
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
      if (this.onPcmChunk) {
        this.onPcmChunk(arrayBufferToBase64(pcm.buffer));
      }
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
    if (!this.outputCtx || !this.outputGain) {
      this.unlockContexts();
    }
    const ctx = this.outputCtx;
    const gain = this.outputGain;
    if (!ctx || !gain) return;

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
    src.connect(gain);

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

  public playTone(kind: "wake" | "sleep" | "tool" | "error"): void {
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
      gain.gain.exponentialRampToValueAtTime(peak, now + delay + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + delay);
      osc.stop(now + delay + dur + 0.03);
    };

    if (kind === "wake") {
      note(220, 0, 0.35, 0.07, "sine");
      note(329.63, 0.08, 0.38, 0.06, "sine");
      note(440, 0.16, 0.45, 0.06, "sine");
      note(659.25, 0.24, 0.5, 0.045, "triangle");
    } else if (kind === "sleep") {
      note(440, 0, 0.22, 0.055, "sine");
      note(329.63, 0.12, 0.26, 0.05, "sine");
      note(220, 0.24, 0.4, 0.05, "sine");
    } else if (kind === "tool") {
      note(680, 0, 0.09, 0.035, "sine");
      note(1020, 0.06, 0.14, 0.035, "sine");
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
      utterance.rate = 1.02;
      utterance.pitch = 0.94;
      const voices = window.speechSynthesis.getVoices();
      const preferred =
        voices.find((v) => /Google UK English Male|Daniel|George|en-GB/i.test(v.name || v.lang)) ||
        voices.find((v) => v.lang.startsWith("en"));
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
