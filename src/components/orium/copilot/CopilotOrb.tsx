import { cn } from "@/lib/utils";

export type OrbState = "idle" | "listening" | "thinking" | "working" | "done";

/**
 * Identidade do Copilot: uma esfera de luz dourada viva — duas correntes de
 * cor girando dentro de um vidro, com brilho e halo. Só CSS (sem WebGL).
 *
 * idle respira devagar · listening cresce com a voz · thinking gira ·
 * working acelera e pulsa · done dá um flash.
 */
export function CopilotOrb({
  state = "idle",
  level = 0,
  size = 28,
  halo,
  className,
}: {
  state?: OrbState;
  level?: number;
  size?: number;
  /** brilho em volta (padrão: só em orbs grandes) */
  halo?: boolean;
  className?: string;
}) {
  const scale = state === "listening" ? 1 + Math.min(0.22, level * 1.2) : 1;
  const glow = halo ?? size >= 56;
  return (
    <span
      className={cn("orb3", glow && "orb3-halo", className)}
      data-state={state}
      style={{ width: size, height: size, ["--s" as string]: size, ["--orb-scale" as string]: scale }}
      aria-hidden
    >
      <span className="orb3-ball">
        <span className="orb3-flow orb3-flow-a" />
        <span className="orb3-flow orb3-flow-b" />
        <span className="orb3-core" />
        <span className="orb3-shine" />
      </span>
    </span>
  );
}
