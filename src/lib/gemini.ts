import { GoogleGenAI } from "@google/genai";

export const DEFAULT_LIVE_VOICE =
  process.env.GEMINI_LIVE_VOICE?.trim() || "Charon";

const PREFERRED_LIVE_MODELS = [
  "gemini-2.5-flash-native-audio-preview-12-2025",
  "gemini-3.1-flash-live-preview",
  "gemini-2.5-flash-native-audio",
  "gemini-3.8-live",
  "gemini-2.0-flash-live-001",
];

let cachedModel: { id: string; fetchedAt: number } | null = null;
const MODEL_CACHE_TTL_MS = 10 * 60 * 1000;

export function getServerApiKey(): string | null {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key || key === "your_gemini_api_key_here") return null;
  return key;
}

export function createGeminiClient(
  apiKey: string,
  apiVersion?: "v1alpha" | "v1beta"
): GoogleGenAI {
  if (apiVersion) {
    return new GoogleGenAI({
      apiKey,
      httpOptions: { apiVersion },
    });
  }
  return new GoogleGenAI({ apiKey });
}

export async function resolveLiveModel(apiKey: string): Promise<string> {
  const explicit = process.env.GEMINI_LIVE_MODEL?.trim();
  if (explicit) return explicit;

  if (cachedModel && Date.now() - cachedModel.fetchedAt < MODEL_CACHE_TTL_MS) {
    return cachedModel.id;
  }

  try {
    const ai = createGeminiClient(apiKey);
    const pager = await ai.models.list({ config: { pageSize: 100 } });
    const liveCandidates: string[] = [];

    for await (const model of pager) {
      const id = (model.name || "").replace(/^models\//, "");
      if (!id) continue;
      const actions = model.supportedActions || [];
      const supportsBidi = actions.some((a) =>
        a.toLowerCase().includes("bidigeneratecontent")
      );
      if (
        supportsBidi ||
        /native-audio|flash-live|-live/i.test(id)
      ) {
        liveCandidates.push(id);
      }
    }

    for (const preferred of PREFERRED_LIVE_MODELS) {
      if (liveCandidates.includes(preferred)) {
        cachedModel = { id: preferred, fetchedAt: Date.now() };
        return preferred;
      }
    }

    const nativeAudio = liveCandidates.find((id) =>
      /native-audio|live/i.test(id)
    );
    if (nativeAudio) {
      cachedModel = { id: nativeAudio, fetchedAt: Date.now() };
      return nativeAudio;
    }

    if (liveCandidates[0]) {
      cachedModel = { id: liveCandidates[0], fetchedAt: Date.now() };
      return liveCandidates[0];
    }
  } catch {
    // Fall back to default known Live native-audio model
  }

  return PREFERRED_LIVE_MODELS[0];
}
