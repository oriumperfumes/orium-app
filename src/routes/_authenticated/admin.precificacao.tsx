import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Layers, Percent, Ticket, Wallet } from "lucide-react";
import { AdminShell } from "@/components/orium/AdminShell";
import { SegmentedControl, SegmentedPanel } from "@/components/orium/SegmentedControl";
import { PricesOnRequestCard, PricingRulesSummary } from "@/components/orium/admin/PricingRules";
import { PricingProductPanel, PricingSearch } from "@/components/orium/admin/PricingProduct";
import { CouponsPanel, PromotionsPanel } from "@/components/orium/admin/PricingCampaigns";
import { DecantCombosPanel } from "@/components/orium/admin/PricingCombos";

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

const TABS: Array<{ id: Tab; label: string; icon: typeof Wallet }> = [
  { id: "precos", label: "Preços", icon: Wallet },
  { id: "promocoes", label: "Promoções", icon: Percent },
  { id: "combos", label: "Combos", icon: Layers },
  { id: "cupons", label: "Cupons", icon: Ticket },
];

/**
 * Central de decisão de preços: buscar o perfume, ver custo → preço → lucro,
 * simular, comparar Pix/cartão/atacado e aplicar. As regras globais, decants,
 * promoções e cupons continuam aqui, só mais visuais e com prévia antes de salvar.
 */
function AdminPricing() {
  const [tab, setTab] = useState<Tab>("precos");
  const [productId, setProductId] = useState<string | null>(null);

  return (
    <AdminShell title="Precificação">
      <SegmentedControl
        asTabs
        size="admin"
        fill="auto"
        label="Áreas de precificação"
        className="mb-6 bg-card shadow-soft"
        value={tab}
        onChange={setTab}
        options={TABS.map(({ id, label, icon }) => ({ value: id, label, icon }))}
      />

      <SegmentedPanel value={tab}>
        {tab === "precos" ? (
          <div className="min-w-0 space-y-6">
            <PricesOnRequestCard />
            <PricingSearch onPick={setProductId} />
            {productId ? <PricingProductPanel productId={productId} onClose={() => setProductId(null)} /> : null}
            <PricingRulesSummary />
          </div>
        ) : tab === "promocoes" ? (
          <PromotionsPanel />
        ) : tab === "combos" ? (
          <DecantCombosPanel />
        ) : (
          <CouponsPanel />
        )}
      </SegmentedPanel>
    </AdminShell>
  );
}
