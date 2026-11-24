"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ClearanceGate } from "@/components/ClearanceGate";
import { JarvisLiveController } from "@/lib/jarvisLive";
import type { CorePalette, JarvisCoreState } from "@/types/jarvis";

interface RGB {
  r: number;
  g: number;
  b: number;
}

const PALETTES: Record<CorePalette, { primary: RGB; secondary: RGB; glow: RGB }> = {
  cyan: {
    primary: { r: 34, g: 211, b: 238 },
    secondary: { r: 56, g: 189, b: 248 },
    glow: { r: 125, g: 235, b: 255 },
  },
  amber: {
    primary: { r: 245, g: 158, b: 11 },
    secondary: { r: 251, g: 191, b: 36 },
    glow: { r: 254, g: 240, b: 138 },
  },
  emerald: {
    primary: { r: 16, g: 185, b: 129 },
    secondary: { r: 52, g: 211, b: 153 },
    glow: { r: 167, g: 243, b: 208 },
  },
  crimson: {
    primary: { r: 244, g: 63, b: 94 },
    secondary: { r: 251, g: 113, b: 133 },
    glow: { r: 254, g: 205, b: 211 },
  },
  violet: {
    primary: { r: 168, g: 85, b: 247 },
    secondary: { r: 192, g: 132, b: 252 },
    glow: { r: 233, g: 213, b: 255 },
  },
};

const ERROR_PALETTE = {
  primary: { r: 248, g: 113, b: 113 },
  secondary: { r: 251, g: 146, b: 60 },
  glow: { r: 254, g: 202, b: 202 },
};

interface SphereNode {
  x: number;
  y: number;
  z: number;
  phase: number;
}

function createFibonacciSphere(count: number): SphereNode[] {
  const nodes: SphereNode[] = [];
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / (count - 1)) * 2;
    const radius = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = goldenAngle * i;
    nodes.push({
      x: Math.cos(theta) * radius,
      y,
      z: Math.sin(theta) * radius,
      phase: (i * 0.37) % (Math.PI * 2),
    });
  }
  return nodes;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function JarvisCore() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const controllerRef = useRef<JarvisLiveController | null>(null);

  const stateRef = useRef<JarvisCoreState>("idle");
  const paletteRef = useRef<CorePalette>("cyan");
  const visionRippleRef = useRef<number>(0);
  const pointerTiltRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const [needsPasscode, setNeedsPasscode] = useState(false);

  const getController = useCallback(() => {
    if (!controllerRef.current) {
      controllerRef.current = new JarvisLiveController();
    }
    return controllerRef.current;
  }, []);

  useEffect(() => {
    const controller = getController();
    controller.attach({
      onStateChange: (next) => {
        stateRef.current = next;
      },
      onPaletteChange: (next) => {
        paletteRef.current = next;
      },
      onPasscodeRequired: () => {
        setNeedsPasscode(true);
      },
      onVisionPulse: () => {
        visionRippleRef.current = 1;
      },
    });

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" && !needsPasscode) {
        e.preventDefault();
        void controller.handleCoreInteraction();
      }
    };
    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      controller.dispose(true);
    };
  }, [getController, needsPasscode]);

  // 60fps full-viewport animated J.A.R.V.I.S. holographic core
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const nodes = createFibonacciSphere(136);
    let width = window.innerWidth;
    let height = window.innerHeight;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const onPointerMove = (e: PointerEvent) => {
      pointerTiltRef.current = {
        x: (e.clientX / Math.max(1, width) - 0.5) * 2,
        y: (e.clientY / Math.max(1, height) - 0.5) * 2,
      };
    };
    window.addEventListener("pointermove", onPointerMove, { passive: true });

    let rafId = 0;
    const startTime = performance.now();

    let curPrimary: RGB = { ...PALETTES.cyan.primary };
    let curSecondary: RGB = { ...PALETTES.cyan.secondary };
    let curGlow: RGB = { ...PALETTES.cyan.glow };
    let smoothedEnergy = 0.05;
    let smoothedLuminance = 0.42;
    let smoothedTiltX = 0;
    let smoothedTiltY = 0;
    let rotY = 0;
    let rotX = 0;
    let ringAngleA = 0;
    let ringAngleB = 0;
    let radarAngle = 0;

    const render = (now: number) => {
      const t = (now - startTime) / 1000;
      const state = stateRef.current;
      const controller = controllerRef.current;

      const targetPalette =
        state === "error" ? ERROR_PALETTE : PALETTES[paletteRef.current];

      curPrimary = {
        r: lerp(curPrimary.r, targetPalette.primary.r, 0.05),
        g: lerp(curPrimary.g, targetPalette.primary.g, 0.05),
        b: lerp(curPrimary.b, targetPalette.primary.b, 0.05),
      };
      curSecondary = {
        r: lerp(curSecondary.r, targetPalette.secondary.r, 0.05),
        g: lerp(curSecondary.g, targetPalette.secondary.g, 0.05),
        b: lerp(curSecondary.b, targetPalette.secondary.b, 0.05),
      };
      curGlow = {
        r: lerp(curGlow.r, targetPalette.glow.r, 0.05),
        g: lerp(curGlow.g, targetPalette.glow.g, 0.05),
        b: lerp(curGlow.b, targetPalette.glow.b, 0.05),
      };

      const pStr = `${Math.round(curPrimary.r)}, ${Math.round(curPrimary.g)}, ${Math.round(curPrimary.b)}`;
      const sStr = `${Math.round(curSecondary.r)}, ${Math.round(curSecondary.g)}, ${Math.round(curSecondary.b)}`;
      const gStr = `${Math.round(curGlow.r)}, ${Math.round(curGlow.g)}, ${Math.round(curGlow.b)}`;

      const inLevel = controller?.audio.getInputLevel() ?? 0;
      const outLevel = controller?.audio.getOutputLevel() ?? 0;
      const spectrum =
        state === "speaking"
          ? controller?.audio.getOutputSpectrum()
          : state === "listening" || state === "standby"
            ? controller?.audio.getInputSpectrum()
            : null;

      let targetEnergy = 0.05 + Math.sin(t * 1.2) * 0.025;
      let targetLum = 0.42; // Dormant dim glow before first tap

      if (state === "arming") {
        targetEnergy = 0.34 + Math.sin(t * 5.2) * 0.14;
        targetLum = 0.72;
      } else if (state === "standby") {
        // Serene armed wake-word watch with soft ambient mic shimmer
        targetEnergy = 0.11 + Math.sin(t * 1.7) * 0.03 + inLevel * 0.22;
        targetLum = 0.68;
      } else if (state === "connecting") {
        targetEnergy = 0.52 + Math.sin(t * 7.5) * 0.18;
        targetLum = 0.95;
      } else if (state === "listening") {
        targetEnergy = Math.max(0.2, Math.min(1, 0.18 + inLevel * 1.15));
        targetLum = 1.0;
      } else if (state === "speaking") {
        targetEnergy = Math.max(
          0.28,
          Math.min(1, 0.25 + outLevel * 1.38 + Math.sin(t * 8) * 0.04)
        );
        targetLum = 1.08;
      } else if (state === "thinking") {
        targetEnergy = 0.58 + Math.sin(t * 9.5) * 0.16;
        targetLum = 1.0;
      } else if (state === "error") {
        targetEnergy = 0.46 + Math.abs(Math.sin(t * 7)) * 0.25;
        targetLum = 0.9;
      }

      smoothedEnergy = lerp(smoothedEnergy, targetEnergy, 0.14);
      smoothedLuminance = lerp(smoothedLuminance, targetLum, 0.07);

      // Gyroscope + pointer parallax tilt
      const gyroTilt = controller?.sensors.getParallaxTilt() ?? { x: 0, y: 0 };
      const targetTiltX =
        Math.abs(gyroTilt.x) > 0.02 ? gyroTilt.x : pointerTiltRef.current.x * 0.4;
      const targetTiltY =
        Math.abs(gyroTilt.y) > 0.02 ? gyroTilt.y : pointerTiltRef.current.y * 0.4;
      smoothedTiltX = lerp(smoothedTiltX, targetTiltX, 0.06);
      smoothedTiltY = lerp(smoothedTiltY, targetTiltY, 0.06);

      const spinRate =
        state === "thinking"
          ? 0.026
          : state === "connecting"
            ? 0.024
            : state === "arming"
              ? 0.016
              : state === "speaking"
                ? 0.013 + smoothedEnergy * 0.012
                : state === "listening"
                  ? 0.008 + smoothedEnergy * 0.008
                  : state === "standby"
                    ? 0.0055
                    : 0.0028;

      rotY += spinRate;
      rotX = Math.sin(t * 0.35) * 0.22 + smoothedTiltY * 0.45;
      ringAngleA += spinRate * 0.7;
      ringAngleB -= spinRate * 1.1;
      radarAngle += 0.018;

      const minDim = Math.min(width, height);
      const baseR = minDim * 0.22;
      const cx = width * 0.5 + smoothedTiltX * minDim * 0.025;
      const cy = height * 0.5 + smoothedTiltY * minDim * 0.025;
      const lum = smoothedLuminance;

      // Clear full obsidian viewport
      ctx.fillStyle = "#02050b";
      ctx.fillRect(0, 0, width, height);

      // Deep ambient atmospheric bloom
      const ambient = ctx.createRadialGradient(
        cx,
        cy,
        baseR * 0.12,
        cx,
        cy,
        minDim * 0.52
      );
      ambient.addColorStop(
        0,
        `rgba(${pStr}, ${(0.16 + smoothedEnergy * 0.22) * lum})`
      );
      ambient.addColorStop(
        0.42,
        `rgba(${sStr}, ${(0.055 + smoothedEnergy * 0.08) * lum})`
      );
      ambient.addColorStop(1, "rgba(2, 5, 11, 0)");
      ctx.fillStyle = ambient;
      ctx.beginPath();
      ctx.arc(cx, cy, minDim * 0.52, 0, Math.PI * 2);
      ctx.fill();

      // Subtle vision frame transmission ripple (active live camera)
      if (visionRippleRef.current > 0.01) {
        const progress = 1 - visionRippleRef.current;
        const rippleR = baseR * (1.15 + progress * 0.95);
        ctx.strokeStyle = `rgba(${gStr}, ${visionRippleRef.current * 0.24})`;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(cx, cy, rippleR, 0, Math.PI * 2);
        ctx.stroke();
        visionRippleRef.current *= 0.93;
      }

      // Outer geometric orbital ring + delicate sweeping radar arc when armed in standby
      const outerR = baseR * (1.56 + smoothedEnergy * 0.06);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(ringAngleA);
      ctx.strokeStyle = `rgba(${pStr}, ${(0.15 + smoothedEnergy * 0.16) * lum})`;
      ctx.lineWidth = 1.1;
      ctx.setLineDash([18, 12, 4, 12]);
      ctx.beginPath();
      ctx.arc(0, 0, outerR, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      if (state === "standby" || state === "arming") {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(radarAngle);
        ctx.lineCap = "round";
        ctx.strokeStyle = `rgba(${gStr}, ${state === "arming" ? 0.55 : 0.34})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, outerR * 1.04, 0, Math.PI * 0.28);
        ctx.stroke();
        ctx.restore();
      }

      // Counter-rotating Arc-Reactor triple energy arcs
      const midR = baseR * (1.28 + smoothedEnergy * 0.09);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(ringAngleB);
      ctx.lineCap = "round";
      for (let i = 0; i < 3; i++) {
        const a0 = (i * Math.PI * 2) / 3 + 0.14;
        const a1 = a0 + Math.PI * 0.44;
        ctx.strokeStyle = `rgba(${pStr}, ${(0.34 + smoothedEnergy * 0.45) * lum})`;
        ctx.lineWidth = 2.2 + smoothedEnergy * 1.4;
        ctx.beginPath();
        ctx.arc(0, 0, midR, a0, a1);
        ctx.stroke();
      }
      ctx.restore();

      // 72-bar circular reactive audio frequency halo
      const barCount = 72;
      const barBaseR = baseR * 1.07;
      const spectrumGain = state === "standby" ? 0.35 : 1.0;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(ringAngleA * 0.35);
      for (let i = 0; i < barCount; i++) {
        const angle = (i / barCount) * Math.PI * 2;
        let binVal = 0;
        if (spectrum && spectrum.length > 0) {
          const halfIdx = i < barCount / 2 ? i : barCount - 1 - i;
          const bin = Math.min(
            spectrum.length - 1,
            Math.floor((halfIdx / (barCount / 2)) * (spectrum.length * 0.55))
          );
          binVal = (spectrum[bin] / 255) * spectrumGain;
        } else {
          binVal =
            (Math.sin(angle * 4 + t * 3.2) * 0.5 + 0.5) * smoothedEnergy * 0.45;
        }

        const len =
          (i % 6 === 0 ? 10 : 4) +
          binVal * baseR * (state === "speaking" ? 0.44 : 0.34) +
          smoothedEnergy * 6;

        ctx.strokeStyle = `rgba(${binVal > 0.45 ? gStr : sStr}, ${
          (0.2 + binVal * 0.72 + (i % 6 === 0 ? 0.12 : 0)) * lum
        })`;
        ctx.lineWidth = i % 6 === 0 ? 2 : 1.3;
        ctx.beginPath();
        ctx.moveTo(Math.cos(angle) * barBaseR, Math.sin(angle) * barBaseR);
        ctx.lineTo(
          Math.cos(angle) * (barBaseR + len),
          Math.sin(angle) * (barBaseR + len)
        );
        ctx.stroke();
      }
      ctx.restore();

      // 3D Projected Holographic Neural Sphere
      const cosY = Math.cos(rotY + smoothedTiltX * 0.45);
      const sinY = Math.sin(rotY + smoothedTiltX * 0.45);
      const cosX = Math.cos(rotX);
      const sinX = Math.sin(rotX);
      const sphereR = baseR * (0.86 + smoothedEnergy * 0.14);

      const projected: Array<{
        x: number;
        y: number;
        z: number;
        scale: number;
        pulse: number;
      }> = [];

      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        let audioBoost = 0;
        if (spectrum && spectrum.length > 0) {
          audioBoost = (spectrum[i % 48] / 255) * 0.24 * spectrumGain;
        }
        const wave =
          1 +
          Math.sin(t * 2.8 + n.phase) * (0.04 + smoothedEnergy * 0.08) +
          audioBoost;

        const nx = n.x * wave;
        const ny = n.y * wave;
        const nz = n.z * wave;

        const x1 = nx * cosY - nz * sinY;
        const z1 = nx * sinY + nz * cosY;
        const y2 = ny * cosX - z1 * sinX;
        const z2 = ny * sinX + z1 * cosX;

        const perspective = 3.2 / (3.2 - z2);
        projected.push({
          x: cx + x1 * sphereR * perspective,
          y: cy + y2 * sphereR * perspective,
          z: z2,
          scale: perspective,
          pulse: audioBoost,
        });
      }

      // Neural lattice filaments between nearby front-hemisphere nodes
      const maxLinkDist = sphereR * 0.42;
      const maxLinkSq = maxLinkDist * maxLinkDist;
      ctx.lineWidth = 0.75;
      for (let i = 0; i < projected.length; i++) {
        const a = projected[i];
        if (a.z < -0.35) continue;
        for (let j = i + 1; j < projected.length; j++) {
          const b = projected[j];
          if (b.z < -0.35) continue;
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const distSq = dx * dx + dy * dy;
          if (distSq < maxLinkSq) {
            const alpha =
              (1 - Math.sqrt(distSq) / maxLinkDist) *
              (0.14 + smoothedEnergy * 0.24) *
              ((a.z + b.z + 2) * 0.25) *
              lum;
            ctx.strokeStyle = `rgba(${pStr}, ${Math.max(0, alpha)})`;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }

      // Glowing neural nodes sorted back-to-front
      projected.sort((a, b) => a.z - b.z);
      for (let i = 0; i < projected.length; i++) {
        const p = projected[i];
        const depthAlpha = Math.max(0.08, Math.min(1, (p.z + 1.2) / 2.2));
        const dotR =
          (1.1 + p.scale * 1.15 + p.pulse * 4) * (0.85 + smoothedEnergy * 0.35);
        ctx.fillStyle = `rgba(${p.z > 0.35 ? gStr : pStr}, ${
          depthAlpha * (0.52 + smoothedEnergy * 0.42) * lum
        })`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, dotR, 0, Math.PI * 2);
        ctx.fill();
      }

      // Inner luminous plasma core
      const coreR = baseR * (0.34 + smoothedEnergy * 0.16);
      const coreGrad = ctx.createRadialGradient(cx, cy, 1, cx, cy, coreR);
      coreGrad.addColorStop(
        0,
        `rgba(255, 255, 255, ${Math.min(1, (0.68 + smoothedEnergy * 0.28) * lum)})`
      );
      coreGrad.addColorStop(
        0.28,
        `rgba(${gStr}, ${Math.min(1, (0.54 + smoothedEnergy * 0.34) * lum)})`
      );
      coreGrad.addColorStop(
        0.68,
        `rgba(${pStr}, ${(0.16 + smoothedEnergy * 0.22) * lum})`
      );
      coreGrad.addColorStop(1, "rgba(0, 0, 0, 0)");

      ctx.fillStyle = coreGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
      ctx.fill();

      rafId = requestAnimationFrame(render);
    };

    rafId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onPointerMove);
    };
  }, []);

  return (
    <main
      onClick={() => {
        if (!needsPasscode) {
          void getController().handleCoreInteraction();
        }
      }}
      className="fixed inset-0 h-dvh w-screen cursor-pointer overflow-hidden bg-[#02050b] select-none touch-manipulation"
      aria-label="J.A.R.V.I.S. Voice Core"
      role="button"
      tabIndex={0}
    >
      <canvas ref={canvasRef} className="block h-full w-full" />

      {needsPasscode && (
        <ClearanceGate
          onUnlocked={() => {
            setNeedsPasscode(false);
            void getController().armStandby();
          }}
        />
      )}
    </main>
  );
}
