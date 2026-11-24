import { NextRequest, NextResponse } from "next/server";
import { Modality, type LiveConnectConfig } from "@google/genai";
import { checkRateLimit, getClientIp, isRequestAuthorized } from "@/lib/auth";
import {
  DEFAULT_LIVE_VOICE,
  createGeminiClient,
  getServerApiKey,
  resolveLiveModel,
} from "@/lib/gemini";
import {
  JARVIS_LIVE_FUNCTION_DECLARATIONS,
  JARVIS_LIVE_SYSTEM_INSTRUCTION,
} from "@/lib/tools";
import type { LiveTokenResponse } from "@/types/jarvis";

/**
 * Mints a single-use, time-bounded ephemeral token for direct browser-to-Gemini
 * Live API WebSocket audio/video streaming. Keeps GEMINI_API_KEY strictly on
 * the server and avoids Vercel serverless function duration limits.
 */
export async function POST(request: NextRequest) {
  if (!isRequestAuthorized(request)) {
    return NextResponse.json(
      { error: "Security clearance required." },
      { status: 401 }
    );
  }

  const ip = getClientIp(request);
  const rate = checkRateLimit(`live-token:${ip}`, 20, 60 * 1000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: `Rate limit exceeded. Retry in ${rate.retryAfterSeconds}s.` },
      {
        status: 429,
        headers: { "Retry-After": String(rate.retryAfterSeconds) },
      }
    );
  }

  const apiKey = getServerApiKey();
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "GEMINI_API_KEY is missing. Set GEMINI_API_KEY in .env.local or Vercel Environment Variables.",
      },
      { status: 503 }
    );
  }

  const model = await resolveLiveModel(apiKey);
  const expireTime = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const newSessionExpireTime = new Date(Date.now() + 2 * 60 * 1000).toISOString();

  const buildLiveConfig = (includeSearch: boolean): LiveConnectConfig => ({
    responseModalities: [Modality.AUDIO],
    speechConfig: {
      voiceConfig: {
        prebuiltVoiceConfig: {
          voiceName: DEFAULT_LIVE_VOICE,
        },
      },
    },
    systemInstruction: {
      parts: [{ text: JARVIS_LIVE_SYSTEM_INSTRUCTION }],
    },
    tools: includeSearch
      ? [
          { googleSearch: {} },
          { functionDeclarations: JARVIS_LIVE_FUNCTION_DECLARATIONS },
        ]
      : [{ functionDeclarations: JARVIS_LIVE_FUNCTION_DECLARATIONS }],
  });

  const attempts: Array<{
    apiVersion: "v1alpha" | "v1beta";
    includeSearch: boolean;
  }> = [
    { apiVersion: "v1alpha", includeSearch: true },
    { apiVersion: "v1alpha", includeSearch: false },
    { apiVersion: "v1beta", includeSearch: true },
    { apiVersion: "v1beta", includeSearch: false },
  ];

  let lastError = "Unable to mint Gemini Live API ephemeral token.";

  for (const attempt of attempts) {
    try {
      const ai = createGeminiClient(apiKey, attempt.apiVersion);
      const token = await ai.authTokens.create({
        config: {
          uses: 1,
          expireTime,
          newSessionExpireTime,
          liveConnectConstraints: {
            model,
            config: buildLiveConfig(attempt.includeSearch),
          },
        },
      });

      if (token.name) {
        const payload: LiveTokenResponse = {
          token: token.name,
          model,
          apiVersion: attempt.apiVersion,
          voiceName: DEFAULT_LIVE_VOICE,
          includeSearch: attempt.includeSearch,
          expiresAt: expireTime,
        };
        return NextResponse.json(payload);
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  return NextResponse.json({ error: lastError }, { status: 502 });
}
