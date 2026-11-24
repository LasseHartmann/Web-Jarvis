import { isKvConfigured, kvGetJson, kvSetJson } from "@/lib/integrations/kv";

export interface MemoryItem {
  id: string;
  key: string;
  fact: string;
  category: string;
  updatedAt: string;
}

const MEMORY_KV_KEY = "jarvis:memories:v1";

export async function handleServerMemory(args: {
  action: "remember" | "recall" | "forget" | "list";
  key?: string;
  fact?: string;
  category?: string;
  query?: string;
}): Promise<Record<string, unknown>> {
  if (!isKvConfigured()) {
    return {
      ok: true,
      storage: "browser-local",
      fallbackToClient: true,
    };
  }

  const memories = (await kvGetJson<MemoryItem[]>(MEMORY_KV_KEY)) || [];

  switch (args.action) {
    case "remember": {
      const fact = args.fact?.trim();
      if (!fact) return { ok: false, error: "A fact is required to remember." };
      const key = (args.key?.trim() || fact.slice(0, 36)).toLowerCase();
      const category = args.category?.trim() || "general";
      const now = new Date().toISOString();

      const existingIdx = memories.findIndex((m) => m.key === key);
      const item: MemoryItem = {
        id: existingIdx >= 0 ? memories[existingIdx].id : crypto.randomUUID(),
        key,
        fact,
        category,
        updatedAt: now,
      };

      if (existingIdx >= 0) {
        memories[existingIdx] = item;
      } else {
        memories.unshift(item);
      }

      await kvSetJson(MEMORY_KV_KEY, memories.slice(0, 150));
      return { ok: true, storage: "cloud-kv", saved: item };
    }

    case "recall": {
      const q = (args.query || args.key || "").trim().toLowerCase();
      const matches = q
        ? memories.filter(
            (m) =>
              m.key.includes(q) ||
              m.fact.toLowerCase().includes(q) ||
              m.category.toLowerCase().includes(q)
          )
        : memories.slice(0, 20);
      return { ok: true, storage: "cloud-kv", count: matches.length, memories: matches };
    }

    case "forget": {
      const target = (args.key || args.query || "").trim().toLowerCase();
      if (!target) return { ok: false, error: "Specify which memory to forget." };
      const before = memories.length;
      const remaining = memories.filter(
        (m) => !m.key.includes(target) && !m.fact.toLowerCase().includes(target)
      );
      await kvSetJson(MEMORY_KV_KEY, remaining);
      return {
        ok: true,
        storage: "cloud-kv",
        removedCount: before - remaining.length,
      };
    }

    case "list":
    default:
      return {
        ok: true,
        storage: "cloud-kv",
        count: memories.length,
        memories: memories.slice(0, 30),
      };
  }
}

export async function getCloudMemoryBrief(): Promise<string[]> {
  if (!isKvConfigured()) return [];
  const memories = (await kvGetJson<MemoryItem[]>(MEMORY_KV_KEY)) || [];
  return memories.slice(0, 20).map((m) => `[${m.category}] ${m.fact}`);
}
