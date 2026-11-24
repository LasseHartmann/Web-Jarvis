"use client";

import { useState } from "react";
import { KeyRound, ShieldCheck, Loader2 } from "lucide-react";

interface ClearanceGateProps {
  onUnlocked: () => void;
}

export function ClearanceGate({ onUnlocked }: ClearanceGateProps) {
  const [passcode, setPasscode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passcode.trim() || submitting) return;

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passcode }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Access denied.");
        return;
      }
      onUnlocked();
    } catch {
      setError("Unable to reach authentication subsystem.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="hud-backdrop fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="hud-panel w-full max-w-md rounded-2xl p-7">
        <div className="flex flex-col items-center text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-[var(--hud-border-strong)] bg-[var(--hud-accent-soft)] shadow-[0_0_28px_var(--hud-glow)]">
            <ShieldCheck className="h-7 w-7 text-[var(--hud-accent)]" />
          </div>
          <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-[var(--hud-accent)]">
            STARK SYSTEMS // CLEARANCE PROTOCOL
          </p>
          <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-[var(--hud-text)]">
            J.A.R.V.I.S. Access Gate
          </h1>
          <p className="mt-2 text-sm text-[var(--hud-muted)]">
            Enter your security clearance code to authorize access to the Gemini
            command core.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div className="relative">
            <KeyRound className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--hud-muted)]" />
            <input
              type="password"
              autoFocus
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              placeholder="Enter clearance passcode..."
              className="w-full rounded-xl border border-[var(--hud-border)] bg-black/40 py-3 pl-10 pr-4 font-mono text-sm text-[var(--hud-text)] placeholder:text-[var(--hud-muted)]/60 focus:border-[var(--hud-border-strong)] focus:outline-none"
            />
          </div>

          {error && (
            <p className="rounded-lg border border-red-400/35 bg-red-500/10 px-3 py-2 font-mono text-xs text-red-300">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting || !passcode.trim()}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--hud-border-strong)] bg-[var(--hud-accent-soft)] py-3 font-mono text-xs font-semibold uppercase tracking-[0.2em] text-[var(--hud-accent)] transition-all hover:bg-[var(--hud-accent)] hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>VERIFYING CLEARANCE</span>
              </>
            ) : (
              <span>AUTHORIZE SESSION</span>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
