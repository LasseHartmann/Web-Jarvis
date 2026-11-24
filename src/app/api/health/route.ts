import { connection, NextRequest, NextResponse } from "next/server";
import { isPasscodeRequired, isRequestAuthorized } from "@/lib/auth";
import { DEFAULT_LIVE_VOICE, getServerApiKey } from "@/lib/gemini";

export async function GET(request: NextRequest) {
  await connection();
  return NextResponse.json({
    ok: true,
    apiKeyConfigured: Boolean(getServerApiKey()),
    passcodeRequired: isPasscodeRequired(),
    authenticated: isRequestAuthorized(request),
    voiceName: DEFAULT_LIVE_VOICE,
  });
}
