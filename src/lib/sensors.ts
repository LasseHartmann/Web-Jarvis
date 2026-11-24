"use client";

import type {
  AccelerometerTelemetry,
  BatteryTelemetry,
  FullSensorTelemetry,
  GpsTelemetry,
  GyroscopeTelemetry,
  MediaDeviceSummary,
  NetworkTelemetry,
} from "@/types/jarvis";

interface BatteryManagerLike extends EventTarget {
  level: number;
  charging: boolean;
  chargingTime: number;
  dischargingTime: number;
}

interface NetworkInformationLike extends EventTarget {
  effectiveType?: string;
  type?: string;
  downlink?: number;
  rtt?: number;
  saveData?: boolean;
}

interface AmbientLightSensorLike extends EventTarget {
  illuminance?: number;
  start: () => void;
  stop: () => void;
  onreading: (() => void) | null;
  onerror: (() => void) | null;
}

function inferFacing(label: string): "front" | "back" | "unknown" {
  const lower = label.toLowerCase();
  if (/back|rear|environment|world|telephoto|ultra\s?wide/.test(lower)) {
    return "back";
  }
  if (/front|user|facetime|selfie|integrated|webcam/.test(lower)) {
    return "front";
  }
  return "unknown";
}

function round(n: number | null | undefined, digits = 2): number | null {
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  const f = Math.pow(10, digits);
  return Math.round(n * f) / f;
}

export class JarvisSensorHub {
  private videoEl: HTMLVideoElement | null = null;
  private captureCanvas: HTMLCanvasElement | null = null;
  private cameraStream: MediaStream | null = null;
  private screenStream: MediaStream | null = null;
  private frameInterval: ReturnType<typeof setInterval> | null = null;

  private activeCameraId: string | null = null;
  private activeMicId: string | null = null;
  private cameraPaused = false;
  private torchOn = false;

  private cameras: MediaDeviceSummary[] = [];
  private microphones: MediaDeviceSummary[] = [];

  private gpsWatchId: number | null = null;
  private gps: GpsTelemetry = {
    permission: "prompt",
    latitude: null,
    longitude: null,
    accuracyMeters: null,
    altitudeMeters: null,
    altitudeAccuracyMeters: null,
    headingDegrees: null,
    speedMetersPerSec: null,
    speedKmh: null,
    updatedAt: null,
  };

  private gyro: GyroscopeTelemetry = {
    supported: false,
    permission: "prompt",
    alphaDeg: null,
    betaDeg: null,
    gammaDeg: null,
    absolute: null,
    compassHeadingDeg: null,
    updatedAt: null,
  };

  private accel: AccelerometerTelemetry = {
    supported: false,
    ax: null,
    ay: null,
    az: null,
    gx: null,
    gy: null,
    gz: null,
    rotAlpha: null,
    rotBeta: null,
    rotGamma: null,
    updatedAt: null,
  };

  private battery: BatteryTelemetry = {
    supported: false,
    levelPercent: null,
    charging: null,
    chargingTimeSec: null,
    dischargingTimeSec: null,
  };

  private network: NetworkTelemetry = {
    online: true,
    effectiveType: null,
    type: null,
    downlinkMbps: null,
    rttMs: null,
    saveData: null,
  };

  private ambientLightLux: number | null = null;
  private lightSensor: AmbientLightSensorLike | null = null;
  private storageUsageMB: number | null = null;
  private storageQuotaMB: number | null = null;

  private onVideoFrame: ((jpegBase64: string) => void) | null = null;
  private onFramePulse: (() => void) | null = null;
  private getMicLevel: () => number = () => 0;

  private boundOrientationHandler: ((e: DeviceOrientationEvent) => void) | null = null;
  private boundMotionHandler: ((e: DeviceMotionEvent) => void) | null = null;
  private boundDeviceChangeHandler: (() => void) | null = null;
  private boundOnlineHandler: (() => void) | null = null;

  public configure(opts: {
    onVideoFrame: (jpegBase64: string) => void;
    onFramePulse?: () => void;
    getMicLevel: () => number;
  }) {
    this.onVideoFrame = opts.onVideoFrame;
    this.onFramePulse = opts.onFramePulse || null;
    this.getMicLevel = opts.getMicLevel;
  }

  public setActiveMicId(id: string | null) {
    this.activeMicId = id;
    this.microphones = this.microphones.map((m) => ({
      ...m,
      active: m.deviceId === id,
    }));
  }

  /**
   * Requests iOS 13+ gyroscope/accelerometer permissions inside the user tap gesture.
   * Must be called before unrelated async awaits so Safari honors the gesture.
   */
  public requestMotionPermissionsInGesture(): Promise<void> {
    if (typeof window === "undefined") return Promise.resolve();

    const tasks: Array<Promise<unknown>> = [];

    const DevOrient = window.DeviceOrientationEvent as unknown as {
      requestPermission?: () => Promise<"granted" | "denied">;
    };
    if (typeof DevOrient?.requestPermission === "function") {
      tasks.push(
        DevOrient.requestPermission()
          .then((res) => {
            this.gyro.permission = res;
          })
          .catch(() => {
            this.gyro.permission = "denied";
          })
      );
    }

    const DevMotion = window.DeviceMotionEvent as unknown as {
      requestPermission?: () => Promise<"granted" | "denied">;
    };
    if (typeof DevMotion?.requestPermission === "function") {
      tasks.push(
        DevMotion.requestPermission().catch(() => {})
      );
    }

    return Promise.all(tasks).then(() => {});
  }

  public async startAllSensors(): Promise<void> {
    this.startGyroAndMotion();
    this.startGps();
    this.startBattery();
    this.startNetwork();
    this.startAmbientLight();
    void this.refreshStorageEstimate();

    // Start primary camera if permitted (fail-safe if no camera or user denies)
    await this.startCamera().catch(() => {});
    await this.refreshMediaDevices();

    if (navigator.mediaDevices && !this.boundDeviceChangeHandler) {
      this.boundDeviceChangeHandler = () => {
        void this.refreshMediaDevices();
      };
      navigator.mediaDevices.addEventListener(
        "devicechange",
        this.boundDeviceChangeHandler
      );
    }

    this.startFrameLoop();
  }

  public async refreshMediaDevices(): Promise<{
    cameras: MediaDeviceSummary[];
    microphones: MediaDeviceSummary[];
  }> {
    if (!navigator.mediaDevices?.enumerateDevices) {
      return { cameras: [], microphones: [] };
    }
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoInputs = devices.filter((d) => d.kind === "videoinput");
      const audioInputs = devices.filter((d) => d.kind === "audioinput");

      this.cameras = videoInputs.map((d, index) => {
        const label = d.label || `Camera ${index + 1}`;
        return {
          index,
          deviceId: d.deviceId,
          label,
          facing: inferFacing(label),
          active: !this.cameraPaused && d.deviceId === this.activeCameraId,
        };
      });

      this.microphones = audioInputs.map((d, index) => ({
        index,
        deviceId: d.deviceId,
        label: d.label || `Microphone ${index + 1}`,
        active: d.deviceId === this.activeMicId,
      }));
    } catch {
      // Ignore enumeration errors
    }

    return { cameras: this.cameras, microphones: this.microphones };
  }

  private ensureCaptureElements() {
    if (!this.videoEl) {
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.autoplay = true;
      this.videoEl = video;
    }
    if (!this.captureCanvas) {
      this.captureCanvas = document.createElement("canvas");
    }
  }

  private async attachStreamToVideo(stream: MediaStream): Promise<void> {
    this.ensureCaptureElements();
    const video = this.videoEl!;
    video.srcObject = stream;
    try {
      await video.play();
    } catch {
      // Autoplay might wait a tick
    }
  }

  public async startCamera(opts?: {
    deviceId?: string;
    facingMode?: "user" | "environment";
  }): Promise<boolean> {
    if (!navigator.mediaDevices?.getUserMedia) return false;
    this.stopCameraOnly();

    const videoConstraint: MediaTrackConstraints = {
      width: { ideal: 640 },
      height: { ideal: 480 },
    };

    if (opts?.deviceId) {
      videoConstraint.deviceId = { exact: opts.deviceId };
    } else if (opts?.facingMode) {
      videoConstraint.facingMode = { ideal: opts.facingMode };
    } else {
      videoConstraint.facingMode = { ideal: "user" };
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: videoConstraint,
        audio: false,
      });
    } catch {
      // Fallback to unconstrained default camera
      stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false,
      });
    }

    this.cameraStream = stream;
    this.cameraPaused = false;
    this.torchOn = false;
    const track = stream.getVideoTracks()[0];
    this.activeCameraId = track?.getSettings().deviceId || opts?.deviceId || null;

    if (!this.screenStream) {
      await this.attachStreamToVideo(stream);
    }
    await this.refreshMediaDevices();
    return true;
  }

  public async switchCamera(target: string): Promise<Record<string, unknown>> {
    const normalized = target.trim().toLowerCase();

    if (normalized === "off" || normalized === "stop" || normalized === "pause") {
      this.stopCameraOnly();
      this.cameraPaused = true;
      await this.refreshMediaDevices();
      return { ok: true, cameraActive: false, message: "Camera feed paused." };
    }

    if (this.screenStream) {
      this.stopScreenShare();
    }

    await this.refreshMediaDevices();

    if (normalized === "front" || normalized === "user" || normalized === "selfie") {
      const match = this.cameras.find((c) => c.facing === "front");
      const ok = await this.startCamera(
        match ? { deviceId: match.deviceId } : { facingMode: "user" }
      ).catch(() => false);
      return {
        ok,
        activeCamera: this.cameras.find((c) => c.active)?.label || "Front camera",
        cameras: this.cameras,
      };
    }

    if (normalized === "back" || normalized === "rear" || normalized === "environment") {
      const match = this.cameras.find((c) => c.facing === "back");
      const ok = await this.startCamera(
        match ? { deviceId: match.deviceId } : { facingMode: "environment" }
      ).catch(() => false);
      return {
        ok,
        activeCamera: this.cameras.find((c) => c.active)?.label || "Rear camera",
        cameras: this.cameras,
      };
    }

    if (normalized === "next") {
      if (this.cameras.length <= 1) {
        return {
          ok: false,
          message: `Only ${this.cameras.length} camera detected on this device.`,
          cameras: this.cameras,
        };
      }
      const curIdx = this.cameras.findIndex((c) => c.deviceId === this.activeCameraId);
      const next = this.cameras[(curIdx + 1) % this.cameras.length];
      const ok = await this.startCamera({ deviceId: next.deviceId }).catch(() => false);
      return { ok, activeCamera: next.label, cameras: this.cameras };
    }

    const idx = Number(normalized);
    if (Number.isInteger(idx) && idx >= 0 && idx < this.cameras.length) {
      const chosen = this.cameras[idx];
      const ok = await this.startCamera({ deviceId: chosen.deviceId }).catch(() => false);
      return { ok, activeCamera: chosen.label, cameras: this.cameras };
    }

    const byLabel = this.cameras.find((c) =>
      c.label.toLowerCase().includes(normalized)
    );
    if (byLabel) {
      const ok = await this.startCamera({ deviceId: byLabel.deviceId }).catch(() => false);
      return { ok, activeCamera: byLabel.label, cameras: this.cameras };
    }

    const ok = await this.startCamera().catch(() => false);
    return {
      ok,
      activeCamera: this.cameras.find((c) => c.active)?.label || "Default camera",
      cameras: this.cameras,
    };
  }

  /**
   * Sequentially captures a fresh frame from every detected camera on the device
   * and streams them into Gemini Live, then restores the previously active camera.
   */
  public async inspectAllCameras(): Promise<Record<string, unknown>> {
    await this.refreshMediaDevices();
    if (this.cameras.length === 0) {
      return { ok: false, message: "No cameras detected or camera permission was denied." };
    }

    const previousId = this.activeCameraId;
    const wasPaused = this.cameraPaused;
    const inspected: Array<{ index: number; label: string; captured: boolean }> = [];

    for (const cam of this.cameras) {
      try {
        const started = await this.startCamera({ deviceId: cam.deviceId });
        if (started) {
          // Give camera auto-exposure a brief moment to settle
          await new Promise((r) => setTimeout(r, 450));
          const frame = this.captureCurrentFrame();
          if (frame && this.onVideoFrame) {
            this.onVideoFrame(frame);
            this.onFramePulse?.();
            inspected.push({ index: cam.index, label: cam.label, captured: true });
          } else {
            inspected.push({ index: cam.index, label: cam.label, captured: false });
          }
        }
      } catch {
        inspected.push({ index: cam.index, label: cam.label, captured: false });
      }
    }

    // Restore prior camera state
    if (wasPaused) {
      this.stopCameraOnly();
      this.cameraPaused = true;
    } else if (previousId && previousId !== this.activeCameraId) {
      await this.startCamera({ deviceId: previousId }).catch(() => {});
    }

    return {
      ok: true,
      camerasInspected: inspected,
      note: "Fresh frames from each camera have been streamed into your live visual feed in order.",
    };
  }

  public async setTorch(enabled: boolean): Promise<Record<string, unknown>> {
    const track = this.cameraStream?.getVideoTracks()[0];
    if (!track) {
      return { ok: false, message: "No active camera stream for torch control." };
    }

    try {
      const capabilities =
        typeof track.getCapabilities === "function"
          ? (track.getCapabilities() as MediaTrackCapabilities & {
              torch?: boolean;
            })
          : {};
      if (!capabilities.torch) {
        return {
          ok: false,
          message: "Current camera does not support hardware torch control. Try switching to the rear camera.",
        };
      }
      await track.applyConstraints({
        advanced: [{ torch: enabled } as MediaTrackConstraintSet],
      });
      this.torchOn = enabled;
      return { ok: true, torchOn: enabled };
    } catch {
      return {
        ok: false,
        message: "Hardware torch constraint was rejected by the device.",
      };
    }
  }

  public async setScreenShare(enabled: boolean): Promise<Record<string, unknown>> {
    if (!enabled) {
      this.stopScreenShare();
      if (this.cameraStream) {
        await this.attachStreamToVideo(this.cameraStream);
      }
      return { ok: true, screenShareActive: false };
    }

    if (!navigator.mediaDevices?.getDisplayMedia) {
      return { ok: false, message: "Screen sharing is not supported in this browser." };
    }

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 2 },
        audio: false,
      });
      this.screenStream = stream;
      const track = stream.getVideoTracks()[0];
      if (track) {
        track.onended = () => {
          this.screenStream = null;
          if (this.cameraStream) {
            void this.attachStreamToVideo(this.cameraStream);
          }
        };
      }
      await this.attachStreamToVideo(stream);
      return { ok: true, screenShareActive: true };
    } catch {
      return { ok: false, message: "Screen sharing permission was cancelled or denied." };
    }
  }

  public resolveMicrophoneTarget(target: string): MediaDeviceSummary | null {
    const normalized = target.trim().toLowerCase();
    if (this.microphones.length === 0) return null;

    if (normalized === "next") {
      const curIdx = this.microphones.findIndex(
        (m) => m.deviceId === this.activeMicId
      );
      return this.microphones[(curIdx + 1) % this.microphones.length];
    }

    const idx = Number(normalized);
    if (Number.isInteger(idx) && idx >= 0 && idx < this.microphones.length) {
      return this.microphones[idx];
    }

    return (
      this.microphones.find((m) =>
        m.label.toLowerCase().includes(normalized)
      ) || null
    );
  }

  public captureCurrentFrame(): string | null {
    const video = this.videoEl;
    const canvas = this.captureCanvas;
    if (!video || !canvas) return null;
    if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) {
      return null;
    }

    const maxDim = 640;
    const scale = Math.min(1, maxDim / Math.max(video.videoWidth, video.videoHeight));
    const w = Math.max(1, Math.round(video.videoWidth * scale));
    const h = Math.max(1, Math.round(video.videoHeight * scale));
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;

    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, w, h);

    const dataUrl = canvas.toDataURL("image/jpeg", 0.68);
    const commaIdx = dataUrl.indexOf(",");
    return commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : null;
  }

  private startFrameLoop() {
    if (this.frameInterval) clearInterval(this.frameInterval);
    this.frameInterval = setInterval(() => {
      if (!this.onVideoFrame) return;
      if (!this.screenStream && (this.cameraPaused || !this.cameraStream)) return;
      const frame = this.captureCurrentFrame();
      if (frame) {
        this.onVideoFrame(frame);
        this.onFramePulse?.();
      }
    }, 1000);
  }

  private startGyroAndMotion() {
    if (typeof window === "undefined") return;

    if ("DeviceOrientationEvent" in window) {
      this.gyro.supported = true;
      if (this.gyro.permission === "prompt") {
        this.gyro.permission = "granted";
      }

      this.boundOrientationHandler = (event: DeviceOrientationEvent) => {
        const webkitHeading = (
          event as DeviceOrientationEvent & { webkitCompassHeading?: number }
        ).webkitCompassHeading;

        this.gyro = {
          supported: true,
          permission: "granted",
          alphaDeg: round(event.alpha, 1),
          betaDeg: round(event.beta, 1),
          gammaDeg: round(event.gamma, 1),
          absolute: event.absolute,
          compassHeadingDeg:
            typeof webkitHeading === "number"
              ? round(webkitHeading, 1)
              : event.alpha !== null
                ? round((360 - event.alpha) % 360, 1)
                : null,
          updatedAt: new Date().toISOString(),
        };
      };
      window.addEventListener("deviceorientation", this.boundOrientationHandler);
    } else {
      this.gyro.permission = "unsupported";
    }

    if ("DeviceMotionEvent" in window) {
      this.accel.supported = true;
      this.boundMotionHandler = (event: DeviceMotionEvent) => {
        this.accel = {
          supported: true,
          ax: round(event.acceleration?.x, 2),
          ay: round(event.acceleration?.y, 2),
          az: round(event.acceleration?.z, 2),
          gx: round(event.accelerationIncludingGravity?.x, 2),
          gy: round(event.accelerationIncludingGravity?.y, 2),
          gz: round(event.accelerationIncludingGravity?.z, 2),
          rotAlpha: round(event.rotationRate?.alpha, 1),
          rotBeta: round(event.rotationRate?.beta, 1),
          rotGamma: round(event.rotationRate?.gamma, 1),
          updatedAt: new Date().toISOString(),
        };
      };
      window.addEventListener("devicemotion", this.boundMotionHandler);
    }
  }

  private startGps() {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      this.gps.permission = "unsupported";
      return;
    }

    try {
      this.gpsWatchId = navigator.geolocation.watchPosition(
        (pos) => {
          const speed = pos.coords.speed;
          this.gps = {
            permission: "granted",
            latitude: round(pos.coords.latitude, 6),
            longitude: round(pos.coords.longitude, 6),
            accuracyMeters: round(pos.coords.accuracy, 1),
            altitudeMeters: round(pos.coords.altitude, 1),
            altitudeAccuracyMeters: round(pos.coords.altitudeAccuracy, 1),
            headingDegrees: round(pos.coords.heading, 1),
            speedMetersPerSec: round(speed, 2),
            speedKmh: typeof speed === "number" ? round(speed * 3.6, 1) : null,
            updatedAt: new Date(pos.timestamp).toISOString(),
          };
        },
        (err) => {
          this.gps.permission = err.code === 1 ? "denied" : "prompt";
          this.gps.error = err.message;
        },
        {
          enableHighAccuracy: true,
          maximumAge: 5000,
          timeout: 15000,
        }
      );
    } catch {
      this.gps.permission = "denied";
    }
  }

  private startBattery() {
    const nav = navigator as Navigator & {
      getBattery?: () => Promise<BatteryManagerLike>;
    };
    if (typeof nav.getBattery !== "function") return;

    nav
      .getBattery()
      .then((bat) => {
        const sync = () => {
          this.battery = {
            supported: true,
            levelPercent: Math.round(bat.level * 100),
            charging: bat.charging,
            chargingTimeSec: Number.isFinite(bat.chargingTime)
              ? bat.chargingTime
              : null,
            dischargingTimeSec: Number.isFinite(bat.dischargingTime)
              ? bat.dischargingTime
              : null,
          };
        };
        sync();
        bat.addEventListener("levelchange", sync);
        bat.addEventListener("chargingchange", sync);
      })
      .catch(() => {});
  }

  private startNetwork() {
    const sync = () => {
      const conn = (
        navigator as Navigator & { connection?: NetworkInformationLike }
      ).connection;
      this.network = {
        online: navigator.onLine,
        effectiveType: conn?.effectiveType || null,
        type: conn?.type || null,
        downlinkMbps: typeof conn?.downlink === "number" ? conn.downlink : null,
        rttMs: typeof conn?.rtt === "number" ? conn.rtt : null,
        saveData: typeof conn?.saveData === "boolean" ? conn.saveData : null,
      };
    };
    sync();
    this.boundOnlineHandler = sync;
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
  }

  private startAmbientLight() {
    const SensorCtor = (
      window as unknown as {
        AmbientLightSensor?: new () => AmbientLightSensorLike;
      }
    ).AmbientLightSensor;
    if (!SensorCtor) return;

    try {
      const sensor = new SensorCtor();
      sensor.onreading = () => {
        if (typeof sensor.illuminance === "number") {
          this.ambientLightLux = round(sensor.illuminance, 1);
        }
      };
      sensor.onerror = () => {};
      sensor.start();
      this.lightSensor = sensor;
    } catch {
      // Blocked by permissions policy or unsupported
    }
  }

  private async refreshStorageEstimate() {
    if (!navigator.storage?.estimate) return;
    try {
      const est = await navigator.storage.estimate();
      this.storageUsageMB =
        typeof est.usage === "number" ? round(est.usage / (1024 * 1024), 1) : null;
      this.storageQuotaMB =
        typeof est.quota === "number" ? round(est.quota / (1024 * 1024), 1) : null;
    } catch {
      // Ignore
    }
  }

  public getParallaxTilt(): { x: number; y: number } {
    const gx = this.gyro.gammaDeg ?? 0;
    const by = (this.gyro.betaDeg ?? 45) - 45;
    return {
      x: Math.max(-1, Math.min(1, gx / 45)),
      y: Math.max(-1, Math.min(1, by / 45)),
    };
  }

  public async readClipboard(): Promise<Record<string, unknown>> {
    if (!navigator.clipboard?.readText) {
      return { ok: false, message: "Clipboard reading is not supported in this browser." };
    }
    try {
      const text = await navigator.clipboard.readText();
      return { ok: true, text: text.slice(0, 2000) };
    } catch {
      return { ok: false, message: "Clipboard access was denied by the browser." };
    }
  }

  public vibrate(pattern: number | number[] = 35): void {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      try {
        navigator.vibrate(pattern);
      } catch {
        // Ignore
      }
    }
  }

  public getSnapshot(micActive: boolean): FullSensorTelemetry {
    const now = new Date();
    const nav = navigator as Navigator & { deviceMemory?: number };

    return {
      cameras: this.cameras,
      cameraActive: Boolean(this.cameraStream && !this.cameraPaused),
      screenShareActive: Boolean(this.screenStream),
      torchOn: this.torchOn,
      microphones: this.microphones,
      microphoneActive: micActive,
      gps: { ...this.gps },
      gyroscope: { ...this.gyro },
      accelerometer: { ...this.accel },
      battery: { ...this.battery },
      network: { ...this.network, online: navigator.onLine },
      device: {
        localTime: now.toLocaleString(),
        isoTime: now.toISOString(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        language: navigator.language,
        languages: Array.from(navigator.languages || []),
        platform: navigator.platform || "unknown",
        userAgent: navigator.userAgent,
        cpuCores: navigator.hardwareConcurrency || null,
        deviceMemoryGB: nav.deviceMemory ?? null,
        maxTouchPoints: navigator.maxTouchPoints || 0,
        screenWidth: window.screen.width,
        screenHeight: window.screen.height,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio || 1,
        screenOrientation: window.screen.orientation?.type || null,
        screenAngleDeg: window.screen.orientation?.angle ?? null,
        prefersDarkMode: window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? true,
        pageVisible: document.visibilityState === "visible",
        storageUsageMB: this.storageUsageMB,
        storageQuotaMB: this.storageQuotaMB,
        ambientLightLux: this.ambientLightLux,
        ambientMicLevel: round(this.getMicLevel(), 3) ?? 0,
      },
    };
  }

  private stopCameraOnly() {
    if (this.cameraStream) {
      this.cameraStream.getTracks().forEach((t) => t.stop());
      this.cameraStream = null;
    }
    this.torchOn = false;
  }

  private stopScreenShare() {
    if (this.screenStream) {
      this.screenStream.getTracks().forEach((t) => t.stop());
      this.screenStream = null;
    }
  }

  public stopAll(): void {
    if (this.frameInterval) {
      clearInterval(this.frameInterval);
      this.frameInterval = null;
    }
    this.stopCameraOnly();
    this.stopScreenShare();
    if (this.videoEl) {
      this.videoEl.srcObject = null;
    }
    if (this.gpsWatchId !== null && "geolocation" in navigator) {
      navigator.geolocation.clearWatch(this.gpsWatchId);
      this.gpsWatchId = null;
    }
    if (this.boundOrientationHandler) {
      window.removeEventListener("deviceorientation", this.boundOrientationHandler);
      this.boundOrientationHandler = null;
    }
    if (this.boundMotionHandler) {
      window.removeEventListener("devicemotion", this.boundMotionHandler);
      this.boundMotionHandler = null;
    }
    if (this.boundDeviceChangeHandler && navigator.mediaDevices) {
      navigator.mediaDevices.removeEventListener(
        "devicechange",
        this.boundDeviceChangeHandler
      );
      this.boundDeviceChangeHandler = null;
    }
    if (this.boundOnlineHandler) {
      window.removeEventListener("online", this.boundOnlineHandler);
      window.removeEventListener("offline", this.boundOnlineHandler);
      this.boundOnlineHandler = null;
    }
    if (this.lightSensor) {
      try {
        this.lightSensor.stop();
      } catch {
        // Ignore
      }
      this.lightSensor = null;
    }
  }
}
