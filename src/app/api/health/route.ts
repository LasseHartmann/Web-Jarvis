import { NextRequest, NextResponse } from "next/server";
import { isPasscodeRequired, isRequestAuthorized } from "@/lib/auth";
import {
  DEFAULT_CHAT_MODEL,
  DEFAULT_LIVE_MODEL,
  resolveApiKey,
} from "@/lib/gemini";
import type { SystemHealth } from "@/types/jarvis";

export async function GET(request: NextRequest) {
  const { source } = resolveApiKey(request.headers.get("x-gemini-api-key"));
  const health: SystemHealth = {
    ok: true,
    apiKeyConfigured: source !== "none",
    passcodeRequired: isPasscodeRequired(),
    authenticated: isRequestAuthorized(request),
    defaultChatModel: DEFAULT_CHAT_MODEL,
    defaultLiveModel: DEFAULT_LIVE_MODEL,
  };
  return NextResponse.json(health);
}
