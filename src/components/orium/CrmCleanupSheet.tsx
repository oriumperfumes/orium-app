/**
 * LIMPEZA DE DADOS DE TESTE (CRM).
 *
 * Só apaga o que a equipe marcar, e nunca toca em pedidos, itens de pedido,
 * faturamento, estoque, produtos, promoções ou fornecedores. Clientes que já
 * fizeram pedido real jamais perdem a ficha.
 */
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/lib/auth";
import {
  crmCleanupPreview,
  crmCleanupApply,
  crmPurgeCustomers,
  type CrmCleanupCounts,
} from "@/lib/crm.functions";

const SCOPES: Array<{ id: keyof CrmCleanupCounts; label: string; hint?: string }> = [
  { id: "fichas", label: "Fichas de clientes sem pedidos reais" },
  { id: "favoritos", label: "Favoritos" },
  { id: "carrinhos", label: "Carrinhos ativos" },
  { id: "abandonados", label: "Carrinhos abandonados" },
  { id: "visualizacoes", label: "Visualizações de perfumes" },
  { id: "interesses", label: "Interesses em negociação" },
  { id: "alertas", label: "Alertas de estoque" },
  { id: "eventos", label: "Histórico comportamental do CRM" },
];

export function CrmCleanupSheet({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone?: () => void;
}) {
  const { role } = useAuth();
  const qc = useQueryClient();
  const preview = useServerFn(crmCleanupPreview);
  const apply = useServerFn(crmCleanupApply);
  const purge = useServerFn(crmPurgeCustomers);

  const [counts, setCounts] = useState<CrmCleanupCounts | null>(null);
  const [loading, setLoading] = useState(false);
  const [includeReal, setIncludeReal] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [confirm, setConfirm] = useState(false);
  const [purgeConfirm, setPurgeConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    void preview({ data: { includeReal } })
      .then((c) => {
        if (alive) setCounts(c);
      })
      .catch(() => {
        if (alive) toast.error("Não conseguimos contar os registros agora.");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [open, includeReal, preview]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["crm-customers"] });
    void qc.invalidateQueries({ queryKey: ["crm-overview"] });
    void qc.invalidateQueries({ queryKey: ["crm-customer"] });
    void qc.invalidateQueries({ queryKey: ["negotiation-interests"] });
    onDone?.();
  };

  const total = picked.reduce((sum, id) => sum + Number(counts?.[id as keyof CrmCleanupCounts] ?? 0), 0);

  const toggle = (id: string) =>
    setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  return (
    <>
      <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
        <SheetContent side="bottom" className="max-h-[92dvh] overflow-y-auto rounded-t-3xl px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <SheetHeader className="px-0 text-left">
            <SheetTitle>Limpeza de dados de teste</SheetTitle>
            <SheetDescription>
              Escolha o que apagar. Pedidos, faturamento, estoque, produtos, promoções e fornecedores nunca são
              apagados.
            </SheetDescription>
          </SheetHeader>

          <div className="mt-2 space-y-2">
            {SCOPES.map((s) => {
              const n = Number(counts?.[s.id] ?? 0);
              const on = picked.includes(s.id);
              return (
                <label
                  key={s.id}
                  className="flex min-h-12 items-center justify-between gap-3 rounded-2xl border border-border/70 bg-card px-3.5 py-2.5"
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <Checkbox checked={on} onCheckedChange={() => toggle(s.id)} disabled={n === 0} />
                    <span className="min-w-0 text-sm">{s.label}</span>
                  </span>
                  <span className="shrink-0 text-xs font-medium tabular-nums text-muted-foreground">
                    {loading ? "…" : n}
                  </span>
                </label>
              );
            })}
          </div>

          <label className="mt-3 flex items-start gap-3 rounded-2xl bg-surface-2 p-3.5 text-sm">
            <Checkbox checked={includeReal} onCheckedChange={(v) => setIncludeReal(!!v)} />
            <span className="text-muted-foreground">
              Limpar também o histórico de comportamento de clientes que já compraram. A ficha e os pedidos deles
              continuam intactos.
            </span>
          </label>

          <div className="mt-4 grid gap-2">
            <Button
              className="h-11 w-full rounded-full"
              disabled={picked.length === 0 || loading || total === 0}
              onClick={() => setConfirm(true)}
            >
              <Trash2 className="size-4" /> Limpar {total} registro(s)
            </Button>

            {role === "owner" ? (
              <Button
                variant="outline"
                className="h-11 w-full rounded-full text-destructive"
                onClick={() => setPurgeConfirm(true)}
              >
                Excluir todos os clientes sem pedidos reais
              </Button>
            ) : null}
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent className="rounded-3xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar {total} registro(s) de teste?</AlertDialogTitle>
            <AlertDialogDescription>
              {picked
                .map((id) => `${SCOPES.find((s) => s.id === id)?.label}: ${Number(counts?.[id as keyof CrmCleanupCounts] ?? 0)}`)
                .join(" · ")}
              . Pedidos, faturamento e estoque continuam intactos. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-full">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-full"
              disabled={busy}
              onClick={async (e) => {
                e.preventDefault();
                setBusy(true);
                try {
                  const r = await apply({ data: { scopes: picked, includeReal } });
                  const done = Object.values(r).reduce((a, b) => a + Number(b ?? 0), 0);
                  toast.success(`${done} registro(s) de teste apagado(s).`);
                  setPicked([]);
                  setConfirm(false);
                  refresh();
                  const c = await preview({ data: { includeReal } });
                  setCounts(c);
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Não foi possível limpar agora.");
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : null} Apagar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={purgeConfirm} onOpenChange={setPurgeConfirm}>
        <AlertDialogContent className="rounded-3xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir todas as fichas sem pedidos reais?</AlertDialogTitle>
            <AlertDialogDescription>
              Serão excluídas {Number(counts?.fichas ?? 0)} ficha(s). Clientes com pedido real são preservados e
              nenhum pedido é apagado.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-full">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-full"
              disabled={busy}
              onClick={async (e) => {
                e.preventDefault();
                setBusy(true);
                try {
                  const r = await purge();
                  toast.success(`${Number(r.fichas ?? 0)} ficha(s) excluída(s).`);
                  setPurgeConfirm(false);
                  refresh();
                  const c = await preview({ data: { includeReal } });
                  setCounts(c);
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Não foi possível excluir agora.");
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : null} Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
