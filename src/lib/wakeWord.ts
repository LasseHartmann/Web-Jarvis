"use client";

import type * as OrtTypes from "onnxruntime-web";
import type { WakeSensitivity } from "@/types/jarvis";

const CHUNK_SAMPLES = 1280; // 80ms @ 16kHz
const OVERLAP_SAMPLES = 480; // 30ms STFT overlap -> 1760 samples -> exact 8x32 mel frames
const MEL_WINDOW_FRAMES = 76;
const MEL_BINS = 32;
const EMBEDDING_WINDOW = 16;
const EMBEDDING_DIM = 96;
const COOLDOWN_MS = 2500;

const THRESHOLDS: Record<WakeSensitivity, number> = {
  high: 0.36,
  medium: 0.5,
  low: 0.65,
};

/**
 * 100% local, zero-API-cost browser wake-word detector running openWakeWord's
 * 3-stage ONNX pipeline (`melspectrogram` -> `embedding_model` -> `hey_jarvis_v0.1`)
 * via WebAssembly (`onnxruntime-web`).
 */
export class JarvisWakeWordEngine {
  private ort: typeof OrtTypes | null = null;
  private melSession: OrtTypes.InferenceSession | null = null;
  private embSession: OrtTypes.InferenceSession | null = null;
  private jarvisSession: OrtTypes.InferenceSession | null = null;

  private loaded = false;
  private loadingPromise: Promise<boolean> | null = null;
  private enabled = false;
  private processing = false;

  private sensitivity: WakeSensitivity = "medium";
  private lastTriggerAt = 0;

  // Streaming sample & feature rolling buffers
  private sampleQueue: number[] = [];
  private rawOverlap = new Float32Array(OVERLAP_SAMPLES);
  private melFrames: Float32Array[] = [];
  private embeddings: Float32Array[] = [];

  private onWake: ((score: number) => void) | null = null;

  public setOnWake(cb: (score: number) => void) {
    this.onWake = cb;
  }

  public setSensitivity(level: WakeSensitivity) {
    this.sensitivity = level;
  }

  public getSensitivity(): WakeSensitivity {
    return this.sensitivity;
  }

  public isLoaded(): boolean {
    return this.loaded;
  }

  public async load(): Promise<boolean> {
    if (this.loaded) return true;
    if (this.loadingPromise) return this.loadingPromise;

    this.loadingPromise = (async () => {
      try {
        const ort = await import("onnxruntime-web");
        ort.env.wasm.wasmPaths = "/ort/";
        ort.env.wasm.numThreads = 1;
        this.ort = ort;

        const opts: OrtTypes.InferenceSession.SessionOptions = {
          executionProviders: ["wasm"],
          graphOptimizationLevel: "all",
        };

        const [mel, emb, jarvis] = await Promise.all([
          ort.InferenceSession.create("/models/melspectrogram.onnx", opts),
          ort.InferenceSession.create("/models/embedding_model.onnx", opts),
          ort.InferenceSession.create("/models/hey_jarvis_v0.1.onnx", opts),
        ]);

        this.melSession = mel;
        this.embSession = emb;
        this.jarvisSession = jarvis;
        this.loaded = true;
        return true;
      } catch {
        this.loaded = false;
        this.loadingPromise = null;
        return false;
      }
    })();

    return this.loadingPromise;
  }

  public start(): void {
    this.resetBuffers();
    this.enabled = true;
  }

  public stop(): void {
    this.enabled = false;
    this.resetBuffers();
  }

  public resetBuffers(): void {
    this.sampleQueue = [];
    this.rawOverlap.fill(0);
    this.melFrames = [];
    this.embeddings = [];
  }

  /**
   * Accepts 16kHz 16-bit signed PCM chunks from the AudioWorklet.
   * Buffers into exact 1280-sample (80ms) frames and runs ONNX inference sequentially.
   */
  public pushPcm16(pcm16: Int16Array): void {
    if (!this.enabled || !this.loaded) return;

    for (let i = 0; i < pcm16.length; i++) {
      this.sampleQueue.push(pcm16[i]);
    }

    // Keep queue bounded if the main thread stalls momentarily (e.g. background tab)
    const maxQueued = CHUNK_SAMPLES * 8;
    if (this.sampleQueue.length > maxQueued) {
      this.sampleQueue.splice(0, this.sampleQueue.length - maxQueued);
    }

    if (!this.processing && this.sampleQueue.length >= CHUNK_SAMPLES) {
      void this.drainQueue();
    }
  }

  private async drainQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    try {
      while (this.enabled && this.sampleQueue.length >= CHUNK_SAMPLES) {
        const chunk = this.sampleQueue.splice(0, CHUNK_SAMPLES);
        await this.processChunk(chunk);
      }
    } finally {
      this.processing = false;
    }
  }

  private async processChunk(chunkInt16AsNum: number[]): Promise<void> {
    const ort = this.ort;
    const melSession = this.melSession;
    const embSession = this.embSession;
    const jarvisSession = this.jarvisSession;
    if (!ort || !melSession || !embSession || !jarvisSession || !this.enabled) {
      return;
    }

    // Build 1760-sample overlapped frame (480 previous + 1280 new) in Int16 magnitude range
    const input1760 = new Float32Array(OVERLAP_SAMPLES + CHUNK_SAMPLES);
    input1760.set(this.rawOverlap, 0);
    for (let i = 0; i < CHUNK_SAMPLES; i++) {
      input1760[OVERLAP_SAMPLES + i] = chunkInt16AsNum[i];
    }
    this.rawOverlap.set(input1760.subarray(CHUNK_SAMPLES));

    // Stage 1: Mel spectrogram -> [1, 1, 8, 32]
    const melTensor = new ort.Tensor("float32", input1760, [1, input1760.length]);
    const melOutMap = await melSession.run({
      [melSession.inputNames[0]]: melTensor,
    });
    const melData = melOutMap[melSession.outputNames[0]].data as Float32Array;
    const numFrames = Math.floor(melData.length / MEL_BINS);

    for (let f = 0; f < numFrames; f++) {
      const frame = new Float32Array(MEL_BINS);
      const base = f * MEL_BINS;
      for (let b = 0; b < MEL_BINS; b++) {
        // Mandatory openWakeWord mel scaling transform
        frame[b] = melData[base + b] / 10.0 + 2.0;
      }
      this.melFrames.push(frame);
    }

    if (this.melFrames.length > MEL_WINDOW_FRAMES) {
      this.melFrames.splice(0, this.melFrames.length - MEL_WINDOW_FRAMES);
    }
    if (this.melFrames.length < MEL_WINDOW_FRAMES) return;

    // Stage 2: Speech embedding on rolling 76x32 mel window -> [1, 1, 1, 96]
    const melFlat = new Float32Array(MEL_WINDOW_FRAMES * MEL_BINS);
    for (let f = 0; f < MEL_WINDOW_FRAMES; f++) {
      melFlat.set(this.melFrames[f], f * MEL_BINS);
    }
    const embTensor = new ort.Tensor("float32", melFlat, [
      1,
      MEL_WINDOW_FRAMES,
      MEL_BINS,
      1,
    ]);
    const embOutMap = await embSession.run({
      [embSession.inputNames[0]]: embTensor,
    });
    const embData = embOutMap[embSession.outputNames[0]].data as Float32Array;
    this.embeddings.push(new Float32Array(embData.subarray(0, EMBEDDING_DIM)));

    if (this.embeddings.length > EMBEDDING_WINDOW) {
      this.embeddings.splice(0, this.embeddings.length - EMBEDDING_WINDOW);
    }
    if (this.embeddings.length < EMBEDDING_WINDOW) return;

    // Stage 3: "Hey Jarvis" classifier on [1, 16, 96] -> probability [0, 1]
    const embFlat = new Float32Array(EMBEDDING_WINDOW * EMBEDDING_DIM);
    for (let e = 0; e < EMBEDDING_WINDOW; e++) {
      embFlat.set(this.embeddings[e], e * EMBEDDING_DIM);
    }
    const jarvisTensor = new ort.Tensor("float32", embFlat, [
      1,
      EMBEDDING_WINDOW,
      EMBEDDING_DIM,
    ]);
    const jarvisOutMap = await jarvisSession.run({
      [jarvisSession.inputNames[0]]: jarvisTensor,
    });
    const score = Number(
      (jarvisOutMap[jarvisSession.outputNames[0]].data as Float32Array)[0] || 0
    );

    const now = Date.now();
    if (score >= THRESHOLDS[this.sensitivity] && now - this.lastTriggerAt > COOLDOWN_MS) {
      this.lastTriggerAt = now;
      this.enabled = false;
      this.resetBuffers();
      this.onWake?.(score);
    }
  }
}
