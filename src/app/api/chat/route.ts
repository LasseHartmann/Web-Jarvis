import { NextRequest, NextResponse } from "next/server";
import type { Content, Part, Tool } from "@google/genai";
import {
  checkRateLimit,
  getClientIp,
  isRequestAuthorized,
} from "@/lib/auth";
import {
  DEFAULT_CHAT_MODEL,
  buildJarvisSystemInstruction,
  createGeminiClient,
  resolveApiKey,
} from "@/lib/gemini";
import { JARVIS_FUNCTION_DECLARATIONS } from "@/lib/tools";
import type {
  GroundingSource,
  ImageAttachment,
  PendingToolResult,
  PersonaTone,
  StreamEvent,
  TelemetrySnapshot,
} from "@/types/jarvis";

export const maxDuration = 60;

interface IncomingMessage {
  role: "user" | "assistant";
  content: string;
  attachments?: ImageAttachment[];
}

interface ChatRequestBody {
  messages?: IncomingMessage[];
  model?: string;
  tone?: PersonaTone;
  searchGrounding?: boolean;
  telemetry?: TelemetrySnapshot;
  pendingToolResults?: PendingToolResult[];
}

function toGeminiContents(
  messages: IncomingMessage[],
  pendingToolResults?: PendingToolResult[]
): Content[] {
  const recent = messages.slice(-28);
  const contents: Content[] = [];

  for (const msg of recent) {
    const parts: Part[] = [];
    if (msg.attachments && msg.attachments.length > 0) {
      for (const att of msg.attachments.slice(0, 4)) {
        if (att.dataBase64 && att.mimeType) {
          parts.push({
            inlineData: {
              mimeType: att.mimeType,
              data: att.dataBase64,
            },
          });
        }
      }
    }
    if (msg.content.trim()) {
      parts.push({ text: msg.content });
    }
    if (parts.length > 0) {
      contents.push({
        role: msg.role === "assistant" ? "model" : "user",
        parts,
      });
    }
  }

  if (pendingToolResults && pendingToolResults.length > 0) {
    contents.push({
      role: "model",
      parts: pendingToolResults.map((tr) => ({
        functionCall: {
          name: tr.name,
          args: tr.args,
        },
      })),
    });
    contents.push({
      role: "user",
      parts: pendingToolResults.map((tr) => ({
        functionResponse: {
          name: tr.name,
          response: tr.result,
        },
      })),
    });
  }

  return contents;
}

function shouldPreferHudTools(lastUserText: string): boolean {
  return /\b(timer|countdown|alarm|remind|task|todo|to-do|mission|note|memo|theme|amber|cyan|stealth|emerald|clear\s+console|reset\s+chat)\b/i.test(
    lastUserText
  );
}

function formatGeminiError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (/API_KEY_INVALID|API key not valid|invalid api key/i.test(raw)) {
    return "Gemini API key was rejected. Verify GEMINI_API_KEY in .env.local / Vercel Environment Variables or Settings.";
  }
  if (/429|RESOURCE_EXHAUSTED|quota/i.test(raw)) {
    return "Gemini API rate limit or quota reached. Please wait a moment or switch to a Flash-Lite model in Settings.";
  }
  if (/404|NOT_FOUND|not found for API version/i.test(raw)) {
    return "Selected Gemini model was not found for this API key. Open Settings to choose another available model.";
  }
  return raw.length > 260 ? `${raw.slice(0, 260)}...` : raw;
}

export async function POST(request: NextRequest) {
  if (!isRequestAuthorized(request)) {
    return NextResponse.json(
      { error: "Security clearance required. Unlock J.A.R.V.I.S. first." },
      { status: 401 }
    );
  }

  const ip = getClientIp(request);
  const rate = checkRateLimit(`chat:${ip}`, 30, 60 * 1000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: `Rate limit exceeded. Retry in ${rate.retryAfterSeconds}s.` },
      {
        status: 429,
        headers: { "Retry-After": String(rate.retryAfterSeconds) },
      }
    );
  }

  let body: ChatRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const messages = Array.isArray(body.messages) ? body.messages : [];
  const pendingToolResults = Array.isArray(body.pendingToolResults)
    ? body.pendingToolResults
    : undefined;

  if (messages.length === 0) {
    return NextResponse.json(
      { error: "At least one message is required." },
      { status: 400 }
    );
  }

  const { apiKey } = resolveApiKey(request.headers.get("x-gemini-api-key"));
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "No Gemini API key configured. Add GEMINI_API_KEY to .env.local (or Vercel Environment Variables), or enter a temporary key in Settings.",
      },
      { status: 503 }
    );
  }

  const requestedModel = body.model?.trim() || DEFAULT_CHAT_MODEL;
  const tone: PersonaTone = body.tone || "classic";
  const searchGrounding = body.searchGrounding !== false;
  const systemInstruction = buildJarvisSystemInstruction(tone, body.telemetry);
  const contents = toGeminiContents(messages, pendingToolResults);

  const lastUserText =
    [...messages].reverse().find((m) => m.role === "user")?.content || "";

  const ai = createGeminiClient(apiKey);
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: StreamEvent) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      const runGeneration = async (tools: Tool[]) => {
        return ai.models.generateContentStream({
          model: requestedModel,
          contents,
          config: {
            systemInstruction,
            tools: tools.length > 0 ? tools : undefined,
            temperature: tone === "technical" ? 0.35 : 0.7,
          },
        });
      };

      try {
        send({ type: "meta", model: requestedModel });

        const primaryTools: Tool[] = [];
        // When completing a tool round-trip, skip re-declaring tools unless needed
        if (!pendingToolResults) {
          primaryTools.push({
            functionDeclarations: JARVIS_FUNCTION_DECLARATIONS,
          });
        }
        if (searchGrounding) {
          primaryTools.push({ googleSearch: {} });
        }

        let responseStream;
        try {
          responseStream = await runGeneration(primaryTools);
        } catch (firstErr) {
          const msg =
            firstErr instanceof Error ? firstErr.message : String(firstErr);
          const isToolComboUnsupported =
            primaryTools.length > 1 &&
            /tool|search|function|INVALID_ARGUMENT|400/i.test(msg);

          if (!isToolComboUnsupported) {
            throw firstErr;
          }

          // Graceful fallback if a specific Gemini model rejects combining
          // built-in Google Search and custom functionDeclarations in one call.
          const fallbackTools: Tool[] = shouldPreferHudTools(lastUserText)
            ? [{ functionDeclarations: JARVIS_FUNCTION_DECLARATIONS }]
            : [{ googleSearch: {} }];

          responseStream = await runGeneration(fallbackTools);
        }

        const seenSources = new Map<string, GroundingSource>();

        for await (const chunk of responseStream) {
          if (chunk.text) {
            send({ type: "text", delta: chunk.text });
          }

          if (chunk.functionCalls && chunk.functionCalls.length > 0) {
            for (const fc of chunk.functionCalls) {
              if (!fc.name) continue;
              send({
                type: "tool_call",
                call: {
                  id: fc.id,
                  name: fc.name,
                  args: (fc.args as Record<string, unknown>) || {},
                },
              });
            }
          }

          const groundingChunks =
            chunk.candidates?.[0]?.groundingMetadata?.groundingChunks;
          if (Array.isArray(groundingChunks)) {
            for (const gc of groundingChunks) {
              const uri = gc.web?.uri;
              if (uri && !seenSources.has(uri)) {
                seenSources.set(uri, {
                  title: gc.web?.title || new URL(uri).hostname,
                  uri,
                });
              }
            }
          }
        }

        if (seenSources.size > 0) {
          send({ type: "sources", sources: Array.from(seenSources.values()) });
        }

        send({ type: "done" });
      } catch (err) {
        send({ type: "error", message: formatGeminiError(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
