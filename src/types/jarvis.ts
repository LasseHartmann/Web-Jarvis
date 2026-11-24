export type CorePalette = "cyan" | "amber" | "emerald" | "crimson" | "violet";

export type VoiceFilterMode = "hud" | "natural";

export type WakeSensitivity = "low" | "medium" | "high";

export type JarvisCoreState =
  | "idle"
  | "arming"
  | "standby"
  | "connecting"
  | "listening"
  | "speaking"
  | "thinking"
  | "error";

export interface MediaDeviceSummary {
  index: number;
  deviceId: string;
  label: string;
  facing?: "front" | "back" | "unknown";
  active: boolean;
}

export interface GpsTelemetry {
  permission: "granted" | "denied" | "prompt" | "unsupported";
  latitude: number | null;
  longitude: number | null;
  accuracyMeters: number | null;
  altitudeMeters: number | null;
  altitudeAccuracyMeters: number | null;
  headingDegrees: number | null;
  speedMetersPerSec: number | null;
  speedKmh: number | null;
  updatedAt: string | null;
  error?: string;
}

export interface GyroscopeTelemetry {
  supported: boolean;
  permission: "granted" | "denied" | "prompt" | "unsupported";
  alphaDeg: number | null; // compass yaw 0-360
  betaDeg: number | null; // pitch -180 to 180
  gammaDeg: number | null; // roll -90 to 90
  absolute: boolean | null;
  compassHeadingDeg: number | null;
  updatedAt: string | null;
}

export interface AccelerometerTelemetry {
  supported: boolean;
  ax: number | null;
  ay: number | null;
  az: number | null;
  gx: number | null;
  gy: number | null;
  gz: number | null;
  rotAlpha: number | null;
  rotBeta: number | null;
  rotGamma: number | null;
  updatedAt: string | null;
}

export interface BatteryTelemetry {
  supported: boolean;
  levelPercent: number | null;
  charging: boolean | null;
  chargingTimeSec: number | null;
  dischargingTimeSec: number | null;
}

export interface NetworkTelemetry {
  online: boolean;
  effectiveType: string | null;
  type: string | null;
  downlinkMbps: number | null;
  rttMs: number | null;
  saveData: boolean | null;
}

export interface DeviceTelemetry {
  localTime: string;
  isoTime: string;
  timeZone: string;
  language: string;
  languages: string[];
  platform: string;
  userAgent: string;
  cpuCores: number | null;
  deviceMemoryGB: number | null;
  maxTouchPoints: number;
  screenWidth: number;
  screenHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  devicePixelRatio: number;
  screenOrientation: string | null;
  screenAngleDeg: number | null;
  prefersDarkMode: boolean;
  pageVisible: boolean;
  storageUsageMB: number | null;
  storageQuotaMB: number | null;
  ambientLightLux: number | null;
  ambientMicLevel: number;
}

export interface FullSensorTelemetry {
  cameras: MediaDeviceSummary[];
  cameraActive: boolean;
  screenShareActive: boolean;
  torchOn: boolean;
  microphones: MediaDeviceSummary[];
  microphoneActive: boolean;
  gps: GpsTelemetry;
  gyroscope: GyroscopeTelemetry;
  accelerometer: AccelerometerTelemetry;
  battery: BatteryTelemetry;
  network: NetworkTelemetry;
  device: DeviceTelemetry;
}

export interface LiveTokenResponse {
  token: string;
  model: string;
  apiVersion: "v1alpha" | "v1beta";
  voiceName: string;
  includeSearch: boolean;
  compressionEnabled: boolean;
  resumptionEnabled: boolean;
  expiresAt: string;
}
