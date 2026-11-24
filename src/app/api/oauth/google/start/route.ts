import crypto from "crypto";
import { connection, NextRequest, NextResponse } from "next/server";
import { isRequestAuthorized, isSecureRequest } from "@/lib/auth";
import { getGoogleClientCreds, GOOGLE_OAUTH_SCOPES } from "@/lib/integrations/google";

export async function GET(request: NextRequest) {
  await connection();
  if (!isRequestAuthorized(request)) {
    return NextResponse.json(
      { error: "Unlock J.A.R.V.I.S. at / first before authorizing Google Services." },
      { status: 401 }
    );
  }

  const creds = getGoogleClientCreds();
  if (!creds) {
    return NextResponse.json(
      {
        error:
          "Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET in environment variables.",
      },
      { status: 503 }
    );
  }

  const origin = process.env.APP_URL?.trim() || request.nextUrl.origin;
  const redirectUri = `${origin.replace(/\/$/, "")}/api/oauth/google/callback`;
  const state = crypto.randomBytes(16).toString("hex");

  const params = new URLSearchParams({
    client_id: creds.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_OAUTH_SCOPES,
    access_type: "offline",
    prompt: "consent",
    state,
  });

  const res = NextResponse.redirect(
    `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
  );
  res.cookies.set({
    name: "jarvis_google_oauth_state",
    value: state,
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureRequest(request),
    path: "/",
    maxAge: 600,
  });
  return res;
}
