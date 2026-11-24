"use client";

import { useState } from "react";

interface ClearanceGateProps {
  onUnlocked: () => void;
}

/**
 * Minimalist zero-chrome clearance input — only mounted when the server
 * explicitly enforces JARVIS_ACCESS_PASSCODE and the session is locked.
 */
export function ClearanceGate({ onUnlocked }: ClearanceGateProps) {
  const [passcode, setPasscode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [failed, setFailed] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passcode.trim() || submitting) return;
    setSubmitting(true);
    setFailed(false);

    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passcode }),
      });
      if (!res.ok) {
        setFailed(true);
        setPasscode("");
        return;
      }
      onUnlocked();
    } catch {
      setFailed(true);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/45 backdrop-blur-md"
      onClick={(e) => e.stopPropagation()}
    >
      <form onSubmit={handleSubmit} className="w-64">
        <input
          type="password"
          autoFocus
          value={passcode}
          onChange={(e) => {
            setFailed(false);
            setPasscode(e.target.value);
          }}
          disabled={submitting}
          aria-label="Access Passcode"
          placeholder="••••••"
          className={`w-full rounded-full border bg-black/55 px-6 py-3.5 text-center font-mono text-sm tracking-[0.35em] text-cyan-100 placeholder:text-cyan-400/35 focus:outline-none transition-colors ${
            failed
              ? "border-red-400/70 shadow-[0_0_24px_rgba(248,113,113,0.35)]"
              : "border-cyan-400/35 focus:border-cyan-300/75 shadow-[0_0_28px_rgba(34,211,238,0.2)]"
          }`}
        />
      </form>
    </div>
  );
}
