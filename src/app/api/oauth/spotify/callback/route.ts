import { connection, NextRequest, NextResponse } from "next/server";
import { isKvConfigured } from "@/lib/integrations/kv";
import {
  getSpotifyClientCreds,
  saveSpotifyRefreshToken,
} from "@/lib/integrations/spotify";

function htmlPage(title: string, body: string, status = 200) {
  return new NextResponse(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#02050b;color:#e6f4ff;font-family:system-ui,sans-serif;padding:24px}.card{max-width:620px;width:100%;background:rgba(10,22,40,.9);border:1px solid rgba(34,211,238,.35);border-radius:16px;padding:28px;line-height:1.6}code,pre{background:#020612;border:1px solid rgba(34,211,238,.25);border-radius:8px;padding:12px;display:block;overflow-x:auto;color:#67e8f9;font-family:ui-monospace,monospace;font-size:13px;word-break:break-all}a{color:#22d3ee}</style></head><body><div class="card">${body}</div></body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

export async function GET(request: NextRequest) {
  await connection();
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const error = request.nextUrl.searchParams.get("error");
  const expectedState = request.cookies.get("jarvis_spotify_oauth_state")?.value;

  if (error) {
    return htmlPage("Spotify Auth Error", `<h2>Spotify Authorization Cancelled</h2><p>${error}</p><p><a href="/">Return to J.A.R.V.I.S.</a></p>`, 400);
  }
  if (!code || !state || !expectedState || state !== expectedState) {
    return htmlPage("Invalid OAuth State", `<h2>Invalid or Expired Spotify OAuth State</h2><p>Please retry at <a href="/api/oauth/spotify/start">/api/oauth/spotify/start</a>.</p>`, 400);
  }

  const creds = getSpotifyClientCreds();
  if (!creds) {
    return htmlPage("Missing Config", `<h2>Missing Spotify Credentials</h2>`, 503);
  }

  const origin = process.env.APP_URL?.trim() || request.nextUrl.origin;
  const redirectUri = `${origin.replace(/\/$/, "")}/api/oauth/spotify/callback`;
  const basic = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString("base64");

  const tokenRes = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
    cache: "no-store",
  });

  const data = (await tokenRes.json()) as {
    refresh_token?: string;
    error_description?: string;
  };
  if (!tokenRes.ok || !data.refresh_token) {
    return htmlPage(
      "Spotify Token Error",
      `<h2>Spotify Token Exchange Failed</h2><p>${data.error_description || "No refresh token returned."}</p>`,
      502
    );
  }

  const savedToKv = isKvConfigured()
    ? await saveSpotifyRefreshToken(data.refresh_token)
    : false;

  const res = htmlPage(
    "Spotify Connected",
    savedToKv
      ? `<h2>Spotify Connected to J.A.R.V.I.S.</h2><p>Your refresh token was automatically stored in Upstash Redis. You are ready to control Spotify by voice.</p><p><a href="/">Return to J.A.R.V.I.S.</a></p>`
      : `<h2>Spotify Authorized</h2><p>Copy this refresh token into your <strong>Vercel Environment Variables</strong> (and <code>.env.local</code>) as <code>SPOTIFY_REFRESH_TOKEN</code>, then redeploy:</p><pre>${data.refresh_token}</pre><p><a href="/">Return to J.A.R.V.I.S.</a></p>`
  );
  res.cookies.delete("jarvis_spotify_oauth_state");
  return res;
}
