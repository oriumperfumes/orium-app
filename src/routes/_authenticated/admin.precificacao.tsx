import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Layers, Percent, Plus, SlidersHorizontal, Ticket, Wallet } from "lucide-react";
import { AdminShell } from "@/components/orium/AdminShell";
import { cn } from "@/lib/utils";
import { BlackHeroCard, PricesOnRequestCard, PricingRulesBoard } from "@/components/orium/admin/PricingRules";
import { PricingWorkbench } from "@/components/orium/admin/PricingProduct";
import {
  CouponsPanel,
  PromotionsPanel,
  campaignStatus,
  useAdminCoupons,
  useAdminPromotions,
} from "@/components/orium/admin/PricingCampaigns";
import {
  DecantCombosPanel,
  comboStatus,
  useAdminCombos,
} from "@/components/orium/admin/PricingCombos";
import { PxPrimary } from "@/components/orium/admin/PricingUI";

export const Route = createFileRoute("/_authenticated/admin/precificacao")({
  head: () => ({
    meta: [
      { title: "Precificação — Orium Admin" },
      { name: "description", content: "Central de preços, promoções e cupons da Orium." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminPricing,
});

type Tab = "precos" | "promocoes" | "combos" | "cupons";

const TABS: Array<{ id: Tab; label: string; icon: typeof Wallet; sub: string; action: string }> = [
  {
    id: "precos",
    label: "Preços",
    icon: Wallet,
    sub: "Regras, consulta e simulação de cada perfume.",
    action: "Editar regras",
  },
  {
    id: "promocoes",
    label: "Promoções",
    icon: Percent,
    sub: "Descontos por período, por perfume ou no catálogo.",
    action: "Nova promoção",
  },
  {
    id: "combos",
    label: "Combos",
    icon: Layers,
    sub: "Leve vários decants por um preço fechado.",
    action: "Novo combo",
  },
  {
    id: "cupons",
    label: "Cupons",
    icon: Ticket,
    sub: "Códigos de desconto públicos ou secretos.",
    action: "Criar cupom",
  },
];

/**
 * Central de preços, no mesmo desenho do Início e de Pedidos: título grande
 * com a ação principal dourada, abas em pílula (selecionada = branca) e
 * números em cartões. Cada aba mantém as mesmas regras de antes; a ação do
 * topo abre a folha da aba (regras, nova promoção, novo combo, novo cupom).
 */
function AdminPricing() {
  const [tab, setTab] = useState<Tab>("precos");
  const [creating, setCreating] = useState<Tab | null>(null);
  const current = TABS.find((t) => t.id === tab)!;

  const promotions = useAdminPromotions();
  const combos = useAdminCombos();
  const coupons = useAdminCoupons();
  const badge: Record<Tab, number> = {
    precos: 0,
    promocoes: (promotions.data ?? []).filter((p) => campaignStatus(p as never) === "ativa").length,
    combos: (combos.data ?? []).filter((c) => comboStatus(c) === "ativa").length,
    cupons: (coupons.data ?? []).filter((c) => campaignStatus(c as never) === "ativa").length,
  };

  return (
    <AdminShell title="Precificação" bare>
      <header className="adm-rise flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
        <div className="min-w-0">
          <p key={tab} className="adm-fade text-[15px] text-[#A9A9A9] lg:text-[17px]">
            {current.sub}
          </p>
          <h1 className="mt-1 text-[34px] leading-[1.05] font-bold tracking-[-0.04em] lg:text-[46px]">
            Precificação
          </h1>
        </div>
        <PxPrimary
          onClick={() => setCreating(tab)}
          icon={
            tab === "precos" ? (
              <SlidersHorizontal className="size-[18px]" strokeWidth={2.4} />
            ) : (
              <Plus className="size-[18px]" strokeWidth={2.6} />
            )
          }
          className="max-sm:w-full lg:h-[60px] lg:min-w-[220px]"
        >
          {current.action}
        </PxPrimary>
      </header>

      {/* abas no desenho de Pedidos */}
      <nav
        aria-label="Áreas de precificação"
        className="adm-rise mt-6 grid grid-cols-4 gap-1.5 sm:flex sm:gap-2"
        style={{ ["--i" as string]: 1 }}
      >
        {TABS.map((t) => {
          const on = tab === t.id;
          const n = badge[t.id];
          return (
            <button
              key={t.id}
              type="button"
              aria-pressed={on}
              onClick={() => setTab(t.id)}
              className={cn(
                "press relative flex h-[60px] shrink-0 flex-col items-center justify-center gap-1 rounded-[20px] text-[12.5px] font-bold transition-colors duration-200 sm:h-[52px] sm:flex-row sm:gap-2 sm:rounded-full sm:pr-5 sm:pl-4 sm:text-[15px]",
                on ? "bg-white text-[#15130F]" : "bg-[#1A1A1A] text-[#A9A9A9] hover:text-white",
              )}
            >
              <t.icon className="size-[18px]" strokeWidth={2.2} />
              {t.label}
              {n > 0 ? (
                <span
                  key={n}
                  className="ord-bump grid h-[22px] min-w-[22px] place-items-center rounded-full bg-[#FFD599] px-1.5 text-[11.5px] font-bold text-[#15130F] tabular-nums max-sm:absolute max-sm:top-1.5 max-sm:right-1.5 max-sm:h-[19px] max-sm:min-w-[19px] max-sm:text-[10.5px]"
                >
                  {n}
                </span>
              ) : null}
            </button>
          );
        })}
      </nav>

      <div key={tab} className="adm-fade mt-4 min-w-0">
        {tab === "precos" ? (
          <div className="min-w-0 space-y-4">
            <PricesOnRequestCard />
            <BlackHeroCard />
            <PricingRulesBoard
              editing={creating === "precos"}
              onEditingChange={(v) => setCreating(v ? "precos" : null)}
            />
            <PricingWorkbench />
          </div>
        ) : tab === "promocoes" ? (
          <PromotionsPanel
            creating={creating === "promocoes"}
            onCreatingChange={(v) => setCreating(v ? "promocoes" : null)}
          />
        ) : tab === "combos" ? (
          <DecantCombosPanel
            creating={creating === "combos"}
            onCreatingChange={(v) => setCreating(v ? "combos" : null)}
          />
        ) : (
          <CouponsPanel
            creating={creating === "cupons"}
            onCreatingChange={(v) => setCreating(v ? "cupons" : null)}
          />
        )}
      </div>
    </AdminShell>
  );
}
