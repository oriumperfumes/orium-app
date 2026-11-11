import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { AdminSecondaryAction } from "@/components/orium/admin/AdminUI";
import { listSupplierCatalogOffers, setOfferCatalog } from "@/lib/supplier-hub.functions";
import { brl } from "@/lib/format";
import { OfferThumb } from "./OfferThumb";

const AVAIL: Record<string, string> = { AVAILABLE: "disponível", UNAVAILABLE: "indisponível", UNKNOWN: "a confirmar" };

const FILTERS = [["all", "Todos"], ["public", "Permitidos"], ["hidden", "Não permitidos"], ["linked", "Vinculados"]] as const;
const DEC_LABEL = { inherit: "Seguir fornecedor", allow: "Permitir", deny: "Não permitir" } as const;
type Dec = keyof typeof DEC_LABEL;

/** Lista de ofertas do fornecedor com decisão individual de catálogo e ações em lote. */
export function SupplierCatalogPanel({ supplierId, onSync, syncing }: { supplierId: string; onSync?: ((id: string) => Promise<void> | void) | undefined; syncing?: boolean | undefined }) {
  const list = useServerFn(listSupplierCatalogOffers);
  const apply = useServerFn(setOfferCatalog);
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number][0]>("all");
  const [page, setPage] = useState(0);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<Dec | null>(null);
  const [busy, setBusy] = useState(false);

  const q = useQuery({
    queryKey: ["supplier-catalog", supplierId, search, filter, page],
    queryFn: () => list({ data: { supplierId, search, filter, page } }),
    staleTime: 10_000,
  });

  const run = async (ids: string[], decision: Dec) => {
    setBusy(true);
    try {
      const r = await apply({ data: { supplierId, offerIds: ids, decision } });
      toast.success(`${r.changed} oferta(s): ${DEC_LABEL[decision]}.`);
      setSel(new Set());
      qc.invalidateQueries({ queryKey: ["supplier-catalog", supplierId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar.");
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  const rows = q.data?.rows ?? [];
  const pages = q.data ? Math.ceil(q.data.total / q.data.pageSize) : 0;
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <div className="mt-5 space-y-3">
      <p className="text-xs text-muted-foreground">A escolha do produto vale mais que a do fornecedor. Bloquear aqui esconde só esta oferta: o perfume continua público se outro fornecedor ou o estoque da loja puder atender.</p>
      <Input placeholder="Buscar produto deste fornecedor" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} />
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {FILTERS.map(([k, l]) => (
          <button key={k} type="button" onClick={() => { setFilter(k); setPage(0); }} className={`h-9 shrink-0 rounded-full border px-3 text-xs ${filter === k ? "border-primary bg-primary/15" : "border-border/60 text-muted-foreground"}`}>{l}</button>
        ))}
      </div>
      {sel.size ? (
        <div className="grid grid-cols-3 gap-2 rounded-xl border border-primary/40 p-2">
          <p className="col-span-3 text-xs">{sel.size} selecionado(s)</p>
          <AdminSecondaryAction disabled={busy} onClick={() => setConfirm("allow")}>Permitir</AdminSecondaryAction>
          <AdminSecondaryAction disabled={busy} onClick={() => setConfirm("deny")}>Bloquear</AdminSecondaryAction>
          <AdminSecondaryAction disabled={busy} onClick={() => setConfirm("inherit")}>Seguir</AdminSecondaryAction>
        </div>
      ) : null}
      <ul className="divide-y divide-border/60 rounded-xl border border-border/60">
        {rows.map((r: any) => (
          <li key={r.id} className="flex min-w-0 items-start gap-3 p-3">
            <Checkbox className="mt-1" checked={sel.has(r.id)} onCheckedChange={() => toggle(r.id)} aria-label={`Selecionar ${r.name}`} />
            <OfferThumb src={r.image_url} fallback={r.product_image_url} alt={r.name} />
            <div className="min-w-0 flex-1">
              <p className="break-words text-sm">{r.name}</p>
              <p className="text-xs text-muted-foreground">{[r.brand, r.volume_ml ? `${r.volume_ml}ml` : null].filter(Boolean).join(" · ") || "marca/volume não informados"}</p>
              <p className="text-xs text-muted-foreground">
                {r.price != null ? brl(r.price) : "sem preço"} · {AVAIL[r.availability] ?? r.availability} · {r.product_name ? `vinculado: ${r.product_name}` : "sem vínculo"}
                {r.product_public != null ? ` · site: ${r.product_public ? "disponível" : "indisponível"}` : ""}
              </p>
              <div className="mt-2 grid grid-cols-3 gap-1 rounded-full border border-border/60 p-0.5">
                {(Object.keys(DEC_LABEL) as Dec[]).map((d) => {
                  const active = (r.decision ?? "inherit") === d;
                  return (
                    <button key={d} type="button" disabled={busy} onClick={() => !active && run([r.id], d)} className={`h-8 truncate rounded-full px-1 text-[11px] ${active ? (d === "deny" ? "bg-destructive/20 text-destructive" : "bg-primary/20 text-foreground") : "text-muted-foreground"}`}>
                      {DEC_LABEL[d]}
                    </button>
                  );
                })}
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">Esta oferta {r.offer_public ? "pode" : "não pode"} sustentar o catálogo.</p>
            </div>
          </li>
        ))}
        {q.isLoading ? <li className="p-4 text-xs text-muted-foreground">Carregando…</li> : null}
        {q.error ? <li className="p-4 text-xs text-destructive">Não foi possível carregar: {(q.error as Error).message}</li> : null}
        {q.data && !rows.length && (search || filter !== "all") ? <li className="p-4 text-xs text-muted-foreground">Nenhuma oferta neste filtro.</li> : null}
        {q.data && !rows.length && !search && filter === "all" ? (
          <li className="space-y-2 p-4 text-xs">
            <p className="text-muted-foreground">Nenhum produto importado deste fornecedor.</p>
            {q.data.supplier.sync_message || q.data.supplier.sync_error_code ? <p className="break-words text-destructive">{q.data.supplier.sync_error_code ? `${q.data.supplier.sync_error_code}: ` : ""}{q.data.supplier.sync_message}</p> : null}
            {onSync ? <AdminSecondaryAction disabled={!!syncing} onClick={async () => { await onSync(supplierId); qc.invalidateQueries({ queryKey: ["supplier-catalog", supplierId] }); }}>{syncing ? "Sincronizando…" : "Sincronizar agora"}</AdminSecondaryAction> : null}
          </li>
        ) : null}
      </ul>
      {pages > 1 ? (
        <div className="flex items-center justify-between text-xs">
          <AdminSecondaryAction disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Anterior</AdminSecondaryAction>
          <span className="text-muted-foreground">{page + 1} / {pages} · {q.data?.total} ofertas</span>
          <AdminSecondaryAction disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>Próxima</AdminSecondaryAction>
        </div>
      ) : null}
      <AlertDialog open={!!confirm} onOpenChange={(v) => !v && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm ? DEC_LABEL[confirm] : ""} · {sel.size} oferta(s)</AlertDialogTitle>
            <AlertDialogDescription>A sincronização continua atualizando preços e disponibilidade; só muda se estas ofertas podem disponibilizar o perfume no site.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirm && run([...sel], confirm)}>Confirmar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
