import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Eye, Loader2, Plus, Search, Ticket, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { brl, dateBR, productTitle } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { deviceId, isRunning, saoPauloDateTimeToIso, applyPercent } from "@/lib/promotions";
import { normalizeTheme, type CampaignVars } from "@/lib/campaign-message";
import { getOffers, type OfferDiagnostic } from "@/lib/offers.functions";
import { OfferPopup } from "@/components/orium/OfferPopup";
import { ItemThumb } from "@/components/orium/admin/OrderItems";
import {
  AdminBlock,
  AdminCard,
  AdminConfirm,
  AdminEmpty,
  AdminMore,
  AdminStatus,
  AdminTechDetails,
} from "@/components/orium/admin/AdminUI";
import { MiniMetric, PercentInput } from "@/components/orium/admin/PriceBits";
import {
  CampaignCopyEditor,
  campaignCopyIssues,
  campaignCopyPayload,
  emptyCampaignCopy,
  type CampaignCopyValue,
} from "@/components/orium/CampaignCopyEditor";

/* ------------------------------------------------------------------ *
 * Promoções e cupons — visão de campanha, com foto do produto, preço
 * antes/depois e período claros. As regras não mudam: promoção é uma
 * camada sobre o preço atual (o preço base nunca é alterado) e cupom
 * continua sendo aplicado no carrinho.
 * ------------------------------------------------------------------ */

type AppliesTo = "BOTH" | "DECANT" | "FULL";

const APPLIES_LABEL: Record<AppliesTo, string> = {
  BOTH: "Decants e frascos",
  DECANT: "Somente decants",
  FULL: "Somente frascos",
};

const SIZES = [2, 5, 10];

const appliesShort = (row: { applies_to: string; decant_sizes?: number[] | null }) => {
  const sizes = row.decant_sizes ?? [];
  if (row.applies_to === "FULL") return "Frasco";
  if (row.applies_to === "DECANT") return sizes.length ? `Decant · ${sizes.join("ml / ")}ml` : "Decants";
  return sizes.length ? `Frasco e decant · ${sizes.join("ml / ")}ml` : "Frasco e decants";
};

const campaignStatus = (row: { active: boolean; starts_at: string | null; ends_at: string | null }) => {
  const now = Date.now();
  if (!row.active) return "pausada";
  if (row.starts_at && new Date(row.starts_at).getTime() > now) return "agendada";
  if (row.ends_at && new Date(row.ends_at).getTime() <= now) return "encerrada";
  return "ativa";
};

/* ---------------------- escolha de perfumes ---------------------- */

function ProductPicker({ ids, setIds }: { ids: string[]; setIds: (v: string[]) => void }) {
  const [term, setTerm] = useState("");
  const { data: results } = useQuery({
    queryKey: ["campaign-product-search", term],
    enabled: term.trim().length >= 2,
    queryFn: async () =>
      (
        await supabase
          .from("products")
          .select("id, canonical_name, brand, image_url, retail_price")
          .eq("active", true)
          .ilike("search_text", `%${term.trim().toLowerCase()}%`)
          .limit(8)
      ).data ?? [],
  });
  const { data: chosen } = useQuery({
    queryKey: ["campaign-product-names", ids.join(",")],
    enabled: ids.length > 0,
    queryFn: async () =>
      (await supabase.from("products").select("id, canonical_name, image_url").in("id", ids)).data ?? [],
  });

  return (
    <div className="min-w-0 space-y-2">
      <Label>Perfumes (vazio = catálogo inteiro)</Label>
      <div className="relative min-w-0">
        <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Buscar perfume"
          className="h-12 rounded-xl pl-9 text-base"
        />
      </div>
      {term.trim().length >= 2 && (results ?? []).length > 0 ? (
        <div className="min-w-0 space-y-1 rounded-xl border border-border/60 p-1">
          {(results ?? []).map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                if (!ids.includes(p.id)) setIds([...ids, p.id]);
                setTerm("");
              }}
              className="flex w-full min-w-0 items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-muted"
            >
              <ItemThumb src={p.image_url} alt={p.canonical_name} size={40} />
              <span className="min-w-0 flex-1 truncate text-sm">
                {p.brand ? `${p.brand} · ` : ""}
                {productTitle(p.canonical_name)}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{brl(p.retail_price)}</span>
            </button>
          ))}
        </div>
      ) : null}
      {ids.length > 0 ? (
        <div className="flex min-w-0 flex-wrap gap-1.5">
          {(chosen ?? []).map((p) => (
            <span
              key={p.id}
              className="flex min-w-0 max-w-full items-center gap-1 rounded-full bg-muted px-3 py-1 text-xs"
            >
              <span className="min-w-0 truncate">{productTitle(p.canonical_name)}</span>
              <button
                type="button"
                onClick={() => setIds(ids.filter((i) => i !== p.id))}
                aria-label="Remover"
                className="shrink-0"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* -------------------------- promoções -------------------------- */

export function PromotionsPanel() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  const { data: list } = useQuery({
    queryKey: ["admin-promotions"],
    queryFn: async () =>
      (await supabase.from("promotions").select("*").order("created_at", { ascending: false })).data ?? [],
  });

  const rows = list ?? [];
  const productIds = useMemo(
    () => [...new Set(rows.flatMap((p) => (p.product_ids ?? []) as string[]))].slice(0, 200),
    [rows],
  );
  const { data: products } = useQuery({
    queryKey: ["campaign-products", productIds.join(",")],
    enabled: productIds.length > 0,
    queryFn: async () =>
      (await supabase.from("products").select("id, canonical_name, brand, image_url, retail_price").in("id", productIds))
        .data ?? [],
  });
  const byId = useMemo(() => new Map((products ?? []).map((p) => [p.id, p])), [products]);

  const counts = useMemo(() => {
    const now = Date.now();
    return {
      ativas: rows.filter((p) => isRunning(p as never, now)).length,
      agendadas: rows.filter((p) => campaignStatus(p as never) === "agendada").length,
      encerradas: rows.filter((p) => ["encerrada", "pausada"].includes(campaignStatus(p as never))).length,
    };
  }, [rows]);

  const toggle = async (id: string, active: boolean) => {
    await supabase.from("promotions").update({ active }).eq("id", id);
    qc.invalidateQueries();
  };
  const remove = async (id: string) => {
    await supabase.from("promotions").delete().eq("id", id);
    toast.success("Promoção removida.");
    qc.invalidateQueries();
  };

  return (
    <div className="min-w-0 space-y-5">
      <div className="grid min-w-0 grid-cols-3 gap-2">
        <MiniMetric label="Ativas" value={counts.ativas} tone="gold" />
        <MiniMetric label="Agendadas" value={counts.agendadas} />
        <MiniMetric label="Encerradas" value={counts.encerradas} />
      </div>

      <Button className="press h-12 w-full rounded-full sm:w-auto" onClick={() => setOpen(true)}>
        <Plus className="size-4" /> Nova promoção
      </Button>

      <AdminBlock title="Campanhas">
        {rows.length === 0 ? (
          <AdminEmpty>Nenhuma promoção criada.</AdminEmpty>
        ) : (
          <ul className="min-w-0 space-y-3">
            {rows.map((p) => {
              const single = (p.product_ids ?? []).length === 1 ? byId.get(String((p.product_ids ?? [])[0])) : null;
              const base = single?.retail_price != null ? Number(single.retail_price) : null;
              const promoPrice = base != null ? applyPercent(base, Number(p.discount_percent)) : null;
              const status = campaignStatus(p as never);
              return (
                <li key={p.id}>
                  <AdminCard className="admin-row-in min-w-0">
                    <div className="flex min-w-0 items-start gap-3">
                      <ItemThumb src={single?.image_url ?? null} alt={p.name} size={56} />
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-2">
                          <p className="min-w-0 truncate text-sm font-semibold">{p.name}</p>
                          <AdminStatus status={status} />
                        </div>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {single
                            ? `${single.brand ? `${single.brand} · ` : ""}${productTitle(single.canonical_name)}`
                            : (p.product_ids ?? []).length
                              ? `${(p.product_ids ?? []).length} perfumes`
                              : "Catálogo inteiro"}
                        </p>
                        <p className="mt-1 flex min-w-0 flex-wrap items-baseline gap-2">
                          {base != null ? (
                            <>
                              <span className="text-xs text-muted-foreground line-through tabular-nums">
                                {brl(base)}
                              </span>
                              <span className="text-base font-semibold text-gold tabular-nums">{brl(promoPrice)}</span>
                            </>
                          ) : null}
                          <span className="text-xs font-semibold text-gold">{Number(p.discount_percent)}% OFF</span>
                        </p>
                        <div className="mt-1.5 flex min-w-0 flex-wrap gap-1.5">
                          <span className="rounded-full border border-border/60 px-2 py-0.5 text-[10px] font-semibold tracking-[0.06em] uppercase">
                            {appliesShort(p as never)}
                          </span>
                          {p.app_exclusive !== false ? (
                            <span className="rounded-full border border-gold/30 bg-gold/10 px-2 py-0.5 text-[10px] font-semibold tracking-[0.06em] text-gold uppercase">
                              {(p.app_badge_label ?? "").trim() || "Exclusivo no app"}
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-1.5 text-xs text-muted-foreground">
                          {p.starts_at ? `${dateBR(p.starts_at)} → ` : ""}
                          {p.ends_at ? dateBR(p.ends_at) : "sem data final"}
                        </p>
                      </div>
                      <AdminMore
                        actions={[
                          {
                            label: p.active ? "Pausar promoção" : "Ativar promoção",
                            onSelect: () => void toggle(p.id, !p.active),
                          },
                          { label: "Excluir promoção", danger: true, separated: true, onSelect: () => setRemoving(p.id) },
                        ]}
                      />
                    </div>

                    <AdminTechDetails label="Editar comunicação e desempenho">
                      <p className="mb-2">
                        {p.orders_count ?? 0} pedidos · {brl(Number(p.sales_total ?? 0))} vendidos ·{" "}
                        {brl(Number(p.discount_total ?? 0))} de desconto
                      </p>
                      <ExistingCampaignCopy
                        table="promotions"
                        row={p as never}
                        badge={`${Number(p.discount_percent)}% OFF`}
                        vars={{
                          discount: String(Number(p.discount_percent)),
                          product: String(p.name),
                          category:
                            p.applies_to === "DECANT" ? "decants" : p.applies_to === "FULL" ? "frascos" : "todo o catálogo",
                        }}
                        fallbackMessage={`${Number(p.discount_percent)}% OFF em ${p.name}`}
                      />
                      <PromotionPopupTools promotionId={p.id} />
                    </AdminTechDetails>
                  </AdminCard>
                </li>
              );
            })}
          </ul>
        )}
      </AdminBlock>

      <NewPromotionSheet open={open} onClose={() => setOpen(false)} />
      <AdminConfirm
        open={!!removing}
        onOpenChange={(v) => !v && setRemoving(null)}
        title="Excluir promoção?"
        description="O preço volta ao normal imediatamente."
        confirmLabel="Excluir"
        danger
        onConfirm={() => removing && void remove(removing)}
      />
    </div>
  );
}

function NewPromotionSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [percent, setPercent] = useState<number | null>(10);
  const [appliesTo, setAppliesTo] = useState<AppliesTo>("BOTH");
  const [sizes, setSizes] = useState<number[]>([]);
  const [ids, setIds] = useState<string[]>([]);
  const [starts, setStarts] = useState("");
  const [ends, setEnds] = useState("");
  const [announce, setAnnounce] = useState(true);
  const [appExclusive, setAppExclusive] = useState(true);
  const [badgeLabel, setBadgeLabel] = useState("");
  const [copy, setCopy] = useState<CampaignCopyValue>(emptyCampaignCopy());
  const [busy, setBusy] = useState(false);

  const pct = Number(percent) || 0;
  const promoVars: CampaignVars = {
    discount: String(pct),
    product: name.trim() || "seus perfumes",
    category: appliesTo === "DECANT" ? "decants" : appliesTo === "FULL" ? "frascos" : "todo o catálogo",
  };

  const { data: preview } = useQuery({
    queryKey: ["promo-preview", ids[0] ?? ""],
    enabled: ids.length === 1,
    queryFn: async () =>
      (await supabase.from("products").select("canonical_name, retail_price").eq("id", ids[0]!).maybeSingle()).data,
  });
  const base = preview?.retail_price != null ? Number(preview.retail_price) : null;
  const promoPrice = base != null ? applyPercent(base, pct) : null;

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("Dê um nome para a promoção.");
      return;
    }
    if (!(pct > 0 && pct <= 90)) {
      toast.error("O desconto deve ficar entre 1% e 90%.");
      return;
    }
    if (campaignCopyIssues(copy, promoVars).length > 0) {
      toast.error("Há variáveis sem valor na comunicação da campanha.");
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.from("promotions").insert({
        name: name.trim(),
        discount_percent: pct,
        applies_to: appliesTo,
        product_ids: ids,
        decant_sizes: appliesTo === "FULL" ? [] : sizes,
        starts_at: saoPauloDateTimeToIso(starts),
        ends_at: saoPauloDateTimeToIso(ends),
        announce,
        app_exclusive: appExclusive,
        app_badge_label: badgeLabel.trim() || null,
        ...campaignCopyPayload(copy),
        active: true,
      });
      if (error) throw error;
      toast.success("Promoção criada.");
      setName("");
      setBadgeLabel("");
      setCopy(emptyCampaignCopy());
      setIds([]);
      setSizes([]);
      qc.invalidateQueries();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível criar.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent
        side="bottom"
        className="max-h-[90vh] overflow-y-auto rounded-t-[24px] px-4 pb-[calc(env(safe-area-inset-bottom,0px)+16px)]"
      >
        <SheetHeader className="px-0 text-left">
          <SheetTitle className="text-base">Nova promoção</SheetTitle>
        </SheetHeader>

        <form onSubmit={create} className="mt-3 min-w-0 space-y-5">
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor="promo-name">Nome</Label>
            <Input
              id="promo-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Semana dos decants"
              className="h-12 rounded-xl text-base"
            />
          </div>

          <ProductPicker ids={ids} setIds={setIds} />

          <div className="min-w-0 space-y-1.5">
            <Label>O que entra na promoção</Label>
            <div className="grid min-w-0 grid-cols-3 gap-1 rounded-xl border border-border/60 p-1">
              {(["BOTH", "DECANT", "FULL"] as AppliesTo[]).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setAppliesTo(v)}
                  className={cn(
                    "h-10 min-w-0 truncate rounded-lg px-2 text-xs transition-colors duration-150",
                    appliesTo === v ? "bg-gold font-medium text-gold-foreground" : "text-muted-foreground",
                  )}
                >
                  {v === "BOTH" ? "Ambos" : v === "DECANT" ? "Decants" : "Frascos"}
                </button>
              ))}
            </div>
          </div>

          {appliesTo !== "FULL" ? (
            <div className="min-w-0 space-y-1.5">
              <Label>Tamanhos de decant (vazio = todos)</Label>
              <div className="flex min-w-0 gap-2">
                {SIZES.map((ml) => (
                  <button
                    key={ml}
                    type="button"
                    onClick={() => setSizes(sizes.includes(ml) ? sizes.filter((s) => s !== ml) : [...sizes, ml])}
                    className={cn(
                      "h-11 min-w-0 flex-1 rounded-xl border text-sm",
                      sizes.includes(ml) ? "border-gold bg-gold/10 font-medium" : "border-border/60 text-muted-foreground",
                    )}
                  >
                    {ml}ml
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <PercentInput id="promo-pct" label="Desconto" value={percent} onChange={setPercent} />

          {base != null ? (
            <div className="min-w-0 rounded-2xl border border-gold/30 bg-gold/5 p-3">
              <p className="text-[11px] tracking-[0.08em] text-muted-foreground uppercase">Prévia</p>
              <p className="mt-1 flex min-w-0 flex-wrap items-baseline gap-2">
                <span className="text-sm text-muted-foreground line-through tabular-nums">{brl(base)}</span>
                <span className="text-lg font-semibold text-gold tabular-nums">{brl(promoPrice)}</span>
              </p>
              <p className="text-xs text-muted-foreground">
                Economia de {brl(base - (promoPrice ?? base))} · {pct}% OFF
              </p>
            </div>
          ) : null}

          <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="promo-start">Começa em (opcional)</Label>
              <Input
                id="promo-start"
                type="datetime-local"
                value={starts}
                onChange={(e) => setStarts(e.target.value)}
                className="h-12 rounded-xl text-base"
              />
            </div>
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="promo-end">Termina em (opcional)</Label>
              <Input
                id="promo-end"
                type="datetime-local"
                value={ends}
                onChange={(e) => setEnds(e.target.value)}
                className="h-12 rounded-xl text-base"
              />
            </div>
          </div>

          <div className="min-w-0 rounded-xl border border-border/60 p-3">
            <div className="flex min-w-0 items-center justify-between gap-3">
              <p className="min-w-0 text-sm font-medium">Desconto exclusivo do aplicativo</p>
              <Switch checked={appExclusive} onCheckedChange={setAppExclusive} />
            </div>
            {appExclusive ? (
              <div className="mt-3 min-w-0 space-y-1.5">
                <Label htmlFor="promo-badge">Texto do selo (opcional)</Label>
                <Input
                  id="promo-badge"
                  value={badgeLabel}
                  onChange={(e) => setBadgeLabel(e.target.value.slice(0, 28))}
                  placeholder="Exclusivo no app"
                  className="h-12 rounded-xl text-base"
                />
              </div>
            ) : null}
          </div>

          <div className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-border/60 p-3">
            <p className="min-w-0 text-sm font-medium">Anunciar uma vez ao cliente</p>
            <Switch checked={announce} onCheckedChange={setAnnounce} />
          </div>

          {announce ? (
            <CampaignCopyEditor
              idPrefix="promo-copy"
              value={copy}
              onChange={setCopy}
              vars={promoVars}
              badge={`${pct}% OFF`}
              fallbackMessage={`${pct}% OFF em ${name.trim() || "seus perfumes"}`}
            />
          ) : null}

          <Button type="submit" disabled={busy} className="press h-12 w-full rounded-full">
            {busy ? <Loader2 className="size-4 animate-spin" /> : "Criar promoção"}
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}

const REASON_LABEL: Record<OfferDiagnostic["reason"], string> = {
  ELIGIBLE: "Pronta para aparecer",
  INACTIVE: "Promoção inativa",
  OUTSIDE_PERIOD: "Fora do período configurado",
  CAMPAIGN_NOT_PUBLIC: "Popup desativado",
  PRODUCT_INVALID: "Selecione exatamente um produto válido",
  PRODUCT_UNAVAILABLE: "Produto indisponível",
  ALREADY_SEEN: "Já vista neste navegador",
};

function PromotionPopupTools({ promotionId }: { promotionId: string }) {
  const load = useServerFn(getOffers);
  const { session } = useAuth();
  const [diagnostic, setDiagnostic] = useState<OfferDiagnostic | null>(null);
  const [previewOffers, setPreviewOffers] = useState<Awaited<ReturnType<typeof load>>["offers"]>([]);
  const [busy, setBusy] = useState(false);

  const inspect = async (showPreview: boolean) => {
    setBusy(true);
    try {
      const result = await load({
        data: { deviceId: deviceId(), userId: session?.user.id ?? null, previewPromotionId: promotionId },
      });
      setDiagnostic(result.diagnostics[0] ?? null);
      if (showPreview) {
        if (result.offers.length) setPreviewOffers(result.offers);
        else toast.error("Não foi possível montar o popup: produto ou preço inválido.");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível testar o popup.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 min-w-0 border-t border-border/50 pt-3">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void inspect(true)}>
          <Eye className="size-3.5" /> Testar popup
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void inspect(false)}>
          Verificar exibição
        </Button>
      </div>
      {diagnostic ? (
        <p className={cn("mt-2 text-xs", diagnostic.reason === "ELIGIBLE" ? "text-success" : "text-muted-foreground")}>
          {REASON_LABEL[diagnostic.reason]}
        </p>
      ) : null}
      {previewOffers.length ? <OfferPopup offers={previewOffers} preview onDone={() => setPreviewOffers([])} /> : null}
    </div>
  );
}

/* --------------------------- cupons --------------------------- */

export function CouponsPanel() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);

  const { data: list } = useQuery({
    queryKey: ["admin-coupons"],
    queryFn: async () =>
      (await supabase.from("coupons").select("*").order("created_at", { ascending: false })).data ?? [],
  });

  const rows = useMemo(() => {
    const clean = term.trim().toUpperCase();
    return (list ?? []).filter((c) => !clean || String(c.code).toUpperCase().includes(clean));
  }, [list, term]);

  const toggle = async (id: string, active: boolean) => {
    await supabase.from("coupons").update({ active }).eq("id", id);
    qc.invalidateQueries();
  };
  const remove = async (id: string) => {
    await supabase.from("coupons").delete().eq("id", id);
    toast.success("Cupom removido.");
    qc.invalidateQueries();
  };

  return (
    <div className="min-w-0 space-y-5">
      <div className="flex min-w-0 flex-wrap gap-2">
        <div className="flex h-12 min-w-0 flex-1 items-center gap-2 rounded-2xl border border-border/70 bg-card px-3 focus-within:border-gold/60">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            value={term}
            onChange={(e) => setTerm(e.target.value.toUpperCase())}
            placeholder="Buscar cupom"
            className="min-w-0 flex-1 bg-transparent text-base uppercase outline-none"
          />
        </div>
        <Button className="press h-12 shrink-0 rounded-full" onClick={() => setOpen(true)}>
          <Plus className="size-4" /> Criar cupom
        </Button>
      </div>

      <CouponTester coupons={list ?? []} />

      <AdminBlock title="Cupons">
        {rows.length === 0 ? (
          <AdminEmpty>Nenhum cupom encontrado.</AdminEmpty>
        ) : (
          <ul className="min-w-0 space-y-3">
            {rows.map((c) => (
              <li key={c.id}>
                <AdminCard className="admin-row-in min-w-0">
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="grid size-11 shrink-0 place-items-center rounded-xl border border-gold/30 bg-gold/10">
                      <Ticket className="size-5 text-gold" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <p className="min-w-0 truncate text-sm font-semibold tracking-wide">{c.code}</p>
                        <AdminStatus status={campaignStatus(c as never)} />
                      </div>
                      <p className="mt-0.5 text-sm font-semibold text-gold">{Number(c.discount_percent)}% OFF</p>
                      <div className="mt-1.5 flex min-w-0 flex-wrap gap-1.5 text-[10px] font-semibold tracking-[0.06em] uppercase">
                        <span className="rounded-full border border-border/60 px-2 py-0.5">
                          {c.visibility === "PUBLIC" ? "Público" : "Secreto"}
                        </span>
                        <span className="rounded-full border border-border/60 px-2 py-0.5">
                          {appliesShort(c as never)}
                        </span>
                      </div>
                      <p className="mt-1.5 text-xs text-muted-foreground">
                        Usados: {c.redemptions ?? 0}
                        {c.max_redemptions ? ` / ${c.max_redemptions}` : ""} ·{" "}
                        {c.ends_at ? `válido até ${dateBR(c.ends_at)}` : "sem data final"}
                      </p>
                    </div>
                    <AdminMore
                      actions={[
                        { label: c.active ? "Pausar cupom" : "Ativar cupom", onSelect: () => void toggle(c.id, !c.active) },
                        { label: "Excluir cupom", danger: true, separated: true, onSelect: () => setRemoving(c.id) },
                      ]}
                    />
                  </div>

                  <AdminTechDetails label="Restrições e comunicação">
                    <div className="mb-3 space-y-1">
                      <p>Aplicável a: {APPLIES_LABEL[c.applies_to as AppliesTo]}</p>
                      <p>Usos por cliente: {c.max_per_user ?? "sem limite"}</p>
                      <p>Acumula com promoção: {c.stackable ? "Sim" : "Não"}</p>
                      <p>Perfumes: {(c.product_ids ?? []).length ? `${(c.product_ids ?? []).length}` : "todos"}</p>
                      <p>
                        {brl(Number(c.sales_total ?? 0))} vendidos · {brl(Number(c.discount_total ?? 0))} de desconto
                      </p>
                    </div>
                    <ExistingCampaignCopy
                      table="coupons"
                      row={c as never}
                      badge={`${String(c.code).toUpperCase()} · ${Number(c.discount_percent)}% OFF`}
                      vars={{
                        coupon: String(c.code).toUpperCase(),
                        discount: String(Number(c.discount_percent)),
                        category:
                          c.applies_to === "DECANT" ? "decants" : c.applies_to === "FULL" ? "frascos" : "todo o catálogo",
                      }}
                      fallbackMessage={`Use ${String(c.code).toUpperCase()} e economize ${Number(c.discount_percent)}% no seu pedido.`}
                    />
                  </AdminTechDetails>
                </AdminCard>
              </li>
            ))}
          </ul>
        )}
      </AdminBlock>

      <NewCouponSheet open={open} onClose={() => setOpen(false)} />
      <AdminConfirm
        open={!!removing}
        onOpenChange={(v) => !v && setRemoving(null)}
        title="Excluir cupom?"
        description="Quem tiver o código deixa de conseguir usar."
        confirmLabel="Excluir"
        danger
        onConfirm={() => removing && void remove(removing)}
      />
    </div>
  );
}

type CouponRow = {
  id: string;
  code: string;
  discount_percent: number;
  applies_to: string;
  product_ids: string[];
  active: boolean;
  starts_at: string | null;
  ends_at: string | null;
  max_redemptions: number | null;
  redemptions: number;
};

/** Testar cupom: contas locais, sem criar pedido nenhum. */
function CouponTester({ coupons }: { coupons: CouponRow[] }) {
  const [code, setCode] = useState("");
  const [cart, setCart] = useState("300");
  const [variant, setVariant] = useState<"FULL" | "DECANT">("FULL");

  const result = useMemo(() => {
    const clean = code.trim().toUpperCase();
    const total = Number(String(cart).replace(",", ".")) || 0;
    if (!clean) return null;
    const coupon = coupons.find((c) => String(c.code).toUpperCase() === clean);
    if (!coupon) return { ok: false as const, reason: "Cupom não encontrado." };
    if (!isRunning(coupon as never)) return { ok: false as const, reason: "Cupom inativo ou fora do período." };
    if (coupon.max_redemptions != null && (coupon.redemptions ?? 0) >= coupon.max_redemptions)
      return { ok: false as const, reason: "Cupom já atingiu o limite de usos." };
    if (coupon.applies_to === "FULL" && variant === "DECANT")
      return { ok: false as const, reason: "Cupom não aplicável: vale somente para frascos." };
    if (coupon.applies_to === "DECANT" && variant === "FULL")
      return { ok: false as const, reason: "Cupom não aplicável: vale somente para decants." };
    if ((coupon.product_ids ?? []).length > 0)
      return {
        ok: true as const,
        discount: Number((total * (Number(coupon.discount_percent) / 100)).toFixed(2)),
        final: applyPercent(total, Number(coupon.discount_percent)),
        note: "Vale apenas para os perfumes escolhidos na criação do cupom.",
      };
    return {
      ok: true as const,
      discount: Number((total * (Number(coupon.discount_percent) / 100)).toFixed(2)),
      final: applyPercent(total, Number(coupon.discount_percent)),
      note: null,
    };
  }, [code, cart, variant, coupons]);

  return (
    <AdminCard className="min-w-0">
      <h3 className="text-sm font-semibold">Testar cupom</h3>
      <div className="mt-3 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor="test-cart">Carrinho (R$)</Label>
          <Input
            id="test-cart"
            inputMode="decimal"
            value={cart}
            onChange={(e) => setCart(e.target.value)}
            className="h-12 rounded-xl text-base tabular-nums"
          />
        </div>
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor="test-code">Cupom</Label>
          <Input
            id="test-code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="ORIUM10"
            className="h-12 rounded-xl text-base uppercase"
          />
        </div>
      </div>
      <div className="mt-3 grid min-w-0 grid-cols-2 gap-1 rounded-xl border border-border/60 p-1">
        {(["FULL", "DECANT"] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setVariant(v)}
            className={cn(
              "h-10 rounded-lg text-xs transition-colors duration-150",
              variant === v ? "bg-gold font-medium text-gold-foreground" : "text-muted-foreground",
            )}
          >
            {v === "FULL" ? "Frasco" : "Decant"}
          </button>
        ))}
      </div>

      {result ? (
        result.ok ? (
          <div className="admin-value-in mt-3 grid min-w-0 grid-cols-2 gap-2">
            <MiniMetric label="Desconto" value={brl(result.discount)} tone="gold" />
            <MiniMetric label="Final" value={brl(result.final)} />
            {result.note ? (
              <p className="col-span-2 text-xs text-muted-foreground">{result.note}</p>
            ) : null}
          </div>
        ) : (
          <p className="admin-value-in mt-3 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
            {result.reason}
          </p>
        )
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">Nenhum pedido é criado neste teste.</p>
      )}
    </AdminCard>
  );
}

function NewCouponSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [code, setCode] = useState("");
  const [percent, setPercent] = useState<number | null>(10);
  const [visibility, setVisibility] = useState<"PUBLIC" | "SECRET">("SECRET");
  const [appliesTo, setAppliesTo] = useState<AppliesTo>("BOTH");
  const [ids, setIds] = useState<string[]>([]);
  const [maxTotal, setMaxTotal] = useState("");
  const [maxPerUser, setMaxPerUser] = useState("1");
  const [ends, setEnds] = useState("");
  const [stackable, setStackable] = useState(false);
  const [announce, setAnnounce] = useState(false);
  const [copy, setCopy] = useState<CampaignCopyValue>(emptyCampaignCopy());
  const [busy, setBusy] = useState(false);

  const pct = Number(percent) || 0;
  const couponVars: CampaignVars = {
    coupon: code.trim().toUpperCase() || "CUPOM",
    discount: String(pct),
    category: appliesTo === "DECANT" ? "decants" : appliesTo === "FULL" ? "frascos" : "todo o catálogo",
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = code.trim().toUpperCase().replace(/\s+/g, "");
    if (clean.length < 3) {
      toast.error("O código precisa ter ao menos 3 letras.");
      return;
    }
    if (!(pct > 0 && pct <= 90)) {
      toast.error("O desconto deve ficar entre 1% e 90%.");
      return;
    }
    if (campaignCopyIssues(copy, { ...couponVars, coupon: clean }).length > 0) {
      toast.error("Há variáveis sem valor na comunicação da campanha.");
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.from("coupons").insert({
        code: clean,
        discount_percent: pct,
        visibility,
        applies_to: appliesTo,
        product_ids: ids,
        decant_sizes: [],
        max_redemptions: maxTotal ? Number(maxTotal) : null,
        max_per_user: maxPerUser ? Number(maxPerUser) : null,
        ends_at: ends ? new Date(ends).toISOString() : null,
        stackable,
        announce,
        ...campaignCopyPayload(copy),
        active: true,
      });
      if (error)
        throw new Error(error.message.includes("duplicate") ? "Já existe um cupom com esse código." : error.message);
      toast.success("Cupom criado.");
      setCode("");
      setIds([]);
      setCopy(emptyCampaignCopy());
      qc.invalidateQueries();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível criar.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent
        side="bottom"
        className="max-h-[90vh] overflow-y-auto rounded-t-[24px] px-4 pb-[calc(env(safe-area-inset-bottom,0px)+16px)]"
      >
        <SheetHeader className="px-0 text-left">
          <SheetTitle className="text-base">Novo cupom</SheetTitle>
        </SheetHeader>

        <form onSubmit={create} className="mt-3 min-w-0 space-y-5">
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor="cup-code">Código</Label>
            <Input
              id="cup-code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="ORIUM10"
              className="h-12 rounded-xl text-base uppercase"
            />
          </div>

          <PercentInput id="cup-pct" label="Desconto" value={percent} onChange={setPercent} />

          <div className="min-w-0 space-y-1.5">
            <Label>Visibilidade</Label>
            <div className="grid min-w-0 grid-cols-2 gap-1 rounded-xl border border-border/60 p-1">
              {(["SECRET", "PUBLIC"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setVisibility(v)}
                  className={cn(
                    "h-10 rounded-lg text-xs transition-colors duration-150",
                    visibility === v ? "bg-gold font-medium text-gold-foreground" : "text-muted-foreground",
                  )}
                >
                  {v === "SECRET" ? "Secreto" : "Público"}
                </button>
              ))}
            </div>
          </div>

          <div className="min-w-0 space-y-1.5">
            <Label>Vale para</Label>
            <div className="grid min-w-0 grid-cols-3 gap-1 rounded-xl border border-border/60 p-1">
              {(["BOTH", "DECANT", "FULL"] as AppliesTo[]).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setAppliesTo(v)}
                  className={cn(
                    "h-10 min-w-0 truncate rounded-lg text-xs transition-colors duration-150",
                    appliesTo === v ? "bg-gold font-medium text-gold-foreground" : "text-muted-foreground",
                  )}
                >
                  {v === "BOTH" ? "Ambos" : v === "DECANT" ? "Decants" : "Frascos"}
                </button>
              ))}
            </div>
          </div>

          <ProductPicker ids={ids} setIds={setIds} />

          <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="cup-max">Limite total de usos</Label>
              <Input
                id="cup-max"
                inputMode="numeric"
                value={maxTotal}
                onChange={(e) => setMaxTotal(e.target.value.replace(/\D/g, ""))}
                placeholder="sem limite"
                className="h-12 rounded-xl text-base tabular-nums"
              />
            </div>
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="cup-user">Usos por cliente</Label>
              <Input
                id="cup-user"
                inputMode="numeric"
                value={maxPerUser}
                onChange={(e) => setMaxPerUser(e.target.value.replace(/\D/g, ""))}
                className="h-12 rounded-xl text-base tabular-nums"
              />
            </div>
          </div>

          <div className="min-w-0 space-y-1.5">
            <Label htmlFor="cup-end">Válido até (opcional)</Label>
            <Input
              id="cup-end"
              type="datetime-local"
              value={ends}
              onChange={(e) => setEnds(e.target.value)}
              className="h-12 rounded-xl text-base"
            />
          </div>

          <div className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-border/60 p-3">
            <span className="min-w-0">
              <span className="block text-sm font-medium">Acumular com promoção</span>
              <span className="block text-xs text-muted-foreground">
                Desligado: o cliente recebe sempre a melhor condição.
              </span>
            </span>
            <Switch checked={stackable} onCheckedChange={setStackable} />
          </div>

          <div className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-border/60 p-3">
            <span className="min-w-0">
              <span className="block text-sm font-medium">Anunciar uma vez</span>
              <span className="block text-xs text-muted-foreground">Só para cupons públicos.</span>
            </span>
            <Switch checked={announce} onCheckedChange={setAnnounce} />
          </div>

          {announce && visibility === "PUBLIC" ? (
            <CampaignCopyEditor
              idPrefix="cup-copy"
              value={copy}
              onChange={setCopy}
              vars={couponVars}
              badge={`${code.trim().toUpperCase() || "CUPOM"} · ${pct}% OFF`}
              fallbackMessage={`Use ${code.trim().toUpperCase() || "CUPOM"} e economize ${pct}% no seu pedido.`}
            />
          ) : null}

          <Button type="submit" disabled={busy} className="press h-12 w-full rounded-full">
            {busy ? <Loader2 className="size-4 animate-spin" /> : "Criar cupom"}
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}

/* ------------------ comunicação de campanha já criada ------------------ */

type CampaignRow = {
  id: string;
  announce_title: string | null;
  announce_message: string | null;
  announce_cta: string | null;
  announce_footnote: string | null;
  announce_theme: string | null;
};

function ExistingCampaignCopy({
  table,
  row,
  badge,
  vars,
  fallbackMessage,
}: {
  table: "promotions" | "coupons";
  row: CampaignRow & Record<string, unknown>;
  badge: string;
  vars: CampaignVars;
  fallbackMessage: string;
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [copy, setCopy] = useState<CampaignCopyValue>({
    title: row.announce_title ?? "",
    message: row.announce_message ?? "",
    cta: row.announce_cta ?? "",
    footnote: row.announce_footnote ?? "",
    theme: normalizeTheme(row.announce_theme),
    showAgain: false,
  });

  const save = async () => {
    if (campaignCopyIssues(copy, vars).length > 0) {
      toast.error("Há variáveis sem valor na mensagem.");
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase
        .from(table)
        .update({
          ...campaignCopyPayload(copy),
          ...(copy.showAgain ? { announce_reset_at: new Date().toISOString() } : {}),
        })
        .eq("id", row.id);
      if (error) throw error;
      toast.success("Comunicação atualizada.");
      setCopy({ ...copy, showAgain: false });
      qc.invalidateQueries();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível salvar.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-w-0 space-y-3">
      <CampaignCopyEditor
        idPrefix={`${table}-${row.id}`}
        value={copy}
        onChange={setCopy}
        vars={vars}
        badge={badge}
        fallbackMessage={fallbackMessage}
        withShowAgain
      />
      <Button onClick={() => void save()} disabled={busy} className="press h-11 w-full rounded-full">
        {busy ? <Loader2 className="size-4 animate-spin" /> : "Salvar comunicação"}
      </Button>
    </div>
  );
}
