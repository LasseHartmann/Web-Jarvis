"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  AlertTriangle,
  ArrowUp,
  Check,
  Copy,
  ExternalLink,
  Globe,
  ImagePlus,
  Mic,
  MicOff,
  Settings,
  Sparkles,
  Square,
  Volume2,
  Wrench,
  X,
} from "lucide-react";
import { TOOL_DISPLAY_NAMES } from "@/lib/tools";
import type { ChatMessage, ImageAttachment, JarvisStatus } from "@/types/jarvis";

interface CommandConsoleProps {
  messages: ChatMessage[];
  status: JarvisStatus;
  hasApiKey: boolean;
  isListening: boolean;
  interimTranscript: string;
  searchGrounding: boolean;
  onSendMessage: (text: string, attachments: ImageAttachment[]) => void;
  onStopGeneration: () => void;
  onToggleListen: () => void;
  onToggleSearch: () => void;
  onSpeakMessage: (text: string) => void;
  onOpenSettings: () => void;
}

const QUICK_PROMPTS = [
  {
    label: "Set a 5-min timer",
    prompt: "Set a 5 minute timer labeled Coffee Break.",
  },
  {
    label: "Add a high-priority task",
    prompt: "Add a high-priority task to review the Vercel deployment.",
  },
  {
    label: "Switch to Amber Alert",
    prompt: "Switch the HUD theme to Amber Alert mode.",
  },
  {
    label: "Morning status briefing",
    prompt: "Give me a quick J.A.R.V.I.S. status briefing based on my current time, timers, and tasks.",
  },
];

async function fileToAttachment(file: File): Promise<ImageAttachment | null> {
  if (!file.type.startsWith("image/")) return null;
  if (file.size > 5 * 1024 * 1024) return null;

  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const base64 = result.includes(",") ? result.split(",")[1] : result;
      if (!base64) {
        resolve(null);
        return;
      }
      resolve({
        id: crypto.randomUUID(),
        name: file.name || "attachment.png",
        mimeType: file.type,
        dataBase64: base64,
      });
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

export function CommandConsole({
  messages,
  status,
  hasApiKey,
  isListening,
  interimTranscript,
  searchGrounding,
  onSendMessage,
  onStopGeneration,
  onToggleListen,
  onToggleSearch,
  onSpeakMessage,
  onOpenSettings,
}: CommandConsoleProps) {
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<ImageAttachment[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const endRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const isBusy = status === "thinking" || status === "tool_active";

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, interimTranscript]);

  const handleCopy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId((prev) => (prev === id ? null : prev)), 1800);
    } catch {
      // Ignore clipboard failures in restricted contexts
    }
  };

  const addFiles = async (files: FileList | File[]) => {
    const list = Array.from(files).slice(0, 4);
    const converted = await Promise.all(list.map(fileToAttachment));
    const valid = converted.filter((x): x is ImageAttachment => x !== null);
    if (valid.length > 0) {
      setAttachments((prev) => [...prev, ...valid].slice(0, 4));
    }
  };

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = input.trim();
    if ((!trimmed && attachments.length === 0) || isBusy) return;
    onSendMessage(trimmed || "Analyze the attached image(s).", attachments);
    setInput("");
    setAttachments([]);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(e.clipboardData.items);
    const imageFiles = items
      .filter((item) => item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((f): f is File => f !== null);
    if (imageFiles.length > 0) {
      e.preventDefault();
      await addFiles(imageFiles);
    }
  };

  return (
    <section
      className={`relative flex min-h-0 flex-1 flex-col overflow-hidden ${
        isDragging ? "ring-2 ring-inset ring-[var(--hud-accent)]" : ""
      }`}
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={async (e) => {
        e.preventDefault();
        setIsDragging(false);
        if (e.dataTransfer.files?.length) {
          await addFiles(e.dataTransfer.files);
        }
      }}
    >
      {/* Missing API Key Banner */}
      {!hasApiKey && (
        <div className="mx-3 mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-400/40 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-200 sm:mx-5">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
            <span>
              <strong>Gemini API key not detected.</strong> Add{" "}
              <code className="rounded bg-black/40 px-1.5 py-0.5 font-mono text-[11px]">
                GEMINI_API_KEY
              </code>{" "}
              to <code className="font-mono">.env.local</code> (or Vercel Env
              Vars), or enter a session key in Settings.
            </span>
          </div>
          <button
            type="button"
            onClick={onOpenSettings}
            className="inline-flex items-center gap-1.5 rounded-lg border border-amber-400/50 bg-amber-400/15 px-2.5 py-1 font-mono text-[11px] font-medium text-amber-100 hover:bg-amber-400/25"
          >
            <Settings className="h-3.5 w-3.5" />
            <span>OPEN SETTINGS</span>
          </button>
        </div>
      )}

      {/* Transcript Scroll Area */}
      <div className="hud-scrollbar flex-1 overflow-y-auto px-3 py-4 sm:px-6">
        {messages.length === 0 ? (
          <div className="mx-auto flex h-full max-w-2xl flex-col items-center justify-center py-8 text-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-[var(--hud-border)] bg-[var(--hud-accent-soft)] px-3.5 py-1 font-mono text-[11px] tracking-[0.2em] text-[var(--hud-accent)]">
              <Sparkles className="h-3.5 w-3.5" />
              <span>GEMINI NEURAL LINK READY</span>
            </div>
            <h1 className="mt-4 text-2xl font-semibold tracking-tight text-[var(--hud-text)] sm:text-3xl hud-glow-text">
              At your service. What shall we build or analyze?
            </h1>
            <p className="mt-2 max-w-lg text-sm text-[var(--hud-muted)]">
              Speak into the Arc Core, type a command, or drop an image to
              analyze. J.A.R.V.I.S. can ground answers with Google Search and
              control your HUD timers, mission queue, notes, and optics.
            </p>

            <div className="mt-7 grid w-full grid-cols-1 gap-2.5 sm:grid-cols-2">
              {QUICK_PROMPTS.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => onSendMessage(item.prompt, [])}
                  disabled={isBusy}
                  className="hud-panel group flex flex-col items-start rounded-xl px-4 py-3 text-left transition-all hover:border-[var(--hud-border-strong)] hover:bg-[var(--hud-accent-soft)] disabled:opacity-50"
                >
                  <span className="font-mono text-[11px] uppercase tracking-wider text-[var(--hud-accent)]">
                    {item.label}
                  </span>
                  <span className="mt-1 text-xs text-[var(--hud-muted)] group-hover:text-[var(--hud-text)]">
                    {item.prompt}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-5 pb-4">
            {messages.map((msg) => {
              const isUser = msg.role === "user";
              return (
                <article
                  key={msg.id}
                  className={`flex flex-col ${isUser ? "items-end" : "items-start"}`}
                >
                  <div className="mb-1 flex items-center gap-2 px-1 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--hud-muted)]">
                    <span
                      className={isUser ? "text-[var(--hud-muted)]" : "text-[var(--hud-accent)]"}
                    >
                      {isUser ? "OPERATOR" : "J.A.R.V.I.S."}
                    </span>
                    <span>•</span>
                    <span>
                      {new Date(msg.timestamp).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    {msg.model && !isUser && (
                      <>
                        <span>•</span>
                        <span className="opacity-75">{msg.model}</span>
                      </>
                    )}
                  </div>

                  <div
                    className={`max-w-[92%] sm:max-w-[86%] rounded-2xl px-4 py-3 text-sm ${
                      isUser
                        ? "border border-[var(--hud-border-strong)] bg-[var(--hud-accent-soft)] text-[var(--hud-text)]"
                        : "hud-panel text-[var(--hud-text)]"
                    }`}
                  >
                    {/* Image Attachments */}
                    {msg.attachments && msg.attachments.length > 0 && (
                      <div className="mb-2.5 flex flex-wrap gap-2">
                        {msg.attachments.map((att) => (
                          <div
                            key={att.id}
                            className="overflow-hidden rounded-lg border border-[var(--hud-border)] bg-black/40"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={`data:${att.mimeType};base64,${att.dataBase64}`}
                              alt={att.name}
                              className="max-h-44 max-w-[220px] object-cover"
                            />
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Executed Tool Telemetry Cards */}
                    {msg.toolActions && msg.toolActions.length > 0 && (
                      <div className="mb-3 space-y-1.5">
                        {msg.toolActions.map((act) => (
                          <div
                            key={act.id}
                            className="flex items-center gap-2 rounded-lg border border-[var(--hud-border)] bg-black/35 px-3 py-1.5 font-mono text-[11px]"
                          >
                            <Wrench className="h-3.5 w-3.5 shrink-0 text-[var(--hud-accent)]" />
                            <span className="text-[var(--hud-accent)]">
                              {TOOL_DISPLAY_NAMES[act.name] || act.name}
                            </span>
                            <span className="text-[var(--hud-muted)]">—</span>
                            <span className="text-[var(--hud-text)]/90 truncate">
                              {act.summary}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Message Content */}
                    {msg.error ? (
                      <div className="flex items-start gap-2 rounded-lg border border-red-400/35 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
                        <span>{msg.error}</span>
                      </div>
                    ) : isUser ? (
                      <p className="whitespace-pre-wrap leading-relaxed">
                        {msg.content}
                      </p>
                    ) : msg.content ? (
                      <div className="jarvis-markdown">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {msg.content}
                        </ReactMarkdown>
                      </div>
                    ) : msg.isStreaming ? (
                      <div className="flex items-center gap-2 font-mono text-xs text-[var(--hud-accent)]">
                        <span className="inline-block h-2 w-2 rounded-full bg-[var(--hud-accent)] animate-pulse" />
                        <span>Synthesizing telemetry...</span>
                      </div>
                    ) : null}

                    {/* Grounding Sources */}
                    {msg.sources && msg.sources.length > 0 && (
                      <div className="mt-3 border-t border-[var(--hud-border)] pt-2.5">
                        <p className="mb-1.5 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-[var(--hud-muted)]">
                          <Globe className="h-3 w-3 text-[var(--hud-accent)]" />
                          <span>Verified Web Sources</span>
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {msg.sources.map((src) => (
                            <a
                              key={src.uri}
                              href={src.uri}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex max-w-[240px] items-center gap-1 rounded-md border border-[var(--hud-border)] bg-black/30 px-2 py-1 font-mono text-[10px] text-[var(--hud-accent)] transition-colors hover:border-[var(--hud-border-strong)] hover:bg-[var(--hud-accent-soft)]"
                            >
                              <span className="truncate">{src.title}</span>
                              <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Assistant message actions */}
                  {!isUser && msg.content && !msg.isStreaming && (
                    <div className="mt-1.5 flex items-center gap-1 px-1">
                      <button
                        type="button"
                        onClick={() => handleCopy(msg.id, msg.content)}
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1 font-mono text-[10px] text-[var(--hud-muted)] transition-colors hover:bg-[var(--hud-accent-soft)] hover:text-[var(--hud-text)]"
                      >
                        {copiedId === msg.id ? (
                          <>
                            <Check className="h-3 w-3 text-emerald-400" />
                            <span>COPIED</span>
                          </>
                        ) : (
                          <>
                            <Copy className="h-3 w-3" />
                            <span>COPY</span>
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => onSpeakMessage(msg.content)}
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1 font-mono text-[10px] text-[var(--hud-muted)] transition-colors hover:bg-[var(--hud-accent-soft)] hover:text-[var(--hud-text)]"
                      >
                        <Volume2 className="h-3 w-3" />
                        <span>SPEAK</span>
                      </button>
                    </div>
                  )}
                </article>
              );
            })}
            <div ref={endRef} />
          </div>
        )}
      </div>

      {/* Live Voice Dictation Strip */}
      {isListening && (
        <div className="mx-3 mb-2 flex items-center justify-between gap-2 rounded-xl border border-red-400/40 bg-red-500/10 px-3.5 py-2 font-mono text-xs text-red-200 sm:mx-6">
          <div className="flex items-center gap-2 min-w-0">
            <span className="h-2 w-2 shrink-0 rounded-full bg-red-400 animate-ping" />
            <span className="truncate">
              {interimTranscript || "Listening for voice command..."}
            </span>
          </div>
          <button
            type="button"
            onClick={onToggleListen}
            className="shrink-0 rounded-md border border-red-400/40 px-2 py-0.5 text-[10px] uppercase hover:bg-red-400/20"
          >
            STOP
          </button>
        </div>
      )}

      {/* Command Composer */}
      <div className="shrink-0 px-3 pb-3 pt-1 sm:px-6 sm:pb-5">
        <form
          onSubmit={handleSubmit}
          className="hud-panel mx-auto max-w-3xl rounded-2xl p-2.5 focus-within:border-[var(--hud-border-strong)]"
        >
          {/* Staged image attachments */}
          {attachments.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2 px-1">
              {attachments.map((att) => (
                <div
                  key={att.id}
                  className="group relative overflow-hidden rounded-lg border border-[var(--hud-border)] bg-black/40"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`data:${att.mimeType};base64,${att.dataBase64}`}
                    alt={att.name}
                    className="h-16 w-16 object-cover"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setAttachments((prev) =>
                        prev.filter((item) => item.id !== att.id)
                      )
                    }
                    className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/75 text-white hover:bg-red-500"
                    title="Remove attachment"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <textarea
            ref={textareaRef}
            rows={1}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
            }}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder="Issue a command to J.A.R.V.I.S... (Shift+Enter for new line, paste or drop images)"
            className="hud-scrollbar w-full resize-none bg-transparent px-2 py-1.5 text-sm text-[var(--hud-text)] placeholder:text-[var(--hud-muted)]/65 focus:outline-none"
          />

          <div className="mt-1.5 flex items-center justify-between gap-2 border-t border-[var(--hud-border)]/60 pt-2">
            <div className="flex items-center gap-1.5">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={async (e) => {
                  if (e.target.files?.length) {
                    await addFiles(e.target.files);
                    e.target.value = "";
                  }
                }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                title="Attach image for Gemini vision analysis"
                className="flex h-8 items-center gap-1.5 rounded-lg border border-[var(--hud-border)] px-2.5 font-mono text-[11px] text-[var(--hud-muted)] transition-colors hover:border-[var(--hud-border-strong)] hover:text-[var(--hud-text)]"
              >
                <ImagePlus className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">VISION</span>
              </button>

              <button
                type="button"
                onClick={onToggleSearch}
                title="Toggle Google Search Grounding"
                className={`flex h-8 items-center gap-1.5 rounded-lg border px-2.5 font-mono text-[11px] transition-colors ${
                  searchGrounding
                    ? "border-[var(--hud-border-strong)] bg-[var(--hud-accent-soft)] text-[var(--hud-accent)]"
                    : "border-[var(--hud-border)] text-[var(--hud-muted)] hover:text-[var(--hud-text)]"
                }`}
              >
                <Globe className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">SEARCH</span>
              </button>

              <button
                type="button"
                onClick={onToggleListen}
                title={isListening ? "Stop voice dictation" : "Start voice dictation"}
                className={`flex h-8 items-center gap-1.5 rounded-lg border px-2.5 font-mono text-[11px] transition-colors ${
                  isListening
                    ? "border-red-400/60 bg-red-500/15 text-red-300"
                    : "border-[var(--hud-border)] text-[var(--hud-muted)] hover:border-[var(--hud-border-strong)] hover:text-[var(--hud-text)]"
                }`}
              >
                {isListening ? (
                  <Mic className="h-3.5 w-3.5 animate-pulse" />
                ) : (
                  <MicOff className="h-3.5 w-3.5" />
                )}
                <span className="hidden sm:inline">
                  {isListening ? "LIVE MIC" : "MIC"}
                </span>
              </button>
            </div>

            {isBusy ? (
              <button
                type="button"
                onClick={onStopGeneration}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-red-400/50 bg-red-500/15 px-3 font-mono text-[11px] font-medium text-red-200 hover:bg-red-500/25"
              >
                <Square className="h-3 w-3 fill-current" />
                <span>ABORT</span>
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim() && attachments.length === 0}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--hud-border-strong)] bg-[var(--hud-accent-soft)] px-3.5 font-mono text-[11px] font-semibold text-[var(--hud-accent)] transition-all hover:bg-[var(--hud-accent)] hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <span>TRANSMIT</span>
                <ArrowUp className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </form>
      </div>
    </section>
  );
}
