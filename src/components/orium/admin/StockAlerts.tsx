import { useState } from "react";
import { Check, Package } from "lucide-react";
import { type StockAlert } from "@/lib/store-stock.functions";
import { RestockSheet, type RestockTarget } from "@/components/orium/admin/RestockSheet";
import { cn } from "@/lib/utils";

/** Avisos de estoque da loja: abaixo dos pedidos, nunca no mesmo nível. */
export function StockAlerts({ alerts }: { alerts: StockAlert[] }) {
  const [target, setTarget] = useState<RestockTarget | null>(null);
  return (
    <section className="adm-rise rounded-[24px] bg-[#1A1A1A] pb-2" style={{ ["--i" as string]: 4 }}>
      <div className="flex items-center gap-2.5 px-5 pt-5 pb-2">
        <h2 className="min-w-0 flex-1 truncate text-[17px] font-bold tracking-[-0.01em]">Acabando</h2>
        <span className="grid h-6 min-w-6 place-items-center rounded-full bg-[#2A1A18] px-2 text-[12.5px] font-bold text-[#FF9A8A] tabular-nums">
          {alerts.length}
        </span>
      </div>
      <div>
        {alerts.slice(0, 8).map((a) => (
          <AlertRow
            key={a.id}
            a={a}
            onRepor={() => setTarget({ id: a.id, name: a.name ?? "Perfume", units: a.units, restockQty: a.restock_qty })}
          />
        ))}
      </div>
      <RestockSheet target={target} onClose={() => setTarget(null)} />
    </section>
  );
}

function AlertRow({ a, onRepor }: { a: StockAlert; onRepor: () => void }) {
  const out = a.units <= 0;
  return (
    <div className="flex min-w-0 items-center gap-3 px-5 py-2.5">
      <div className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-[12px] bg-white">
        {a.image_url ? (
          <img src={a.image_url} alt="" loading="lazy" className="size-full object-contain p-1" />
        ) : (
          <Package className="size-5 text-[#8C8C8C]" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-bold">{a.name ?? "—"}</p>
        <p className={cn("truncate text-[12.5px] font-semibold", out ? "text-[#FF9A8A]" : "text-[#F5C26B]")}>
          {out ? "Sem estoque" : "Última unidade"}
          {a.in_restock ? <span className="font-normal text-[#8C8C8C]"> · {a.restock_qty} na reposição</span> : null}
        </p>
      </div>
      {a.in_restock ? (
        <span className="inline-flex h-9 shrink-0 items-center gap-1 rounded-full px-2 text-[13px] font-semibold text-[#8C8C8C]">
          <Check className="size-4" strokeWidth={2.4} /> Pedido
        </span>
      ) : (
        <button
          type="button"
          onClick={onRepor}
          className="press inline-flex h-9 shrink-0 items-center rounded-full bg-[#FFD599] px-4 text-[13px] font-bold text-[#15130F] transition-colors hover:bg-[#FFDDAA]"
        >
          Repor
        </button>
      )}
    </div>
  );
}
