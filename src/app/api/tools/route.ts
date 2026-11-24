import { connection, NextRequest, NextResponse } from "next/server";
import { checkRateLimit, getClientIp, isRequestAuthorized } from "@/lib/auth";
import { handleGitHubAction } from "@/lib/integrations/github";
import {
  getGoogleClientCreds,
  handleGoogleCalendar,
  handleGoogleGmail,
  handleGoogleTasks,
} from "@/lib/integrations/google";
import { isKvConfigured, kvGetString } from "@/lib/integrations/kv";
import { getCloudMemoryBrief, handleServerMemory } from "@/lib/integrations/memory";
import { getSpotifyClientCreds, handleSpotifyControl } from "@/lib/integrations/spotify";
import { runDeepThink } from "@/lib/integrations/think";
import { handleVercelAction } from "@/lib/integrations/vercel";
import { handleWhatsApp } from "@/lib/integrations/whatsapp";
import { getLocationContext, getWeatherReport } from "@/lib/integrations/world";

export async function GET(request: NextRequest) {
  await connection();
  if (!isRequestAuthorized(request)) {
    return NextResponse.json({ error: "Security clearance required." }, { status: 401 });
  }

  const [spotifyKvToken, googleKvToken, memories] = await Promise.all([
    kvGetString("jarvis:spotify:refresh_token"),
    kvGetString("jarvis:google:refresh_token"),
    getCloudMemoryBrief(),
  ]);

  return NextResponse.json({
    ok: true,
    integrations: {
      weather: true,
      location: true,
      deepThink: true,
      cloudMemory: isKvConfigured(),
      spotify: Boolean(
        getSpotifyClientCreds() &&
          (spotifyKvToken || process.env.SPOTIFY_REFRESH_TOKEN?.trim())
      ),
      google: Boolean(
        getGoogleClientCreds() &&
          (googleKvToken || process.env.GOOGLE_REFRESH_TOKEN?.trim())
      ),
      whatsapp: Boolean(
        process.env.WHATSAPP_ACCESS_TOKEN?.trim() &&
          process.env.WHATSAPP_PHONE_NUMBER_ID?.trim()
      ),
      github: Boolean(process.env.GITHUB_TOKEN?.trim()),
      vercel: Boolean(process.env.VERCEL_TOKEN?.trim()),
    },
    memories,
  });
}

export async function POST(request: NextRequest) {
  if (!isRequestAuthorized(request)) {
    return NextResponse.json({ error: "Security clearance required." }, { status: 401 });
  }

  const ip = getClientIp(request);
  const limit = checkRateLimit(`tools:${ip}`, 60, 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json(
      { ok: false, error: `Rate limit exceeded. Retry in ${limit.retryAfterSeconds}s.` },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }
    );
  }

  let body: { name?: string; args?: Record<string, unknown> };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON payload." }, { status: 400 });
  }

  const name = String(body.name || "").trim();
  const args = (body.args && typeof body.args === "object" ? body.args : {}) as Record<
    string,
    unknown
  >;

  try {
    let result: Record<string, unknown>;

    switch (name) {
      case "deep_think":
        result = await runDeepThink({
          question: String(args.question || ""),
          context: typeof args.context === "string" ? args.context : undefined,
        });
        break;

      case "get_weather":
        result = await getWeatherReport({
          latitude: typeof args.latitude === "number" ? args.latitude : undefined,
          longitude: typeof args.longitude === "number" ? args.longitude : undefined,
          location_name:
            typeof args.location_name === "string" ? args.location_name : undefined,
        });
        break;

      case "get_location_context":
        result = await getLocationContext({
          latitude: typeof args.latitude === "number" ? args.latitude : undefined,
          longitude: typeof args.longitude === "number" ? args.longitude : undefined,
          nearby_query:
            typeof args.nearby_query === "string" ? args.nearby_query : undefined,
        });
        break;

      case "memory_store":
        result = await handleServerMemory({
          action: (String(args.action || "list").toLowerCase() as
            | "remember"
            | "recall"
            | "forget"
            | "list"),
          key: typeof args.key === "string" ? args.key : undefined,
          fact: typeof args.fact === "string" ? args.fact : undefined,
          category: typeof args.category === "string" ? args.category : undefined,
          query: typeof args.query === "string" ? args.query : undefined,
        });
        break;

      case "spotify_control":
        result = await handleSpotifyControl({
          action: String(args.action || "now_playing"),
          query: typeof args.query === "string" ? args.query : undefined,
          volume_percent:
            typeof args.volume_percent === "number" ? args.volume_percent : undefined,
          device_name:
            typeof args.device_name === "string" ? args.device_name : undefined,
        });
        break;

      case "google_calendar":
        result = await handleGoogleCalendar({
          action: String(args.action || "list_events"),
          days_ahead:
            typeof args.days_ahead === "number" ? args.days_ahead : undefined,
          summary: typeof args.summary === "string" ? args.summary : undefined,
          start_iso: typeof args.start_iso === "string" ? args.start_iso : undefined,
          end_iso: typeof args.end_iso === "string" ? args.end_iso : undefined,
          description:
            typeof args.description === "string" ? args.description : undefined,
          location: typeof args.location === "string" ? args.location : undefined,
          event_id: typeof args.event_id === "string" ? args.event_id : undefined,
          confirmed: args.confirmed === true,
        });
        break;

      case "google_gmail":
        result = await handleGoogleGmail({
          action: String(args.action || "list_unread"),
          query: typeof args.query === "string" ? args.query : undefined,
          message_id:
            typeof args.message_id === "string" ? args.message_id : undefined,
          to: typeof args.to === "string" ? args.to : undefined,
          subject: typeof args.subject === "string" ? args.subject : undefined,
          body: typeof args.body === "string" ? args.body : undefined,
          confirmed: args.confirmed === true,
        });
        break;

      case "google_tasks":
        result = await handleGoogleTasks({
          action: String(args.action || "list"),
          title: typeof args.title === "string" ? args.title : undefined,
          notes: typeof args.notes === "string" ? args.notes : undefined,
          due_iso: typeof args.due_iso === "string" ? args.due_iso : undefined,
          task_id: typeof args.task_id === "string" ? args.task_id : undefined,
        });
        break;

      case "whatsapp_message":
        result = await handleWhatsApp({
          action: String(args.action || "read_recent"),
          recipient:
            typeof args.recipient === "string" ? args.recipient : undefined,
          message: typeof args.message === "string" ? args.message : undefined,
          confirmed: args.confirmed === true,
        });
        break;

      case "github_action":
        result = await handleGitHubAction({
          action: String(args.action || "list_repos"),
          owner: typeof args.owner === "string" ? args.owner : undefined,
          repo: typeof args.repo === "string" ? args.repo : undefined,
          title: typeof args.title === "string" ? args.title : undefined,
          body: typeof args.body === "string" ? args.body : undefined,
          confirmed: args.confirmed === true,
        });
        break;

      case "vercel_action":
        result = await handleVercelAction({
          action: String(args.action || "deployment_status"),
          project: typeof args.project === "string" ? args.project : undefined,
          confirmed: args.confirmed === true,
        });
        break;

      default:
        return NextResponse.json(
          { ok: false, error: `Unknown server tool: ${name}` },
          { status: 400 }
        );
    }

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Server tool execution failed.",
      },
      { status: 500 }
    );
  }
}
