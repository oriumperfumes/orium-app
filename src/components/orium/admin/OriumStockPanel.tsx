import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Minus, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { productInventory, productInventoryAdjust } from "@/lib/copilot.functions";
import { cn } from "@/lib/utils";

const SOURCE: Record<string, string> = {
  local: "Estoque Orium",
  manual: "Liberação manual",
  supplier: "Fornecedor / sob encomenda",
  blocked: "Escondido manualmente",
  none: "Sem estoque em lugar nenhum",
};
const STATUS: Record<string, string> = {
  disponivel: "Disponível",
  indisponivel: "Indisponível",
  desconhecido: "Não informado",
  desatualizado: "Desatualizado",
  erro: "Erro na leitura",
};
const brl = (v: number | null | undefined) => (v == null ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));

/** Estoque físico da Orium separado do estoque dos fornecedores. */
export function OriumStockPanel({ productId }: { productId: string }) {
  const load = useServerFn(productInventory);
  const adjust = useServerFn(productInventoryAdjust);
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["orium-stock", productId], queryFn: () => load({ data: { productId } }) });
  const [qty, setQty] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const snap = data?.snap;
  if (!snap) return null;

  const run = async (payload: { mode: "set" | "add" | "remove" | null; quantity: number | null; override: "none" | "available" | "blocked" | null }) => {
    setBusy(true);
    try {
      await adjust({ data: { productId, ...payload } });
      await qc.invalidateQueries({ queryKey: ["orium-stock", productId] });
      setQty("");
      toast.success("Atualizado.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não consegui atualizar.");
    } finally {
      setBusy(false);
    }
  };

  const ov = snap.availability.override;
  return (
    <div className="mt-6 grid min-w-0 gap-3 lg:grid-cols-2">
      <section className="rounded-2xl border bg-card p-5">
        <p className="text-[11px] font-semibold tracking-[0.14em] text-primary uppercase">Estoque Orium</p>
        <p className="mt-2 text-3xl font-semibold tabular-nums">
          {snap.orium_stock} <span className="text-base font-normal text-muted-foreground">unidade(s)</span>
        </p>
        <p className="mt-1 text-sm">
          Disponibilidade pública: <span className="font-medium">{snap.availability.public}</span>
        </p>
        <p className="text-xs text-muted-foreground">Por: {SOURCE[snap.availability.source ?? "none"]}</p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button variant="outline" size="icon" className="size-11 rounded-full" disabled={busy || snap.orium_stock <= 0} onClick={() => run({ mode: "remove", quantity: 1, override: null })} aria-label="Tirar uma unidade">
            <Minus className="size-4" />
          </Button>
          <Button variant="outline" size="icon" className="size-11 rounded-full" disabled={busy} onClick={() => run({ mode: "add", quantity: 1, override: null })} aria-label="Adicionar uma unidade">
            <Plus className="size-4" />
          </Button>
          <input
            inputMode="numeric"
            value={qty}
            onChange={(e) => setQty(e.target.value.replace(/\D/g, ""))}
            placeholder="Definir"
            className="h-11 w-24 rounded-full border bg-background px-4 text-base"
          />
          <Button className="h-11 rounded-full" disabled={busy || qty === ""} onClick={() => run({ mode: "set", quantity: Number(qty), override: null })}>
            Salvar
          </Button>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {(
            [
              ["none", "Automático"],
              ["available", "Liberar manualmente"],
              ["blocked", "Esconder"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              disabled={busy}
              onClick={() => ov !== k && run({ mode: null, quantity: null, override: k })}
              className={cn("min-h-10 rounded-full border px-4 text-sm", ov === k ? "border-primary bg-primary/10 text-primary" : "border-border")}
            >
              {label}
            </button>
          ))}
        </div>
        {data?.moves?.length ? (
          <div className="mt-4 space-y-1 border-t pt-3 text-xs text-muted-foreground">
            {data.moves.map((m: any, i: number) => (
              <p key={i}>
                {new Date(m.created_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} · {m.delta > 0 ? `+${m.delta}` : m.delta} ({m.before_qty} → {m.after_qty}) · {m.reason ?? m.source}
              </p>
            ))}
          </div>
        ) : null}
      </section>
      <section className="rounded-2xl border bg-card p-5">
        <p className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">Fornecedores</p>
        <div className="mt-3 space-y-2">
          {snap.suppliers.length ? (
            snap.suppliers.map((s: any, i: number) => (
              <div key={i} className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0 truncate font-medium">{s.supplier}</span>
                <span className="shrink-0 text-right tabular-nums">
                  {brl(s.price)} · <span className={s.status === "disponivel" ? "text-foreground" : "text-muted-foreground"}>{STATUS[s.status] ?? s.status}</span>
                </span>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">Nenhum fornecedor vinculado.</p>
          )}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">O estoque do fornecedor serve para compra e reposição. A sincronização nunca altera o estoque Orium.</p>
      </section>
    </div>
  );
}
