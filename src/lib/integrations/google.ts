import { kvGetString, kvSetString } from "@/lib/integrations/kv";

export const GOOGLE_OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/tasks",
].join(" ");

const KV_REFRESH_KEY = "jarvis:google:refresh_token";

let cachedAccess: { token: string; expiresAt: number } | null = null;

export function getGoogleClientCreds() {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export async function saveGoogleRefreshToken(refreshToken: string): Promise<boolean> {
  cachedAccess = null;
  return kvSetString(KV_REFRESH_KEY, refreshToken);
}

async function getRefreshToken(): Promise<string | null> {
  const fromKv = await kvGetString(KV_REFRESH_KEY);
  if (fromKv) return fromKv;
  return process.env.GOOGLE_REFRESH_TOKEN?.trim() || null;
}

async function getGoogleAccessToken(): Promise<string | null> {
  if (cachedAccess && Date.now() < cachedAccess.expiresAt - 60_000) {
    return cachedAccess.token;
  }

  const creds = getGoogleClientCreds();
  const refreshToken = await getRefreshToken();
  if (!creds || !refreshToken) return null;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
    cache: "no-store",
  });

  if (!res.ok) return null;
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) return null;

  cachedAccess = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
  };
  return cachedAccess.token;
}

async function googleFetch(
  url: string,
  init?: RequestInit
): Promise<{ status: number; ok: boolean; data: unknown }> {
  const token = await getGoogleAccessToken();
  if (!token) {
    return {
      status: 401,
      ok: false,
      data: {
        error:
          "Google services are not connected yet. Set GOOGLE_CLIENT_ID & GOOGLE_CLIENT_SECRET and authorize once at /api/oauth/google/start.",
      },
    };
  }

  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    cache: "no-store",
  });

  if (res.status === 204) return { status: 204, ok: true, data: null };
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, ok: res.ok, data };
}

export async function handleGoogleCalendar(args: {
  action: string;
  days_ahead?: number;
  summary?: string;
  start_iso?: string;
  end_iso?: string;
  description?: string;
  location?: string;
  event_id?: string;
  confirmed?: boolean;
}): Promise<Record<string, unknown>> {
  const action = (args.action || "list_events").toLowerCase();

  switch (action) {
    case "list_events": {
      const days = Math.max(1, Math.min(30, Number(args.days_ahead || 3)));
      const now = new Date();
      const end = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
      const url =
        `https://www.googleapis.com/calendar/v3/calendars/primary/events` +
        `?singleEvents=true&orderBy=startTime&maxResults=15` +
        `&timeMin=${encodeURIComponent(now.toISOString())}` +
        `&timeMax=${encodeURIComponent(end.toISOString())}`;

      const res = await googleFetch(url);
      if (!res.ok) return { ok: false, error: res.data };

      const items = (
        (res.data as {
          items?: Array<{
            id: string;
            summary?: string;
            location?: string;
            start?: { dateTime?: string; date?: string };
            end?: { dateTime?: string; date?: string };
          }>;
        }).items || []
      ).map((e) => ({
        id: e.id,
        summary: e.summary || "(Untitled event)",
        start: e.start?.dateTime || e.start?.date,
        end: e.end?.dateTime || e.end?.date,
        location: e.location,
      }));
      return { ok: true, count: items.length, events: items };
    }

    case "create_event": {
      if (!args.summary?.trim() || !args.start_iso?.trim()) {
        return { ok: false, error: "summary and start_iso are required." };
      }
      const startMs = Date.parse(args.start_iso);
      const endIso =
        args.end_iso?.trim() ||
        (Number.isFinite(startMs)
          ? new Date(startMs + 60 * 60 * 1000).toISOString()
          : args.start_iso);

      const res = await googleFetch(
        "https://www.googleapis.com/calendar/v3/calendars/primary/events",
        {
          method: "POST",
          body: JSON.stringify({
            summary: args.summary.trim(),
            description: args.description?.trim(),
            location: args.location?.trim(),
            start: { dateTime: args.start_iso.trim() },
            end: { dateTime: endIso },
          }),
        }
      );
      if (!res.ok) return { ok: false, error: res.data };
      const created = res.data as { id?: string; summary?: string; htmlLink?: string };
      return { ok: true, createdId: created.id, summary: created.summary };
    }

    case "delete_event": {
      if (!args.event_id?.trim()) {
        return { ok: false, error: "event_id is required to delete an event." };
      }
      if (!args.confirmed) {
        return {
          ok: false,
          confirmationRequired: true,
          action: "delete_event",
          eventId: args.event_id,
          instruction:
            "Ask the user verbally to confirm deleting this calendar event, then call google_calendar again with confirmed: true.",
        };
      }
      const res = await googleFetch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(
          args.event_id.trim()
        )}`,
        { method: "DELETE" }
      );
      return res.ok
        ? { ok: true, deletedEventId: args.event_id }
        : { ok: false, error: res.data };
    }

    default:
      return { ok: false, error: `Unsupported calendar action: ${action}` };
  }
}

function encodeRfc2822Email(to: string, subject: string, body: string): string {
  const mime = [
    `To: ${to}`,
    `Subject: ${subject}`,
    "Content-Type: text/plain; charset=utf-8",
    "MIME-Version: 1.0",
    "",
    body,
  ].join("\r\n");
  return Buffer.from(mime, "utf8").toString("base64url");
}

function decodeBase64Url(str?: string): string {
  if (!str) return "";
  try {
    return Buffer.from(str.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  } catch {
    return "";
  }
}

export async function handleGoogleGmail(args: {
  action: string;
  query?: string;
  message_id?: string;
  to?: string;
  subject?: string;
  body?: string;
  confirmed?: boolean;
}): Promise<Record<string, unknown>> {
  const action = (args.action || "list_unread").toLowerCase();

  switch (action) {
    case "list_unread":
    case "search": {
      const q =
        action === "list_unread"
          ? "is:unread in:inbox"
          : args.query?.trim() || "in:inbox";
      const listRes = await googleFetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=7&q=${encodeURIComponent(q)}`
      );
      if (!listRes.ok) return { ok: false, error: listRes.data };
      const msgRefs =
        (listRes.data as { messages?: Array<{ id: string }> }).messages || [];

      const summaries = await Promise.all(
        msgRefs.slice(0, 6).map(async (ref) => {
          const m = await googleFetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${ref.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`
          );
          if (!m.ok || !m.data) return { id: ref.id };
          const d = m.data as {
            id: string;
            snippet?: string;
            payload?: { headers?: Array<{ name: string; value: string }> };
          };
          const headers = d.payload?.headers || [];
          const h = (name: string) =>
            headers.find((x) => x.name.toLowerCase() === name.toLowerCase())?.value || "";
          return {
            id: d.id,
            from: h("From"),
            subject: h("Subject"),
            date: h("Date"),
            snippet: d.snippet,
          };
        })
      );
      return { ok: true, count: summaries.length, messages: summaries };
    }

    case "read_message": {
      if (!args.message_id?.trim()) {
        return { ok: false, error: "message_id is required." };
      }
      const res = await googleFetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(
          args.message_id.trim()
        )}?format=full`
      );
      if (!res.ok) return { ok: false, error: res.data };
      const d = res.data as {
        snippet?: string;
        payload?: {
          headers?: Array<{ name: string; value: string }>;
          body?: { data?: string };
          parts?: Array<{ mimeType?: string; body?: { data?: string } }>;
        };
      };
      const headers = d.payload?.headers || [];
      const h = (name: string) =>
        headers.find((x) => x.name.toLowerCase() === name.toLowerCase())?.value || "";

      const plainPart = d.payload?.parts?.find((p) => p.mimeType === "text/plain");
      const rawBody =
        decodeBase64Url(plainPart?.body?.data || d.payload?.body?.data) ||
        d.snippet ||
        "";

      return {
        ok: true,
        from: h("From"),
        subject: h("Subject"),
        date: h("Date"),
        body: rawBody.slice(0, 2400),
      };
    }

    case "create_draft": {
      if (!args.to?.trim() || !args.subject?.trim() || !args.body?.trim()) {
        return { ok: false, error: "to, subject, and body are required for a draft." };
      }
      const raw = encodeRfc2822Email(args.to.trim(), args.subject.trim(), args.body.trim());
      const res = await googleFetch(
        "https://gmail.googleapis.com/gmail/v1/users/me/drafts",
        {
          method: "POST",
          body: JSON.stringify({ message: { raw } }),
        }
      );
      return res.ok
        ? { ok: true, status: "draft_saved", to: args.to, subject: args.subject }
        : { ok: false, error: res.data };
    }

    case "send_email": {
      if (!args.to?.trim() || !args.subject?.trim() || !args.body?.trim()) {
        return { ok: false, error: "to, subject, and body are required to send an email." };
      }
      if (!args.confirmed) {
        return {
          ok: false,
          confirmationRequired: true,
          preview: {
            to: args.to.trim(),
            subject: args.subject.trim(),
            body: args.body.trim(),
          },
          instruction:
            "Read the recipient, subject, and brief summary aloud to the user and ask for explicit verbal confirmation before calling google_gmail send_email again with confirmed: true.",
        };
      }
      const raw = encodeRfc2822Email(args.to.trim(), args.subject.trim(), args.body.trim());
      const res = await googleFetch(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
        {
          method: "POST",
          body: JSON.stringify({ raw }),
        }
      );
      return res.ok
        ? { ok: true, status: "sent", to: args.to, subject: args.subject }
        : { ok: false, error: res.data };
    }

    default:
      return { ok: false, error: `Unsupported Gmail action: ${action}` };
  }
}

export async function handleGoogleTasks(args: {
  action: string;
  title?: string;
  notes?: string;
  due_iso?: string;
  task_id?: string;
}): Promise<Record<string, unknown>> {
  const action = (args.action || "list").toLowerCase();

  switch (action) {
    case "list": {
      const res = await googleFetch(
        "https://tasks.googleapis.com/tasks/v1/lists/@default/tasks?showCompleted=false&maxResults=20"
      );
      if (!res.ok) return { ok: false, error: res.data };
      const items = (
        (res.data as {
          items?: Array<{ id: string; title?: string; notes?: string; due?: string }>;
        }).items || []
      ).map((t) => ({
        id: t.id,
        title: t.title,
        notes: t.notes,
        due: t.due,
      }));
      return { ok: true, count: items.length, tasks: items };
    }

    case "add": {
      if (!args.title?.trim()) return { ok: false, error: "title is required." };
      const res = await googleFetch(
        "https://tasks.googleapis.com/tasks/v1/lists/@default/tasks",
        {
          method: "POST",
          body: JSON.stringify({
            title: args.title.trim(),
            notes: args.notes?.trim(),
            due: args.due_iso?.trim(),
          }),
        }
      );
      return res.ok
        ? { ok: true, added: args.title.trim() }
        : { ok: false, error: res.data };
    }

    case "complete": {
      let targetId = args.task_id?.trim();
      let matchedTitle = args.title?.trim();

      if (!targetId && matchedTitle) {
        const listRes = await googleFetch(
          "https://tasks.googleapis.com/tasks/v1/lists/@default/tasks?showCompleted=false&maxResults=30"
        );
        const items =
          (listRes.data as { items?: Array<{ id: string; title?: string }> })?.items || [];
        const found = items.find((t) =>
          (t.title || "").toLowerCase().includes(matchedTitle!.toLowerCase())
        );
        if (found) {
          targetId = found.id;
          matchedTitle = found.title;
        }
      }

      if (!targetId) {
        return { ok: false, error: "Could not find a matching open Google Task." };
      }

      const res = await googleFetch(
        `https://tasks.googleapis.com/tasks/v1/lists/@default/tasks/${encodeURIComponent(
          targetId
        )}`,
        {
          method: "PATCH",
          body: JSON.stringify({ status: "completed" }),
        }
      );
      return res.ok
        ? { ok: true, completed: matchedTitle || targetId }
        : { ok: false, error: res.data };
    }

    default:
      return { ok: false, error: `Unsupported Google Tasks action: ${action}` };
  }
}
