import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Giro 360° com fotos reais: uma sequência de N fotos do frasco girando no
 * prato. Arrastar troca a foto (com inércia, como girar o frasco de verdade);
 * parado, gira sozinho bem devagar. As fotos carregam em ordem espalhada
 * (0°, 180°, 90°, 270°…) para o giro já funcionar antes de tudo chegar.
 */
export function Spin360({
  frames,
  alt,
  className,
  autoSpin = true,
  sensitivity = 1,
}: {
  /** URLs das fotos em ordem de giro */
  frames: string[];
  alt: string;
  className?: string;
  autoSpin?: boolean;
  /** voltas por largura de tela arrastada */
  sensitivity?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [ready, setReady] = useState(false);
  const imgs = useRef<(HTMLImageElement | null)[]>([]);
  const pos = useRef(0); // posição em "quadros" (contínua)
  const vel = useRef(0);
  const drag = useRef<{ x: number; t: number } | null>(null);

  useEffect(() => {
    const n = frames.length;
    if (!n) return;
    imgs.current = new Array(n).fill(null);
    // ordem espalhada: metades sucessivas
    const order: number[] = [];
    const seen = new Set<number>();
    for (let step = n; step >= 1; step = Math.floor(step / 2)) {
      for (let i = 0; i < n; i += step) if (!seen.has(i)) (seen.add(i), order.push(i));
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
        if (i === 0) setReady(true);
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
  }, [frames]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const n = frames.length;
    const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let idle = 0;
    let visible = true;
    let last = performance.now();

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
      const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      const ctx = canvas.getContext("2d");
      const im = nearest(pos.current);
      if (!ctx || !im) return;
      ctx.clearRect(0, 0, w, h);
      const s = Math.min(w / im.naturalWidth, h / im.naturalHeight);
      const dw = im.naturalWidth * s, dh = im.naturalHeight * s;
      ctx.drawImage(im, (w - dw) / 2, (h - dh) / 2, dw, dh);
    };
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!drag.current) {
        idle += dt;
        vel.current *= Math.exp(-dt * 2.6);
        const spin = autoSpin && !reduced && idle > 2 ? n / 14 : 0; // uma volta a cada ~14 s
        pos.current += (vel.current + spin) * dt;
      }
      draw();
      raf = visible ? requestAnimationFrame(tick) : 0;
    };
    const io =
      typeof IntersectionObserver === "function"
        ? new IntersectionObserver(([e]) => {
            visible = !!e?.isIntersecting;
            if (visible && !raf) {
              last = performance.now();
              raf = requestAnimationFrame(tick);
            }
          })
        : null;
    io?.observe(canvas);
    raf = requestAnimationFrame(tick);

    const down = (e: PointerEvent) => {
      drag.current = { x: e.clientX, t: performance.now() };
      vel.current = 0;
      idle = 0;
      canvas.setPointerCapture?.(e.pointerId);
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
      className={cn("block cursor-grab transition-opacity duration-500 active:cursor-grabbing", ready ? "opacity-100" : "opacity-0", className)}
    />
  );
}
