export type HudTheme = "arc-cyan" | "amber-alert" | "stealth-emerald";

export type JarvisStatus =
  | "standby"
  | "listening"
  | "thinking"
  | "speaking"
  | "tool_active"
  | "error";

export type PersonaTone = "classic" | "concise" | "technical";

export interface ImageAttachment {
  id: string;
  name: string;
  mimeType: string;
  dataBase64: string;
}

export interface GroundingSource {
  title: string;
  uri: string;
}

export interface ToolActionEvent {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: "executed" | "failed";
  summary: string;
  timestamp: number;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  attachments?: ImageAttachment[];
  sources?: GroundingSource[];
  toolActions?: ToolActionEvent[];
  model?: string;
  isStreaming?: boolean;
  error?: string;
}

export interface ChatThread {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
}

export interface JarvisTimer {
  id: string;
  label: string;
  durationSeconds: number;
  endsAt: number;
  createdAt: number;
  completed?: boolean;
}

export interface JarvisTask {
  id: string;
  title: string;
  priority: "low" | "normal" | "high";
  completed: boolean;
  createdAt: number;
}

export interface JarvisNote {
  id: string;
  title: string;
  body: string;
  createdAt: number;
  updatedAt: number;
}

export interface TelemetrySnapshot {
  localTime: string;
  timeZone: string;
  theme: HudTheme;
  activeTimers: Array<{ id: string; label: string; remainingSeconds: number }>;
  tasks: Array<{ id: string; title: string; priority: string; completed: boolean }>;
  notes: Array<{ id: string; title: string; bodyPreview: string }>;
}

export interface JarvisSettings {
  theme: HudTheme;
  tone: PersonaTone;
  model: string;
  voiceEnabled: boolean;
  voiceName: string;
  speechRate: number;
  searchGrounding: boolean;
  soundEffects: boolean;
  customApiKey: string;
}

export interface PendingToolResult {
  name: string;
  args: Record<string, unknown>;
  result: Record<string, unknown>;
}

export type StreamEvent =
  | { type: "meta"; model: string }
  | { type: "text"; delta: string }
  | {
      type: "tool_call";
      call: { id?: string; name: string; args: Record<string, unknown> };
    }
  | { type: "sources"; sources: GroundingSource[] }
  | { type: "error"; message: string }
  | { type: "done" };

export interface SystemHealth {
  ok: boolean;
  apiKeyConfigured: boolean;
  passcodeRequired: boolean;
  authenticated: boolean;
  defaultChatModel: string;
  defaultLiveModel: string;
}
