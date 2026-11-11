import { cn } from "@/lib/utils";

/**
 * Barra de progresso em passos — a mesma para o combo de decants (Sacola, pop-up, página do
 * perfume) e para o atacado. Um segmento por unidade (até 8); acima disso, barra contínua.
 */
export function StepBar({
  value,
  total,
  className,
  tone = "gold",
}: {
  value: number;
  total: number;
  className?: string;
  tone?: "gold";
}) {
  const v = Math.max(0, Math.min(total, value));
  const fill = tone === "gold" ? "bg-[#FFD599]" : "bg-white";
  if (total > 8) {
    return (
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={v}
        className={cn("h-[7px] overflow-hidden rounded-full bg-white/12", className)}
      >
        <div
          className={cn("h-full rounded-full transition-[width] duration-700 ease-[var(--ease-orium)]", fill)}
          style={{ width: `${(v / total) * 100}%` }}
        />
      </div>
    );
  }
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={v}
      className={cn("flex gap-1.5", className)}
    >
      {Array.from({ length: total }).map((_, i) => (
        <span key={i} className="h-[7px] flex-1 overflow-hidden rounded-full bg-white/12">
          <span
            className={cn(
              "block h-full origin-left rounded-full transition-transform duration-500 ease-[var(--ease-orium)]",
              fill,
            )}
            style={{ transform: `scaleX(${i < v ? 1 : 0})`, transitionDelay: i < v ? `${i * 70}ms` : "0ms" }}
          />
        </span>
      ))}
    </div>
  );
}
