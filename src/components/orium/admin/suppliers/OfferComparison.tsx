import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Ban, ExternalLink, Star } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { compareProductOffers, setOfferCatalog, setProductSupplierPreference } from "@/lib/supplier-hub.functions";
import { OfferThumb } from "./OfferThumb";
import { brl, relativeTime } from "@/lib/format";
import { PRIORITY_LABEL, SUPPLY_MODE_LABEL, type SupplyMode } from "@/lib/supplier-lead";

const AVAIL: Record<string, string> = { AVAILABLE: "Disponível", UNAVAILABLE: "Indisponível", UNKNOWN: "Disponibilidade a confirmar" };
const pct = (m: number | null) => (m == null ? "—" : `${(m * 100).toFixed(1).replace(".", ",")}%`);

/** Ofertas de um perfume em todos os fornecedores visíveis na comparação. */
export function OfferComparison({ productId }: { productId: string }) {
  const compare = useServerFn(compareProductOffers);
  const setPref = useServerFn(setProductSupplierPreference);
  const setCat = useServerFn(setOfferCatalog);
  const qc = useQueryClient();
  const [units, setUnits] = useState(1);
  const [kept, setKept] = useState<Set<string>>(new Set());
  const { data, isLoading, error } = useQuery({ queryKey: ["offer-compare", productId, units], queryFn: () => compare({ data: { productId, units } }) });

  const refresh = () => qc.invalidateQueries({ queryKey: ["offer-compare", productId] });
  const toggle = async (supplierId: string, current: string | null, mode: "preferred" | "blocked") => {
    try {
      await setPref({ data: { productId, supplierId, mode: current === mode ? null : mode } });
      refresh();
      toast.success(current === mode ? "Preferência removida." : mode === "preferred" ? "Fornecedor preferido para este perfume." : "Fornecedor bloqueado para este perfume.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar.");
    }
  };
  const hideOffer = async (supplierId: string, offerId: string) => {
    try {
      await setCat({ data: { supplierId, offerIds: [offerId], decision: "deny" } });
      refresh();
      toast.success("Esta oferta não disponibiliza mais o perfume no site.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar.");
    }
  };

  if (isLoading) return <p className="text-sm text-muted-foreground">Carregando ofertas…</p>;
  if (error) return <p className="text-sm text-destructive">{(error as Error).message}</p>;
  if (!data) return null;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>Comparar para</span>
        <Input className="h-9 w-16" inputMode="numeric" value={String(units)} onChange={(e) => setUnits(Math.max(1, Math.min(999, Number(e.target.value.replace(/\D/g, "")) || 1)))} />
        <span>frasco(s) · venda {data.product.sale_price != null ? brl(data.product.sale_price) : "sem preço"}</span>
      </div>
      {data.localStock > 0 ? <p className="rounded-xl border border-primary/40 bg-primary/10 p-3 text-xs">{data.localStock} frasco(s) lacrado(s) na loja: pronta entrega, sem prazo de fornecedor.</p> : null}
      {data.offers.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma oferta vinculada a este perfume.</p> : null}
      {data.offers.map((o) => (
        <div key={o.offer_id} className={`rounded-2xl border p-3 text-sm ${o.preference === "blocked" ? "border-border/40 opacity-60" : o.labels.includes("Preferencial") ? "border-primary/50" : "border-border/60"}`}>
          <div className="flex min-w-0 items-start justify-between gap-3">
            <OfferThumb src={o.image_url} fallback={data.product.image_url} alt={data.product.name ?? o.supplier_name} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{o.supplier_name}</p>
              <p className="text-xs text-muted-foreground">{SUPPLY_MODE_LABEL[o.supply_mode as SupplyMode] ?? o.supply_mode}{o.origin ? ` · ${o.origin}` : ""} · {PRIORITY_LABEL[o.priority]}</p>
            </div>
            <div className="shrink-0 text-right">
              <p className="font-semibold">{o.price != null ? brl(o.price) : "Sem preço"}</p>
              {o.promo ? <p className="text-[11px] text-primary">promoção</p> : null}
            </div>
          </div>
          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
            <dt className="text-muted-foreground">Custo anunciado</dt><dd className="text-right">{o.price != null ? brl(o.price) : "—"}</dd>
            <dt className="text-muted-foreground">Frete por unidade</dt><dd className="text-right">{o.freight_per_unit != null ? brl(o.freight_per_unit) : "a consultar"}</dd>
            <dt className="text-muted-foreground">Custo total estimado</dt><dd className="text-right font-medium">{o.effective_unit_cost != null ? brl(o.effective_unit_cost) : "—"}</dd>
            <dt className="text-muted-foreground">Margem estimada</dt><dd className={`text-right ${o.below_margin ? "text-destructive" : ""}`}>{pct(o.margin)}{o.min_margin != null ? ` (mín. ${o.min_margin}%)` : ""}</dd>
          </dl>
          <p className="mt-2 text-xs text-muted-foreground">
            {AVAIL[o.availability]} · {o.shipping_text} · {o.lead_text}
            {o.min_order ? ` · mínimo ${brl(o.min_order)}` : ""}
            {o.stale ? " · preço desatualizado" : ` · lido ${relativeTime(o.last_synced_at)}`}
            {!o.use_for_pricing ? " · não altera preço público" : ""}
            {` · catálogo: ${o.catalog.public ? "pode publicar" : "não publica"}`}
          </p>
          {o.below_margin && o.catalog.public && !kept.has(o.offer_id) ? (
            <div className="mt-2 space-y-2 rounded-xl border border-destructive/40 bg-destructive/10 p-2 text-xs">
              <p>Este produto pode não atingir a margem mínima desejada.</p>
              <div className="grid grid-cols-3 gap-1.5">
                <button type="button" className="h-9 rounded-full border border-border/60" onClick={() => setKept((s) => new Set(s).add(o.offer_id))}>Manter</button>
                <button type="button" className="h-9 rounded-full border border-destructive/50 text-destructive" onClick={() => hideOffer(o.supplier_id, o.offer_id)}>Não disponibilizar</button>
                <Link to="/admin/precificacao" className="inline-flex h-9 items-center justify-center rounded-full border border-border/60">Revisar preço</Link>
              </div>
            </div>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {o.labels.map((l) => <span key={l} className="rounded-full border border-primary/40 px-2 py-0.5 text-[11px] text-primary">{l}</span>)}
            <span className="flex-1" />
            <button type="button" aria-label="Preferir para este perfume" onClick={() => toggle(o.supplier_id, o.preference, "preferred")} className={`inline-flex h-9 items-center gap-1 rounded-full border px-3 text-xs ${o.preference === "preferred" ? "border-primary text-primary" : "border-border/60 text-muted-foreground"}`}><Star className="size-3.5" />Preferir</button>
            <button type="button" aria-label="Bloquear para este perfume" onClick={() => toggle(o.supplier_id, o.preference, "blocked")} className={`inline-flex h-9 items-center gap-1 rounded-full border px-3 text-xs ${o.preference === "blocked" ? "border-destructive text-destructive" : "border-border/60 text-muted-foreground"}`}><Ban className="size-3.5" />Bloquear</button>
            {o.url ? <a href={o.url} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center rounded-full border border-border/60 px-3 text-muted-foreground" aria-label="Abrir no site"><ExternalLink className="size-3.5" /></a> : null}
          </div>
        </div>
      ))}
    </div>
  );
}
