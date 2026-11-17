import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Giro 360° com fotos reais: uma sequência de N fotos do frasco girando.
 * Arrastar troca a foto (com inércia, como girar o frasco de verdade); parado,
 * gira sozinho bem devagar. Entre duas fotos vizinhas a imagem funde de uma
 * para a outra, então o giro lento fica contínuo, sem degraus.
 *
 * As fotos só começam a baixar quando o card chega perto da tela e chegam em
 * ordem espalhada (0°, 180°, 90°, 270°…): o giro funciona antes de tudo chegar.
 * Fora da tela (ou com `active` falso) não desenha nada.
 */
export function Spin360({
  frames,
  alt,
  className,
  autoSpin = true,
  sensitivity = 1,
  active = true,
  onReady,
}: {
  /** URLs das fotos em ordem de giro */
  frames: string[];
  alt: string;
  className?: string;
  autoSpin?: boolean;
  /** voltas por largura de tela arrastada */
  sensitivity?: number;
  /** falso = pausado (ex.: outro frasco aparecendo no carrossel) */
  active?: boolean;
  onReady?: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [ready, setReady] = useState(false);
  const [near, setNear] = useState(false);
  const imgs = useRef<(HTMLImageElement | null)[]>([]);
  const pos = useRef(0); // posição em "quadros" (contínua)
  const vel = useRef(0);
  const drag = useRef<{ x: number; t: number } | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  // só baixa quando o card estiver a ~1 tela de distância
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || near) return;
    if (typeof IntersectionObserver !== "function") {
      setNear(true);
      return;
    }
    const io = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting) {
          setNear(true);
          io.disconnect();
        }
      },
      { rootMargin: "600px 0px" },
    );
    io.observe(canvas);
    return () => io.disconnect();
  }, [near]);

  useEffect(() => {
    const n = frames.length;
    if (!n || !near) return;
    imgs.current = new Array(n).fill(null);
    setReady(false);
    // ordem espalhada: metades sucessivas
    const order: number[] = [];
    const seen = new Set<number>();
    for (let step = n; step >= 1; step = Math.floor(step / 2)) {
      for (let i = 0; i < n; i += step) {
        if (!seen.has(i)) {
          seen.add(i);
          order.push(i);
        }
      }
      if (step === 1) break;
    }
    let cancelled = false;
    let k = 0;
    const loadNext = () => {
      if (cancelled || k >= order.length) return;
      const i = order[k++]!;
      const im = new Image();
      im.decoding = "async";
      im.onload = () => {
        if (cancelled) return;
        imgs.current[i] = im;
        if (i === 0) {
          setReady(true);
          onReadyRef.current?.();
        }
        loadNext();
      };
      im.onerror = loadNext;
      im.src = frames[i]!;
    };
    // três downloads em paralelo
    loadNext();
    loadNext();
    loadNext();
    return () => {
      cancelled = true;
    };
  }, [frames, near]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const n = frames.length;
    const reduced =
      typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let idle = 0;
    let visible = true;
    let last = performance.now();
    let drawn = ""; // o que está na tela (para não redesenhar à toa)

    const at = (i: number) => imgs.current[((i % n) + n) % n] ?? null;
    const nearest = (f: number) => {
      const base = ((Math.round(f) % n) + n) % n;
      for (let d = 0; d < n; d++) {
        const a = imgs.current[(base + d) % n];
        if (a) return a;
        const b = imgs.current[(base - d + n) % n];
        if (b) return b;
      }
      return null;
    };
    const draw = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.round(canvas.clientWidth * dpr),
        h = Math.round(canvas.clientHeight * dpr);
      const f = pos.current;
      const i0 = Math.floor(f);
      const t = f - i0;
      const a = at(i0),
        b = at(i0 + 1);
      // quantizado: 1/32 de quadro já é imperceptível
      const key = `${w}x${h}:${i0}:${Math.round(t * 32)}:${a ? 1 : 0}${b ? 1 : 0}`;
      if (key === drawn) return;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      const ctx = canvas.getContext("2d");
      const im0 = a ?? nearest(f);
      if (!ctx || !im0) return;
      drawn = key;
      ctx.clearRect(0, 0, w, h);
      const s = Math.min(w / im0.naturalWidth, h / im0.naturalHeight);
      const dw = im0.naturalWidth * s,
        dh = im0.naturalHeight * s;
      const x = (w - dw) / 2,
        y = (h - dh) / 2;
      ctx.imageSmoothingQuality = "high";
      ctx.globalAlpha = 1;
      ctx.drawImage(im0, x, y, dw, dh);
      // funde com o vizinho: giro lento contínuo, sem degraus
      if (a && b && t > 0.02) {
        ctx.globalAlpha = t;
        ctx.drawImage(b, x, y, dw, dh);
        ctx.globalAlpha = 1;
      }
    };
    const tick = (now: number) => {
      raf = 0;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!drag.current) {
        idle += dt;
        vel.current *= Math.exp(-dt * 2.6);
        const spin = autoSpin && !reduced && idle > 1.6 ? n / 16 : 0; // uma volta a cada ~16 s
        pos.current += (vel.current + spin) * dt;
      }
      draw();
      if (visible && activeRef.current) raf = requestAnimationFrame(tick);
    };
    const wake = () => {
      if (raf || !visible || !activeRef.current) return;
      last = performance.now();
      raf = requestAnimationFrame(tick);
    };
    const io =
      typeof IntersectionObserver === "function"
        ? new IntersectionObserver(([e]) => {
            visible = !!e?.isIntersecting;
            wake();
          })
        : null;
    io?.observe(canvas);
    wake();
    // reativa quando o carrossel volta para este frasco
    const poll = window.setInterval(wake, 400);

    const down = (e: PointerEvent) => {
      drag.current = { x: e.clientX, t: performance.now() };
      vel.current = 0;
      idle = 0;
      canvas.setPointerCapture?.(e.pointerId);
      wake();
    };
    const move = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const now = performance.now();
      const dx = e.clientX - d.x;
      const df = (-dx / (canvas.clientWidth || 300)) * n * sensitivity;
      pos.current += df;
      vel.current = vel.current * 0.5 + (df / Math.max(0.008, (now - d.t) / 1000)) * 0.5;
      drag.current = { x: e.clientX, t: now };
      idle = 0;
    };
    const up = () => {
      drag.current = null;
    };
    canvas.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      cancelAnimationFrame(raf);
      window.clearInterval(poll);
      io?.disconnect();
      canvas.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [frames, autoSpin, sensitivity]);

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={alt}
      style={{ touchAction: "pan-y" }}
      className={cn(
        "block cursor-grab transition-opacity duration-500 active:cursor-grabbing",
        ready ? "opacity-100" : "opacity-0",
        className,
      )}
    />
  );
}
