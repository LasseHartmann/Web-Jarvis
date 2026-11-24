import { createGeminiClient, getServerApiKey } from "@/lib/gemini";

const PREFERRED_THINK_MODELS = [
  "gemini-3.1-pro-preview",
  "gemini-2.5-pro",
  "gemini-3.8-flash",
  "gemini-2.5-flash",
];

let cachedThinkModel: { id: string; fetchedAt: number } | null = null;

async function resolveThinkModel(apiKey: string): Promise<string> {
  const explicit = process.env.GEMINI_THINK_MODEL?.trim();
  if (explicit) return explicit;

  if (
    cachedThinkModel &&
    Date.now() - cachedThinkModel.fetchedAt < 10 * 60 * 1000
  ) {
    return cachedThinkModel.id;
  }

  try {
    const ai = createGeminiClient(apiKey);
    const pager = await ai.models.list({ config: { pageSize: 100 } });
    const ids: string[] = [];
    for await (const m of pager) {
      const id = (m.name || "").replace(/^models\//, "");
      if (id.startsWith("gemini-")) ids.push(id);
    }
    for (const candidate of PREFERRED_THINK_MODELS) {
      if (ids.includes(candidate)) {
        cachedThinkModel = { id: candidate, fetchedAt: Date.now() };
        return candidate;
      }
    }
    const pro = ids.find((id) => /pro/i.test(id) && !/embedding|vision/i.test(id));
    if (pro) {
      cachedThinkModel = { id: pro, fetchedAt: Date.now() };
      return pro;
    }
  } catch {
    // Fallback
  }

  return PREFERRED_THINK_MODELS[0];
}

/**
 * Escalates complex reasoning, architecture, math, or multi-step web research
 * from real-time Gemini Live to a flagship Gemini Pro model with Google Search grounding.
 */
export async function runDeepThink(args: {
  question: string;
  context?: string;
}): Promise<Record<string, unknown>> {
  const apiKey = getServerApiKey();
  if (!apiKey) {
    return { ok: false, error: "GEMINI_API_KEY is not configured." };
  }

  const prompt = args.question?.trim();
  if (!prompt) {
    return { ok: false, error: "A question is required for deep analysis." };
  }

  const model = await resolveThinkModel(apiKey);
  const ai = createGeminiClient(apiKey);

  const fullPrompt = args.context?.trim()
    ? `Additional context:\n${args.context.trim()}\n\nRequest:\n${prompt}`
    : prompt;

  try {
    const response = await ai.models.generateContent({
      model,
      contents: fullPrompt,
      config: {
        systemInstruction:
          "You are J.A.R.V.I.S.'s deep analytical reasoning subsystem. Think carefully and return a clear, accurate, concise synthesis optimized to be spoken aloud cleanly in 2 to 5 sentences unless detailed numbers/steps are essential. Avoid markdown symbols.",
        tools: [{ googleSearch: {} }],
      },
    });

    return {
      ok: true,
      model,
      analysis: response.text || "No output produced.",
    };
  } catch {
    // Fallback without search if model rejects search tool
    try {
      const response = await ai.models.generateContent({
        model,
        contents: fullPrompt,
        config: {
          systemInstruction:
            "You are J.A.R.V.I.S.'s deep analytical reasoning subsystem. Return a concise, accurate synthesis ready to be spoken aloud cleanly without markdown.",
        },
      });
      return {
        ok: true,
        model,
        analysis: response.text || "No output produced.",
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "Deep analysis failed.",
      };
    }
  }
}
