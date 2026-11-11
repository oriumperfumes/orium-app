import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { brl } from "@/lib/format";
import { useCart } from "@/lib/cart";
import { cn } from "@/lib/utils";
import { StepBar } from "@/components/orium/StepProgress";

/** Progresso visual até o preço de atacado (6 unidades) + economia do pedido. */
export function WholesaleProgress({ compact }: { compact?: boolean }) {
  const cart = useCart();
  const [justUnlocked, setJustUnlocked] = useState(false);
  const prev = useRef(cart.tier);

  useEffect(() => {
    if (prev.current === "varejo" && cart.tier === "atacado") {
      setJustUnlocked(true);
      const t = setTimeout(() => setJustUnlocked(false), 1800);
      prev.current = cart.tier;
      return () => clearTimeout(t);
    }
    prev.current = cart.tier;
    return undefined;
  }, [cart.tier]);

  const done = cart.tier === "atacado";
  // só frascos completos contam para o atacado; decants ficam de fora
  const missing = cart.missingForWholesale;

  return (
    <div
      className={cn(
        "rounded-[20px] bg-[#1A1A1A] p-4",
        done && "bg-[#221C14] ring-1 ring-[#FFD599]/60 ring-inset",
        justUnlocked && "check-pop",
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <p className={cn("text-[14px] font-semibold", done ? "text-[#FFD599]" : "text-white")}>
          {done ? (
            <span className="inline-flex items-center gap-1.5">
              <Check className="size-3.5" /> Preço de atacado liberado
            </span>
          ) : missing === 1 ? (
            "Falta só 1 frasco para liberar o preço de atacado"
          ) : (
            `Faltam ${missing} frascos para liberar o atacado`
          )}
        </p>
        <span className="shrink-0 text-[12.5px] font-semibold tabular-nums text-[#A9A9A9]">
          {Math.min(cart.bottleQuantity, cart.minQty)}/{cart.minQty}
        </span>
      </div>

      <StepBar value={Math.min(cart.bottleQuantity, cart.minQty)} total={cart.minQty} className="mt-3" />

      {done && cart.savings > 0 && !compact ? (
        <div className="value-in mt-3 flex items-baseline justify-between gap-3 border-t border-white/[0.08] pt-3">
          <span className="text-[12.5px] text-[#A9A9A9]">
            Varejo <span className="line-through">{brl(cart.retailTotal)}</span>
          </span>
          <span className="text-[14px] font-bold text-[#FFD599]">Você economizou {brl(cart.savings)}</span>
        </div>
      ) : null}
    </div>
  );
}
