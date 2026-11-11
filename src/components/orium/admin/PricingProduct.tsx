import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, RotateCcw, Search, Store, X } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { brl, listDateTime, productTitle } from "@/lib/format";
import { cn } from "@/lib/utils";
import { getPaymentPricing } from "@/lib/payment-rule";
import { ItemThumb } from "@/components/orium/admin/OrderItems";
import { AdminBlock, AdminCard, AdminConfirm, AdminEmpty, AdminRowsSkeleton, AdminStatus } from "@/components/orium/admin/AdminUI";
import { HelpTip, LadderArrow, LadderStep, MiniMetric, MoneyInput, PriceValue } from "@/components/orium/admin/PriceBits";
import {
  pricingSearch,
  pricingSnapshot,
  setProductPrice,
  type PricingSearchRow,
  type PricingSnapshot,
} from "@/lib/pricing-admin.functions";

/* ------------------------------------------------------------------ *
 * Consulta e simulação de preço de um perfume.
 *
 * A simulação é local e instantânea, usando as MESMAS regras do
 * catálogo (payment-rule para Pix/cartão). Nada é gravado até tocar
 * "Aplicar preço".
 * ------------------------------------------------------------------ */

const pct = (v: number) => `${v.toFixed(1).replace(".", ",")}%`;

/** Busca grande, com resultado imediato. */
export function PricingSearch({ onPick }: { onPick: (id: string) => void }) {
  const search = useServerFn(pricingSearch);
  const [term, setTerm] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  const { data, isFetching } = useQuery({
    queryKey: ["pricing-search", term.trim()],
    enabled: term.trim().length >= 2,
    queryFn: async () => (await search({ data: { term: term.trim() } })) as PricingSearchRow[],
    staleTime: 30_000,
  });

  const rows = data ?? [];

  return (
    <div className="min-w-0 space-y-3">
      <div className="flex h-12 min-w-0 items-center gap-2 rounded-2xl border border-border/70 bg-card px-3 focus-within:border-gold/60">
        <Search className="size-4 shrink-0 text-muted-foreground" />
        <input
          ref={inputRef}
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Buscar perfume ou produto"
          className="min-w-0 flex-1 bg-transparent text-base outline-none"
          autoComplete="off"
        />
        {term ? (
          <button
            type="button"
            onClick={() => {
              setTerm("");
              inputRef.current?.focus();
            }}
            aria-label="Limpar busca"
            className="grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground"
          >
            <X className="size-4" />
          </button>
        ) : isFetching ? (
          <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
        ) : null}
      </div>

      {term.trim().length >= 2 ? (
        rows.length === 0 && !isFetching ? (
          <AdminEmpty>Nenhum produto encontrado.</AdminEmpty>
        ) : (
          <ul className="min-w-0 space-y-2">
            {rows.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => {
                    onPick(r.id);
                    setTerm("");
                  }}
                  className="admin-row-in flex w-full min-w-0 items-center gap-3 rounded-2xl border border-border/60 bg-card p-3 text-left"
                >
                  <ItemThumb src={r.image} alt={r.name} size={48} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{productTitle(r.name)}</p>
                    <p className="truncate text-xs text-muted-foreground">{r.brand ?? "Sem marca"}</p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      Custo {brl(r.cost)} · Preço {brl(r.retail)}
                    </p>
                  </div>
                  {r.custom ? <AdminStatus status="personalizado" /> : null}
                </button>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}

/** Painel completo do produto: custo, preços, simulação e preview do cliente. */
export function PricingProductPanel({ productId, onClose }: { productId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const load = useServerFn(pricingSnapshot);
  const save = useServerFn(setProductPrice);
  const [offersOpen, setOffersOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [sim, setSim] = useState<number | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const { data, isPending } = useQuery({
    queryKey: ["pricing-snapshot", productId],
    queryFn: async () => (await load({ data: { productId } })) as PricingSnapshot | null,
  });

  useEffect(() => {
    setSim(data?.retail ?? null);
  }, [data?.productId, data?.retail]);

  const payment = useMemo(
    () => ({ pixDiscountPercent: data?.pixDiscountPercent ?? 5, active: data?.pixDiscountActive !== false }),
    [data?.pixDiscountPercent, data?.pixDiscountActive],
  );

  if (isPending) return <AdminRowsSkeleton rows={3} height={140} />;
  if (!data) return <AdminEmpty>Produto não encontrado.</AdminEmpty>;

  const cost = data.cost;
  const retail = data.retail;
  const card = getPaymentPricing(retail ?? 0, payment);
  const wholesaleCard = getPaymentPricing(data.wholesale ?? 0, payment);
  const profit = cost != null && retail != null ? Number((retail - cost).toFixed(2)) : null;
  const marginPct = profit != null && retail ? (profit / retail) * 100 : null;
  const adjust = data.baseRetail != null && retail != null ? Number((data.baseRetail - retail).toFixed(2)) : 0;

  const simCard = getPaymentPricing(sim ?? 0, payment);
  const simProfit = cost != null && sim != null ? Number((sim - cost).toFixed(2)) : null;
  const simMargin = simProfit != null && sim ? (simProfit / sim) * 100 : null;
  const simDiff = sim != null && retail != null ? Number((sim - retail).toFixed(2)) : null;
  const belowCost = cost != null && sim != null && sim < cost;

  const apply = async (value: number | null) => {
    setBusy(true);
    try {
      await save({ data: { productId, retailPrice: value } });
      toast.success(value == null ? "Preço voltou ao automático." : "Preço aplicado.");
      qc.invalidateQueries({ queryKey: ["pricing-snapshot", productId] });
      qc.invalidateQueries({ queryKey: ["pricing-search"] });
      qc.invalidateQueries({ queryKey: ["pricing-overrides"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar o preço.");
    } finally {
      setBusy(false);
    }
  };

  const origin = data.promotion
    ? "promoção ativa"
    : data.customRetail != null
      ? "preço personalizado"
      : "preço automático";

  return (
    <div className="min-w-0 space-y-4">
      {/* identificação */}
      <AdminCard className="min-w-0">
        <div className="flex min-w-0 items-start gap-3">
          <ItemThumb src={data.image} alt={data.name} size={56} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-semibold">{productTitle(data.name)}</p>
            <p className="truncate text-xs text-muted-foreground">
              {data.brand ?? "Sem marca"}
              {data.volumeMl ? ` · ${data.volumeMl}ml` : ""}
              {data.concentration ? ` · ${data.concentration}` : ""}
            </p>
            <div className="mt-2 flex min-w-0 flex-wrap gap-1.5">
              <AdminStatus status={origin} />
              {data.usedOutOfStockCost ? <AdminStatus status="custo sem estoque" /> : null}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar produto"
            className="grid size-9 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-accent"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="mt-4 grid min-w-0 grid-cols-2 gap-2">
          <MiniMetric label="Custo" value={<PriceValue value={cost} />} />
          <MiniMetric label="Preço Pix" value={<PriceValue value={retail} />} tone="gold" />
          <MiniMetric label="No cartão" value={<PriceValue value={card.active ? card.cardPrice : retail} />} />
          <MiniMetric label="Atacado" value={<PriceValue value={data.wholesale} />} />
        </div>

        <div className="mt-3 flex min-w-0 flex-wrap gap-2">
          <Button variant="outline" size="sm" className="rounded-full" onClick={() => setOffersOpen(true)}>
            <Store className="size-3.5" /> Ver fornecedores
          </Button>
          <Button variant="ghost" size="sm" className="rounded-full" onClick={() => setHistoryOpen(true)}>
            Ver histórico
          </Button>
        </div>

        <p className="mt-3 text-xs text-muted-foreground">
          {data.manualPricing
            ? "Produto de cadastro manual: o preço é definido à mão."
            : `Fornecedor do custo: ${data.supplierName ?? "—"} · atualizado ${listDateTime(data.costUpdatedAt)}`}
        </p>
      </AdminCard>

      {data.promotion ? (
        <AdminCard className="min-w-0 border-gold/30 bg-gold/5">
          <p className="text-[11px] font-semibold tracking-[0.12em] text-gold uppercase">Promoção ativa</p>
          <p className="mt-1 truncate text-sm font-medium">{data.promotion.name}</p>
          <div className="mt-2 flex min-w-0 items-baseline gap-2">
            <span className="text-sm text-muted-foreground line-through tabular-nums">{brl(retail)}</span>
            <PriceValue value={data.promotion.price} className="text-lg font-semibold text-gold" />
            <span className="text-xs text-muted-foreground">−{data.promotion.percent}%</span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {data.promotion.endsAt ? `Termina em ${listDateTime(data.promotion.endsAt)}` : "Sem data final"}
          </p>
        </AdminCard>
      ) : null}

      {/* caminho do preço */}
      <AdminBlock title="Como este preço é formado">
        <AdminCard className="min-w-0">
          <LadderStep label="Custo" value={cost} note={data.supplierName ?? undefined} />
          <LadderArrow>margem de varejo + {brl(data.retailMarkup)}</LadderArrow>
          <LadderStep label="Varejo base" value={data.baseRetail} />
          {data.psych.active ? (
            <>
              <LadderArrow>
                ajuste comercial (final ,90), máximo {brl(data.psych.maxReduction)}
              </LadderArrow>
              <LadderStep
                label="Preço Pix"
                value={retail}
                tone="gold"
                strong
                note={adjust > 0 ? `ajuste de −${brl(adjust)}` : undefined}
                help={
                  <HelpTip title="Ajuste comercial">
                    Depois da margem, o preço desce até o final ,90 mais próximo, sem passar do limite configurado.
                  </HelpTip>
                }
              />
            </>
          ) : (
            <LadderStep label="Preço Pix" value={retail} tone="gold" strong />
          )}
          <LadderArrow>
            cartão = Pix ÷ (1 − {data.pixDiscountPercent}%)
          </LadderArrow>
          <LadderStep
            label="Preço no cartão"
            value={card.active ? card.cardPrice : retail}
            note={card.active ? `${data.pixDiscountPercent}% OFF no Pix` : "desconto do Pix desligado"}
            help={
              <HelpTip title="Pix e cartão">
                O preço cadastrado é o preço no Pix. O valor do cartão é calculado para que o desconto do Pix seja
                exato.
              </HelpTip>
            }
          />

          <div className="mt-4 border-t border-border/50 pt-3">
            <LadderStep
              label="Atacado"
              value={data.wholesale}
              note={`a partir de ${data.wholesaleMinQuantity} peças · ${brl(wholesaleCard.active ? wholesaleCard.cardPrice : data.wholesale)} no cartão`}
              help={
                <HelpTip title="Atacado">
                  Vale com {data.wholesaleMinQuantity} ou mais peças no carrinho, podendo misturar perfumes
                  diferentes.
                </HelpTip>
              }
            />
          </div>

          <div className="mt-4 grid min-w-0 grid-cols-2 gap-2">
            <MiniMetric
              label="Lucro bruto"
              value={<PriceValue value={profit} />}
              tone={profit != null && profit < 0 ? "danger" : "gold"}
            />
            <MiniMetric
              label="Margem sobre a venda"
              value={marginPct == null ? "—" : pct(marginPct)}
              {...(marginPct != null && marginPct < 15 ? { tone: "warning" as const } : {})}
            />
          </div>
        </AdminCard>
      </AdminBlock>

      {/* simulador */}
      <AdminBlock title="Simular preço">
        <AdminCard className="min-w-0">
          <MoneyInput
            id="sim-price"
            label="Quanto quero vender (Pix)"
            value={sim}
            onChange={setSim}
            hint="Nada é salvo enquanto você simula."
          />

          <div className="mt-3 flex min-w-0 flex-wrap gap-2">
            {[-10, -5, 5, 10].map((step) => (
              <button
                key={step}
                type="button"
                onClick={() => setSim(Math.max(0, Number(((sim ?? retail ?? 0) + step).toFixed(2))))}
                className="press h-9 shrink-0 rounded-full border border-border/70 px-3 text-sm tabular-nums"
              >
                {step > 0 ? `+ R$${step}` : `− R$${Math.abs(step)}`}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setSim(retail ?? null)}
              className="press h-9 shrink-0 rounded-full border border-border/70 px-3 text-sm"
            >
              Preço atual
            </button>
          </div>

          <div className="mt-4 grid min-w-0 grid-cols-2 gap-2">
            <MiniMetric label="Lucro bruto" value={<PriceValue value={simProfit} />} tone={belowCost ? "danger" : "gold"} />
            <MiniMetric label="Margem sobre a venda" value={simMargin == null ? "—" : pct(simMargin)} />
            <MiniMetric label="No cartão" value={<PriceValue value={simCard.active ? simCard.cardPrice : sim} />} />
            <MiniMetric
              label="Contra o preço atual"
              value={simDiff == null ? "—" : `${simDiff > 0 ? "+" : simDiff < 0 ? "−" : ""}${brl(Math.abs(simDiff))}`}
            />
          </div>

          {belowCost ? (
            <p className="mt-3 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              Atenção: este preço está abaixo do custo de {brl(cost)}.
            </p>
          ) : null}

          <div className="mt-4 flex min-w-0 flex-wrap gap-2">
            <Button
              className="press h-11 min-w-0 flex-1 rounded-full"
              disabled={busy || sim == null || sim <= 0 || (retail != null && sim === retail)}
              onClick={() => setConfirm(true)}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : "Aplicar preço"}
            </Button>
            {data.customRetail != null && !data.manualPricing ? (
              <Button
                variant="outline"
                className="press h-11 rounded-full"
                disabled={busy}
                onClick={() => setResetConfirm(true)}
              >
                <RotateCcw className="size-4" /> Voltar ao automático
              </Button>
            ) : null}
          </div>
        </AdminCard>
      </AdminBlock>

      {/* preview do cliente */}
      <AdminBlock title="Como o cliente verá">
        <AdminCard className="min-w-0">
          <p className="truncate text-sm font-medium">{productTitle(data.name)}</p>
          <p className="mt-1 flex min-w-0 flex-wrap items-baseline gap-2">
            <PriceValue value={data.promotion?.price ?? retail} className="text-2xl font-semibold text-gold" />
            <span className="text-xs text-muted-foreground">no Pix</span>
          </p>
          {card.active ? (
            <p className="text-xs text-muted-foreground">
              {brl(getPaymentPricing(data.promotion?.price ?? retail ?? 0, payment).cardPrice)} no cartão
            </p>
          ) : null}
          {data.wholesale != null ? (
            <p className="mt-1 text-xs text-muted-foreground">
              A partir de {data.wholesaleMinQuantity} peças: {brl(data.wholesale)}
            </p>
          ) : null}
          <div className="mt-3 flex min-w-0 flex-wrap gap-2 text-xs text-muted-foreground">
            {data.decants.map((d) => (
              <span key={d.ml} className="rounded-full border border-border/60 px-2.5 py-1">
                {d.ml}ml {brl(d.price)}
                {d.custom ? " · próprio" : ""}
              </span>
            ))}
          </div>
        </AdminCard>
      </AdminBlock>

      {/* fornecedores */}
      <Sheet open={offersOpen} onOpenChange={setOffersOpen}>
        <SheetContent
          side="bottom"
          className="max-h-[85vh] overflow-y-auto rounded-t-[24px] px-4 pb-[calc(env(safe-area-inset-bottom,0px)+16px)]"
        >
          <SheetHeader className="px-0 text-left">
            <SheetTitle className="text-base">Fornecedores</SheetTitle>
          </SheetHeader>
          {data.offers.length === 0 ? (
            <AdminEmpty>Sem ofertas de fornecedor para este produto.</AdminEmpty>
          ) : (
            <ul className="mt-2 space-y-2">
              {data.offers.map((o, i) => (
                <li
                  key={`${o.supplierName}-${i}`}
                  className={cn(
                    "flex min-w-0 items-center justify-between gap-3 rounded-2xl border p-3",
                    o.best ? "border-gold/40 bg-gold/5" : "border-border/60",
                  )}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{o.supplierName}</p>
                    <p className="text-xs text-muted-foreground">{o.inStock ? "Disponível" : "Indisponível"}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-semibold tabular-nums">{brl(o.price)}</p>
                    {o.best ? <p className="text-[11px] text-gold">Melhor custo</p> : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SheetContent>
      </Sheet>

      {/* histórico */}
      <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
        <SheetContent
          side="bottom"
          className="max-h-[85vh] overflow-y-auto rounded-t-[24px] px-4 pb-[calc(env(safe-area-inset-bottom,0px)+16px)]"
        >
          <SheetHeader className="px-0 text-left">
            <SheetTitle className="text-base">Histórico de custo</SheetTitle>
          </SheetHeader>
          {data.costHistory.length === 0 ? (
            <AdminEmpty>Sem variação de custo registrada.</AdminEmpty>
          ) : (
            <ul className="mt-2 divide-y divide-border/50">
              {data.costHistory.map((h, i) => (
                <li key={i} className="flex min-w-0 items-center justify-between gap-3 py-2.5">
                  <span className="min-w-0 truncate text-sm">{h.supplierName}</span>
                  <span className="shrink-0 text-right text-sm tabular-nums">
                    {brl(h.price)}
                    <span className="ml-2 text-xs text-muted-foreground">{listDateTime(h.at)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Aqui aparece o custo do fornecedor. O preço de venda muda junto conforme a regra em vigor.
          </p>
        </SheetContent>
      </Sheet>

      <AdminConfirm
        open={confirm}
        onOpenChange={setConfirm}
        title={belowCost ? "Vender abaixo do custo?" : "Aplicar este preço?"}
        description={
          belowCost
            ? `${brl(sim)} está abaixo do custo de ${brl(cost)}. O produto passa a ter preço personalizado.`
            : `${productTitle(data.name)} passa a custar ${brl(sim)} no Pix. O preço fica personalizado e não muda na sincronização.`
        }
        confirmLabel="Aplicar"
        danger={belowCost}
        onConfirm={() => void apply(sim)}
      />
      <AdminConfirm
        open={resetConfirm}
        onOpenChange={setResetConfirm}
        title="Voltar ao preço automático?"
        description="O preço volta a seguir custo + margem e o ajuste comercial."
        confirmLabel="Voltar ao automático"
        onConfirm={() => void apply(null)}
      />
    </div>
  );
}
