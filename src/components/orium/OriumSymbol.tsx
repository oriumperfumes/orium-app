/**
 * Símbolo da Orium em vetor (mesmo desenho do logo oficial), para quando ele
 * precisa ser animado — abertura do app instalado. Cor = currentColor.
 */
export const SYMBOL_VIEWBOX = "236 140 552 742";

export function OriumSymbol({ className, strokeWidth = 23 }: { className?: string; strokeWidth?: number }) {
  return (
    <svg viewBox={SYMBOL_VIEWBOX} className={className} aria-hidden fill="none">
      <g stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
        {/* começa no topo, onde a haste encontra o círculo */}
        <circle className="sym-ring" cx="512" cy="604.5" r="255.5" pathLength={1} transform="rotate(-90 512 604.5)" />
        <path className="sym-stem" d="M511.5 300 V 816" pathLength={1} />
        <path className="sym-cap" d="M482.5 292 V 190 Q482.5 165.5 507 165.5 H 517 Q541.5 165.5 541.5 190 V 292" />
      </g>
      <path className="sym-cap" d="M471 288 H 553 L 540 342 H 484 Z" fill="currentColor" />
    </svg>
  );
}
