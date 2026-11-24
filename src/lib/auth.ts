import crypto from "crypto";
import { NextRequest } from "next/server";

export const CLEARANCE_COOKIE_NAME = "jarvis_clearance";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

interface RateBucket {
  count: number;
  resetAt: number;
}

// Lightweight per-instance rate limiter (resets across serverless cold starts,
// still effective against bursts on warm Vercel Fluid/Node instances).
const rateLimitStore = new Map<string, RateBucket>();

export function isPasscodeRequired(): boolean {
  return Boolean(process.env.JARVIS_ACCESS_PASSCODE?.trim());
}

function getSigningSecret(): Buffer {
  const explicit = process.env.AUTH_SECRET?.trim();
  if (explicit && explicit.length >= 16) {
    return crypto.createHash("sha256").update(explicit).digest();
  }
  const passcode = process.env.JARVIS_ACCESS_PASSCODE?.trim() || "jarvis-local";
  return crypto
    .createHash("sha256")
    .update(`${passcode}:jarvis-clearance-v1`)
    .digest();
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) {
    // Compare against dummy buffer to keep timing uniform
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

export function verifyPasscode(candidate: string): boolean {
  const expected = process.env.JARVIS_ACCESS_PASSCODE?.trim();
  if (!expected) return true;
  if (!candidate) return false;
  return safeEqual(candidate.trim(), expected);
}

export function createClearanceToken(): string {
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + SESSION_TTL_SECONDS;
  const nonce = crypto.randomBytes(12).toString("hex");
  const payload = `${issuedAt}.${expiresAt}.${nonce}`;
  const sig = crypto
    .createHmac("sha256", getSigningSecret())
    .update(payload)
    .digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyClearanceToken(token: string | undefined): boolean {
  if (!isPasscodeRequired()) return true;
  if (!token) return false;

  const parts = token.split(".");
  if (parts.length !== 4) return false;

  const [issuedStr, expiresStr, nonce, providedSig] = parts;
  const expiresAt = Number(expiresStr);
  if (!Number.isFinite(expiresAt) || expiresAt < Math.floor(Date.now() / 1000)) {
    return false;
  }

  const payload = `${issuedStr}.${expiresStr}.${nonce}`;
  const expectedSig = crypto
    .createHmac("sha256", getSigningSecret())
    .update(payload)
    .digest("base64url");

  return safeEqual(providedSig, expectedSig);
}

export function isRequestAuthorized(request: NextRequest): boolean {
  if (!isPasscodeRequired()) return true;
  const cookie = request.cookies.get(CLEARANCE_COOKIE_NAME)?.value;
  return verifyClearanceToken(cookie);
}

export function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() || "unknown";
  }
  return request.headers.get("x-real-ip") || "local";
}

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number
): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  const existing = rateLimitStore.get(key);

  if (!existing || existing.resetAt <= now) {
    rateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
    // Prune stale buckets occasionally to prevent unbounded growth
    if (rateLimitStore.size > 500) {
      for (const [bucketKey, bucket] of rateLimitStore.entries()) {
        if (bucket.resetAt <= now) rateLimitStore.delete(bucketKey);
      }
    }
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (existing.count >= limit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }

  existing.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}

export function isSecureRequest(request?: NextRequest): boolean {
  if (!request) return process.env.NODE_ENV === "production";
  const forwardedProto = request.headers.get("x-forwarded-proto");
  if (forwardedProto) {
    return forwardedProto.split(",")[0]?.trim() === "https";
  }
  return request.nextUrl.protocol === "https:";
}

export function getClearanceCookieOptions(request?: NextRequest) {
  return {
    name: CLEARANCE_COOKIE_NAME,
    httpOnly: true,
    sameSite: "lax" as const,
    secure: isSecureRequest(request),
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  };
}
