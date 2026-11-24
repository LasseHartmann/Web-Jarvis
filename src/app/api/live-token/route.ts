import { NextRequest, NextResponse } from "next/server";
import { Modality } from "@google/genai";
import { checkRateLimit, getClientIp, isRequestAuthorized } from "@/lib/auth";
import {
  DEFAULT_LIVE_MODEL,
  createGeminiClient,
  resolveApiKey,
} from "@/lib/gemini";

/**
 * Phase 2 foundation: mints a single-use, time-bounded ephemeral token for
 * direct browser-to-Gemini Live API WebSocket voice sessions without exposing
 * GEMINI_API_KEY or hitting Vercel serverless duration limits.
 */
export async function POST(request: NextRequest) {
  if (!isRequestAuthorized(request)) {
    return NextResponse.json(
      { error: "Security clearance required." },
      { status: 401 }
    );
  }

  const ip = getClientIp(request);
  const rate = checkRateLimit(`live-token:${ip}`, 10, 60 * 1000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: `Rate limit exceeded. Retry in ${rate.retryAfterSeconds}s.` },
      {
        status: 429,
        headers: { "Retry-After": String(rate.retryAfterSeconds) },
      }
    );
  }

  const { apiKey } = resolveApiKey(request.headers.get("x-gemini-api-key"));
  if (!apiKey) {
    return NextResponse.json(
      { error: "GEMINI_API_KEY is not configured on the server." },
      { status: 503 }
    );
  }

  try {
    const ai = createGeminiClient(apiKey, "v1alpha");
    const expireTime = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const newSessionExpireTime = new Date(Date.now() + 60 * 1000).toISOString();

    const token = await ai.authTokens.create({
      config: {
        uses: 1,
        expireTime,
        newSessionExpireTime,
        liveConnectConstraints: {
          model: DEFAULT_LIVE_MODEL,
          config: {
            responseModalities: [Modality.AUDIO],
          },
        },
      },
    });

    return NextResponse.json({
      token: token.name,
      model: DEFAULT_LIVE_MODEL,
      expiresAt: expireTime,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to mint Live API token.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
