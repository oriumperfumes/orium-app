import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Boxes,
  Droplet,
  Loader2,
  MessageCircle,
  Minus,
  Percent,
  Plus,
  SlidersHorizontal,
  Store,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Switch } from "@/components/ui/switch";
import { brl, productTitle } from "@/lib/format";
import { commercialPrice } from "@/lib/commercial-price";
import { getPaymentPricing } from "@/lib/payment-rule";
import {
  pricingImpact,
  setPricesOnRequest,
  setBlackHero,
  updatePricingRules,
  type PricingImpact,
} from "@/lib/pricing-admin.functions";
import { AdminEmpty } from "@/components/orium/admin/AdminUI";
import {
  PxDialog,
  PxKpi,
  PxKpiRow,
  PxNote,
  PxPreview,
  PxPrimary,
  PxSecondary,
  PxSwitchRow,
} from "@/components/orium/admin/PricingUI";
import { cn } from "@/lib/utils";
import { MoneyInput, PercentInput } from "@/components/orium/admin/PriceBits";

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
 * Abertura da Home em modo Black: o vídeo do topo vira a chamada da Black
 * November (título, desconto, contagem e botão para a vitrine). Só aparece
 * enquanto houver campanha com "Black" no nome em vigor. Vem ligada.
 */
export function BlackHeroCard() {
  const qc = useQueryClient();
  const save = useServerFn(setBlackHero);
  const { settings, loading } = usePricingRules();
  const [busy, setBusy] = useState(false);
  const on = (settings as { black_hero?: boolean } | null | undefined)?.black_hero !== false;

  const toggle = async (next: boolean) => {
    setBusy(true);
    try {
      await save({ data: { on: next } });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["admin-pricing-rules"] }),
        qc.invalidateQueries({ queryKey: ["pricing-settings"] }),
      ]);
      toast.success(next ? "Abertura Black ligada na Home." : "A Home voltou para a abertura normal.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className="adm-rise dash-card flex min-w-0 flex-col gap-4 p-5 sm:flex-row sm:items-center lg:p-6"
      style={{ ["--i" as string]: 3 }}
    >
      <span className="inline-flex h-7 shrink-0 items-stretch self-start overflow-hidden rounded-[7px] text-[11px] leading-none font-black tracking-[0.06em] ring-1 ring-white/25 sm:self-center">
        <span className="flex items-center bg-white px-2 text-black">BLACK</span>
        <span className="flex items-center bg-black px-2 text-white">NOVEMBER</span>
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h2 className="text-[19px] font-bold tracking-[-0.02em]">Abertura da Home em modo Black</h2>
          <span
            className={cn(
              "inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-bold",
              on ? "bg-white text-black" : "bg-[#232323] text-[#A9A9A9]",
            )}
          >
            {on ? "Ligada" : "Desligada"}
          </span>
        </div>
        <p className="mt-1 max-w-[70ch] text-[14px] leading-snug text-[#A9A9A9]">
          {on
            ? "Enquanto houver campanha com “Black” no nome, o vídeo do topo da Home mostra a Black November: desconto, contagem, o Asad Bourbon em oferta e o botão para a vitrine."
            : "A Home mostra a abertura normal (“Encontre aqui o seu próximo perfume”)."}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-3 max-sm:justify-between">
        <span className="text-[14px] font-semibold text-[#A9A9A9] sm:hidden">{on ? "Desligar" : "Ligar"}</span>
        {loading || busy ? (
          <Loader2 className="size-6 animate-spin text-[#A9A9A9]" />
        ) : (
          <Switch className="scale-125" checked={on} onCheckedChange={(v) => void toggle(v)} aria-label="Abertura da Home em modo Black" />
        )}
      </div>
    </section>
  );
}

/**
 * As regras globais em quatro números, no desenho do Início. O cartão dourado
 * é a margem de varejo (a regra que forma quase todo preço do catálogo).
 * Cada número abre a sua própria janela de edição: Varejo, Atacado, Pix ou Decants.
 */
type RuleSection = "varejo" | "atacado" | "pix" | "decants";
/** "todas": o botão "Editar regras" do topo abre as quatro numa janela só */
type RuleView = RuleSection | "todas";

export function PricingRulesBoard({
  editing,
  onEditingChange,
}: {
  /** botão "Editar regras" do topo: abre as quatro regras juntas */
  editing: boolean;
  onEditingChange: (v: boolean) => void;
}) {
  const { settings, decants, loading } = usePricingRules();
  const [section, setSection] = useState<RuleSection | null>(null);
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
  const current: RuleView | null = section ?? (editing ? "todas" : null);
  const close = () => {
    setSection(null);
    onEditingChange(false);
  };

  return (
    <>
      <PxKpiRow>
        <PxKpi
          onClick={() => setSection("varejo")}
          ariaLabel="Editar margem de varejo"
          hero
          i={3}
          className="col-span-2 xl:col-span-1"
          label="Varejo"
          icon={<Store className="size-[18px]" strokeWidth={2.2} />}
          loading={loading}
          value={`+ ${brl(retail)}`}
          foot={`Custo R$ 200 → ${brl(example)}${psychOn ? " · final ,90" : ""}`}
        />
        <PxKpi
          onClick={() => setSection("atacado")}
          ariaLabel="Editar atacado"
          i={4}
          label="Atacado"
          icon={<Boxes className="size-[18px]" strokeWidth={2.2} />}
          loading={loading}
          value={`+ ${brl(wholesale)}`}
          foot={`a partir de ${minQty} peças`}
        />
        <PxKpi
          onClick={() => setSection("pix")}
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
          onClick={() => setSection("decants")}
          ariaLabel="Editar decants"
          i={6}
          label="Decant 2 ml"
          icon={<Droplet className="size-[18px]" strokeWidth={2.2} />}
          loading={loading}
          value={brl(Number(decants?.price_2ml ?? 19.9))}
          foot={`5 ml ${brl(Number(decants?.price_5ml ?? 39.9))} · 10 ml ${brl(Number(decants?.price_10ml ?? 69.9))}`}
        />
      </PxKpiRow>

      {/* uma janela por regra; a key zera o rascunho a cada abertura */}
      {current ? <RuleEditor key={current} section={current} onClose={close} /> : null}
    </>
  );
}

const SECTION_META: Record<RuleView, { title: string; description: string; icon: ReactNode }> = {
  todas: {
    title: "Regras de preço",
    description:
      "As quatro regras do catálogo numa tela só. Cada uma mostra o resultado enquanto você digita.",
    icon: <SlidersHorizontal className="size-[18px]" strokeWidth={2.2} />,
  },
  varejo: {
    title: "Varejo",
    description: "Quanto a Orium soma ao custo do fornecedor para chegar ao preço de venda.",
    icon: <Store className="size-[18px]" strokeWidth={2.2} />,
  },
  atacado: {
    title: "Atacado",
    description: "Preço para quem leva várias peças, podendo misturar perfumes.",
    icon: <Boxes className="size-[18px]" strokeWidth={2.2} />,
  },
  pix: {
    title: "Desconto no Pix",
    description: "O preço cadastrado é o do Pix; o cartão é calculado para o desconto ficar exato.",
    icon: <Percent className="size-[18px]" strokeWidth={2.2} />,
  },
  decants: {
    title: "Decants",
    description: "Preço fixo por tamanho para todo o catálogo. Decants não entram no atacado.",
    icon: <Droplet className="size-[18px]" strokeWidth={2.2} />,
  },
};

/**
 * Edição de UMA regra. Salva com as mesmas regras de sempre (updatePricingRules),
 * mandando as outras como estão; mudanças que alteram o preço de varejo do
 * catálogo (margem ou ajuste comercial) mostram o impacto antes de aplicar.
 */
function RuleEditor({ section, onClose }: { section: RuleView; onClose: () => void }) {
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

  useEffect(() => {
    setForm(initial);
    setImpact(null);
  }, [initial]);

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const retailChanged =
    form.retail !== initial.retail ||
    form.psychActive !== initial.psychActive ||
    form.psychMax !== initial.psychMax;

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
    if (!retailChanged) {
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
      toast.error("Informe a margem.");
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
      toast.success(
        section === "todas"
          ? "Regras de preço atualizadas."
          : `${SECTION_META[section].title} atualizado.`,
      );
      qc.invalidateQueries();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      setBusy(false);
    }
  };

  const meta = SECTION_META[section];

  const footer = impact ? (
    <div className="flex min-w-0 gap-2">
      <PxSecondary className="h-[54px] flex-1" onClick={() => setImpact(null)}>
        Voltar
      </PxSecondary>
      <PxPrimary className="flex-1" loading={busy} onClick={() => void persist()}>
        Aplicar no catálogo
      </PxPrimary>
    </div>
  ) : (
    <div className="flex min-w-0 gap-2">
      <PxSecondary className="h-[54px] flex-1" onClick={onClose}>
        Cancelar
      </PxSecondary>
      <PxPrimary className="flex-1" loading={busy} disabled={!dirty} onClick={() => void check()}>
        {retailChanged ? "Ver impacto" : "Salvar"}
      </PxPrimary>
    </div>
  );

  // prévia dourada: o resultado da regra enquanto se digita
  const preview = impact ? (
    <PxPreview
      label="Produtos que mudam de preço"
      value={
        <>
          {impact.affected}
          <span className="ml-2 text-[16px] font-semibold tracking-normal opacity-60">
            de {impact.checked}
          </span>
        </>
      }
      foot={
        impact.affected
          ? `média de ${impact.delta > 0 ? "+" : "−"}${brl(Math.abs(impact.delta))} por produto`
          : "nenhum preço muda"
      }
    />
  ) : section === "todas" ? null : section === "varejo" ? (
    <PxPreview
      label="Perfume com custo de R$ 200"
      value={brl(form.psychActive ? exampleFinal : exampleBase)}
      foot={
        form.psychActive && exampleFinal != null && exampleFinal !== exampleBase
          ? `${brl(exampleBase)} com a margem · ajuste para o final ,90`
          : `R$ 200 + ${brl(form.retail)} de margem`
      }
    />
  ) : section === "atacado" ? (
    <PxPreview
      label={`Com ${form.minQty ?? 6} ou mais peças`}
      value={brl(exampleCost + (Number(form.wholesale) || 0))}
      foot={`custo R$ 200 + ${brl(form.wholesale)} · misturando perfumes`}
    />
  ) : section === "pix" ? (
    <PxPreview
      label="R$ 300,00 no Pix vira"
      value={form.pixActive ? brl(pixPreview.cardPrice) : brl(300)}
      foot={
        form.pixActive
          ? `no cartão · ${Number(form.pixPercent) || 0}% OFF no Pix`
          : "no cartão · desconto do Pix desligado"
      }
    />
  ) : (
    <div className="grid min-w-0 grid-cols-3 gap-2">
      {(
        [
          ["2 ml", form.d2],
          ["5 ml", form.d5],
          ["10 ml", form.d10],
        ] as const
      ).map(([ml, v]) => (
        <div key={ml} className="dash-hero min-w-0 p-4">
          <p className="text-[13px] font-semibold text-[#15130F]/70">{ml}</p>
          <p className="mt-1.5 truncate text-[20px] leading-none font-bold tracking-[-0.03em] tabular-nums">
            {brl(v)}
          </p>
        </div>
      ))}
    </div>
  );

  // campos de cada regra (usados sozinhos ou os quatro juntos)
  const fields = (sec: RuleSection) =>
    sec === "varejo" ? (
      <>
        <MoneyInput
          id="rule-retail"
          label="Margem somada ao custo"
          value={form.retail}
          onChange={(v) => set("retail", v)}
        />
        <PxSwitchRow
          title="Ajuste comercial (final ,90)"
          hint="Depois da margem, o preço desce até o final ,90 mais próximo."
          checked={form.psychActive}
          onChange={(v) => set("psychActive", v)}
        />
        {form.psychActive ? (
          <MoneyInput
            id="rule-psych"
            label="Ajuste máximo para baixo"
            value={form.psychMax}
            onChange={(v) => set("psychMax", v)}
          />
        ) : null}
      </>
    ) : sec === "atacado" ? (
      <>
        <MoneyInput
          id="rule-wholesale"
          label="Margem somada ao custo"
          value={form.wholesale}
          onChange={(v) => set("wholesale", v)}
        />
        <div className="min-w-0 space-y-2">
          <p className="text-[14px] font-semibold text-[#D4D4D4]">Vale a partir de</p>
          <div className="flex h-[56px] items-center justify-between rounded-full bg-[#232323] px-1.5">
            <button
              type="button"
              aria-label="Uma peça a menos"
              disabled={(form.minQty ?? 6) <= 2}
              onClick={() => set("minQty", Math.max(2, (form.minQty ?? 6) - 1))}
              className="press grid size-11 place-items-center rounded-full bg-[#2E2E2E] text-white disabled:opacity-40"
            >
              <Minus className="size-4" />
            </button>
            <span className="text-[18px] font-bold tabular-nums">{form.minQty ?? 6} peças</span>
            <button
              type="button"
              aria-label="Uma peça a mais"
              disabled={(form.minQty ?? 6) >= 50}
              onClick={() => set("minQty", Math.min(50, (form.minQty ?? 6) + 1))}
              className="press grid size-11 place-items-center rounded-full bg-[#2E2E2E] text-white disabled:opacity-40"
            >
              <Plus className="size-4" />
            </button>
          </div>
        </div>
      </>
    ) : sec === "pix" ? (
      <>
        <PercentInput
          id="rule-pix"
          label="Desconto no Pix"
          value={form.pixPercent}
          onChange={(v) => set("pixPercent", v)}
        />
        <PxSwitchRow
          title={`Mostrar “${Number(form.pixPercent) || 0}% OFF no Pix” na loja`}
          hint="Desligado: Pix e cartão pelo mesmo preço."
          checked={form.pixActive}
          onChange={(v) => set("pixActive", v)}
        />
      </>
    ) : (
      <>
        <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-3">
          <MoneyInput id="rule-d2" label="2 ml" value={form.d2} onChange={(v) => set("d2", v)} />
          <MoneyInput id="rule-d5" label="5 ml" value={form.d5} onChange={(v) => set("d5", v)} />
          <MoneyInput
            id="rule-d10"
            label="10 ml"
            value={form.d10}
            onChange={(v) => set("d10", v)}
          />
        </div>
        <PxNote>
          Um perfume pode ter preço próprio de decant na tela dele; esse preço continua valendo.
        </PxNote>
      </>
    );

  // resultado em uma linha, para os cartões da janela com as quatro regras
  const result = (sec: RuleSection) =>
    sec === "varejo"
      ? `Custo R$ 200 → ${brl(form.psychActive ? exampleFinal : exampleBase)}`
      : sec === "atacado"
        ? `R$ 200 → ${brl(exampleCost + (Number(form.wholesale) || 0))} com ${form.minQty ?? 6}+ peças`
        : sec === "pix"
          ? form.pixActive
            ? `R$ 300 no Pix → ${brl(pixPreview.cardPrice)} no cartão`
            : "Pix e cartão pelo mesmo preço"
          : `${brl(form.d2)} · ${brl(form.d5)} · ${brl(form.d10)}`;

  return (
    <PxDialog
      open
      wide={section === "todas" && !impact}
      onClose={onClose}
      icon={meta.icon}
      title={impact ? "Confira antes de aplicar" : meta.title}
      description={impact ? "Os preços de varejo do catálogo mudam juntos." : meta.description}
      preview={preview}
      footer={footer}
    >
      {impact ? (
        impact.sample.length === 0 ? (
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
        )
      ) : section === "todas" ? (
        <div className="grid min-w-0 gap-3 md:grid-cols-2">
          {(["varejo", "atacado", "pix", "decants"] as const).map((sec) => (
            <section key={sec} className="min-w-0 space-y-4 rounded-[24px] bg-[#1A1A1A] p-5">
              <div className="flex min-w-0 items-center gap-3">
                <span className="dash-ico">{SECTION_META[sec].icon}</span>
                <div className="min-w-0">
                  <h3 className="text-[17px] font-bold tracking-[-0.01em]">
                    {SECTION_META[sec].title}
                  </h3>
                  <p className="truncate text-[13px] font-semibold text-[#FFD599]">{result(sec)}</p>
                </div>
              </div>
              {fields(sec)}
            </section>
          ))}
        </div>
      ) : (
        fields(section)
      )}
    </PxDialog>
  );
}
