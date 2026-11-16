import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Calculator,
  History,
  Loader2,
  Receipt,
  RotateCcw,
  Search,
  Store,
  Tag,
  TrendingUp,
  Wallet,
  X,
} from "lucide-react";
import { brl, listDateTime, productTitle } from "@/lib/format";
import { cn } from "@/lib/utils";
import { getPaymentPricing } from "@/lib/payment-rule";
import { ItemThumb } from "@/components/orium/admin/OrderItems";
import { AdminConfirm, AdminEmpty } from "@/components/orium/admin/AdminUI";
import {
  HelpTip,
  LadderArrow,
  LadderStep,
  MoneyInput,
  PriceValue,
} from "@/components/orium/admin/PriceBits";
import {
  PxCard,
  PxCardBody,
  PxCardHead,
  PxKpi,
  PxKpiRow,
  PxNote,
  PxPrimary,
  PxSecondary,
  PxSheet,
  PxStat,
  PxTag,
} from "@/components/orium/admin/PricingUI";
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

/** Área de trabalho da aba Preços: busca no topo e o perfume escolhido logo abaixo. */
export function PricingWorkbench() {
  const [productId, setProductId] = useState<string | null>(null);
  return (
    <div className="min-w-0 space-y-4">
      <PricingSearch onPick={setProductId} picked={productId != null} />
      {productId ? (
        <PricingProductPanel
          key={productId}
          productId={productId}
          onClose={() => setProductId(null)}
        />
      ) : null}
    </div>
  );
}

/** Busca grande (como a de Pedidos), com resultado imediato em blocos. */
export function PricingSearch({
  onPick,
  picked,
}: {
  onPick: (id: string) => void;
  picked?: boolean;
}) {
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
  const typing = term.trim().length >= 2;

  return (
    <PxCard i={7}>
      <PxCardHead
        title={picked ? "Consultar outro perfume" : "Consultar um perfume"}
        sub="Custo, preço, lucro e simulação antes de mexer no catálogo."
        icon={<Calculator className="size-[18px]" strokeWidth={2.2} />}
      />
      <PxCardBody>
        <label className="flex h-[56px] min-w-0 items-center gap-3 rounded-full bg-[#232323] px-5 focus-within:ring-2 focus-within:ring-[#FFD599]/50">
          <Search className="size-[18px] shrink-0 text-[#8C8C8C]" strokeWidth={2.2} />
          <input
            ref={inputRef}
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Nome do perfume ou marca"
            className="h-full min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-[#6F6F6F]"
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
              className="press grid size-8 shrink-0 place-items-center rounded-full bg-[#2E2E2E]"
            >
              <X className="size-4" />
            </button>
          ) : isFetching ? (
            <Loader2 className="size-[18px] shrink-0 animate-spin text-[#8C8C8C]" />
          ) : null}
        </label>

        {typing ? (
          rows.length === 0 && !isFetching ? (
            <div className="mt-3">
              <AdminEmpty>Nenhum produto encontrado.</AdminEmpty>
            </div>
          ) : (
            <ul className="mt-3 grid min-w-0 gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {rows.map((r, i) => (
                <li key={r.id} className="ord-in min-w-0" style={{ ["--i" as string]: i }}>
                  <button
                    type="button"
                    onClick={() => {
                      onPick(r.id);
                      setTerm("");
                    }}
                    className="ord-tile press flex w-full min-w-0 items-center gap-3 !bg-[#232323] p-3 text-left hover:!bg-[#2A2A2A]"
                  >
                    <span className="overflow-hidden rounded-[16px]">
                      <ItemThumb src={r.image} alt={r.name} size={56} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-bold">
                        {productTitle(r.name)}
                      </span>
                      <span className="block truncate text-[13px] text-[#8C8C8C]">
                        {r.brand ?? "Sem marca"}
                      </span>
                      <span className="mt-1 flex min-w-0 items-center gap-2 text-[13px] tabular-nums">
                        <span className="text-[#8C8C8C]">custo {brl(r.cost)}</span>
                        <span className="font-bold text-[#FFD599]">{brl(r.retail)}</span>
                      </span>
                    </span>
                    {r.custom ? <PxTag>próprio</PxTag> : null}
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </PxCardBody>
    </PxCard>
  );
}

/** Painel completo do produto: custo, preços, simulação e preview do cliente. */
export function PricingProductPanel({
  productId,
  onClose,
}: {
  productId: string;
  onClose: () => void;
}) {
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
    () => ({
      pixDiscountPercent: data?.pixDiscountPercent ?? 5,
      active: data?.pixDiscountActive !== false,
    }),
    [data?.pixDiscountPercent, data?.pixDiscountActive],
  );

  if (isPending)
    return (
      <div className="grid gap-3 lg:grid-cols-2 lg:gap-4">
        <div className="admin-skeleton h-[220px] rounded-[28px]" />
        <div className="admin-skeleton h-[220px] rounded-[28px]" />
      </div>
    );
  if (!data) return <AdminEmpty>Produto não encontrado.</AdminEmpty>;

  const cost = data.cost;
  const retail = data.retail;
  const card = getPaymentPricing(retail ?? 0, payment);
  const wholesaleCard = getPaymentPricing(data.wholesale ?? 0, payment);
  const profit = cost != null && retail != null ? Number((retail - cost).toFixed(2)) : null;
  const marginPct = profit != null && retail ? (profit / retail) * 100 : null;
  const adjust =
    data.baseRetail != null && retail != null ? Number((data.baseRetail - retail).toFixed(2)) : 0;

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
    ? "Promoção ativa"
    : data.customRetail != null
      ? "Preço personalizado"
      : "Preço automático";
  const shownPrice = data.promotion?.price ?? retail;

  return (
    <div className="ord-slide min-w-0 space-y-4">
      {/* identificação */}
      <PxCard>
        <div className="flex min-w-0 flex-col gap-4 p-5 sm:flex-row sm:items-center lg:p-6">
          <div className="flex min-w-0 flex-1 items-center gap-4">
            <span className="shrink-0 overflow-hidden rounded-[20px] bg-white">
              <ItemThumb src={data.image} alt={data.name} size={76} />
            </span>
            <div className="min-w-0">
              <p className="truncate text-[13.5px] font-semibold text-[#8C8C8C]">
                {data.brand ?? "Sem marca"}
                {data.volumeMl ? ` · ${data.volumeMl} ml` : ""}
                {data.concentration ? ` · ${data.concentration}` : ""}
              </p>
              <h2 className="mt-0.5 truncate text-[24px] leading-tight font-bold tracking-[-0.03em] lg:text-[28px]">
                {productTitle(data.name)}
              </h2>
              <div className="mt-2 flex min-w-0 flex-wrap gap-1.5">
                <PxTag gold={!!data.promotion}>{origin}</PxTag>
                {data.usedOutOfStockCost ? <PxTag>Custo sem estoque</PxTag> : null}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <PxSecondary icon={<Store className="size-4" />} onClick={() => setOffersOpen(true)}>
              Fornecedores
            </PxSecondary>
            <PxSecondary icon={<History className="size-4" />} onClick={() => setHistoryOpen(true)}>
              Histórico
            </PxSecondary>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar produto"
              className="dash-dots press"
            >
              <X className="size-[18px]" strokeWidth={2.2} />
            </button>
          </div>
        </div>
        <p className="px-5 pb-5 text-[13px] text-[#8C8C8C] lg:px-6 lg:pb-6">
          {data.manualPricing
            ? "Produto de cadastro manual: o preço é definido à mão."
            : `Fornecedor do custo: ${data.supplierName ?? "—"} · atualizado ${listDateTime(data.costUpdatedAt)}`}
        </p>
      </PxCard>

      {/* quatro números do perfume */}
      <PxKpiRow>
        <PxKpi
          hero
          className="col-span-2 xl:col-span-1"
          label="Preço no Pix"
          icon={<Wallet className="size-[18px]" strokeWidth={2.2} />}
          value={<PriceValue value={retail} />}
          foot={
            adjust > 0 && data.psych.active
              ? `ajuste comercial de −${brl(adjust)}`
              : `custo + ${brl(data.retailMarkup)}`
          }
        />
        <PxKpi
          label="No cartão"
          icon={<Receipt className="size-[18px]" strokeWidth={2.2} />}
          value={<PriceValue value={card.active ? card.cardPrice : retail} />}
          foot={
            card.active ? `${data.pixDiscountPercent}% OFF no Pix` : "desconto do Pix desligado"
          }
        />
        <PxKpi
          label="Atacado"
          icon={<Tag className="size-[18px]" strokeWidth={2.2} />}
          value={<PriceValue value={data.wholesale} />}
          foot={`a partir de ${data.wholesaleMinQuantity} peças`}
        />
        <PxKpi
          label="Lucro bruto"
          icon={<TrendingUp className="size-[18px]" strokeWidth={2.2} />}
          value={
            <span className={cn(profit != null && profit < 0 && "text-[#FF9A8A]")}>
              <PriceValue value={profit} />
            </span>
          }
          foot={
            marginPct == null
              ? "sem custo"
              : `margem ${pct(marginPct)}${marginPct < 15 ? " · baixa" : ""}`
          }
        />
      </PxKpiRow>

      <div className="grid min-w-0 gap-3 lg:grid-cols-2 lg:gap-4">
        {/* caminho do preço */}
        <PxCard>
          <PxCardHead
            title="Como este preço é formado"
            sub="Do custo do fornecedor ao preço que o cliente paga."
          />
          <PxCardBody>
            {data.promotion ? (
              <div className="mb-3 rounded-[22px] bg-[#FFD599] p-4 text-[#15130F]">
                <p className="text-[13px] font-bold">Promoção ativa · {data.promotion.name}</p>
                <p className="mt-1 flex min-w-0 items-baseline gap-2">
                  <span className="text-[14px] line-through opacity-60 tabular-nums">
                    {brl(retail)}
                  </span>
                  <PriceValue
                    value={data.promotion.price}
                    className="text-[24px] font-bold tracking-[-0.02em]"
                  />
                  <span className="rounded-full bg-[#15130F] px-2 py-0.5 text-[12px] font-bold text-[#FFD599]">
                    −{data.promotion.percent}%
                  </span>
                </p>
                <p className="mt-1 text-[12.5px] opacity-70">
                  {data.promotion.endsAt
                    ? `Termina em ${listDateTime(data.promotion.endsAt)}`
                    : "Sem data final"}
                </p>
              </div>
            ) : null}

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
                      Depois da margem, o preço desce até o final ,90 mais próximo, sem passar do
                      limite configurado.
                    </HelpTip>
                  }
                />
              </>
            ) : (
              <>
                <LadderArrow>preço cadastrado</LadderArrow>
                <LadderStep label="Preço Pix" value={retail} tone="gold" strong />
              </>
            )}
            <LadderArrow>cartão = Pix ÷ (1 − {data.pixDiscountPercent}%)</LadderArrow>
            <LadderStep
              label="Preço no cartão"
              value={card.active ? card.cardPrice : retail}
              note={
                card.active ? `${data.pixDiscountPercent}% OFF no Pix` : "desconto do Pix desligado"
              }
              help={
                <HelpTip title="Pix e cartão">
                  O preço cadastrado é o preço no Pix. O valor do cartão é calculado para que o
                  desconto do Pix seja exato.
                </HelpTip>
              }
            />
            <div className="mt-3">
              <LadderStep
                label="Atacado"
                value={data.wholesale}
                note={`a partir de ${data.wholesaleMinQuantity} peças · ${brl(wholesaleCard.active ? wholesaleCard.cardPrice : data.wholesale)} no cartão`}
                help={
                  <HelpTip title="Atacado">
                    Vale com {data.wholesaleMinQuantity} ou mais peças no carrinho, podendo misturar
                    perfumes diferentes.
                  </HelpTip>
                }
              />
            </div>
          </PxCardBody>
        </PxCard>

        <div className="min-w-0 space-y-3 lg:space-y-4">
          {/* simulador */}
          <PxCard>
            <PxCardHead title="Simular preço" sub="Nada é salvo enquanto você simula." />
            <PxCardBody>
              <MoneyInput
                id="sim-price"
                label="Quanto quero vender no Pix"
                value={sim}
                onChange={setSim}
              />

              <div className="mt-3 flex min-w-0 flex-wrap gap-2">
                {[-10, -5, 5, 10].map((step) => (
                  <button
                    key={step}
                    type="button"
                    onClick={() =>
                      setSim(Math.max(0, Number(((sim ?? retail ?? 0) + step).toFixed(2))))
                    }
                    className="press h-10 shrink-0 rounded-full bg-[#232323] px-4 text-[14px] font-bold tabular-nums transition-colors hover:bg-[#2C2C2C]"
                  >
                    {step > 0 ? `+ R$ ${step}` : `− R$ ${Math.abs(step)}`}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setSim(retail ?? null)}
                  className="press h-10 shrink-0 rounded-full px-4 text-[14px] font-bold text-[#A9A9A9] transition-colors hover:text-white"
                >
                  Preço atual
                </button>
              </div>

              <div className="mt-4 grid min-w-0 grid-cols-2 gap-2">
                <PxStat
                  label="Lucro bruto"
                  value={<PriceValue value={simProfit} />}
                  tone={belowCost ? "danger" : "gold"}
                />
                <PxStat label="Margem" value={simMargin == null ? "—" : pct(simMargin)} />
                <PxStat
                  label="No cartão"
                  value={<PriceValue value={simCard.active ? simCard.cardPrice : sim} />}
                />
                <PxStat
                  label="Contra o atual"
                  value={
                    simDiff == null
                      ? "—"
                      : `${simDiff > 0 ? "+" : simDiff < 0 ? "−" : ""}${brl(Math.abs(simDiff))}`
                  }
                  tone={
                    simDiff != null && simDiff > 0
                      ? "good"
                      : simDiff != null && simDiff < 0
                        ? "warning"
                        : undefined
                  }
                />
              </div>

              {belowCost ? (
                <div className="mt-3">
                  <PxNote tone="danger">
                    Atenção: este preço está abaixo do custo de {brl(cost)}.
                  </PxNote>
                </div>
              ) : null}

              <div className="mt-4 flex min-w-0 flex-wrap gap-2">
                <PxPrimary
                  className="min-w-0 flex-1"
                  loading={busy}
                  disabled={sim == null || sim <= 0 || (retail != null && sim === retail)}
                  onClick={() => setConfirm(true)}
                >
                  Aplicar preço
                </PxPrimary>
                {data.customRetail != null && !data.manualPricing ? (
                  <PxSecondary
                    className="h-[54px]"
                    disabled={busy}
                    icon={<RotateCcw className="size-4" />}
                    onClick={() => setResetConfirm(true)}
                  >
                    Voltar ao automático
                  </PxSecondary>
                ) : null}
              </div>
            </PxCardBody>
          </PxCard>

          {/* preview do cliente */}
          <PxCard>
            <PxCardHead title="Como o cliente vê" />
            <PxCardBody>
              <div className="rounded-[22px] bg-[#232323] p-4">
                <p className="truncate text-[13px] font-semibold text-[#8C8C8C]">
                  {data.brand ?? ""}
                </p>
                <p className="truncate text-[16px] font-bold">{productTitle(data.name)}</p>
                <p className="mt-2 flex min-w-0 flex-wrap items-baseline gap-2">
                  <PriceValue
                    value={shownPrice}
                    className="text-[28px] font-bold tracking-[-0.03em] text-[#FFD599]"
                  />
                  <span className="text-[13px] text-[#8C8C8C]">no Pix</span>
                </p>
                {card.active ? (
                  <p className="text-[13px] text-[#A9A9A9]">
                    {brl(getPaymentPricing(shownPrice ?? 0, payment).cardPrice)} no cartão
                  </p>
                ) : null}
                {data.wholesale != null ? (
                  <p className="mt-1 text-[13px] text-[#A9A9A9]">
                    A partir de {data.wholesaleMinQuantity} peças: {brl(data.wholesale)}
                  </p>
                ) : null}
                {data.decants.length ? (
                  <div className="mt-3 flex min-w-0 flex-wrap gap-1.5">
                    {data.decants.map((d) => (
                      <PxTag key={d.ml}>
                        {d.ml} ml · {brl(d.price)}
                        {d.custom ? " · próprio" : ""}
                      </PxTag>
                    ))}
                  </div>
                ) : null}
              </div>
            </PxCardBody>
          </PxCard>
        </div>
      </div>

      {/* fornecedores */}
      <PxSheet
        open={offersOpen}
        onClose={() => setOffersOpen(false)}
        title="Fornecedores"
        description={productTitle(data.name)}
      >
        {data.offers.length === 0 ? (
          <AdminEmpty>Sem ofertas de fornecedor para este produto.</AdminEmpty>
        ) : (
          <ul className="space-y-2">
            {data.offers.map((o, i) => (
              <li
                key={`${o.supplierName}-${i}`}
                className={cn(
                  "flex min-w-0 items-center justify-between gap-3 rounded-[20px] p-4",
                  o.best ? "bg-[#FFD599] text-[#15130F]" : "bg-[#1A1A1A]",
                )}
              >
                <div className="min-w-0">
                  <p className="truncate text-[15px] font-bold">{o.supplierName}</p>
                  <p className={cn("text-[13px]", o.best ? "text-[#15130F]/65" : "text-[#8C8C8C]")}>
                    {o.inStock ? "Disponível" : "Indisponível"}
                    {o.best ? " · melhor custo" : ""}
                  </p>
                </div>
                <p className="shrink-0 text-[18px] font-bold tabular-nums">{brl(o.price)}</p>
              </li>
            ))}
          </ul>
        )}
      </PxSheet>

      {/* histórico */}
      <PxSheet
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        title="Histórico de custo"
        description="O custo do fornecedor ao longo do tempo. O preço de venda acompanha conforme a regra em vigor."
      >
        {data.costHistory.length === 0 ? (
          <AdminEmpty>Sem variação de custo registrada.</AdminEmpty>
        ) : (
          <ul className="space-y-1.5">
            {data.costHistory.map((h, i) => (
              <li
                key={i}
                className="flex min-w-0 items-center justify-between gap-3 rounded-[18px] bg-[#1A1A1A] px-4 py-3"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[14.5px] font-semibold">
                    {h.supplierName}
                  </span>
                  <span className="block text-[12.5px] text-[#8C8C8C]">{listDateTime(h.at)}</span>
                </span>
                <span className="shrink-0 text-[16px] font-bold tabular-nums">{brl(h.price)}</span>
              </li>
            ))}
          </ul>
        )}
      </PxSheet>

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
