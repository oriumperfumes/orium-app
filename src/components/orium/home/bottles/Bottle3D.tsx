import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { Studio3D } from "@/components/orium/home/bottles/studio-3d";

/** Modelos 3D disponíveis (cada um vira um pedaço de código que só baixa quando o card se aproxima). */
export type Bottle3DModel = "club-de-nuit" | "asad-bourbon";

const BG: [number, number, number] = [12, 12, 12];

/** cada modelo baixa só o próprio código (o estúdio é comum a todos) */
async function load(model: Bottle3DModel) {
  const studio = import("@/components/orium/home/bottles/studio-3d");
  if (model === "asad-bourbon") {
    const [{ createStudio3D }, m] = await Promise.all([
      studio,
      import("@/components/orium/home/bottles/asad-bourbon-3d"),
    ]);
    return { createStudio3D, build: m.buildAsadBourbon, size: m.ASAD_SIZE };
  }
  const [{ createStudio3D }, m] = await Promise.all([
    studio,
    import("@/components/orium/home/bottles/club-de-nuit-3d"),
  ]);
  return { createStudio3D, build: m.buildClubDeNuit, size: m.CDN_SIZE };
}

/**
 * Frasco em 3D de verdade: arrastar gira (com inércia), parado gira sozinho
 * devagar. Só baixa o código quando o card chega perto da tela e só desenha
 * quando está visível e ativo. Sem WebGL, mostra a foto `still`.
 */
export function Bottle3D({
  model,
  alt,
  active = true,
  still,
  className,
}: {
  model: Bottle3DModel;
  alt: string;
  active?: boolean;
  /** foto estática (render do próprio modelo) para aparelhos sem WebGL */
  still: string;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<Studio3D | null>(null);
  const [state, setState] = useState<"idle" | "live" | "fallback">("idle");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    let stage: Studio3D | null = null;
    const start = () =>
      load(model)
        .then(({ createStudio3D, build, size }) => {
          if (cancelled) return;
          stage = createStudio3D(canvas, build(), {
            bg: BG,
            height: size.total,
            footprint: Math.max(size.W, size.D),
            yaw: -0.55,
            onFirstFrame: () => !cancelled && setState("live"),
          });
          stageRef.current = stage;
          if (!stage) setState("fallback");
        })
        .catch(() => !cancelled && setState("fallback"));
    const io =
      typeof IntersectionObserver === "function"
        ? new IntersectionObserver(
            ([e]) => {
              if (e?.isIntersecting) {
                io?.disconnect();
                void start();
              }
            },
            { rootMargin: "400px 0px" },
          )
        : null;
    if (io) io.observe(canvas);
    else void start();
    return () => {
      cancelled = true;
      io?.disconnect();
      stage?.destroy();
      stageRef.current = null;
    };
  }, [model]);

  useEffect(() => {
    stageRef.current?.setActive(active);
  }, [active, state]);

  return (
    <div className={cn("relative", className)}>
      {state === "fallback" ? (
        <img src={still} alt={alt} className="absolute inset-0 h-full w-full object-contain" />
      ) : (
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={alt}
          className={cn(
            "absolute inset-0 h-full w-full cursor-grab transition-opacity duration-700 active:cursor-grabbing",
            state === "live" ? "opacity-100" : "opacity-0",
          )}
        />
      )}
    </div>
  );
}
