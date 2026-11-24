"use client";

import { useEffect, useState } from "react";
import {
  CheckCircle2,
  KeyRound,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  X,
} from "lucide-react";
import type {
  HudTheme,
  JarvisSettings,
  PersonaTone,
  SystemHealth,
} from "@/types/jarvis";

interface ModelOption {
  id: string;
  label: string;
  tier: string;
}

interface SettingsModalProps {
  open: boolean;
  settings: JarvisSettings;
  health: SystemHealth | null;
  onUpdate: (patch: Partial<JarvisSettings>) => void;
  onClose: () => void;
  onRefreshHealth: () => void;
}

const THEMES: Array<{ id: HudTheme; label: string; swatch: string }> = [
  { id: "arc-cyan", label: "Arc Cyan", swatch: "#22d3ee" },
  { id: "amber-alert", label: "Amber Alert", swatch: "#f59e0b" },
  { id: "stealth-emerald", label: "Stealth Emerald", swatch: "#10b981" },
];

const TONES: Array<{ id: PersonaTone; label: string; desc: string }> = [
  {
    id: "classic",
    label: "Classic J.A.R.V.I.S.",
    desc: "Composed, articulate, dryly witty personal AI butler.",
  },
  {
    id: "concise",
    label: "Tactical Concise",
    desc: "Short, zero-filler telemetry replies ideal for voice.",
  },
  {
    id: "technical",
    label: "Principal Engineer",
    desc: "Deep architectural & code-focused engineering analysis.",
  },
];

export function SettingsModal({
  open,
  settings,
  health,
  onUpdate,
  onClose,
  onRefreshHealth,
}: SettingsModalProps) {
  const [models, setModels] = useState<ModelOption[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  useEffect(() => {
    if (!open) return;

    const loadVoices = () => {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        setVoices(window.speechSynthesis.getVoices());
      }
    };
    loadVoices();
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }

    let cancelled = false;
    const fetchModels = async () => {
      setLoadingModels(true);
      try {
        const headers: Record<string, string> = {};
        if (settings.customApiKey.trim()) {
          headers["x-gemini-api-key"] = settings.customApiKey.trim();
        }
        const res = await fetch("/api/models", { headers });
        if (res.ok) {
          const data = await res.json();
          if (!cancelled && Array.isArray(data.models)) {
            setModels(data.models);
          }
        }
      } finally {
        if (!cancelled) setLoadingModels(false);
      }
    };
    fetchModels();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);

    return () => {
      cancelled = true;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, settings.customApiKey, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="hud-panel hud-scrollbar max-h-[88vh] w-full max-w-xl overflow-y-auto rounded-2xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--hud-border)] pb-3">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4 text-[var(--hud-accent)]" />
            <h2 className="font-mono text-sm font-semibold uppercase tracking-[0.2em] text-[var(--hud-text)]">
              SYSTEM CONFIGURATION
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-[var(--hud-muted)] hover:bg-white/10 hover:text-[var(--hud-text)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-5 space-y-6">
          {/* Diagnostics Banner */}
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <div className="rounded-xl border border-[var(--hud-border)] bg-black/30 p-3">
              <div className="flex items-center gap-2 font-mono text-[11px] text-[var(--hud-muted)]">
                {health?.apiKeyConfigured || settings.customApiKey ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                ) : (
                  <ShieldAlert className="h-4 w-4 text-amber-400" />
                )}
                <span>GEMINI API STATUS</span>
              </div>
              <p className="mt-1 text-xs font-medium text-[var(--hud-text)]">
                {settings.customApiKey
                  ? "Using Session BYOK Key"
                  : health?.apiKeyConfigured
                    ? "Server GEMINI_API_KEY Active"
                    : "Not Configured Yet"}
              </p>
            </div>

            <div className="rounded-xl border border-[var(--hud-border)] bg-black/30 p-3">
              <div className="flex items-center gap-2 font-mono text-[11px] text-[var(--hud-muted)]">
                {health?.passcodeRequired ? (
                  <ShieldCheck className="h-4 w-4 text-emerald-400" />
                ) : (
                  <ShieldAlert className="h-4 w-4 text-amber-400" />
                )}
                <span>VERCEL ACCESS GATE</span>
              </div>
              <p className="mt-1 text-xs font-medium text-[var(--hud-text)]">
                {health?.passcodeRequired
                  ? "Passcode Clearance Enforced"
                  : "Open (set JARVIS_ACCESS_PASSCODE in prod)"}
              </p>
            </div>
          </div>

          {/* Model Selection */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="font-mono text-[11px] uppercase tracking-wider text-[var(--hud-accent)]">
                Gemini Model
              </label>
              <button
                type="button"
                onClick={onRefreshHealth}
                className="inline-flex items-center gap-1 font-mono text-[10px] text-[var(--hud-muted)] hover:text-[var(--hud-accent)]"
              >
                <RefreshCw
                  className={`h-3 w-3 ${loadingModels ? "animate-spin" : ""}`}
                />
                <span>REFRESH</span>
              </button>
            </div>
            <select
              value={settings.model}
              onChange={(e) => onUpdate({ model: e.target.value })}
              className="w-full rounded-xl border border-[var(--hud-border)] bg-[#071122] px-3 py-2.5 font-mono text-xs text-[var(--hud-text)] focus:border-[var(--hud-border-strong)] focus:outline-none"
            >
              <option value="">
                Server Default ({health?.defaultChatModel || "gemini-2.5-flash"})
              </option>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          {/* HUD Theme */}
          <div className="space-y-2">
            <span className="block font-mono text-[11px] uppercase tracking-wider text-[var(--hud-accent)]">
              HUD Optics Theme
            </span>
            <div className="grid grid-cols-3 gap-2">
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onUpdate({ theme: t.id })}
                  className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-xs transition-all ${
                    settings.theme === t.id
                      ? "border-[var(--hud-border-strong)] bg-[var(--hud-accent-soft)] text-[var(--hud-text)]"
                      : "border-[var(--hud-border)] bg-black/25 text-[var(--hud-muted)] hover:text-[var(--hud-text)]"
                  }`}
                >
                  <span
                    className="h-3 w-3 shrink-0 rounded-full"
                    style={{ backgroundColor: t.swatch }}
                  />
                  <span className="truncate font-medium">{t.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Persona Tone */}
          <div className="space-y-2">
            <span className="block font-mono text-[11px] uppercase tracking-wider text-[var(--hud-accent)]">
              Persona Profile
            </span>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {TONES.map((tone) => (
                <button
                  key={tone.id}
                  type="button"
                  onClick={() => onUpdate({ tone: tone.id })}
                  className={`rounded-xl border p-3 text-left transition-all ${
                    settings.tone === tone.id
                      ? "border-[var(--hud-border-strong)] bg-[var(--hud-accent-soft)]"
                      : "border-[var(--hud-border)] bg-black/25 hover:border-[var(--hud-border-strong)]/60"
                  }`}
                >
                  <p className="text-xs font-semibold text-[var(--hud-text)]">
                    {tone.label}
                  </p>
                  <p className="mt-1 text-[11px] leading-snug text-[var(--hud-muted)]">
                    {tone.desc}
                  </p>
                </button>
              ))}
            </div>
          </div>

          {/* Voice & Audio */}
          <div className="space-y-3 border-t border-[var(--hud-border)]/70 pt-4">
            <span className="block font-mono text-[11px] uppercase tracking-wider text-[var(--hud-accent)]">
              Vocal Synthesis & HUD Audio
            </span>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="flex items-center justify-between rounded-xl border border-[var(--hud-border)] bg-black/25 px-3 py-2.5 text-xs">
                <span>Speak J.A.R.V.I.S. replies</span>
                <input
                  type="checkbox"
                  checked={settings.voiceEnabled}
                  onChange={(e) => onUpdate({ voiceEnabled: e.target.checked })}
                  className="h-4 w-4 accent-[var(--hud-accent)]"
                />
              </label>

              <label className="flex items-center justify-between rounded-xl border border-[var(--hud-border)] bg-black/25 px-3 py-2.5 text-xs">
                <span>HUD telemetry chimes</span>
                <input
                  type="checkbox"
                  checked={settings.soundEffects}
                  onChange={(e) => onUpdate({ soundEffects: e.target.checked })}
                  className="h-4 w-4 accent-[var(--hud-accent)]"
                />
              </label>
            </div>

            {voices.length > 0 && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="sm:col-span-2">
                  <label className="mb-1 block font-mono text-[10px] uppercase text-[var(--hud-muted)]">
                    Browser Voice
                  </label>
                  <select
                    value={settings.voiceName}
                    onChange={(e) => onUpdate({ voiceName: e.target.value })}
                    className="w-full rounded-xl border border-[var(--hud-border)] bg-[#071122] px-3 py-2 text-xs text-[var(--hud-text)] focus:outline-none"
                  >
                    <option value="">Auto (Prefer British / English)</option>
                    {voices.map((v) => (
                      <option key={`${v.name}-${v.lang}`} value={v.name}>
                        {v.name} ({v.lang})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block font-mono text-[10px] uppercase text-[var(--hud-muted)]">
                    Rate ({settings.speechRate.toFixed(2)}x)
                  </label>
                  <input
                    type="range"
                    min={0.8}
                    max={1.35}
                    step={0.05}
                    value={settings.speechRate}
                    onChange={(e) =>
                      onUpdate({ speechRate: Number(e.target.value) })
                    }
                    className="mt-2 w-full accent-[var(--hud-accent)]"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Optional Session BYOK API Key */}
          <div className="space-y-2 border-t border-[var(--hud-border)]/70 pt-4">
            <label className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-[var(--hud-accent)]">
              <KeyRound className="h-3.5 w-3.5" />
              <span>Optional Session Gemini API Key (BYOK)</span>
            </label>
            <p className="text-[11px] text-[var(--hud-muted)]">
              Leave blank to use the server&apos;s{" "}
              <code className="font-mono">GEMINI_API_KEY</code> environment
              variable. If entered here, it stays in browser{" "}
              <code className="font-mono">sessionStorage</code> only for this
              tab.
            </p>
            <div className="flex gap-2">
              <input
                type="password"
                value={settings.customApiKey}
                onChange={(e) => onUpdate({ customApiKey: e.target.value })}
                placeholder="AIza..."
                className="min-w-0 flex-1 rounded-xl border border-[var(--hud-border)] bg-black/35 px-3 py-2 font-mono text-xs text-[var(--hud-text)] placeholder:text-[var(--hud-muted)]/50 focus:border-[var(--hud-border-strong)] focus:outline-none"
              />
              {settings.customApiKey && (
                <button
                  type="button"
                  onClick={() => onUpdate({ customApiKey: "" })}
                  className="rounded-xl border border-red-400/40 px-3 py-2 font-mono text-[11px] text-red-300 hover:bg-red-500/15"
                >
                  CLEAR
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
