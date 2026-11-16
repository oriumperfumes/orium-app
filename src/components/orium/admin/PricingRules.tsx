import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, MessageCircle, SlidersHorizontal } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { brl, productTitle } from "@/lib/format";
import { commercialPrice } from "@/lib/commercial-price";
import { getPaymentPricing } from "@/lib/payment-rule";
import { pricingImpact, setPricesOnRequest, updatePricingRules, type PricingImpact } from "@/lib/pricing-admin.functions";
import { AdminCard, AdminEmpty } from "@/components/orium/admin/AdminUI";
import { CountInput, HelpTip, MoneyInput, PercentInput } from "@/components/orium/admin/PriceBits";

/* ------------------------------------------------------------------ *
 * Regras globais de preço: margens, ajuste comercial, Pix x cartão e
 * decants. Cada regra mostra um exemplo real, e nenhuma alteração que
 * afete o catálogo é salva sem mostrar o impacto antes.
 * ------------------------------------------------------------------ */

type Settings = {
  retail: number | null;
  wholesale: number | null;
  minQty: number | null;
  psychActive: boolean;
  psychMax: number | null;
  pixPercent: number | null;
  pixActive: boolean;
  d2: number | null;
  d5: number | null;
  d10: number | null;
};

const EMPTY: Settings = {
  retail: 120,
  wholesale: 50,
  minQty: 6,
  psychActive: false,
  psychMax: 0.1,
  pixPercent: 5,
  pixActive: true,
  d2: 19.9,
  d5: 39.9,
  d10: 69.9,
};

function usePricingRules() {
  const settings = useQuery({
    // NÃO compartilhar com o cache público: este traz só Pix/atacado e não contém margens.
    queryKey: ["admin-pricing-rules"],
    queryFn: async () => {
      const { data, error } = await supabase.from("pricing_settings").select("*").maybeSingle();
      if (error) throw error;
      return data;
    },
    staleTime: 0,
  });
  const decants = useQuery({
    queryKey: ["decant-settings"],
    queryFn: async () => (await supabase.from("decant_settings").select("*").maybeSingle()).data,
  });
  return { settings: settings.data, decants: decants.data, loading: settings.isPending || decants.isPending };
}

/**
 * Chave geral: todos os preços do catálogo público sob consulta.
 * Ligada, o cliente vê "Sob consulta" + WhatsApp no lugar dos preços e o site
 * não fecha pedido; desligada, tudo volta como estava (nenhum preço é alterado).
 */
export function PricesOnRequestCard() {
  const qc = useQueryClient();
  const save = useServerFn(setPricesOnRequest);
  const { settings, loading } = usePricingRules();
  const [busy, setBusy] = useState(false);
  const on = (settings as { prices_on_request?: boolean } | null | undefined)?.prices_on_request === true;

  const toggle = async (next: boolean) => {
    setBusy(true);
    try {
      await save({ data: { on: next } });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["admin-pricing-rules"] }),
        qc.invalidateQueries({ queryKey: ["pricing-settings"] }),
      ]);
      toast.success(next ? "Preços sob consulta ativados na loja." : "Preços voltaram a aparecer na loja.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminCard className="min-w-0">
      <div className="flex items-start gap-4">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[#1F1F1F] text-[#FFD599]">
          <MessageCircle className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold">Preços sob consulta</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            {on
              ? "Ativo: o catálogo público mostra “Sob consulta” no lugar de todos os preços e o cliente fala com a Orium pelo WhatsApp. O site não fecha pedido."
              : "Desligado: os preços aparecem normalmente na loja. Ligue para esconder todos os preços e atender só pelo WhatsApp."}
          </p>
        </div>
        {loading || busy ? (
          <Loader2 className="mt-2 size-5 shrink-0 animate-spin text-muted-foreground" />
        ) : (
          <Switch
            className="mt-2 shrink-0"
            checked={on}
            onCheckedChange={(v) => void toggle(v)}
            aria-label="Preços sob consulta em toda a loja"
          />
        )}
      </div>
    </AdminCard>
  );
}

/** Resumo de abrir a tela: quatro regras em uma olhada. */
export function PricingRulesSummary() {
  const { settings, decants } = usePricingRules();
  const [open, setOpen] = useState(false);
  const retail = Number(settings?.retail_markup ?? 120);
  const wholesale = Number(settings?.wholesale_markup ?? 50);
  const minQty = Number(settings?.wholesale_min_quantity ?? 6);
  const pix = Number(settings?.pix_discount_percent ?? 5);
  const psychOn = settings?.psych_pricing_active === true;

  const items = [
    { label: "Varejo", value: `Custo + ${brl(retail)}`, note: `Custo R$ 200 → ${brl(commercialPrice(200 + retail, { active: psychOn, strategy: "ends_90", maxReduction: Number(settings?.psych_max_reduction ?? 0) }))}` },
    { label: "Atacado", value: `Custo + ${brl(wholesale)}`, note: `A partir de ${minQty} peças` },
    { label: "Pix", value: `${pix}% abaixo do cartão`, note: `R$ 300 no Pix → ${brl(getPaymentPricing(300, { pixDiscountPercent: pix, active: settings?.pix_discount_active !== false }).cardPrice)} no cartão` },
    {
      label: "Ajuste comercial",
      value: psychOn ? "Ativo" : "Desligado",
      note: psychOn ? `Final ,90 · até ${brl(Number(settings?.psych_max_reduction ?? 0))}` : "Preço fica exato na margem",
    },
    {
      label: "Decants",
      value: `${brl(Number(decants?.price_2ml ?? 19.9))} · ${brl(Number(decants?.price_5ml ?? 39.9))} · ${brl(Number(decants?.price_10ml ?? 69.9))}`,
      note: "2ml · 5ml · 10ml",
    },
  ];

  return (
    <>
      <AdminCard className="min-w-0">
        <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((i) => (
            <div key={i.label} className="min-w-0">
              <p className="truncate text-[11px] tracking-[0.08em] text-muted-foreground uppercase">{i.label}</p>
              <p className="mt-0.5 truncate text-sm font-semibold tabular-nums">{i.value}</p>
              <p className="truncate text-xs text-muted-foreground">{i.note}</p>
            </div>
          ))}
        </div>
        <Button variant="outline" className="press mt-4 h-11 w-full rounded-full sm:w-auto" onClick={() => setOpen(true)}>
          <SlidersHorizontal className="size-4" /> Editar regras
        </Button>
      </AdminCard>

      <PricingRulesSheet open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function PricingRulesSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { settings, decants } = usePricingRules();
  const saveRules = useServerFn(updatePricingRules);
  const impactFn = useServerFn(pricingImpact);

  const initial: Settings = useMemo(
    () => ({
      retail: Number(settings?.retail_markup ?? EMPTY.retail),
      wholesale: Number(settings?.wholesale_markup ?? EMPTY.wholesale),
      minQty: Number(settings?.wholesale_min_quantity ?? EMPTY.minQty),
      psychActive: settings ? settings.psych_pricing_active === true : false,
      psychMax: Number(settings?.psych_max_reduction ?? EMPTY.psychMax),
      pixPercent: Number(settings?.pix_discount_percent ?? EMPTY.pixPercent),
      pixActive: settings ? settings.pix_discount_active !== false : true,
      d2: Number(decants?.price_2ml ?? EMPTY.d2),
      d5: Number(decants?.price_5ml ?? EMPTY.d5),
      d10: Number(decants?.price_10ml ?? EMPTY.d10),
    }),
    [settings, decants],
  );

  const [form, setForm] = useState<Settings>(initial);
  const [impact, setImpact] = useState<PricingImpact | null>(null);
  const [busy, setBusy] = useState(false);
  const [advanced, setAdvanced] = useState(false);

  useEffect(() => {
    setForm(initial);
    setImpact(null);
  }, [initial, open]);

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setForm((f) => ({ ...f, [key]: value }));

  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const catalogChanged =
    form.retail !== initial.retail ||
    form.psychActive !== initial.psychActive ||
    form.psychMax !== initial.psychMax ||
    form.wholesale !== initial.wholesale;

  const psych = { active: form.psychActive, strategy: "ends_90", maxReduction: Number(form.psychMax) || 0 };
  const exampleCost = 200;
  const exampleBase = exampleCost + (Number(form.retail) || 0);
  const exampleFinal = commercialPrice(exampleBase, psych);
  const pixPreview = getPaymentPricing(300, {
    pixDiscountPercent: Number(form.pixPercent) || 0,
    active: form.pixActive,
  });

  const check = async () => {
    if (!catalogChanged) {
      void persist();
      return;
    }
    setBusy(true);
    try {
      const res = (await impactFn({
        data: {
          retailMarkup: Number(form.retail) || 0,
          psychActive: form.psychActive,
          psychMaxReduction: Number(form.psychMax) || 0,
        },
      })) as PricingImpact;
      setImpact(res);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível calcular o impacto.");
    } finally {
      setBusy(false);
    }
  };

  const persist = async () => {
    if (!(Number(form.retail) >= 0) || !(Number(form.wholesale) >= 0)) {
      toast.error("Informe as duas margens.");
      return;
    }
    if (!(Number(form.pixPercent) > 0 && Number(form.pixPercent) < 100)) {
      toast.error("O desconto do Pix deve ficar entre 0 e 100.");
      return;
    }
    if ([form.d2, form.d5, form.d10].some((v) => !(Number(v) > 0))) {
      toast.error("Informe os três preços de decant.");
      return;
    }
    setBusy(true);
    try {
      await saveRules({
        data: {
          retail_markup: Number(form.retail),
          wholesale_markup: Number(form.wholesale),
          wholesale_min_quantity: Number(form.minQty) || 6,
          psych_pricing_active: form.psychActive,
          psych_max_reduction: Number(form.psychMax) || 0,
          pix_discount_percent: Number(form.pixPercent),
          pix_discount_active: form.pixActive,
          decant_2: Number(form.d2),
          decant_5: Number(form.d5),
          decant_10: Number(form.d10),
        },
      });

      toast.success("Precificação atualizada.");
      qc.invalidateQueries();
      setImpact(null);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar.");
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
          <SheetTitle className="text-base">{impact ? "Impacto da alteração" : "Regras de preço"}</SheetTitle>
        </SheetHeader>

        {impact ? (
          <div className="mt-3 min-w-0 space-y-4">
            <div className="grid min-w-0 grid-cols-2 gap-2">
              <div className="rounded-2xl border border-border/60 p-3">
                <p className="text-[11px] tracking-[0.08em] text-muted-foreground uppercase">Antes</p>
                <p className="mt-1 text-sm font-semibold">Varejo + {brl(initial.retail)}</p>
              </div>
              <div className="rounded-2xl border border-gold/40 bg-gold/5 p-3">
                <p className="text-[11px] tracking-[0.08em] text-muted-foreground uppercase">Depois</p>
                <p className="mt-1 text-sm font-semibold text-gold">Varejo + {brl(form.retail)}</p>
              </div>
            </div>

            <p className="text-sm">
              <span className="font-semibold tabular-nums">{impact.affected}</span> de {impact.checked} produtos mudam
              de preço
              {impact.affected ? ` · média de ${impact.delta > 0 ? "+" : "−"}${brl(Math.abs(impact.delta))} cada` : ""}.
            </p>

            {impact.sample.length === 0 ? (
              <AdminEmpty>Nenhum preço muda com esta alteração.</AdminEmpty>
            ) : (
              <ul className="min-w-0 divide-y divide-border/50 rounded-2xl border border-border/60">
                {impact.sample.map((r) => (
                  <li key={r.id} className="flex min-w-0 items-center justify-between gap-3 px-3 py-2.5">
                    <span className="min-w-0 truncate text-sm">{productTitle(r.name)}</span>
                    <span className="shrink-0 text-sm tabular-nums">
                      <span className="text-muted-foreground">{brl(r.from)}</span> → {brl(r.to)}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            <div className="flex min-w-0 gap-2">
              <Button variant="outline" className="press h-11 flex-1 rounded-full" onClick={() => setImpact(null)}>
                Cancelar
              </Button>
              <Button className="press h-11 flex-1 rounded-full" disabled={busy} onClick={() => void persist()}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : "Aplicar alteração"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-3 min-w-0 space-y-5">
            {/* varejo */}
            <section className="min-w-0 space-y-3 rounded-2xl border border-border/60 p-4">
              <div className="flex min-w-0 items-center gap-1">
                <h3 className="text-sm font-semibold">Varejo</h3>
                <HelpTip title="Margem de varejo">
                  Valor somado ao menor custo disponível do fornecedor para chegar ao preço de venda.
                </HelpTip>
              </div>
              <MoneyInput id="rule-retail" label="Margem padrão" value={form.retail} onChange={(v) => set("retail", v)} />
              <p className="text-xs text-muted-foreground">
                Custo {brl(exampleCost)} + {brl(form.retail)} = {brl(exampleBase)}
                {form.psychActive ? ` → ${brl(exampleFinal)}` : ""}
              </p>
            </section>

            {/* atacado */}
            <section className="min-w-0 space-y-3 rounded-2xl border border-border/60 p-4">
              <div className="flex min-w-0 items-center gap-1">
                <h3 className="text-sm font-semibold">Atacado</h3>
                <HelpTip title="Atacado">
                  Vale quando o carrinho tem a quantidade mínima no total, podendo misturar perfumes diferentes.
                </HelpTip>
              </div>
              <MoneyInput
                id="rule-wholesale"
                label="Margem padrão"
                value={form.wholesale}
                onChange={(v) => set("wholesale", v)}
              />
              <CountInput
                id="rule-minqty"
                label="Ativa a partir de (peças)"
                value={form.minQty}
                onChange={(v) => set("minQty", v)}
              />
              <p className="text-xs text-muted-foreground">
                Custo {brl(exampleCost)} → {brl(exampleCost + (Number(form.wholesale) || 0))} com{" "}
                {form.minQty ?? 6}+ peças no carrinho, misturando perfumes.
              </p>
            </section>

            {/* pagamento */}
            <section className="min-w-0 space-y-3 rounded-2xl border border-border/60 p-4">
              <div className="flex min-w-0 items-center gap-1">
                <h3 className="text-sm font-semibold">Formas de pagamento</h3>
                <HelpTip title="Pix e cartão">
                  O preço cadastrado é o do Pix. O cartão é calculado para que o desconto anunciado seja exato.
                </HelpTip>
              </div>
              <PercentInput
                id="rule-pix"
                label="Desconto no Pix"
                value={form.pixPercent}
                onChange={(v) => set("pixPercent", v)}
              />
              <label className="flex min-w-0 items-center justify-between gap-3">
                <span className="min-w-0 text-sm">Mostrar “{Number(form.pixPercent) || 0}% OFF no Pix” na loja</span>
                <Switch checked={form.pixActive} onCheckedChange={(v) => set("pixActive", v)} />
              </label>
              <p className="text-xs text-muted-foreground">
                R$ 300,00 no Pix → {brl(pixPreview.cardPrice)} no cartão
              </p>
            </section>

            {/* decants */}
            <section className="min-w-0 space-y-3 rounded-2xl border border-border/60 p-4">
              <h3 className="text-sm font-semibold">Decants</h3>
              <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-3">
                <MoneyInput id="rule-d2" label="2ml" value={form.d2} onChange={(v) => set("d2", v)} />
                <MoneyInput id="rule-d5" label="5ml" value={form.d5} onChange={(v) => set("d5", v)} />
                <MoneyInput id="rule-d10" label="10ml" value={form.d10} onChange={(v) => set("d10", v)} />
              </div>
              <p className="text-xs text-muted-foreground">
                Vale para todo o catálogo. Um perfume pode ter preço próprio na tela dele. Decants não entram no
                atacado.
              </p>
            </section>

            {/* avançado */}
            <section className="min-w-0 rounded-2xl border border-border/60">
              <button
                type="button"
                onClick={() => setAdvanced((v) => !v)}
                className="flex min-h-12 w-full items-center justify-between gap-3 px-4 text-left text-sm"
              >
                Opções avançadas
                <span className="text-xs text-muted-foreground">{advanced ? "ocultar" : "mostrar"}</span>
              </button>
              {advanced ? (
                <div className="min-w-0 space-y-3 border-t border-border/50 p-4">
                  <label className="flex min-w-0 items-center justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block text-sm">Ajuste comercial (final ,90)</span>
                      <span className="block text-xs text-muted-foreground">
                        Aplicado depois da margem, uma única vez.
                      </span>
                    </span>
                    <Switch checked={form.psychActive} onCheckedChange={(v) => set("psychActive", v)} />
                  </label>
                  <MoneyInput
                    id="rule-psych"
                    label="Ajuste máximo para baixo"
                    value={form.psychMax}
                    onChange={(v) => set("psychMax", v)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Preço calculado {brl(exampleBase)} → sugestão comercial {brl(exampleFinal)}
                    {exampleFinal != null ? ` · ajuste de −${brl(exampleBase - exampleFinal)}` : ""}
                  </p>
                </div>
              ) : null}
            </section>

            {dirty ? (
              <div className="sticky bottom-0 -mx-4 flex min-w-0 items-center gap-2 border-t border-border/60 bg-card px-4 py-3">
                <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">Alterações não salvas</p>
                <Button variant="ghost" className="press h-11 shrink-0 rounded-full" onClick={() => setForm(initial)}>
                  Descartar
                </Button>
                <Button className="press h-11 shrink-0 rounded-full" disabled={busy} onClick={() => void check()}>
                  {busy ? <Loader2 className="size-4 animate-spin" /> : catalogChanged ? "Ver impacto" : "Salvar"}
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
