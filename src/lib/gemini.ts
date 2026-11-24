import { GoogleGenAI } from "@google/genai";
import type { PersonaTone, TelemetrySnapshot } from "@/types/jarvis";

export const DEFAULT_CHAT_MODEL =
  process.env.GEMINI_CHAT_MODEL?.trim() || "gemini-2.5-flash";

export const DEFAULT_LIVE_MODEL =
  process.env.GEMINI_LIVE_MODEL?.trim() ||
  "gemini-2.5-flash-native-audio-preview-12-2025";

export const CURATED_MODELS = [
  {
    id: "gemini-2.5-flash",
    label: "Gemini 2.5 Flash (Balanced Default)",
    tier: "flash",
  },
  {
    id: "gemini-3.5-flash-lite",
    label: "Gemini 3.5 Flash-Lite (Ultra Fast)",
    tier: "lite",
  },
  {
    id: "gemini-3.8-flash",
    label: "Gemini 3.8 Flash (High Capacity)",
    tier: "flash",
  },
  {
    id: "gemini-3.1-pro-preview",
    label: "Gemini 3.1 Pro Preview (Deep Reasoning)",
    tier: "pro",
  },
];

export function resolveApiKey(headerKey?: string | null): {
  apiKey: string | null;
  source: "server" | "byok" | "none";
} {
  const custom = headerKey?.trim();
  if (custom) {
    return { apiKey: custom, source: "byok" };
  }
  const serverKey = process.env.GEMINI_API_KEY?.trim();
  if (serverKey && serverKey !== "your_gemini_api_key_here") {
    return { apiKey: serverKey, source: "server" };
  }
  return { apiKey: null, source: "none" };
}

export function createGeminiClient(apiKey: string, apiVersion?: string): GoogleGenAI {
  if (apiVersion) {
    return new GoogleGenAI({
      apiKey,
      httpOptions: { apiVersion },
    });
  }
  return new GoogleGenAI({ apiKey });
}

export function buildJarvisSystemInstruction(
  tone: PersonaTone,
  telemetry?: TelemetrySnapshot
): string {
  const toneDirectives: Record<PersonaTone, string> = {
    classic:
      "Adopt the composed, articulate, dryly witty demeanor of J.A.R.V.I.S. — poised, respectful, lightly British in phrasing, and quietly proactive without ever being verbose or melodramatic.",
    concise:
      "Respond in crisp, tactical J.A.R.V.I.S. telemetry style: ultra-concise, high-signal answers with zero filler, ready for rapid spoken delivery.",
    technical:
      "Act as a principal systems engineer wearing the J.A.R.V.I.S. persona: precise, architectural, deeply analytical, with structured code blocks and concrete trade-offs.",
  };

  const telemetryLines: string[] = [];
  if (telemetry) {
    telemetryLines.push(`- Local time: ${telemetry.localTime} (${telemetry.timeZone})`);
    telemetryLines.push(`- Active HUD theme: ${telemetry.theme}`);
    if (telemetry.activeTimers.length > 0) {
      const timersText = telemetry.activeTimers
        .map((t) => `"${t.label}" (${t.remainingSeconds}s left)`)
        .join(", ");
      telemetryLines.push(`- Active timers: ${timersText}`);
    } else {
      telemetryLines.push("- Active timers: none");
    }

    const openTasks = telemetry.tasks.filter((t) => !t.completed);
    if (openTasks.length > 0) {
      const tasksText = openTasks
        .slice(0, 10)
        .map((t) => `[${t.priority}] ${t.title}`)
        .join("; ");
      telemetryLines.push(`- Open tasks (${openTasks.length}): ${tasksText}`);
    } else {
      telemetryLines.push("- Open tasks: none");
    }

    if (telemetry.notes.length > 0) {
      const notesText = telemetry.notes
        .slice(0, 6)
        .map((n) => `"${n.title}"`)
        .join(", ");
      telemetryLines.push(`- Saved notes (${telemetry.notes.length}): ${notesText}`);
    }
  }

  return [
    "You are J.A.R.V.I.S. (Just A Rather Very Intelligent System), the user's personal holographic AI command interface.",
    toneDirectives[tone] || toneDirectives.classic,
    "",
    "Operational guidelines:",
    "- Be genuinely helpful, direct, and accurate. Use clean Markdown (headings, bullet lists, fenced code blocks) when it aids readability, while keeping conversational answers crisp so they sound natural when read aloud.",
    "- You have interactive HUD tools (`start_timer`, `cancel_timer`, `add_task`, `complete_task`, `save_note`, `set_hud_theme`, `clear_console`). Invoke them whenever the user asks to set timers, manage tasks/notes, change the HUD theme, or clear the console.",
    "- Never fabricate real-time sensor readings (CPU temperature, home lights, etc.) as if you had hardware access; be transparent about what is live telemetry vs. simulated.",
    telemetryLines.length > 0
      ? `\nLive HUD Telemetry Snapshot:\n${telemetryLines.join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}
