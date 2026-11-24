import crypto from "crypto";
import { connection, NextRequest, NextResponse } from "next/server";
import { isRequestAuthorized, isSecureRequest } from "@/lib/auth";
import { getSpotifyClientCreds, SPOTIFY_SCOPES } from "@/lib/integrations/spotify";

export async function GET(request: NextRequest) {
  await connection();
  if (!isRequestAuthorized(request)) {
    return NextResponse.json(
      { error: "Unlock J.A.R.V.I.S. at / first before authorizing Spotify." },
      { status: 401 }
    );
  }

  const creds = getSpotifyClientCreds();
  if (!creds) {
    return NextResponse.json(
      {
        error:
          "Missing SPOTIFY_CLIENT_ID or SPOTIFY_CLIENT_SECRET in environment variables.",
      },
      { status: 503 }
    );
  }

  const origin = process.env.APP_URL?.trim() || request.nextUrl.origin;
  const redirectUri = `${origin.replace(/\/$/, "")}/api/oauth/spotify/callback`;
  const state = crypto.randomBytes(16).toString("hex");

  const params = new URLSearchParams({
    response_type: "code",
    client_id: creds.clientId,
    scope: SPOTIFY_SCOPES,
    redirect_uri: redirectUri,
    state,
    show_dialog: "true",
  });

  const res = NextResponse.redirect(
    `https://accounts.spotify.com/authorize?${params.toString()}`
  );
  res.cookies.set({
    name: "jarvis_spotify_oauth_state",
    value: state,
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureRequest(request),
    path: "/",
    maxAge: 600,
  });
  return res;
}
