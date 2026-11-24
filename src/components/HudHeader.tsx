"use client";

import { useEffect, useState } from "react";
import {
  Globe,
  Lock,
  PanelLeft,
  PanelRight,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Volume2,
  VolumeX,
} from "lucide-react";
import type { JarvisSettings, JarvisStatus, SystemHealth } from "@/types/jarvis";

interface HudHeaderProps {
  status: JarvisStatus;
  health: SystemHealth | null;
  settings: JarvisSettings;
  activeModel: string;
  showLeftRail: boolean;
  showRightRail: boolean;
  onToggleLeftRail: () => void;
  onToggleRightRail: () => void;
  onToggleVoice: () => void;
  onToggleSearch: () => void;
  onOpenSettings: () => void;
  onLockSession: () => void;
}

export function HudHeader({
  status,
  health,
  settings,
  activeModel,
  showLeftRail,
  showRightRail,
  onToggleLeftRail,
  onToggleRightRail,
  onToggleVoice,
  onToggleSearch,
  onOpenSettings,
  onLockSession,
}: HudHeaderProps) {
  const [clockText, setClockText] = useState("--:--:--");

  useEffect(() => {
    const update = () => {
      const now = new Date();
      setClockText(
        now.toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        })
      );
    };
    queueMicrotask(update);
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, []);

  const hasKey = Boolean(health?.apiKeyConfigured || settings.customApiKey.trim());

  return (
    <header className="hud-panel z-20 flex h-14 shrink-0 items-center justify-between gap-2 border-x-0 border-t-0 px-3 sm:px-5">
      {/* Left: Brand + Sidebar toggle */}
      <div className="flex items-center gap-2.5 min-w-0">
        <button
          type="button"
          onClick={onToggleLeftRail}
          title={showLeftRail ? "Hide Core & Archives" : "Show Core & Archives"}
          className={`flex h-8 w-8 items-center justify-center rounded-lg border transition-colors ${
            showLeftRail
              ? "border-[var(--hud-border-strong)] bg-[var(--hud-accent-soft)] text-[var(--hud-accent)]"
              : "border-[var(--hud-border)] text-[var(--hud-muted)] hover:text-[var(--hud-text)]"
          }`}
        >
          <PanelLeft className="h-4 w-4" />
        </button>

        <div className="flex items-center gap-2.5 min-w-0">
          <div className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[var(--hud-border-strong)] bg-[var(--hud-accent-soft)]">
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                status === "error"
                  ? "bg-red-400"
                  : !hasKey
                    ? "bg-amber-400"
                    : "bg-[var(--hud-accent)]"
              } ${status === "thinking" || status === "listening" ? "animate-ping" : ""}`}
            />
          </div>
          <div className="leading-tight truncate">
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm font-semibold tracking-[0.22em] text-[var(--hud-text)] hud-glow-text">
                J.A.R.V.I.S.
              </span>
              <span className="hidden md:inline-flex items-center rounded border border-[var(--hud-border)] bg-[var(--hud-accent-soft)] px-1.5 py-0.5 font-mono text-[10px] tracking-wider text-[var(--hud-accent)]">
                MK-VII
              </span>
            </div>
            <p className="hidden sm:block font-mono text-[10px] tracking-wider text-[var(--hud-muted)] truncate">
              {hasKey ? activeModel : "GEMINI API KEY NOT CONFIGURED"}
            </p>
          </div>
        </div>
      </div>

      {/* Center: Live telemetry clock + quick capability pills */}
      <div className="hidden lg:flex items-center gap-3">
        <div className="flex items-center gap-2 rounded-lg border border-[var(--hud-border)] bg-black/25 px-3 py-1 font-mono text-xs text-[var(--hud-text)]">
          <span className="text-[10px] uppercase tracking-widest text-[var(--hud-muted)]">
            SYS TIME
          </span>
          <span className="tabular-nums text-[var(--hud-accent)]">{clockText}</span>
        </div>

        <button
          type="button"
          onClick={onToggleSearch}
          title="Toggle Google Search Grounding"
          className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 font-mono text-[11px] tracking-wide transition-colors ${
            settings.searchGrounding
              ? "border-[var(--hud-border-strong)] bg-[var(--hud-accent-soft)] text-[var(--hud-accent)]"
              : "border-[var(--hud-border)] text-[var(--hud-muted)] hover:text-[var(--hud-text)]"
          }`}
        >
          <Globe className="h-3.5 w-3.5" />
          <span>WEB {settings.searchGrounding ? "ON" : "OFF"}</span>
        </button>

        <div
          className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 font-mono text-[11px] ${
            health?.passcodeRequired
              ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-300"
              : "border-amber-400/25 bg-amber-500/10 text-amber-300"
          }`}
          title={
            health?.passcodeRequired
              ? "Server API key is protected by Security Clearance passcode"
              : "Passcode gate disabled — set JARVIS_ACCESS_PASSCODE before public Vercel deployment"
          }
        >
          {health?.passcodeRequired ? (
            <ShieldCheck className="h-3.5 w-3.5" />
          ) : (
            <ShieldAlert className="h-3.5 w-3.5" />
          )}
          <span>{health?.passcodeRequired ? "SECURED" : "OPEN LOCAL"}</span>
        </div>
      </div>

      {/* Right: Voice, Settings, Lock, Telemetry Toggle */}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={onToggleVoice}
          title={settings.voiceEnabled ? "Mute spoken replies" : "Enable spoken replies"}
          className={`flex h-8 items-center gap-1.5 rounded-lg border px-2.5 font-mono text-[11px] transition-colors ${
            settings.voiceEnabled
              ? "border-[var(--hud-border-strong)] bg-[var(--hud-accent-soft)] text-[var(--hud-accent)]"
              : "border-[var(--hud-border)] text-[var(--hud-muted)] hover:text-[var(--hud-text)]"
          }`}
        >
          {settings.voiceEnabled ? (
            <Volume2 className="h-3.5 w-3.5" />
          ) : (
            <VolumeX className="h-3.5 w-3.5" />
          )}
          <span className="hidden sm:inline">
            {settings.voiceEnabled ? "VOICE" : "MUTED"}
          </span>
        </button>

        <button
          type="button"
          onClick={onOpenSettings}
          title="System Settings & Model Config"
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--hud-border)] text-[var(--hud-muted)] transition-colors hover:border-[var(--hud-border-strong)] hover:text-[var(--hud-text)]"
        >
          <Settings className="h-4 w-4" />
        </button>

        {health?.passcodeRequired && (
          <button
            type="button"
            onClick={onLockSession}
            title="Lock Security Clearance"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--hud-border)] text-[var(--hud-muted)] transition-colors hover:border-red-400/50 hover:text-red-300"
          >
            <Lock className="h-4 w-4" />
          </button>
        )}

        <button
          type="button"
          onClick={onToggleRightRail}
          title={showRightRail ? "Hide Telemetry Panel" : "Show Telemetry Panel"}
          className={`flex h-8 w-8 items-center justify-center rounded-lg border transition-colors ${
            showRightRail
              ? "border-[var(--hud-border-strong)] bg-[var(--hud-accent-soft)] text-[var(--hud-accent)]"
              : "border-[var(--hud-border)] text-[var(--hud-muted)] hover:text-[var(--hud-text)]"
          }`}
        >
          <PanelRight className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}
