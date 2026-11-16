import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Boxes, Droplet, Loader2, MessageCircle, Percent, Store } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Switch } from "@/components/ui/switch";
import { brl, productTitle } from "@/lib/format";
import { commercialPrice } from "@/lib/commercial-price";
import { getPaymentPricing } from "@/lib/payment-rule";
import {
  pricingImpact,
  setPricesOnRequest,
  updatePricingRules,
  type PricingImpact,
} from "@/lib/pricing-admin.functions";
import { AdminEmpty } from "@/components/orium/admin/AdminUI";
import {
  PxKpi,
  PxKpiRow,
  PxNote,
  PxPrimary,
  PxSecondary,
  PxSection,
  PxSheet,
  PxStat,
  PxSwitchRow,
} from "@/components/orium/admin/PricingUI";
import { cn } from "@/lib/utils";
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
  return {
    settings: settings.data,
    decants: decants.data,
    loading: settings.isPending || decants.isPending,
  };
}

/**
 * Chave geral: todos os preços do catálogo público sob consulta.
 * Ligada, o cliente vê "Sob consulta" + WhatsApp no lugar dos preços e o site
 * não fecha pedido; desligada, tudo volta como estava (nenhum preço é alterado).
 * Ligada, o cartão fica dourado: o estado que muda a loja inteira salta aos olhos.
 */
export function PricesOnRequestCard() {
  const qc = useQueryClient();
  const save = useServerFn(setPricesOnRequest);
  const { settings, loading } = usePricingRules();
  const [busy, setBusy] = useState(false);
  const on =
    (settings as { prices_on_request?: boolean } | null | undefined)?.prices_on_request === true;

  const toggle = async (next: boolean) => {
    setBusy(true);
    try {
      await save({ data: { on: next } });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["admin-pricing-rules"] }),
        qc.invalidateQueries({ queryKey: ["pricing-settings"] }),
      ]);
      toast.success(
        next ? "Preços sob consulta ativados na loja." : "Preços voltaram a aparecer na loja.",
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className={cn(
        "adm-rise flex min-w-0 flex-col gap-4 p-5 transition-colors duration-300 sm:flex-row sm:items-center lg:p-6",
        on ? "dash-hero" : "dash-card",
      )}
      style={{ ["--i" as string]: 2 }}
    >
      <span className="dash-ico">
        <MessageCircle className="size-[18px]" strokeWidth={2.2} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h2 className="text-[19px] font-bold tracking-[-0.02em]">Preços sob consulta</h2>
          <span
            className={cn(
              "inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-bold",
              on ? "bg-[#15130F] text-[#FFD599]" : "bg-[#232323] text-[#A9A9A9]",
            )}
          >
            {on ? <span aria-hidden className="size-1.5 rounded-full bg-current" /> : null}
            {on ? "Ligado na loja" : "Desligado"}
          </span>
        </div>
        <p
          className={cn(
            "mt-1 max-w-[70ch] text-[14px] leading-snug",
            on ? "text-[#15130F]/70" : "text-[#A9A9A9]",
          )}
        >
          {on
            ? "O catálogo público mostra “Sob consulta” no lugar de todos os preços e o cliente fala com a Orium pelo WhatsApp. O site não fecha pedido."
            : "Os preços aparecem normalmente na loja. Ligue para esconder todos os preços e atender só pelo WhatsApp."}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-3 max-sm:justify-between">
        <span
          className={cn(
            "text-[14px] font-semibold sm:hidden",
            on ? "text-[#15130F]/70" : "text-[#A9A9A9]",
          )}
        >
          {on ? "Desligar" : "Ligar"}
        </span>
        {loading || busy ? (
          <Loader2
            className={cn("size-6 animate-spin", on ? "text-[#15130F]" : "text-[#A9A9A9]")}
          />
        ) : (
          <Switch
            className={cn(
              "scale-125",
              on && "data-[state=checked]:bg-[#15130F] [&>span]:bg-[#FFD599]",
            )}
            checked={on}
            onCheckedChange={(v) => void toggle(v)}
            aria-label="Preços sob consulta em toda a loja"
          />
        )}
      </div>
    </section>
  );
}

/**
 * As regras globais em quatro números, no desenho do Início. O cartão dourado
 * é a margem de varejo (a regra que forma quase todo preço do catálogo).
 * Tocar em qualquer número abre as regras.
 */
export function PricingRulesBoard({
  editing,
  onEditingChange,
}: {
  editing: boolean;
  onEditingChange: (v: boolean) => void;
}) {
  const { settings, decants, loading } = usePricingRules();
  const retail = Number(settings?.retail_markup ?? 120);
  const wholesale = Number(settings?.wholesale_markup ?? 50);
  const minQty = Number(settings?.wholesale_min_quantity ?? 6);
  const pix = Number(settings?.pix_discount_percent ?? 5);
  const pixOn = settings?.pix_discount_active !== false;
  const psychOn = settings?.psych_pricing_active === true;
  const example = commercialPrice(200 + retail, {
    active: psychOn,
    strategy: "ends_90",
    maxReduction: Number(settings?.psych_max_reduction ?? 0),
  });
  const card300 = getPaymentPricing(300, { pixDiscountPercent: pix, active: pixOn }).cardPrice;
  const open = () => onEditingChange(true);

  return (
    <>
      <PxKpiRow>
        <PxKpi
          onClick={open}
          ariaLabel="Editar margem de varejo"
          hero
          i={3}
          className="col-span-2  xl:col-span-1"
          label="Varejo"
          icon={<Store className="size-[18px]" strokeWidth={2.2} />}
          loading={loading}
          value={`+ ${brl(retail)}`}
          foot={`Custo R$ 200 → ${brl(example)}${psychOn ? " · final ,90" : ""}`}
        />
        <PxKpi
          onClick={open}
          ariaLabel="Editar atacado"
          i={4}

          label="Atacado"
          icon={<Boxes className="size-[18px]" strokeWidth={2.2} />}
          loading={loading}
          value={`+ ${brl(wholesale)}`}
          foot={`a partir de ${minQty} peças`}
        />
        <PxKpi
          onClick={open}
          ariaLabel="Editar Pix"
          i={5}

          label="Desconto no Pix"
          icon={<Percent className="size-[18px]" strokeWidth={2.2} />}
          loading={loading}
          value={pixOn ? `${pix}%` : "Desligado"}
          foot={
            pixOn ? `R$ 300 no Pix → ${brl(card300)} no cartão` : "Pix e cartão com o mesmo preço"
          }
        />
        <PxKpi
          onClick={open}
          ariaLabel="Editar decants"
          i={6}

          label="Decant 2 ml"
          icon={<Droplet className="size-[18px]" strokeWidth={2.2} />}
          loading={loading}
          value={brl(Number(decants?.price_2ml ?? 19.9))}
          foot={`5 ml ${brl(Number(decants?.price_5ml ?? 39.9))} · 10 ml ${brl(Number(decants?.price_10ml ?? 69.9))}`}
        />
      </PxKpiRow>

      <PricingRulesSheet open={editing} onClose={() => onEditingChange(false)} />
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

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const catalogChanged =
    form.retail !== initial.retail ||
    form.psychActive !== initial.psychActive ||
    form.psychMax !== initial.psychMax ||
    form.wholesale !== initial.wholesale;

  const psych = {
    active: form.psychActive,
    strategy: "ends_90",
    maxReduction: Number(form.psychMax) || 0,
  };
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

  const footer = impact ? (
    <div className="flex min-w-0 gap-2">
      <PxSecondary className="h-[54px] flex-1" onClick={() => setImpact(null)}>
        Voltar
      </PxSecondary>
      <PxPrimary className="flex-1" loading={busy} onClick={() => void persist()}>
        Aplicar alteração
      </PxPrimary>
    </div>
  ) : dirty ? (
    <div className="flex min-w-0 items-center gap-2">
      <p className="min-w-0 flex-1 truncate text-[13px] text-[#8C8C8C] max-sm:hidden">
        Alterações não salvas
      </p>
      <PxSecondary className="h-[54px] max-sm:flex-1" onClick={() => setForm(initial)}>
        Descartar
      </PxSecondary>
      <PxPrimary className="max-sm:flex-1" loading={busy} onClick={() => void check()}>
        {catalogChanged ? "Ver impacto" : "Salvar"}
      </PxPrimary>
    </div>
  ) : null;

  return (
    <PxSheet
      open={open}
      onClose={onClose}
      title={impact ? "Impacto da alteração" : "Regras de preço"}
      description={
        impact
          ? "Confira antes de aplicar: os preços do catálogo mudam juntos."
          : "Margens, Pix, decants e ajuste comercial do catálogo inteiro."
      }
      footer={footer}
    >
      {impact ? (
        <div className="min-w-0 space-y-4">
          <div className="grid min-w-0 grid-cols-2 gap-2">
            <PxStat label="Antes" value={`+ ${brl(initial.retail)}`} note="margem de varejo" />
            <PxStat
              label="Depois"
              value={`+ ${brl(form.retail)}`}
              note="margem de varejo"
              tone="gold"
            />
          </div>

          <div className="rounded-[24px] bg-[#1A1A1A] p-5">
            <p className="text-[34px] leading-none font-bold tracking-[-0.04em] tabular-nums">
              {impact.affected}
              <span className="ml-2 text-[16px] font-semibold tracking-normal text-[#8C8C8C]">
                de {impact.checked} produtos
              </span>
            </p>
            <p className="mt-2 text-[14px] text-[#A9A9A9]">
              mudam de preço
              {impact.affected
                ? ` · média de ${impact.delta > 0 ? "+" : "−"}${brl(Math.abs(impact.delta))} cada`
                : ""}
              .
            </p>
          </div>

          {impact.sample.length === 0 ? (
            <AdminEmpty>Nenhum preço muda com esta alteração.</AdminEmpty>
          ) : (
            <ul className="min-w-0 space-y-1.5">
              {impact.sample.map((r) => (
                <li
                  key={r.id}
                  className="flex min-w-0 items-center justify-between gap-3 rounded-[18px] bg-[#1A1A1A] px-4 py-3"
                >
                  <span className="min-w-0 truncate text-[14.5px] font-semibold">
                    {productTitle(r.name)}
                  </span>
                  <span className="shrink-0 text-[14px] tabular-nums">
                    <span className="text-[#8C8C8C] line-through">{brl(r.from)}</span>
                    <span className="ml-2 font-bold text-[#FFD599]">{brl(r.to)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="min-w-0 space-y-3">
          <PxSection
            title="Varejo"
            help={
              <HelpTip title="Margem de varejo">
                Valor somado ao menor custo disponível do fornecedor para chegar ao preço de venda.
              </HelpTip>
            }
          >
            <MoneyInput
              id="rule-retail"
              label="Margem padrão"
              value={form.retail}
              onChange={(v) => set("retail", v)}
            />
            <PxNote>
              Custo {brl(exampleCost)} + {brl(form.retail)} ={" "}
              <b className="text-white">{brl(exampleBase)}</b>
              {form.psychActive ? (
                <>
                  {" "}
                  → <b className="text-[#FFD599]">{brl(exampleFinal)}</b>
                </>
              ) : null}
            </PxNote>
          </PxSection>

          <PxSection
            title="Atacado"
            help={
              <HelpTip title="Atacado">
                Vale quando o carrinho tem a quantidade mínima no total, podendo misturar perfumes
                diferentes.
              </HelpTip>
            }
          >
            <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
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
            </div>
            <PxNote>
              Custo {brl(exampleCost)} →{" "}
              <b className="text-white">{brl(exampleCost + (Number(form.wholesale) || 0))}</b> com{" "}
              {form.minQty ?? 6}+ peças no carrinho, misturando perfumes.
            </PxNote>
          </PxSection>

          <PxSection
            title="Formas de pagamento"
            help={
              <HelpTip title="Pix e cartão">
                O preço cadastrado é o do Pix. O cartão é calculado para que o desconto anunciado
                seja exato.
              </HelpTip>
            }
          >
            <PercentInput
              id="rule-pix"
              label="Desconto no Pix"
              value={form.pixPercent}
              onChange={(v) => set("pixPercent", v)}
            />
            <PxSwitchRow
              title={`Mostrar “${Number(form.pixPercent) || 0}% OFF no Pix” na loja`}
              checked={form.pixActive}
              onChange={(v) => set("pixActive", v)}
            />
            <PxNote>
              R$ 300,00 no Pix → <b className="text-white">{brl(pixPreview.cardPrice)}</b> no cartão
            </PxNote>
          </PxSection>

          <PxSection title="Decants">
            <div className="grid min-w-0 grid-cols-3 gap-2 sm:gap-3">
              <MoneyInput
                id="rule-d2"
                label="2 ml"
                value={form.d2}
                onChange={(v) => set("d2", v)}
              />
              <MoneyInput
                id="rule-d5"
                label="5 ml"
                value={form.d5}
                onChange={(v) => set("d5", v)}
              />
              <MoneyInput
                id="rule-d10"
                label="10 ml"
                value={form.d10}
                onChange={(v) => set("d10", v)}
              />
            </div>
            <PxNote>
              Vale para todo o catálogo. Um perfume pode ter preço próprio na tela dele. Decants não
              entram no atacado.
            </PxNote>
          </PxSection>

          <PxSection>
            <button
              type="button"
              onClick={() => setAdvanced((v) => !v)}
              className="flex w-full min-w-0 items-center justify-between gap-3 text-left"
            >
              <span className="text-[16px] font-bold">Opções avançadas</span>
              <span className="text-[13px] font-semibold text-[#8C8C8C]">
                {advanced ? "ocultar" : "mostrar"}
              </span>
            </button>
            {advanced ? (
              <div className="min-w-0 space-y-3 pt-1">
                <PxSwitchRow
                  title="Ajuste comercial (final ,90)"
                  hint="Aplicado depois da margem, uma única vez."
                  checked={form.psychActive}
                  onChange={(v) => set("psychActive", v)}
                />
                <MoneyInput
                  id="rule-psych"
                  label="Ajuste máximo para baixo"
                  value={form.psychMax}
                  onChange={(v) => set("psychMax", v)}
                />
                <PxNote>
                  Preço calculado {brl(exampleBase)} → sugestão comercial {brl(exampleFinal)}
                  {exampleFinal != null ? ` · ajuste de −${brl(exampleBase - exampleFinal)}` : ""}
                </PxNote>
              </div>
            ) : null}
          </PxSection>
        </div>
      )}
    </PxSheet>
  );
}
