import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Minus, Plus } from "lucide-react";
import { toast } from "sonner";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { stockAddToRestock } from "@/lib/store-stock.functions";

export type RestockTarget = { id: string; name: string; units: number; restockQty?: number };

/** "Repor": escolhe quantas unidades comprar e soma à lista real de Reposição. */
export function RestockSheet({ target, onClose }: { target: RestockTarget | null; onClose: () => void }) {
  const add = useServerFn(stockAddToRestock);
  const qc = useQueryClient();
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (target) setQty(Math.max(1, 3 - target.units));
  }, [target]);

  const save = async () => {
    if (!target) return;
    setBusy(true);
    try {
      const r = await add({ data: { productId: target.id, quantity: qty } });
      toast.success(r.already ? `Reposição atualizada: ${r.quantity} un.` : `Adicionado à reposição: ${qty} un.`);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["store-stock"] }),
        qc.invalidateQueries({ queryKey: ["admin-restock"] }),
      ]);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não consegui adicionar.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DrawerContent className="px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        {target ? (
          <div className="mx-auto w-full max-w-md">
            <DrawerTitle className="pt-3 text-lg leading-tight font-semibold">Repor {target.name}</DrawerTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Estoque atual: <b className="text-foreground tabular-nums">{target.units}</b>
              {target.restockQty ? ` · já na reposição: ${target.restockQty} un.` : ""}
            </p>

            <p className="mt-5 text-[12px] font-medium tracking-[0.1em] text-muted-foreground uppercase">Quantidade que deseja comprar</p>
            <div className="mt-2 flex items-center gap-3">
              <button type="button" aria-label="Menos uma" disabled={qty <= 1} onClick={() => setQty((q) => Math.max(1, q - 1))} className="btn-glass press grid size-12 place-items-center rounded-full border disabled:opacity-40">
                <Minus className="size-5" />
              </button>
              <input
                inputMode="numeric"
                aria-label="Quantidade"
                value={qty}
                onChange={(e) => setQty(Math.min(999, Math.max(1, Number(e.target.value.replace(/\D/g, "") || 1))))}
                className="adm-card h-12 min-w-0 flex-1 !rounded-2xl text-center text-2xl font-bold tabular-nums outline-none"
              />
              <button type="button" aria-label="Mais uma" onClick={() => setQty((q) => Math.min(999, q + 1))} className="btn-glass press grid size-12 place-items-center rounded-full border">
                <Plus className="size-5" />
              </button>
            </div>

            <Button size="lg" className="mt-5 w-full" disabled={busy} aria-busy={busy} onClick={save}>
              {busy ? "Adicionando…" : "Adicionar à reposição"}
            </Button>
          </div>
        ) : null}
      </DrawerContent>
    </Drawer>
  );
}
