import { kvGetString, kvSetString } from "@/lib/integrations/kv";

export const SPOTIFY_SCOPES = [
  "user-read-playback-state",
  "user-modify-playback-state",
  "user-read-currently-playing",
  "user-library-modify",
  "user-library-read",
  "playlist-read-private",
  "playlist-read-collaborative",
].join(" ");

const KV_REFRESH_KEY = "jarvis:spotify:refresh_token";

let cachedAccess: { token: string; expiresAt: number } | null = null;

export function getSpotifyClientCreds() {
  const clientId = process.env.SPOTIFY_CLIENT_ID?.trim();
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export async function saveSpotifyRefreshToken(refreshToken: string): Promise<boolean> {
  cachedAccess = null;
  return kvSetString(KV_REFRESH_KEY, refreshToken);
}

async function getRefreshToken(): Promise<string | null> {
  const fromKv = await kvGetString(KV_REFRESH_KEY);
  if (fromKv) return fromKv;
  return process.env.SPOTIFY_REFRESH_TOKEN?.trim() || null;
}

async function getSpotifyAccessToken(): Promise<string | null> {
  if (cachedAccess && Date.now() < cachedAccess.expiresAt - 60_000) {
    return cachedAccess.token;
  }

  const creds = getSpotifyClientCreds();
  const refreshToken = await getRefreshToken();
  if (!creds || !refreshToken) return null;

  const basic = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString("base64");
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
    cache: "no-store",
  });

  if (!res.ok) return null;
  const data = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
    refresh_token?: string;
  };
  if (!data.access_token) return null;

  if (data.refresh_token) {
    await saveSpotifyRefreshToken(data.refresh_token);
  }

  cachedAccess = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
  };
  return cachedAccess.token;
}

async function spotifyFetch(
  path: string,
  init?: RequestInit
): Promise<{ status: number; ok: boolean; data: unknown }> {
  const token = await getSpotifyAccessToken();
  if (!token) {
    return {
      status: 401,
      ok: false,
      data: {
        error:
          "Spotify is not connected yet. Set SPOTIFY_CLIENT_ID & SPOTIFY_CLIENT_SECRET and authorize once at /api/oauth/spotify/start.",
      },
    };
  }

  const res = await fetch(`https://api.spotify.com/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    cache: "no-store",
  });

  if (res.status === 204) {
    return { status: 204, ok: true, data: null };
  }

  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, ok: res.ok, data };
}

interface SpotifyDevice {
  id: string;
  name: string;
  type: string;
  is_active: boolean;
  volume_percent: number;
}

async function resolveDeviceId(deviceName?: string): Promise<string | undefined> {
  if (!deviceName?.trim()) return undefined;
  const res = await spotifyFetch("/me/player/devices");
  if (!res.ok || !res.data) return undefined;
  const devices = ((res.data as { devices?: SpotifyDevice[] }).devices || []);
  const q = deviceName.trim().toLowerCase();
  const match = devices.find(
    (d) => d.name.toLowerCase().includes(q) || d.type.toLowerCase().includes(q)
  );
  return match?.id;
}

export async function handleSpotifyControl(args: {
  action: string;
  query?: string;
  volume_percent?: number;
  device_name?: string;
}): Promise<Record<string, unknown>> {
  const action = (args.action || "now_playing").toLowerCase();

  if (!getSpotifyClientCreds()) {
    return {
      ok: false,
      error:
        "Spotify credentials are not configured yet. Add SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in Vercel, then authorize at /api/oauth/spotify/start.",
    };
  }

  const deviceId = await resolveDeviceId(args.device_name);
  const deviceSuffix = deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : "";

  switch (action) {
    case "now_playing": {
      const res = await spotifyFetch("/me/player");
      if (res.status === 204 || !res.data) {
        return { ok: true, playing: false, message: "Nothing is currently playing on Spotify." };
      }
      if (!res.ok) return { ok: false, error: res.data };
      const p = res.data as {
        is_playing?: boolean;
        progress_ms?: number;
        device?: SpotifyDevice;
        item?: {
          id?: string;
          name?: string;
          duration_ms?: number;
          artists?: Array<{ name: string }>;
          album?: { name?: string };
        };
      };
      return {
        ok: true,
        isPlaying: Boolean(p.is_playing),
        track: p.item?.name || "Unknown",
        artists: (p.item?.artists || []).map((a) => a.name).join(", "),
        album: p.item?.album?.name,
        device: p.device?.name,
        volumePercent: p.device?.volume_percent,
      };
    }

    case "play": {
      const res = await spotifyFetch(`/me/player/play${deviceSuffix}`, {
        method: "PUT",
      });
      if (!res.ok) {
        return {
          ok: false,
          error:
            res.status === 404
              ? "No active Spotify device found. Open Spotify on your phone or PC first."
              : res.status === 403
                ? "Spotify Premium is required for remote playback control."
                : res.data,
        };
      }
      return { ok: true, action: "resumed" };
    }

    case "pause": {
      const res = await spotifyFetch(`/me/player/pause${deviceSuffix}`, {
        method: "PUT",
      });
      return res.ok ? { ok: true, action: "paused" } : { ok: false, error: res.data };
    }

    case "next": {
      const res = await spotifyFetch(`/me/player/next${deviceSuffix}`, {
        method: "POST",
      });
      return res.ok ? { ok: true, action: "skipped_next" } : { ok: false, error: res.data };
    }

    case "previous": {
      const res = await spotifyFetch(`/me/player/previous${deviceSuffix}`, {
        method: "POST",
      });
      return res.ok ? { ok: true, action: "skipped_previous" } : { ok: false, error: res.data };
    }

    case "volume": {
      const vol = Math.max(0, Math.min(100, Math.round(Number(args.volume_percent ?? 50))));
      const qs = deviceId
        ? `?volume_percent=${vol}&device_id=${encodeURIComponent(deviceId)}`
        : `?volume_percent=${vol}`;
      const res = await spotifyFetch(`/me/player/volume${qs}`, { method: "PUT" });
      return res.ok
        ? { ok: true, volumePercent: vol }
        : { ok: false, error: res.data };
    }

    case "devices": {
      const res = await spotifyFetch("/me/player/devices");
      if (!res.ok) return { ok: false, error: res.data };
      const devices = ((res.data as { devices?: SpotifyDevice[] }).devices || []).map(
        (d) => ({
          name: d.name,
          type: d.type,
          active: d.is_active,
          volumePercent: d.volume_percent,
        })
      );
      return { ok: true, devices };
    }

    case "transfer": {
      if (!deviceId) {
        return {
          ok: false,
          error: `Could not find a Spotify Connect device matching "${args.device_name || ""}".`,
        };
      }
      const res = await spotifyFetch("/me/player", {
        method: "PUT",
        body: JSON.stringify({ device_ids: [deviceId], play: true }),
      });
      return res.ok
        ? { ok: true, transferredTo: args.device_name }
        : { ok: false, error: res.data };
    }

    case "playlists": {
      const res = await spotifyFetch("/me/playlists?limit=20");
      if (!res.ok) return { ok: false, error: res.data };
      const items = (
        (res.data as {
          items?: Array<{ name: string; uri: string; tracks?: { total?: number } }>;
        }).items || []
      );

      if (args.query?.trim()) {
        const q = args.query.trim().toLowerCase();
        const match = items.find((pl) => pl.name.toLowerCase().includes(q));
        if (match) {
          const playRes = await spotifyFetch(`/me/player/play${deviceSuffix}`, {
            method: "PUT",
            body: JSON.stringify({ context_uri: match.uri }),
          });
          return playRes.ok
            ? { ok: true, playingPlaylist: match.name }
            : { ok: false, error: playRes.data };
        }
      }

      return {
        ok: true,
        playlists: items.map((pl) => ({
          name: pl.name,
          tracks: pl.tracks?.total,
        })),
      };
    }

    case "like_current": {
      const cur = await spotifyFetch("/me/player/currently-playing");
      const trackId = (cur.data as { item?: { id?: string; name?: string } })?.item?.id;
      const trackName = (cur.data as { item?: { name?: string } })?.item?.name;
      if (!trackId) {
        return { ok: false, error: "No active track found to save." };
      }
      const saveRes = await spotifyFetch(`/me/tracks?ids=${encodeURIComponent(trackId)}`, {
        method: "PUT",
      });
      return saveRes.ok
        ? { ok: true, liked: trackName }
        : { ok: false, error: saveRes.data };
    }

    case "queue":
    case "search_and_play": {
      const q = args.query?.trim();
      if (!q) return { ok: false, error: "A search query is required." };

      // Check user's own playlists first if query mentions playlist
      if (action === "search_and_play" && /playlist/i.test(q)) {
        const cleaned = q.replace(/\b(my|the|playlist)\b/gi, "").trim();
        const plRes = await spotifyFetch("/me/playlists?limit=25");
        if (plRes.ok && plRes.data) {
          const playlists =
            (plRes.data as { items?: Array<{ name: string; uri: string }> }).items || [];
          const match = playlists.find((p) =>
            p.name.toLowerCase().includes(cleaned.toLowerCase())
          );
          if (match) {
            const playRes = await spotifyFetch(`/me/player/play${deviceSuffix}`, {
              method: "PUT",
              body: JSON.stringify({ context_uri: match.uri }),
            });
            return playRes.ok
              ? { ok: true, playingPlaylist: match.name }
              : { ok: false, error: playRes.data };
          }
        }
      }

      const searchRes = await spotifyFetch(
        `/search?q=${encodeURIComponent(q)}&type=track,artist,playlist&limit=3`
      );
      if (!searchRes.ok) return { ok: false, error: searchRes.data };

      const searchData = searchRes.data as {
        tracks?: {
          items?: Array<{
            uri: string;
            name: string;
            artists?: Array<{ name: string }>;
          }>;
        };
      };
      const firstTrack = searchData.tracks?.items?.[0];
      if (!firstTrack) {
        return { ok: false, error: `No Spotify tracks found for "${q}".` };
      }

      if (action === "queue") {
        const qs = deviceId
          ? `?uri=${encodeURIComponent(firstTrack.uri)}&device_id=${encodeURIComponent(deviceId)}`
          : `?uri=${encodeURIComponent(firstTrack.uri)}`;
        const qRes = await spotifyFetch(`/me/player/queue${qs}`, { method: "POST" });
        return qRes.ok
          ? {
              ok: true,
              queued: firstTrack.name,
              artists: (firstTrack.artists || []).map((a) => a.name).join(", "),
            }
          : { ok: false, error: qRes.data };
      }

      const playRes = await spotifyFetch(`/me/player/play${deviceSuffix}`, {
        method: "PUT",
        body: JSON.stringify({ uris: [firstTrack.uri] }),
      });
      return playRes.ok
        ? {
            ok: true,
            playing: firstTrack.name,
            artists: (firstTrack.artists || []).map((a) => a.name).join(", "),
          }
        : { ok: false, error: playRes.data };
    }

    default:
      return { ok: false, error: `Unsupported Spotify action: ${action}` };
  }
}
