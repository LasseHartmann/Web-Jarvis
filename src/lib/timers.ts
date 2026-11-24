"use client";

export interface LocalTimer {
  id: string;
  label: string;
  durationSeconds: number;
  endsAt: number;
  createdAt: number;
}

export interface LocalMemoryItem {
  id: string;
  key: string;
  fact: string;
  category: string;
  updatedAt: string;
}

const TIMERS_STORAGE_KEY = "jarvis_voice_timers_v1";
const MEMORIES_STORAGE_KEY = "jarvis_local_memories_v1";

export class JarvisTimerManager {
  private timers: LocalTimer[] = [];
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private onTimerFinished: ((timer: LocalTimer) => void) | null = null;

  public start(onTimerFinished: (timer: LocalTimer) => void) {
    this.onTimerFinished = onTimerFinished;
    this.load();
    if (this.intervalId) clearInterval(this.intervalId);
    this.intervalId = setInterval(() => this.tick(), 1000);
  }

  public stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private load() {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(TIMERS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as LocalTimer[];
        const now = Date.now();
        this.timers = parsed.filter((t) => t.endsAt > now);
      }
    } catch {
      this.timers = [];
    }
  }

  private persist() {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        TIMERS_STORAGE_KEY,
        JSON.stringify(this.timers)
      );
    } catch {
      // Ignore storage errors
    }
  }

  private tick() {
    const now = Date.now();
    const expired = this.timers.filter((t) => t.endsAt <= now);
    if (expired.length === 0) return;

    this.timers = this.timers.filter((t) => t.endsAt > now);
    this.persist();

    for (const timer of expired) {
      this.onTimerFinished?.(timer);
    }
  }

  public setTimer(label: string, durationSeconds: number): LocalTimer {
    const clamped = Math.max(1, Math.min(86400, Math.round(durationSeconds)));
    const now = Date.now();
    const timer: LocalTimer = {
      id: crypto.randomUUID(),
      label: label.trim() || "Timer",
      durationSeconds: clamped,
      endsAt: now + clamped * 1000,
      createdAt: now,
    };
    this.timers.push(timer);
    this.persist();
    return timer;
  }

  public listTimers(): Array<{
    id: string;
    label: string;
    remainingSeconds: number;
  }> {
    const now = Date.now();
    this.timers = this.timers.filter((t) => t.endsAt > now);
    this.persist();
    return this.timers.map((t) => ({
      id: t.id,
      label: t.label,
      remainingSeconds: Math.max(0, Math.round((t.endsAt - now) / 1000)),
    }));
  }

  public cancelTimer(target: string): { removed: number; labels: string[] } {
    const q = target.trim().toLowerCase();
    if (!q || q === "all") {
      const labels = this.timers.map((t) => t.label);
      this.timers = [];
      this.persist();
      return { removed: labels.length, labels };
    }
    const matching = this.timers.filter(
      (t) => t.id === target || t.label.toLowerCase().includes(q)
    );
    const ids = new Set(matching.map((t) => t.id));
    this.timers = this.timers.filter((t) => !ids.has(t.id));
    this.persist();
    return { removed: matching.length, labels: matching.map((t) => t.label) };
  }
}

export function handleLocalMemoryFallback(args: {
  action: "remember" | "recall" | "forget" | "list";
  key?: string;
  fact?: string;
  category?: string;
  query?: string;
}): Record<string, unknown> {
  if (typeof window === "undefined") {
    return { ok: false, error: "Local storage unavailable." };
  }

  let items: LocalMemoryItem[] = [];
  try {
    const raw = window.localStorage.getItem(MEMORIES_STORAGE_KEY);
    if (raw) items = JSON.parse(raw) as LocalMemoryItem[];
  } catch {
    items = [];
  }

  const save = () => {
    try {
      window.localStorage.setItem(
        MEMORIES_STORAGE_KEY,
        JSON.stringify(items.slice(0, 150))
      );
    } catch {
      // Ignore
    }
  };

  switch (args.action) {
    case "remember": {
      const fact = args.fact?.trim();
      if (!fact) return { ok: false, error: "A fact is required." };
      const key = (args.key?.trim() || fact.slice(0, 36)).toLowerCase();
      const category = args.category?.trim() || "general";
      const now = new Date().toISOString();
      const idx = items.findIndex((m) => m.key === key);
      const item: LocalMemoryItem = {
        id: idx >= 0 ? items[idx].id : crypto.randomUUID(),
        key,
        fact,
        category,
        updatedAt: now,
      };
      if (idx >= 0) items[idx] = item;
      else items.unshift(item);
      save();
      return { ok: true, storage: "browser-local", saved: item };
    }
    case "recall": {
      const q = (args.query || args.key || "").trim().toLowerCase();
      const matches = q
        ? items.filter(
            (m) =>
              m.key.includes(q) ||
              m.fact.toLowerCase().includes(q) ||
              m.category.toLowerCase().includes(q)
          )
        : items.slice(0, 20);
      return { ok: true, storage: "browser-local", count: matches.length, memories: matches };
    }
    case "forget": {
      const target = (args.key || args.query || "").trim().toLowerCase();
      if (!target) return { ok: false, error: "Specify which memory to forget." };
      const before = items.length;
      items = items.filter(
        (m) => !m.key.includes(target) && !m.fact.toLowerCase().includes(target)
      );
      save();
      return { ok: true, storage: "browser-local", removedCount: before - items.length };
    }
    case "list":
    default:
      return { ok: true, storage: "browser-local", count: items.length, memories: items.slice(0, 30) };
  }
}

export function getLocalMemoryBrief(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(MEMORIES_STORAGE_KEY);
    if (!raw) return [];
    const items = JSON.parse(raw) as LocalMemoryItem[];
    return items.slice(0, 15).map((m) => `[${m.category}] ${m.fact}`);
  } catch {
    return [];
  }
}
