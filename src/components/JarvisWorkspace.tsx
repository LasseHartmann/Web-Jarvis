"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MessageSquarePlus, Trash2 } from "lucide-react";
import { ClearanceGate } from "@/components/ClearanceGate";
import { CommandConsole } from "@/components/CommandConsole";
import { HudHeader } from "@/components/HudHeader";
import { JarvisOrb } from "@/components/JarvisOrb";
import { SettingsModal } from "@/components/SettingsModal";
import { TelemetryPanel } from "@/components/TelemetryPanel";
import {
  playHudChime,
  speakJarvisText,
  startMicMonitor,
  stopJarvisSpeech,
  type MicMonitorHandle,
} from "@/lib/audio";
import type {
  ChatMessage,
  ChatThread,
  GroundingSource,
  HudTheme,
  ImageAttachment,
  JarvisNote,
  JarvisSettings,
  JarvisStatus,
  JarvisTask,
  JarvisTimer,
  PendingToolResult,
  StreamEvent,
  SystemHealth,
  TelemetrySnapshot,
  ToolActionEvent,
} from "@/types/jarvis";

interface BrowserSpeechRecognitionEvent {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    0: { transcript: string };
  }>;
}

interface BrowserSpeechRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: BrowserSpeechRecognitionEvent) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

const STORAGE_KEYS = {
  threads: "jarvis_threads_v1",
  timers: "jarvis_timers_v1",
  tasks: "jarvis_tasks_v1",
  notes: "jarvis_notes_v1",
  settings: "jarvis_settings_v1",
  sessionKey: "jarvis_byok_session_v1",
};

const DEFAULT_SETTINGS: JarvisSettings = {
  theme: "arc-cyan",
  tone: "classic",
  model: "",
  voiceEnabled: false,
  voiceName: "",
  speechRate: 1.04,
  searchGrounding: true,
  soundEffects: true,
  customApiKey: "",
};

function makeNewThread(): ChatThread {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    title: "New Command Session",
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function JarvisWorkspace() {
  const [hydrated, setHydrated] = useState(false);
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [status, setStatus] = useState<JarvisStatus>("standby");

  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string>("");
  const [timers, setTimers] = useState<JarvisTimer[]>([]);
  const [tasks, setTasks] = useState<JarvisTask[]>([]);
  const [notes, setNotes] = useState<JarvisNote[]>([]);
  const [toolLog, setToolLog] = useState<ToolActionEvent[]>([]);
  const [settings, setSettings] = useState<JarvisSettings>(DEFAULT_SETTINGS);

  const [showLeftRail, setShowLeftRail] = useState(true);
  const [showRightRail, setShowRightRail] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [nowMs, setNowMs] = useState(0);

  const [isListening, setIsListening] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState("");

  const abortRef = useRef<AbortController | null>(null);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const micMonitorRef = useRef<MicMonitorHandle | null>(null);
  const completedTimerIdsRef = useRef<Set<string>>(new Set());

  // Keep refs for callbacks inside async stream/speech handlers
  const settingsRef = useRef(settings);
  const timersRef = useRef(timers);
  const tasksRef = useRef(tasks);
  const notesRef = useRef(notes);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);
  useEffect(() => {
    timersRef.current = timers;
  }, [timers]);
  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);
  useEffect(() => {
    notesRef.current = notes;
  }, [notes]);

  const fetchHealth = useCallback(async (overrideKey?: string) => {
    try {
      const headers: Record<string, string> = {};
      const key = overrideKey ?? settingsRef.current.customApiKey;
      if (key.trim()) headers["x-gemini-api-key"] = key.trim();
      const res = await fetch("/api/health", { headers });
      if (res.ok) {
        const data = (await res.json()) as SystemHealth;
        setHealth(data);
      }
    } catch {
      // Network offline or local dev starting up
    }
  }, []);

  // Hydrate persisted state cleanly on mount
  useEffect(() => {
    const savedThreads = readJson<ChatThread[]>(STORAGE_KEYS.threads, []);
    const initialThreads =
      savedThreads.length > 0 ? savedThreads : [makeNewThread()];
    const savedTimers = readJson<JarvisTimer[]>(STORAGE_KEYS.timers, []);
    const savedTasks = readJson<JarvisTask[]>(STORAGE_KEYS.tasks, []);
    const savedNotes = readJson<JarvisNote[]>(STORAGE_KEYS.notes, []);
    const savedSettings = {
      ...DEFAULT_SETTINGS,
      ...readJson<Partial<JarvisSettings>>(STORAGE_KEYS.settings, {}),
      customApiKey:
        typeof window !== "undefined"
          ? window.sessionStorage.getItem(STORAGE_KEYS.sessionKey) || ""
          : "",
    };

    const isNarrow = window.innerWidth < 1100;
    queueMicrotask(() => {
      setThreads(initialThreads);
      setActiveThreadId(initialThreads[0].id);
      setTimers(savedTimers);
      setTasks(savedTasks);
      setNotes(savedNotes);
      setSettings(savedSettings);
      setNowMs(Date.now());
      if (isNarrow) {
        setShowLeftRail(false);
        setShowRightRail(false);
      }
      setHydrated(true);
      void fetchHealth(savedSettings.customApiKey);
    });
  }, [fetchHealth]);

  // Persist workspace data
  useEffect(() => {
    if (!hydrated) return;
    try {
      // Strip large base64 attachments from localStorage archive to prevent quota overflow
      const compactThreads = threads.slice(0, 20).map((t) => ({
        ...t,
        messages: t.messages.map((m) => ({
          ...m,
          isStreaming: false,
          attachments: undefined,
        })),
      }));
      localStorage.setItem(STORAGE_KEYS.threads, JSON.stringify(compactThreads));
    } catch {
      // Ignore storage quota errors
    }
  }, [threads, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(STORAGE_KEYS.timers, JSON.stringify(timers));
  }, [timers, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(STORAGE_KEYS.tasks, JSON.stringify(tasks));
  }, [tasks, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(STORAGE_KEYS.notes, JSON.stringify(notes));
  }, [notes, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    const { customApiKey, ...persistable } = settings;
    localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(persistable));
    if (customApiKey.trim()) {
      sessionStorage.setItem(STORAGE_KEYS.sessionKey, customApiKey.trim());
    } else {
      sessionStorage.removeItem(STORAGE_KEYS.sessionKey);
    }
  }, [settings, hydrated]);

  // Live 1-second tick for countdown timers & completion chime
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setNowMs(now);

      for (const timer of timersRef.current) {
        if (timer.endsAt <= now && !completedTimerIdsRef.current.has(timer.id)) {
          completedTimerIdsRef.current.add(timer.id);
          playHudChime("timer", settingsRef.current.soundEffects);
          if (settingsRef.current.voiceEnabled) {
            speakJarvisText(`Timer complete: ${timer.label}.`, {
              voiceName: settingsRef.current.voiceName,
              rate: settingsRef.current.speechRate,
            });
          }
        }
      }
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const activeThread =
    threads.find((t) => t.id === activeThreadId) || threads[0] || null;

  const updateSettings = useCallback((patch: Partial<JarvisSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  const handleNewThread = useCallback(() => {
    stopJarvisSpeech();
    const fresh = makeNewThread();
    setThreads((prev) => [fresh, ...prev]);
    setActiveThreadId(fresh.id);
  }, []);

  const handleDeleteThread = useCallback(
    (id: string) => {
      setThreads((prev) => {
        const remaining = prev.filter((t) => t.id !== id);
        if (remaining.length === 0) {
          const fresh = makeNewThread();
          setActiveThreadId(fresh.id);
          return [fresh];
        }
        if (activeThreadId === id) {
          setActiveThreadId(remaining[0].id);
        }
        return remaining;
      });
    },
    [activeThreadId]
  );

  // Telemetry state mutations
  const addTimer = useCallback((label: string, durationSeconds: number) => {
    const clamped = Math.max(1, Math.min(86400, Math.round(durationSeconds)));
    const now = Date.now();
    const timer: JarvisTimer = {
      id: crypto.randomUUID(),
      label: label.trim() || "Countdown",
      durationSeconds: clamped,
      endsAt: now + clamped * 1000,
      createdAt: now,
    };
    setTimers((prev) => [timer, ...prev]);
    return timer;
  }, []);

  const removeTimer = useCallback((id: string) => {
    completedTimerIdsRef.current.delete(id);
    setTimers((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addTask = useCallback(
    (title: string, priority: "low" | "normal" | "high" = "normal") => {
      const task: JarvisTask = {
        id: crypto.randomUUID(),
        title: title.trim(),
        priority,
        completed: false,
        createdAt: Date.now(),
      };
      setTasks((prev) => [task, ...prev]);
      return task;
    },
    []
  );

  const toggleTask = useCallback((id: string) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, completed: !t.completed } : t))
    );
  }, []);

  const removeTask = useCallback((id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addNote = useCallback((title: string, body: string) => {
    const now = Date.now();
    const note: JarvisNote = {
      id: crypto.randomUUID(),
      title: title.trim() || "Briefing Note",
      body: body.trim(),
      createdAt: now,
      updatedAt: now,
    };
    setNotes((prev) => [note, ...prev]);
    return note;
  }, []);

  const removeNote = useCallback((id: string) => {
    setNotes((prev) => prev.filter((n) => n.id !== id));
  }, []);

  // Execute client-side Gemini function calls
  const executeClientTool = useCallback(
    (
      name: string,
      args: Record<string, unknown>
    ): { event: ToolActionEvent; result: Record<string, unknown> } => {
      const id = crypto.randomUUID();
      const timestamp = Date.now();

      try {
        switch (name) {
          case "start_timer": {
            const label = String(args.label || "Countdown");
            const seconds = Number(args.duration_seconds || 60);
            const timer = addTimer(label, seconds);
            const summary = `Started ${timer.durationSeconds}s timer "${timer.label}"`;
            return {
              event: { id, name, args, status: "executed", summary, timestamp },
              result: {
                ok: true,
                timer_id: timer.id,
                label: timer.label,
                duration_seconds: timer.durationSeconds,
              },
            };
          }

          case "cancel_timer": {
            const target = String(args.target || "").toLowerCase();
            if (target === "all") {
              setTimers([]);
              return {
                event: {
                  id,
                  name,
                  args,
                  status: "executed",
                  summary: "Cleared all active timers",
                  timestamp,
                },
                result: { ok: true, cleared: "all" },
              };
            }
            const match = timersRef.current.find(
              (t) =>
                t.id === target || t.label.toLowerCase().includes(target)
            );
            if (!match) {
              return {
                event: {
                  id,
                  name,
                  args,
                  status: "failed",
                  summary: `No timer matched "${args.target}"`,
                  timestamp,
                },
                result: { ok: false, error: "Timer not found" },
              };
            }
            removeTimer(match.id);
            return {
              event: {
                id,
                name,
                args,
                status: "executed",
                summary: `Canceled timer "${match.label}"`,
                timestamp,
              },
              result: { ok: true, canceled: match.label },
            };
          }

          case "add_task": {
            const title = String(args.title || "Untitled task");
            const rawPrio = String(args.priority || "normal").toLowerCase();
            const priority: "low" | "normal" | "high" =
              rawPrio === "high" || rawPrio === "low" ? rawPrio : "normal";
            const task = addTask(title, priority);
            return {
              event: {
                id,
                name,
                args,
                status: "executed",
                summary: `Queued [${priority}] "${task.title}"`,
                timestamp,
              },
              result: { ok: true, task_id: task.id, title: task.title, priority },
            };
          }

          case "complete_task": {
            const target = String(args.target || "").toLowerCase();
            const match = tasksRef.current.find(
              (t) =>
                !t.completed &&
                (t.id === target || t.title.toLowerCase().includes(target))
            );
            if (!match) {
              return {
                event: {
                  id,
                  name,
                  args,
                  status: "failed",
                  summary: `No open task matched "${args.target}"`,
                  timestamp,
                },
                result: { ok: false, error: "Task not found" },
              };
            }
            toggleTask(match.id);
            return {
              event: {
                id,
                name,
                args,
                status: "executed",
                summary: `Completed "${match.title}"`,
                timestamp,
              },
              result: { ok: true, completed: match.title },
            };
          }

          case "save_note": {
            const title = String(args.title || "Briefing Note");
            const body = String(args.body || "");
            const note = addNote(title, body);
            return {
              event: {
                id,
                name,
                args,
                status: "executed",
                summary: `Stored note "${note.title}"`,
                timestamp,
              },
              result: { ok: true, note_id: note.id, title: note.title },
            };
          }

          case "set_hud_theme": {
            const requested = String(args.theme || "arc-cyan");
            const validThemes: HudTheme[] = [
              "arc-cyan",
              "amber-alert",
              "stealth-emerald",
            ];
            const theme: HudTheme = validThemes.includes(requested as HudTheme)
              ? (requested as HudTheme)
              : "arc-cyan";
            updateSettings({ theme });
            return {
              event: {
                id,
                name,
                args,
                status: "executed",
                summary: `HUD optics set to ${theme}`,
                timestamp,
              },
              result: { ok: true, theme },
            };
          }

          case "clear_console": {
            handleNewThread();
            return {
              event: {
                id,
                name,
                args,
                status: "executed",
                summary: "Initialized fresh console session",
                timestamp,
              },
              result: { ok: true, cleared: true },
            };
          }

          default:
            return {
              event: {
                id,
                name,
                args,
                status: "failed",
                summary: `Unknown tool "${name}"`,
                timestamp,
              },
              result: { ok: false, error: `Unknown tool ${name}` },
            };
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Tool execution failed";
        return {
          event: { id, name, args, status: "failed", summary: msg, timestamp },
          result: { ok: false, error: msg },
        };
      }
    },
    [
      addNote,
      addTask,
      addTimer,
      handleNewThread,
      removeTimer,
      toggleTask,
      updateSettings,
    ]
  );

  const buildTelemetrySnapshot = useCallback((): TelemetrySnapshot => {
    const now = Date.now();
    return {
      localTime: new Date(now).toLocaleString(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      theme: settingsRef.current.theme,
      activeTimers: timersRef.current
        .filter((t) => t.endsAt > now)
        .map((t) => ({
          id: t.id,
          label: t.label,
          remainingSeconds: Math.max(0, Math.round((t.endsAt - now) / 1000)),
        })),
      tasks: tasksRef.current.map((t) => ({
        id: t.id,
        title: t.title,
        priority: t.priority,
        completed: t.completed,
      })),
      notes: notesRef.current.map((n) => ({
        id: n.id,
        title: n.title,
        bodyPreview: n.body.slice(0, 120),
      })),
    };
  }, []);

  const speakResponse = useCallback((text: string) => {
    setStatus("speaking");
    speakJarvisText(text, {
      voiceName: settingsRef.current.voiceName,
      rate: settingsRef.current.speechRate,
      onStart: () => setStatus("speaking"),
      onEnd: () => setStatus("standby"),
    });
  }, []);

  const stopGeneration = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    stopJarvisSpeech();
    setStatus("standby");
  }, []);

  // Core streaming request to /api/chat with optional tool-result follow-up
  const runChatStream = useCallback(
    async (
      threadId: string,
      assistantMsgId: string,
      payloadMessages: Array<{
        role: "user" | "assistant";
        content: string;
        attachments?: ImageAttachment[];
      }>,
      pendingToolResults?: PendingToolResult[]
    ): Promise<{
      accumulatedText: string;
      toolCalls: Array<{ name: string; args: Record<string, unknown> }>;
      hadError: boolean;
    }> => {
      const controller = new AbortController();
      abortRef.current = controller;

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (settingsRef.current.customApiKey.trim()) {
        headers["x-gemini-api-key"] = settingsRef.current.customApiKey.trim();
      }

      const res = await fetch("/api/chat", {
        method: "POST",
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          messages: payloadMessages,
          model: settingsRef.current.model || undefined,
          tone: settingsRef.current.tone,
          searchGrounding: settingsRef.current.searchGrounding,
          telemetry: buildTelemetrySnapshot(),
          pendingToolResults,
        }),
      });

      if (!res.ok || !res.body) {
        let errorMsg = `Request failed (${res.status}).`;
        try {
          const data = await res.json();
          if (data.error) errorMsg = data.error;
        } catch {
          // keep fallback
        }
        if (res.status === 401) {
          void fetchHealth();
        }
        setThreads((prev) =>
          prev.map((t) =>
            t.id !== threadId
              ? t
              : {
                  ...t,
                  messages: t.messages.map((m) =>
                    m.id === assistantMsgId
                      ? { ...m, isStreaming: false, error: errorMsg }
                      : m
                  ),
                }
          )
        );
        return { accumulatedText: "", toolCalls: [], hadError: true };
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let accumulatedText = "";
      let resolvedModel = "";
      const toolCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
      let sources: GroundingSource[] = [];
      let hadError = false;

      const patchAssistant = (
        updater: (msg: ChatMessage) => ChatMessage
      ) => {
        setThreads((prev) =>
          prev.map((t) =>
            t.id !== threadId
              ? t
              : {
                  ...t,
                  updatedAt: Date.now(),
                  messages: t.messages.map((m) =>
                    m.id === assistantMsgId ? updater(m) : m
                  ),
                }
          )
        );
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;
          let event: StreamEvent;
          try {
            event = JSON.parse(line) as StreamEvent;
          } catch {
            continue;
          }

          if (event.type === "meta") {
            resolvedModel = event.model;
            patchAssistant((m) => ({ ...m, model: resolvedModel }));
          } else if (event.type === "text") {
            accumulatedText += event.delta;
            patchAssistant((m) => ({
              ...m,
              content: m.content + event.delta,
            }));
          } else if (event.type === "tool_call") {
            toolCalls.push({ name: event.call.name, args: event.call.args });
          } else if (event.type === "sources") {
            sources = event.sources;
            patchAssistant((m) => ({ ...m, sources }));
          } else if (event.type === "error") {
            hadError = true;
            patchAssistant((m) => ({
              ...m,
              isStreaming: false,
              error: event.message,
            }));
          }
        }
      }

      return { accumulatedText, toolCalls, hadError };
    },
    [buildTelemetrySnapshot, fetchHealth]
  );

  const handleSendMessage = useCallback(
    async (text: string, attachments: ImageAttachment[]) => {
      if (!activeThread) return;
      stopJarvisSpeech();

      const threadId = activeThread.id;
      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: text,
        timestamp: Date.now(),
        attachments: attachments.length > 0 ? attachments : undefined,
      };
      const assistantMsgId = crypto.randomUUID();
      const assistantPlaceholder: ChatMessage = {
        id: assistantMsgId,
        role: "assistant",
        content: "",
        timestamp: Date.now(),
        isStreaming: true,
      };

      const historyPayload = [
        ...activeThread.messages
          .filter((m) => !m.error)
          .map((m) => ({
            role: m.role,
            content: m.content,
            attachments: m.attachments,
          })),
        {
          role: "user" as const,
          content: text,
          attachments: attachments.length > 0 ? attachments : undefined,
        },
      ];

      setThreads((prev) =>
        prev.map((t) => {
          if (t.id !== threadId) return t;
          const isFirst = t.messages.length === 0;
          return {
            ...t,
            title: isFirst ? text.slice(0, 42) : t.title,
            updatedAt: Date.now(),
            messages: [...t.messages, userMsg, assistantPlaceholder],
          };
        })
      );

      setStatus("thinking");

      try {
        const firstPass = await runChatStream(
          threadId,
          assistantMsgId,
          historyPayload
        );

        let finalSpokenText = firstPass.accumulatedText;

        // If Gemini requested HUD tool calls, execute them locally and run follow-up confirmation
        if (!firstPass.hadError && firstPass.toolCalls.length > 0) {
          setStatus("tool_active");
          playHudChime("tool", settingsRef.current.soundEffects);

          const executedEvents: ToolActionEvent[] = [];
          const pendingResults: PendingToolResult[] = [];
          let clearedConsole = false;

          for (const call of firstPass.toolCalls) {
            if (call.name === "clear_console") clearedConsole = true;
            const { event, result } = executeClientTool(call.name, call.args);
            executedEvents.push(event);
            pendingResults.push({
              name: call.name,
              args: call.args,
              result,
            });
          }

          setToolLog((prev) => [...executedEvents, ...prev].slice(0, 25));

          if (!clearedConsole) {
            setThreads((prev) =>
              prev.map((t) =>
                t.id !== threadId
                  ? t
                  : {
                      ...t,
                      messages: t.messages.map((m) =>
                        m.id === assistantMsgId
                          ? { ...m, toolActions: executedEvents }
                          : m
                      ),
                    }
              )
            );

            if (!finalSpokenText.trim()) {
              const followUp = await runChatStream(
                threadId,
                assistantMsgId,
                historyPayload,
                pendingResults
              );
              finalSpokenText = followUp.accumulatedText;
            }
          }
        }

        // Mark streaming complete
        setThreads((prev) =>
          prev.map((t) =>
            t.id !== threadId
              ? t
              : {
                  ...t,
                  messages: t.messages.map((m) =>
                    m.id === assistantMsgId ? { ...m, isStreaming: false } : m
                  ),
                }
          )
        );

        if (firstPass.hadError) {
          playHudChime("error", settingsRef.current.soundEffects);
          setStatus("error");
          setTimeout(() => setStatus("standby"), 2800);
        } else if (settingsRef.current.voiceEnabled && finalSpokenText.trim()) {
          speakResponse(finalSpokenText);
        } else {
          setStatus("standby");
        }
      } catch (err) {
        const aborted = err instanceof DOMException && err.name === "AbortError";
        setThreads((prev) =>
          prev.map((t) =>
            t.id !== threadId
              ? t
              : {
                  ...t,
                  messages: t.messages.map((m) =>
                    m.id === assistantMsgId
                      ? {
                          ...m,
                          isStreaming: false,
                          error: aborted
                            ? undefined
                            : "Transmission interrupted. Check connection and try again.",
                        }
                      : m
                  ),
                }
          )
        );
        setStatus(aborted ? "standby" : "error");
      } finally {
        abortRef.current = null;
      }
    },
    [activeThread, executeClientTool, runChatStream, speakResponse]
  );

  // Voice dictation with Web Speech API + Web Audio AnalyserNode for Arc Core
  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    micMonitorRef.current?.stop();
    micMonitorRef.current = null;
    setIsListening(false);
    setInterimTranscript("");
    setStatus((prev) => (prev === "listening" ? "standby" : prev));
  }, []);

  const toggleListening = useCallback(async () => {
    if (isListening) {
      playHudChime("deactivate", settingsRef.current.soundEffects);
      stopListening();
      return;
    }

    stopJarvisSpeech();
    const SpeechRec =
      (
        window as unknown as {
          SpeechRecognition?: new () => BrowserSpeechRecognition;
          webkitSpeechRecognition?: new () => BrowserSpeechRecognition;
        }
      ).SpeechRecognition ||
      (
        window as unknown as {
          webkitSpeechRecognition?: new () => BrowserSpeechRecognition;
        }
      ).webkitSpeechRecognition;

    if (!SpeechRec) {
      alert(
        "Browser voice recognition is not supported in this browser. Try Chrome or Edge over HTTPS / localhost."
      );
      return;
    }

    playHudChime("activate", settingsRef.current.soundEffects);
    setIsListening(true);
    setStatus("listening");
    setInterimTranscript("");

    // Start live mic frequency monitor for the Arc-Reactor orb
    micMonitorRef.current = await startMicMonitor();

    const recognition = new SpeechRec();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    let finalTranscript = "";

    recognition.onresult = (event: BrowserSpeechRecognitionEvent) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const piece = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += piece;
        } else {
          interim += piece;
        }
      }
      setInterimTranscript((finalTranscript + interim).trim());
    };

    recognition.onerror = () => {
      stopListening();
    };

    recognition.onend = () => {
      const spoken = finalTranscript.trim();
      micMonitorRef.current?.stop();
      micMonitorRef.current = null;
      recognitionRef.current = null;
      setIsListening(false);
      setInterimTranscript("");
      if (spoken) {
        void handleSendMessage(spoken, []);
      } else {
        setStatus("standby");
      }
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      stopListening();
    }
  }, [handleSendMessage, isListening, stopListening]);

  // Lock session (clears clearance cookie)
  const handleLockSession = useCallback(async () => {
    await fetch("/api/auth", { method: "DELETE" });
    await fetchHealth();
  }, [fetchHealth]);

  // Global keyboard shortcut Ctrl/Cmd + K for new session
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        handleNewThread();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleNewThread]);

  const activeModelDisplay =
    settings.model || health?.defaultChatModel || "gemini-2.5-flash";
  const hasApiKey = Boolean(
    health?.apiKeyConfigured || settings.customApiKey.trim()
  );

  // If server enforces passcode and user isn't authenticated yet, show Clearance Gate
  if (health?.passcodeRequired && !health.authenticated) {
    return (
      <div data-theme={settings.theme} className="min-h-screen">
        <ClearanceGate onUnlocked={() => void fetchHealth()} />
      </div>
    );
  }

  return (
    <div
      data-theme={settings.theme}
      className="hud-backdrop flex h-dvh flex-col overflow-hidden text-[var(--hud-text)]"
    >
      <HudHeader
        status={status}
        health={health}
        settings={settings}
        activeModel={activeModelDisplay}
        showLeftRail={showLeftRail}
        showRightRail={showRightRail}
        onToggleLeftRail={() => setShowLeftRail((v) => !v)}
        onToggleRightRail={() => setShowRightRail((v) => !v)}
        onToggleVoice={() => {
          if (settings.voiceEnabled) stopJarvisSpeech();
          updateSettings({ voiceEnabled: !settings.voiceEnabled });
        }}
        onToggleSearch={() =>
          updateSettings({ searchGrounding: !settings.searchGrounding })
        }
        onOpenSettings={() => setSettingsOpen(true)}
        onLockSession={handleLockSession}
      />

      {/* Main 3-Panel HUD Cockpit */}
      <main className="relative flex min-h-0 flex-1 overflow-hidden">
        {/* Left Rail: Arc Core + Session Archives */}
        {showLeftRail && (
          <aside className="hud-panel z-10 flex w-72 shrink-0 flex-col border-y-0 border-l-0 max-md:absolute max-md:inset-y-0 max-md:left-0 max-md:shadow-2xl">
            <div className="flex flex-col items-center border-b border-[var(--hud-border)] px-4 py-5">
              <JarvisOrb
                status={status}
                theme={settings.theme}
                isListening={isListening}
                getAudioLevel={() => micMonitorRef.current?.getLevel() ?? 0}
                onToggleListen={() => void toggleListening()}
                onStopSpeaking={() => {
                  stopJarvisSpeech();
                  setStatus("standby");
                }}
              />
            </div>

            <div className="flex items-center justify-between px-4 pb-2 pt-3">
              <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--hud-accent)]">
                Command Archives
              </span>
              <button
                type="button"
                onClick={handleNewThread}
                title="New Session (Ctrl+K)"
                className="inline-flex items-center gap-1 rounded-md border border-[var(--hud-border)] px-2 py-1 font-mono text-[10px] text-[var(--hud-text)] transition-colors hover:border-[var(--hud-border-strong)] hover:bg-[var(--hud-accent-soft)]"
              >
                <MessageSquarePlus className="h-3 w-3" />
                <span>NEW</span>
              </button>
            </div>

            <div className="hud-scrollbar flex-1 space-y-1.5 overflow-y-auto px-3 pb-4">
              {threads.map((thread) => {
                const isActive = thread.id === activeThread?.id;
                return (
                  <div
                    key={thread.id}
                    className={`group flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-xs transition-all ${
                      isActive
                        ? "border-[var(--hud-border-strong)] bg-[var(--hud-accent-soft)] text-[var(--hud-text)]"
                        : "border-transparent bg-black/20 text-[var(--hud-muted)] hover:border-[var(--hud-border)] hover:text-[var(--hud-text)]"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setActiveThreadId(thread.id)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <p className="truncate font-medium">{thread.title}</p>
                      <p className="mt-0.5 font-mono text-[10px] opacity-70">
                        {thread.messages.length} msgs
                      </p>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteThread(thread.id)}
                      className="opacity-0 transition-opacity group-hover:opacity-100 text-[var(--hud-muted)] hover:text-red-300"
                      title="Delete session"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          </aside>
        )}

        {/* Center Command Console */}
        <CommandConsole
          messages={activeThread?.messages || []}
          status={status}
          hasApiKey={hasApiKey}
          isListening={isListening}
          interimTranscript={interimTranscript}
          searchGrounding={settings.searchGrounding}
          onSendMessage={handleSendMessage}
          onStopGeneration={stopGeneration}
          onToggleListen={() => void toggleListening()}
          onToggleSearch={() =>
            updateSettings({ searchGrounding: !settings.searchGrounding })
          }
          onSpeakMessage={speakResponse}
          onOpenSettings={() => setSettingsOpen(true)}
        />

        {/* Right Rail: Telemetry Panel */}
        {showRightRail && (
          <div className="z-10 w-80 shrink-0 max-lg:absolute max-lg:inset-y-0 max-lg:right-0 max-lg:shadow-2xl">
            <TelemetryPanel
              nowMs={nowMs}
              timers={timers}
              tasks={tasks}
              notes={notes}
              toolLog={toolLog}
              onAddTimer={addTimer}
              onRemoveTimer={removeTimer}
              onAddTask={addTask}
              onToggleTask={toggleTask}
              onRemoveTask={removeTask}
              onAddNote={addNote}
              onRemoveNote={removeNote}
            />
          </div>
        )}
      </main>

      <SettingsModal
        open={settingsOpen}
        settings={settings}
        health={health}
        onUpdate={updateSettings}
        onClose={() => setSettingsOpen(false)}
        onRefreshHealth={() => void fetchHealth()}
      />
    </div>
  );
}
