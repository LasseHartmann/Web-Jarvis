"use client";

import { useEffect, useRef } from "react";
import { Mic, MicOff, Volume2 } from "lucide-react";
import type { HudTheme, JarvisStatus } from "@/types/jarvis";

interface JarvisOrbProps {
  status: JarvisStatus;
  theme: HudTheme;
  isListening: boolean;
  getAudioLevel?: () => number;
  onToggleListen: () => void;
  onStopSpeaking?: () => void;
  size?: number;
}

const THEME_COLORS: Record<HudTheme, { primary: string; secondary: string }> = {
  "arc-cyan": { primary: "34, 211, 238", secondary: "56, 189, 248" },
  "amber-alert": { primary: "245, 158, 11", secondary: "251, 191, 36" },
  "stealth-emerald": { primary: "16, 185, 129", secondary: "52, 211, 153" },
};

const STATUS_LABELS: Record<JarvisStatus, string> = {
  standby: "ARC CORE // STANDBY",
  listening: "AUDIO CAPTURE // LISTENING",
  thinking: "NEURAL MATRIX // COMPUTING",
  speaking: "VOCAL SYNTH // TRANSMITTING",
  tool_active: "SUBSYSTEM // EXECUTING TOOL",
  error: "DIAGNOSTIC // ATTENTION REQUIRED",
};

export function JarvisOrb({
  status,
  theme,
  isListening,
  getAudioLevel,
  onToggleListen,
  onStopSpeaking,
  size = 216,
}: JarvisOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const statusRef = useRef(status);
  const themeRef = useRef(theme);
  const levelFnRef = useRef(getAudioLevel);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    themeRef.current = theme;
  }, [theme]);

  useEffect(() => {
    levelFnRef.current = getAudioLevel;
  }, [getAudioLevel]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    let rafId = 0;
    let smoothedLevel = 0.08;
    const start = performance.now();

    const draw = (now: number) => {
      const t = (now - start) / 1000;
      const curStatus = statusRef.current;
      const palette =
        curStatus === "error"
          ? { primary: "248, 113, 113", secondary: "251, 146, 60" }
          : THEME_COLORS[themeRef.current];

      let targetLevel = 0.08 + Math.sin(t * 2.1) * 0.03;
      if (curStatus === "listening") {
        const mic = levelFnRef.current?.() ?? 0;
        targetLevel = Math.max(0.24, Math.min(1, 0.22 + mic * 1.15));
      } else if (curStatus === "thinking") {
        targetLevel = 0.42 + Math.sin(t * 6.5) * 0.16;
      } else if (curStatus === "speaking") {
        targetLevel =
          0.38 +
          Math.abs(Math.sin(t * 9.2)) * 0.28 +
          Math.abs(Math.cos(t * 5.3)) * 0.15;
      } else if (curStatus === "tool_active") {
        targetLevel = 0.55 + Math.sin(t * 11) * 0.12;
      }

      smoothedLevel += (targetLevel - smoothedLevel) * 0.14;

      const cx = size / 2;
      const cy = size / 2;
      const baseR = size * 0.28;

      ctx.clearRect(0, 0, size, size);

      // Ambient radial halo
      const halo = ctx.createRadialGradient(
        cx,
        cy,
        baseR * 0.2,
        cx,
        cy,
        size * 0.48
      );
      halo.addColorStop(0, `rgba(${palette.primary}, ${0.28 + smoothedLevel * 0.28})`);
      halo.addColorStop(0.55, `rgba(${palette.secondary}, ${0.09 + smoothedLevel * 0.08})`);
      halo.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(cx, cy, size * 0.48, 0, Math.PI * 2);
      ctx.fill();

      // Outer segmented HUD ring
      const outerR = size * 0.43;
      const spinSpeed =
        curStatus === "thinking"
          ? 1.8
          : curStatus === "tool_active"
            ? 2.4
            : curStatus === "speaking"
              ? 1.1
              : 0.35;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(t * spinSpeed * 0.45);
      ctx.strokeStyle = `rgba(${palette.primary}, 0.36)`;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([12, 8, 4, 8]);
      ctx.beginPath();
      ctx.arc(0, 0, outerR, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      // Counter-rotating technical calibration ticks
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-t * spinSpeed * 0.65);
      const tickCount = 36;
      for (let i = 0; i < tickCount; i++) {
        const angle = (i / tickCount) * Math.PI * 2;
        const wave =
          Math.sin(angle * 4 + t * 5) * smoothedLevel * 7 +
          Math.cos(angle * 7 - t * 3.5) * smoothedLevel * 4;
        const inner = baseR + 10;
        const len = (i % 3 === 0 ? 11 : 5) + Math.max(0, wave);
        ctx.strokeStyle = `rgba(${palette.secondary}, ${
          i % 3 === 0 ? 0.68 : 0.28 + smoothedLevel * 0.3
        })`;
        ctx.lineWidth = i % 3 === 0 ? 1.8 : 1.1;
        ctx.beginPath();
        ctx.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner);
        ctx.lineTo(
          Math.cos(angle) * (inner + len),
          Math.sin(angle) * (inner + len)
        );
        ctx.stroke();
      }
      ctx.restore();

      // Inner Arc-Reactor triple arcs
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(t * spinSpeed * 1.15);
      ctx.strokeStyle = `rgba(${palette.primary}, 0.85)`;
      ctx.lineWidth = 2.6;
      ctx.lineCap = "round";
      for (let i = 0; i < 3; i++) {
        const startA = (i * Math.PI * 2) / 3 + 0.18;
        const endA = startA + Math.PI * 0.46;
        ctx.beginPath();
        ctx.arc(0, 0, baseR + smoothedLevel * 5, startA, endA);
        ctx.stroke();
      }
      ctx.restore();

      // Core plasma sphere
      const coreR = baseR * (0.64 + smoothedLevel * 0.14);
      const coreGrad = ctx.createRadialGradient(cx, cy, 2, cx, cy, coreR);
      coreGrad.addColorStop(0, "rgba(255, 255, 255, 0.92)");
      coreGrad.addColorStop(0.35, `rgba(${palette.primary}, 0.82)`);
      coreGrad.addColorStop(1, `rgba(${palette.secondary}, 0.12)`);

      ctx.fillStyle = coreGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
      ctx.fill();

      // Crisp inner ring outline
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.35 + smoothedLevel * 0.35})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(cx, cy, coreR * 0.72, 0, Math.PI * 2);
      ctx.stroke();

      rafId = requestAnimationFrame(draw);
    };

    rafId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafId);
  }, [size]);

  return (
    <div className="flex flex-col items-center select-none">
      <button
        type="button"
        onClick={status === "speaking" && onStopSpeaking ? onStopSpeaking : onToggleListen}
        title={
          status === "speaking"
            ? "Click to interrupt J.A.R.V.I.S."
            : isListening
              ? "Click to stop listening"
              : "Click to speak to J.A.R.V.I.S."
        }
        className="group relative flex items-center justify-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--hud-accent)]"
        style={{ width: size, height: size }}
      >
        <canvas
          ref={canvasRef}
          style={{ width: size, height: size }}
          className="block transition-transform duration-300 group-hover:scale-[1.03]"
        />
        <span
          className="pointer-events-none absolute flex h-11 w-11 items-center justify-center rounded-full border border-white/25 bg-black/35 text-white/90 backdrop-blur-sm transition-all duration-200 group-hover:scale-110 group-hover:border-white/50"
          aria-hidden="true"
        >
          {status === "speaking" ? (
            <Volume2 className="h-5 w-5 animate-pulse" />
          ) : isListening ? (
            <Mic className="h-5 w-5 text-red-300 animate-pulse" />
          ) : (
            <MicOff className="h-4 w-4 opacity-80" />
          )}
        </span>
      </button>

      <div className="mt-2 flex flex-col items-center gap-1 text-center">
        <span className="font-mono text-[11px] tracking-[0.22em] text-[var(--hud-accent)] hud-glow-text">
          {STATUS_LABELS[status]}
        </span>
        <span className="text-[11px] text-[var(--hud-muted)]">
          {status === "speaking"
            ? "Click core to silence"
            : isListening
              ? "Listening — speak your command"
              : "Click core for voice command"}
        </span>
      </div>
    </div>
  );
}
