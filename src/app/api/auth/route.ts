import { NextRequest, NextResponse } from "next/server";
import {
  CLEARANCE_COOKIE_NAME,
  checkRateLimit,
  createClearanceToken,
  getClearanceCookieOptions,
  getClientIp,
  isPasscodeRequired,
  isRequestAuthorized,
  isSecureRequest,
  verifyPasscode,
} from "@/lib/auth";

export async function GET(request: NextRequest) {
  return NextResponse.json({
    passcodeRequired: isPasscodeRequired(),
    authenticated: isRequestAuthorized(request),
  });
}

export async function POST(request: NextRequest) {
  if (!isPasscodeRequired()) {
    return NextResponse.json({ authenticated: true, passcodeRequired: false });
  }

  const ip = getClientIp(request);
  const limit = checkRateLimit(`auth:${ip}`, 10, 5 * 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json(
      {
        error: `Too many clearance attempts. Retry in ${limit.retryAfterSeconds}s.`,
      },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      }
    );
  }

  let body: { passcode?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request payload." }, { status: 400 });
  }

  const passcode = typeof body.passcode === "string" ? body.passcode : "";
  if (!verifyPasscode(passcode)) {
    return NextResponse.json(
      { error: "Access denied. Invalid security clearance code." },
      { status: 401 }
    );
  }

  const token = createClearanceToken();
  const response = NextResponse.json({ authenticated: true, passcodeRequired: true });
  response.cookies.set({
    ...getClearanceCookieOptions(request),
    value: token,
  });
  return response;
}

export async function DELETE(request: NextRequest) {
  const response = NextResponse.json({ authenticated: false });
  response.cookies.set({
    name: CLEARANCE_COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureRequest(request),
    path: "/",
    maxAge: 0,
  });
  return response;
}
