import crypto from "crypto";
import { connection, NextRequest, NextResponse } from "next/server";
import { appendIncomingWhatsAppMessage } from "@/lib/integrations/whatsapp";

/**
 * Meta WhatsApp Cloud API Webhook Verification (GET) & Incoming Message Receiver (POST).
 */
export async function GET(request: NextRequest) {
  await connection();
  const mode = request.nextUrl.searchParams.get("hub.mode");
  const token = request.nextUrl.searchParams.get("hub.verify_token");
  const challenge = request.nextUrl.searchParams.get("hub.challenge");
  const expected = process.env.WHATSAPP_VERIFY_TOKEN?.trim();

  if (mode === "subscribe" && expected && token === expected && challenge) {
    return new NextResponse(challenge, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }
  return NextResponse.json({ error: "Verification failed." }, { status: 403 });
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const appSecret = process.env.WHATSAPP_APP_SECRET?.trim();

  if (appSecret) {
    const providedSig = request.headers.get("x-hub-signature-256") || "";
    const expectedSig = `sha256=${crypto
      .createHmac("sha256", appSecret)
      .update(rawBody)
      .digest("hex")}`;

    const a = Buffer.from(providedSig, "utf8");
    const b = Buffer.from(expectedSig, "utf8");
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
    }
  }

  try {
    const payload = JSON.parse(rawBody) as {
      entry?: Array<{
        changes?: Array<{
          value?: {
            contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>;
            messages?: Array<{
              id?: string;
              from?: string;
              timestamp?: string;
              type?: string;
              text?: { body?: string };
            }>;
          };
        }>;
      }>;
    };

    for (const entry of payload.entry || []) {
      for (const change of entry.changes || []) {
        const contacts = change.value?.contacts || [];
        for (const msg of change.value?.messages || []) {
          if (msg.type === "text" && msg.text?.body) {
            const sender = contacts.find((c) => c.wa_id === msg.from);
            await appendIncomingWhatsAppMessage({
              id: msg.id || crypto.randomUUID(),
              from: msg.from || "unknown",
              senderName: sender?.profile?.name,
              text: msg.text.body,
              timestamp: msg.timestamp
                ? new Date(Number(msg.timestamp) * 1000).toISOString()
                : new Date().toISOString(),
            });
          }
        }
      }
    }
  } catch {
    // Always acknowledge webhook cleanly to prevent Meta retry storms
  }

  return NextResponse.json({ ok: true });
}
