import { isKvConfigured, kvGetJson, kvSetJson } from "@/lib/integrations/kv";

export interface IncomingWhatsAppMessage {
  id: string;
  from: string;
  senderName?: string;
  text: string;
  timestamp: string;
}

const WHATSAPP_INBOX_KEY = "jarvis:whatsapp:inbox:v1";

function parseContactsMap(): Record<string, string> {
  const raw = process.env.WHATSAPP_CONTACTS_JSON?.trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, string>;
    const normalized: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "string" && v.trim()) {
        normalized[k.trim().toLowerCase()] = v.trim();
      }
    }
    return normalized;
  } catch {
    return {};
  }
}

function normalizePhone(input: string): string {
  return input.replace(/[^\d]/g, "");
}

function resolveRecipient(raw?: string): { phone: string; label: string } | null {
  const contacts = parseContactsMap();
  const q = (raw || "").trim().toLowerCase();

  if (!q || q === "me" || q === "myself" || q === "self") {
    const def = process.env.WHATSAPP_DEFAULT_RECIPIENT?.trim();
    if (def) return { phone: normalizePhone(def), label: "yourself" };
    return null;
  }

  if (contacts[q]) {
    return { phone: normalizePhone(contacts[q]), label: raw!.trim() };
  }

  const partialKey = Object.keys(contacts).find((k) => k.includes(q));
  if (partialKey) {
    return { phone: normalizePhone(contacts[partialKey]), label: partialKey };
  }

  const digits = normalizePhone(q);
  if (digits.length >= 8) {
    return { phone: digits, label: raw!.trim() };
  }

  return null;
}

export async function appendIncomingWhatsAppMessage(
  msg: IncomingWhatsAppMessage
): Promise<void> {
  if (!isKvConfigured()) return;
  const inbox = (await kvGetJson<IncomingWhatsAppMessage[]>(WHATSAPP_INBOX_KEY)) || [];
  inbox.unshift(msg);
  await kvSetJson(WHATSAPP_INBOX_KEY, inbox.slice(0, 30));
}

export async function handleWhatsApp(args: {
  action: string;
  recipient?: string;
  message?: string;
  confirmed?: boolean;
}): Promise<Record<string, unknown>> {
  const action = (args.action || "read_recent").toLowerCase();

  switch (action) {
    case "list_contacts": {
      const contacts = parseContactsMap();
      const entries = Object.entries(contacts).map(([name, num]) => ({
        name,
        endingIn: normalizePhone(num).slice(-4),
      }));
      return {
        ok: true,
        defaultRecipientConfigured: Boolean(
          process.env.WHATSAPP_DEFAULT_RECIPIENT?.trim()
        ),
        contacts: entries,
      };
    }

    case "read_recent": {
      if (!isKvConfigured()) {
        return {
          ok: false,
          error:
            "Upstash Redis is needed to store incoming WhatsApp webhook messages. Configure UPSTASH_REDIS_REST_URL & UPSTASH_REDIS_REST_TOKEN and point your Meta webhook to /api/webhooks/whatsapp.",
        };
      }
      const inbox = (await kvGetJson<IncomingWhatsAppMessage[]>(WHATSAPP_INBOX_KEY)) || [];
      return { ok: true, count: inbox.length, messages: inbox.slice(0, 10) };
    }

    case "send_text": {
      const accessToken = process.env.WHATSAPP_ACCESS_TOKEN?.trim();
      const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
      if (!accessToken || !phoneNumberId) {
        return {
          ok: false,
          error:
            "WhatsApp Cloud API is not configured yet. Add WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID in Vercel.",
        };
      }

      const resolved = resolveRecipient(args.recipient);
      if (!resolved) {
        return {
          ok: false,
          error:
            "Could not resolve recipient phone number. Add them to WHATSAPP_CONTACTS_JSON or specify the full international number.",
        };
      }

      const text = args.message?.trim();
      if (!text) {
        return { ok: false, error: "Message text cannot be empty." };
      }

      if (!args.confirmed) {
        return {
          ok: false,
          confirmationRequired: true,
          preview: {
            recipient: resolved.label,
            endingIn: resolved.phone.slice(-4),
            message: text,
          },
          instruction:
            "Read the recipient and exact message text aloud to the user and ask for explicit verbal confirmation before calling whatsapp_message send_text again with confirmed: true.",
        };
      }

      const res = await fetch(
        `https://graph.facebook.com/v21.0/${encodeURIComponent(phoneNumberId)}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to: resolved.phone,
            type: "text",
            text: { body: text },
          }),
          cache: "no-store",
        }
      );

      let data: unknown = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }

      return res.ok
        ? { ok: true, sentTo: resolved.label, message: text }
        : { ok: false, error: data };
    }

    default:
      return { ok: false, error: `Unsupported WhatsApp action: ${action}` };
  }
}
