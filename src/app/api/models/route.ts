import { NextRequest, NextResponse } from "next/server";
import { isRequestAuthorized } from "@/lib/auth";
import {
  CURATED_MODELS,
  DEFAULT_CHAT_MODEL,
  createGeminiClient,
  resolveApiKey,
} from "@/lib/gemini";

export async function GET(request: NextRequest) {
  if (!isRequestAuthorized(request)) {
    return NextResponse.json({ error: "Security clearance required." }, { status: 401 });
  }

  const { apiKey } = resolveApiKey(request.headers.get("x-gemini-api-key"));
  if (!apiKey) {
    return NextResponse.json({
      defaultModel: DEFAULT_CHAT_MODEL,
      models: CURATED_MODELS,
      liveDiscovered: false,
    });
  }

  try {
    const ai = createGeminiClient(apiKey);
    const pager = await ai.models.list({ config: { pageSize: 50 } });
    const discovered: Array<{ id: string; label: string; tier: string }> = [];

    for await (const model of pager) {
      const rawName = model.name || "";
      const id = rawName.replace(/^models\//, "");
      if (!id.startsWith("gemini-")) continue;
      if (id.includes("embedding") || id.includes("tts") || id.includes("imagen")) {
        continue;
      }
      discovered.push({
        id,
        label: model.displayName ? `${model.displayName} (${id})` : id,
        tier: id.includes("pro") ? "pro" : id.includes("lite") ? "lite" : "flash",
      });
      if (discovered.length >= 25) break;
    }

    const seen = new Set(discovered.map((m) => m.id));
    const merged = [
      ...discovered,
      ...CURATED_MODELS.filter((m) => !seen.has(m.id)),
    ];

    return NextResponse.json({
      defaultModel: DEFAULT_CHAT_MODEL,
      models: merged,
      liveDiscovered: discovered.length > 0,
    });
  } catch {
    return NextResponse.json({
      defaultModel: DEFAULT_CHAT_MODEL,
      models: CURATED_MODELS,
      liveDiscovered: false,
    });
  }
}
