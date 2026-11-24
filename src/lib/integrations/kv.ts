/**
 * Lightweight zero-dependency Upstash Redis REST helper.
 * Works natively on Vercel serverless functions. When UPSTASH_REDIS_REST_URL
 * and UPSTASH_REDIS_REST_TOKEN are unset, every helper degrades gracefully so
 * integrations can fall back to env vars or localStorage.
 */

function getKvCredentials(): { url: string; token: string } | null {
  const url =
    process.env.UPSTASH_REDIS_REST_URL?.trim() ||
    process.env.KV_REST_API_URL?.trim();
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN?.trim() ||
    process.env.KV_REST_API_TOKEN?.trim();
  return url && token ? { url, token } : null;
}

export function isKvConfigured(): boolean {
  return Boolean(getKvCredentials());
}

async function kvCommand<T = unknown>(command: Array<string | number>): Promise<T | null> {
  const creds = getKvCredentials();
  if (!creds) return null;

  try {
    const res = await fetch(creds.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(command),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { result?: T };
    return data.result ?? null;
  } catch {
    return null;
  }
}

export async function kvGetString(key: string): Promise<string | null> {
  const val = await kvCommand<string | null>(["GET", key]);
  return typeof val === "string" ? val : null;
}

export async function kvSetString(
  key: string,
  value: string,
  ttlSeconds?: number
): Promise<boolean> {
  const cmd: Array<string | number> =
    typeof ttlSeconds === "number" && ttlSeconds > 0
      ? ["SET", key, value, "EX", Math.round(ttlSeconds)]
      : ["SET", key, value];
  const res = await kvCommand<string>(cmd);
  return res === "OK";
}

export async function kvGetJson<T>(key: string): Promise<T | null> {
  const raw = await kvGetString(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function kvSetJson(
  key: string,
  value: unknown,
  ttlSeconds?: number
): Promise<boolean> {
  return kvSetString(key, JSON.stringify(value), ttlSeconds);
}
