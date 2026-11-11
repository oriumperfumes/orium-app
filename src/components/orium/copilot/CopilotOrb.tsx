import { cn } from "@/lib/utils";

export type OrbState = "idle" | "listening" | "thinking" | "working" | "done";

/**
 * Identidade do Copilot: anel dourado líquido em SVG/CSS.
 * idle quase parado · listening reage à voz · thinking gira lento ·
 * working luz percorre o anel · done flash curto.
 */
export function CopilotOrb({ state = "idle", level = 0, size = 28, className }: { state?: OrbState; level?: number; size?: number; className?: string }) {
  const scale = state === "listening" ? 1 + Math.min(0.28, level * 1.4) : 1;
  return (
    <span
      className={cn("copilot-orb2", className)}
      data-state={state}
      style={{ width: size, height: size, ["--orb-scale" as string]: scale }}
      aria-hidden
    >
      <svg viewBox="0 0 40 40" width={size} height={size}>
        <defs>
          <radialGradient id="orb-core" cx="38%" cy="32%" r="70%">
            <stop offset="0%" stopColor="var(--gold-soft)" stopOpacity="0.95" />
            <stop offset="55%" stopColor="var(--gold)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--gold)" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="orb-arc" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--gold-soft)" stopOpacity="0" />
            <stop offset="100%" stopColor="var(--gold-soft)" stopOpacity="1" />
          </linearGradient>
        </defs>
        <circle className="orb-core" cx="20" cy="20" r="9" fill="url(#orb-core)" />
        <circle cx="20" cy="20" r="15" fill="none" stroke="var(--gold)" strokeOpacity="0.35" strokeWidth="1.2" />
        <circle className="orb-arc" cx="20" cy="20" r="15" fill="none" stroke="url(#orb-arc)" strokeWidth="1.8" strokeLinecap="round" strokeDasharray="22 72" />
      </svg>
    </span>
  );
}
