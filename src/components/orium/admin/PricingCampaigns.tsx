import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  BadgePercent,
  CalendarClock,
  CircleCheck,
  Eye,
  FlaskConical,
  HandCoins,
  Pause,
  Percent,
  Search,
  Ticket,
  TrendingUp,
  Users,
  X,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { brl, dateBR, productTitle } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import {
  deviceId,
  isRunning,
  isoToSaoPauloInput,
  saoPauloDateTimeToIso,
  applyPercent,
} from "@/lib/promotions";
import { adminUpdatePromotion } from "@/lib/promotions-admin.functions";
import type { Tables } from "@/integrations/supabase/types";
import { normalizeTheme, type CampaignVars } from "@/lib/campaign-message";
import { getOffers, type OfferDiagnostic } from "@/lib/offers.functions";
import { OfferPopup } from "@/components/orium/OfferPopup";
import { ItemThumb } from "@/components/orium/admin/OrderItems";
import { isBlack } from "@/lib/black";
import { BlackTag } from "@/components/orium/black/Black";
import {
  AdminConfirm,
  AdminEmpty,
  AdminMore,
  AdminTechDetails,
} from "@/components/orium/admin/AdminUI";
import { MoneyInput, PercentInput } from "@/components/orium/admin/PriceBits";
import {
  PxCard,
  PxCardBody,
  PxCardHead,
  PxChip,
  PxField,
  PxInput,
  PxKpi,
  PxKpiRow,
  PxNote,
  PxPrimary,
  PxSecondary,
  PxQuick,
  PxSeg,
  PxStat,
  PxStatus,
  PxSwitchRow,
  PxTag,
  PxWizard,
  pxEndInDays,
  pxShortDate,
  type PxStep,
} from "@/components/orium/admin/PricingUI";
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

const APPLIES_OPTIONS: Array<{ value: AppliesTo; label: string }> = [
  { value: "BOTH", label: "Ambos" },
  { value: "DECANT", label: "Decants" },
  { value: "FULL", label: "Frascos" },
];

const SIZES = [2, 5, 10];

const appliesShort = (row: { applies_to: string; decant_sizes?: number[] | null }) => {
  const sizes = row.decant_sizes ?? [];
  if (row.applies_to === "FULL") return "Frasco";
  if (row.applies_to === "DECANT")
    return sizes.length ? `Decant · ${sizes.join(" / ")} ml` : "Decants";
  return sizes.length ? `Frasco e decant · ${sizes.join(" / ")} ml` : "Frasco e decants";
};

export const campaignStatus = (row: {
  active: boolean;
  starts_at: string | null;
  ends_at: string | null;
}) => {
  const now = Date.now();
  if (!row.active) return "pausada";
  if (row.starts_at && new Date(row.starts_at).getTime() > now) return "agendada";
  if (row.ends_at && new Date(row.ends_at).getTime() <= now) return "encerrada";
  return "ativa";
};

/** Listas com a mesma chave de cache da aba e do contador do topo. */
export function useAdminPromotions() {
  return useQuery({
    queryKey: ["admin-promotions"],
    queryFn: async () =>
      (await supabase.from("promotions").select("*").order("created_at", { ascending: false }))
        .data ?? [],
  });
}
export function useAdminCoupons() {
  return useQuery({
    queryKey: ["admin-coupons"],
    queryFn: async () =>
      (await supabase.from("coupons").select("*").order("created_at", { ascending: false })).data ??
      [],
  });
}

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
      (await supabase.from("products").select("id, canonical_name, image_url").in("id", ids))
        .data ?? [],
  });

  return (
    <PxField label="Perfumes" hint="Nenhum escolhido = catálogo inteiro.">
      <label className="flex h-[52px] min-w-0 items-center gap-3 rounded-full bg-[#232323] px-4 focus-within:ring-2 focus-within:ring-[#FFD599]/50">
        <Search className="size-[18px] shrink-0 text-[#8C8C8C]" strokeWidth={2.2} />
        <input
          data-slot="input-group-control"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Buscar perfume"
          className="h-full min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-[#6F6F6F]"
        />
      </label>
      {term.trim().length >= 2 && (results ?? []).length > 0 ? (
        <div className="min-w-0 space-y-1 rounded-[20px] bg-[#232323] p-1.5">
          {(results ?? []).map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                if (!ids.includes(p.id)) setIds([...ids, p.id]);
                setTerm("");
              }}
              className="press flex w-full min-w-0 items-center gap-3 rounded-[16px] px-2 py-2 text-left transition-colors hover:bg-[#2E2E2E]"
            >
              <span className="overflow-hidden rounded-[12px]">
                <ItemThumb src={p.image_url} alt={p.canonical_name} size={40} />
              </span>
              <span className="min-w-0 flex-1 truncate text-[14.5px] font-semibold">
                {p.brand ? <span className="text-[#8C8C8C]">{p.brand} · </span> : null}
                {productTitle(p.canonical_name)}
              </span>
              <span className="shrink-0 text-[13px] font-bold text-[#FFD599] tabular-nums">
                {brl(p.retail_price)}
              </span>
            </button>
          ))}
        </div>
      ) : null}
      {ids.length > 0 ? (
        <div className="flex min-w-0 flex-wrap gap-1.5">
          {(chosen ?? []).map((p) => (
            <span
              key={p.id}
              className="flex h-8 min-w-0 max-w-full items-center gap-1.5 rounded-full bg-white pr-1.5 pl-3 text-[13px] font-semibold text-[#15130F]"
            >
              <span className="min-w-0 truncate">{productTitle(p.canonical_name)}</span>
              <button
                type="button"
                onClick={() => setIds(ids.filter((i) => i !== p.id))}
                aria-label="Remover"
                className="grid size-5 shrink-0 place-items-center rounded-full bg-[#15130F]/10"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </PxField>
  );
}

/* -------------------------- promoções -------------------------- */

export function PromotionsPanel({
  creating,
  onCreatingChange,
}: {
  creating: boolean;
  onCreatingChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const [removing, setRemoving] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const { data: list, isPending } = useAdminPromotions();

  const rows = useMemo(() => list ?? [], [list]);
  const productIds = useMemo(
    () => [...new Set(rows.flatMap((p) => (p.product_ids ?? []) as string[]))].slice(0, 200),
    [rows],
  );
  const { data: products } = useQuery({
    queryKey: ["campaign-products", productIds.join(",")],
    enabled: productIds.length > 0,
    queryFn: async () =>
      (
        await supabase
          .from("products")
          .select("id, canonical_name, brand, image_url, retail_price")
          .in("id", productIds)
      ).data ?? [],
  });
  const byId = useMemo(() => new Map((products ?? []).map((p) => [p.id, p])), [products]);

  const stats = useMemo(() => {
    const now = Date.now();
    return {
      ativas: rows.filter((p) => isRunning(p as never, now)).length,
      agendadas: rows.filter((p) => campaignStatus(p as never) === "agendada").length,
      paradas: rows.filter((p) => ["encerrada", "pausada"].includes(campaignStatus(p as never)))
        .length,
      vendido: rows.reduce((s, p) => s + Number(p.sales_total ?? 0), 0),
      desconto: rows.reduce((s, p) => s + Number(p.discount_total ?? 0), 0),
    };
  }, [rows]);

  const editing = editingId ? (rows.find((r) => r.id === editingId) ?? null) : null;

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
    <div className="min-w-0 space-y-4">
      <PxKpiRow>
        <PxKpi
          hero
          i={2}
          label="No ar agora"
          icon={<CircleCheck className="size-[18px]" strokeWidth={2.2} />}
          loading={isPending}
          value={stats.ativas}
          foot={stats.ativas === 1 ? "promoção valendo" : "promoções valendo"}
        />
        <PxKpi
          i={3}
          label="Agendadas"
          icon={<CalendarClock className="size-[18px]" strokeWidth={2.2} />}
          loading={isPending}
          value={stats.agendadas}
          foot="começam sozinhas"
        />
        <PxKpi
          i={4}
          label="Pausadas ou encerradas"
          icon={<Pause className="size-[18px]" strokeWidth={2.2} />}
          loading={isPending}
          value={stats.paradas}
          foot="fora da loja"
        />
        <PxKpi
          i={5}
          label="Vendido com promoção"
          icon={<TrendingUp className="size-[18px]" strokeWidth={2.2} />}
          loading={isPending}
          value={brl(stats.vendido)}
          foot={`${brl(stats.desconto)} de desconto dado`}
        />
      </PxKpiRow>

      <section className="min-w-0">
        <h2 className="mb-3 px-1 text-[18px] font-bold tracking-[-0.015em]">Campanhas</h2>
        {isPending ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {[0, 1].map((i) => (
              <div key={i} className="admin-skeleton h-[240px] rounded-[28px]" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <AdminEmpty>Nenhuma promoção criada.</AdminEmpty>
        ) : (
          <ul className="grid min-w-0 gap-3 lg:grid-cols-2 lg:gap-4">
            {rows.map((p, i) => {
              const single =
                (p.product_ids ?? []).length === 1
                  ? byId.get(String((p.product_ids ?? [])[0]))
                  : null;
              const base = single?.retail_price != null ? Number(single.retail_price) : null;
              const promoPrice =
                base != null ? applyPercent(base, Number(p.discount_percent)) : null;
              const status = campaignStatus(p as never);
              const pctText = pctShow(Number(p.discount_percent));
              return (
                <li key={p.id} className="ord-in min-w-0" style={{ ["--i" as string]: i }}>
                  <article
                    className="dash-card flex h-full min-w-0 cursor-pointer flex-col gap-4 p-5 lg:p-6"
                    onClick={(e) => {
                      // tocar no card abre a edição; botões, menus e a área de comunicação têm ação própria
                      const t = e.target as HTMLElement;
                      if (!e.currentTarget.contains(t)) return;
                      if (
                        t.closest(
                          "button, a, input, textarea, select, label, [role=menuitem], [data-no-edit]",
                        )
                      )
                        return;
                      setEditingId(p.id);
                    }}
                  >
                    <div className="flex min-w-0 items-start gap-4">
                      {single ? (
                        <span className="shrink-0 overflow-hidden rounded-[20px] bg-white">
                          <ItemThumb src={single.image_url ?? null} alt={p.name} size={72} />
                        </span>
                      ) : (
                        <span className="grid size-[72px] shrink-0 place-items-center rounded-[20px] bg-[#232323] text-[#FFD599]">
                          <BadgePercent className="size-7" strokeWidth={1.8} />
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <span className="flex min-w-0 items-center gap-2">
                          <PxStatus status={status} />
                          {isBlack(p) ? <BlackTag promotion={p} size="xs" /> : null}
                        </span>
                        <p className="mt-1.5 truncate text-[18px] font-bold tracking-[-0.015em]">
                          {p.name}
                        </p>
                        <p className="truncate text-[13.5px] text-[#8C8C8C]">
                          {single
                            ? `${single.brand ? `${single.brand} · ` : ""}${productTitle(single.canonical_name)}`
                            : (p.product_ids ?? []).length
                              ? `${(p.product_ids ?? []).length} perfumes`
                              : "Catálogo inteiro"}
                        </p>
                      </div>
                      <AdminMore
                        actions={[
                          {
                            label: "Editar promoção",
                            onSelect: () => setEditingId(p.id),
                          },
                          {
                            label: p.active ? "Pausar promoção" : "Ativar promoção",
                            onSelect: () => void toggle(p.id, !p.active),
                          },
                          {
                            label: "Excluir promoção",
                            danger: true,
                            separated: true,
                            onSelect: () => setRemoving(p.id),
                          },
                        ]}
                      />
                    </div>

                    <div className="flex min-w-0 flex-wrap items-end justify-between gap-3 rounded-[22px] bg-[#232323] p-4">
                      <div className="min-w-0">
                        {base != null ? (
                          <>
                            <p className="text-[13px] text-[#8C8C8C] line-through tabular-nums">
                              {brl(base)}
                            </p>
                            <p className="text-[26px] leading-none font-bold tracking-[-0.03em] text-[#FFD599] tabular-nums">
                              {brl(promoPrice)}
                            </p>
                          </>
                        ) : (
                          <p className="text-[26px] leading-none font-bold tracking-[-0.03em] text-[#FFD599]">
                            {pctText}% OFF
                          </p>
                        )}
                      </div>
                      {base != null ? (
                        <span className="rounded-full bg-[#FFD599] px-3 py-1 text-[13px] font-bold text-[#15130F]">
                          −{pctText}%
                        </span>
                      ) : null}
                    </div>

                    <div className="flex min-w-0 flex-wrap gap-1.5">
                      <PxTag>{appliesShort(p as never)}</PxTag>
                      {p.app_exclusive !== false ? (
                        <PxTag>{(p.app_badge_label ?? "").trim() || "Exclusivo no app"}</PxTag>
                      ) : null}
                      <PxTag>
                        {p.starts_at ? `${dateBR(p.starts_at)} → ` : ""}
                        {p.ends_at ? dateBR(p.ends_at) : "sem data final"}
                      </PxTag>
                    </div>

                    <div className="mt-auto" data-no-edit>
                      <AdminTechDetails label="Comunicação e desempenho">
                        <div className="mb-3 grid grid-cols-3 gap-2">
                          <PxStat label="Pedidos" value={p.orders_count ?? 0} />
                          <PxStat label="Vendido" value={brl(Number(p.sales_total ?? 0))} />
                          <PxStat label="Desconto" value={brl(Number(p.discount_total ?? 0))} />
                        </div>
                        <ExistingCampaignCopy
                          table="promotions"
                          row={p as never}
                          badge={`${Math.round(Number(p.discount_percent))}% OFF`}
                          vars={{
                            discount: String(Math.round(Number(p.discount_percent))),
                            product: String(p.name),
                            category:
                              p.applies_to === "DECANT"
                                ? "decants"
                                : p.applies_to === "FULL"
                                  ? "frascos"
                                  : "todo o catálogo",
                          }}
                          fallbackMessage={`${Math.round(Number(p.discount_percent))}% OFF em ${p.name}`}
                        />
                        <PromotionPopupTools promotionId={p.id} />
                      </AdminTechDetails>
                    </div>
                  </article>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <NewPromotionSheet open={creating} onClose={() => onCreatingChange(false)} />
      {editing ? (
        <EditPromotionSheet
          key={editing.id}
          row={editing}
          siblings={rows.filter((r) => r.id !== editing.id && r.name === editing.name).length}
          onClose={() => setEditingId(null)}
        />
      ) : null}
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

/** Próxima sexta-feira às 09:00 (relógio de São Paulo), no formato do campo de data. */
function nextFridayMorning() {
  const sp = new Date(Date.now() - 3 * 3600_000); // "agora" em São Paulo, lido como UTC
  const add = (5 - sp.getUTCDay() + 7) % 7 || (sp.getUTCHours() < 9 ? 0 : 7);
  const d = new Date(sp.getTime() + add * 86400_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T09:00`;
}

const PERCENT_QUICK = [5, 10, 15, 20, 25, 30].map((v) => ({ value: v, label: `${v}%` }));
const END_QUICK = [
  { value: 0, label: "Sem fim" },
  { value: 3, label: "3 dias" },
  { value: 7, label: "7 dias" },
  { value: 15, label: "15 dias" },
  { value: 30, label: "30 dias" },
];

const PROMO_STEPS: PxStep[] = [
  {
    key: "desconto",
    label: "Desconto",
    hint: "Dê um nome para a campanha e escolha quanto de desconto.",
  },
  {
    key: "produtos",
    label: "Produtos",
    hint: "Escolha perfumes ou deixe vazio para valer no catálogo inteiro.",
  },
  {
    key: "periodo",
    label: "Período",
    hint: "Sem datas, a promoção começa agora e só termina quando você pausar.",
  },
  {
    key: "loja",
    label: "Na loja",
    hint: "Selo do aplicativo e o aviso que aparece uma vez para o cliente.",
  },
];

/** Período em texto curto, para prévia e resumo. */
const periodText = (starts: string, ends: string) =>
  `${starts ? `de ${pxShortDate(starts)}` : "começa agora"} · ${ends ? `até ${pxShortDate(ends)}` : "sem data final"}`;

/** Prévia do card da promoção (criação e edição). */
function PromoPreviewCard({
  black,
  name,
  appliesTo,
  pctLabel,
  base,
  promoPrice,
  single,
  scope,
  starts,
  ends,
  appExclusive,
  badgeLabel,
}: {
  black: boolean;
  name: string;
  appliesTo: AppliesTo;
  pctLabel: string;
  base: number | null;
  promoPrice: number | null;
  single: { canonical_name: string | null; image_url: string | null } | null | undefined;
  scope: string;
  starts: string;
  ends: string;
  appExclusive: boolean;
  badgeLabel: string;
}) {
  return black ? (
    <div className="min-w-0 overflow-hidden rounded-[26px] bg-black p-5 text-white ring-1 ring-white/15">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <BlackTag promotion={{ name }} size="md" />
        <span className="shrink-0 text-[12.5px] font-bold text-[#8C8C8C]">
          {APPLIES_OPTIONS.find((o) => o.value === appliesTo)?.label}
        </span>
      </div>
      <p className="mt-4 truncate text-[15px] font-bold text-[#A9A9A9]">{name.trim()}</p>
      <p className="text-[46px] leading-none font-black tracking-[-0.05em] tabular-nums">
        {pctLabel}% <span className="text-[22px] tracking-[-0.02em] text-[#FFD599]">OFF</span>
      </p>
      {base != null ? (
        <div className="mt-4 flex min-w-0 items-center gap-3 rounded-[18px] bg-white/[0.06] p-2.5">
          {single?.image_url ? (
            <span className="shrink-0 overflow-hidden rounded-[12px] bg-white">
              <ItemThumb src={single.image_url} alt={single.canonical_name ?? ""} size={44} />
            </span>
          ) : null}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13.5px] font-semibold">{scope}</span>
            <span className="flex items-baseline gap-2 tabular-nums">
              <span className="text-[12.5px] text-[#8C8C8C] line-through">{brl(base)}</span>
              <span className="text-[17px] font-bold">{brl(promoPrice)}</span>
            </span>
          </span>
        </div>
      ) : (
        <p className="mt-3 truncate text-[14px] font-semibold text-[#A9A9A9]">{scope}</p>
      )}
      <p className="mt-3 text-[12.5px] font-semibold text-[#8C8C8C]">{periodText(starts, ends)}</p>
      <p className="mt-3 border-t border-white/10 pt-3 text-[12px] leading-snug text-[#A9A9A9]">
        Na loja: selo Black nos cards, preço riscado, contagem até o fim, aviso de estoque baixo
        real e botão “Comprar agora”.
      </p>
    </div>
  ) : (
    <div className="min-w-0 overflow-hidden rounded-[26px] bg-[#FFD599] p-5 text-[#15130F]">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <span className="inline-flex min-w-0 items-center gap-2 truncate rounded-full bg-[#15130F] px-3 py-1 text-[12px] font-semibold text-[#FFD599]">
          <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-[#FFD599]" />
          <span className="truncate">
            {appExclusive ? badgeLabel.trim() || "Exclusivo no app" : "Promoção"}
          </span>
        </span>
        <span className="shrink-0 text-[12.5px] font-bold opacity-60">
          {APPLIES_OPTIONS.find((o) => o.value === appliesTo)?.label}
        </span>
      </div>
      <p className="mt-4 truncate text-[15px] font-bold opacity-70">
        {name.trim() || "Nome da promoção"}
      </p>
      <p className="text-[46px] leading-none font-bold tracking-[-0.05em] tabular-nums">
        {pctLabel}% <span className="text-[22px] tracking-[-0.02em]">OFF</span>
      </p>
      {base != null ? (
        <div className="mt-4 flex min-w-0 items-center gap-3 rounded-[18px] bg-[#15130F]/[0.06] p-2.5">
          {single?.image_url ? (
            <span className="shrink-0 overflow-hidden rounded-[12px] bg-white">
              <ItemThumb src={single.image_url} alt={single.canonical_name ?? ""} size={44} />
            </span>
          ) : null}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13.5px] font-semibold">{scope}</span>
            <span className="flex items-baseline gap-2 tabular-nums">
              <span className="text-[12.5px] line-through opacity-55">{brl(base)}</span>
              <span className="text-[17px] font-bold">{brl(promoPrice)}</span>
            </span>
          </span>
        </div>
      ) : (
        <p className="mt-3 truncate text-[14px] font-semibold opacity-70">{scope}</p>
      )}
      <p className="mt-3 text-[12.5px] font-semibold opacity-60">{periodText(starts, ends)}</p>
    </div>
  );
}

function NewPromotionSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [percent, setPercent] = useState<number | null>(10);
  const [appliesTo, setAppliesTo] = useState<AppliesTo>("BOTH");
  const [sizes, setSizes] = useState<number[]>([]);
  const [ids, setIds] = useState<string[]>([]);
  const [starts, setStarts] = useState("");
  const [ends, setEnds] = useState("");
  const [endPick, setEndPick] = useState<number | null>(0);
  const [announce, setAnnounce] = useState(true);
  const [appExclusive, setAppExclusive] = useState(true);
  const [badgeLabel, setBadgeLabel] = useState("");
  const [copy, setCopy] = useState<CampaignCopyValue>(emptyCampaignCopy());
  const [busy, setBusy] = useState(false);
  /** "percent" = X% OFF · "price" = de R$ 400 por R$ 299,90 (vira o percentual exato). */
  const [priceMode, setPriceMode] = useState<"percent" | "price">("percent");
  /** preço final ("por") de cada perfume, no modo de/por */
  const [targets, setTargets] = useState<Record<string, number | null>>({});

  const { data: preview } = useQuery({
    queryKey: ["promo-preview", ids[0] ?? ""],
    enabled: ids.length === 1,
    queryFn: async () =>
      (
        await supabase
          .from("products")
          .select("canonical_name, brand, image_url, retail_price")
          .eq("id", ids[0]!)
          .maybeSingle()
      ).data,
  });
  const single = ids.length === 1 ? preview : null;
  const base = single?.retail_price != null ? Number(single.retail_price) : null;

  /* de/por: cada perfume escolhido tem o seu "por" (ex.: Asad de 400 por 299,90,
     Club de Nuit de 350 por 259,90). Vira uma promoção por perfume, todas com o
     mesmo nome e período — a loja trata como uma campanha só. */
  const { data: pricedRows } = useQuery({
    queryKey: ["promo-de-por", ids.join(",")],
    enabled: priceMode === "price" && ids.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from("products")
        .select("id, canonical_name, brand, image_url, retail_price")
        .in("id", ids);
      const order = new Map(ids.map((id, i) => [id, i]));
      return (data ?? []).sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    },
  });
  const rows = priceMode === "price" ? (pricedRows ?? []).filter((r) => ids.includes(r.id)) : [];
  /** Preço final → percentual com 5 casas: o preço volta exato ao centavo. */
  const pctOf = (r: { id: string; retail_price: number | null }) => {
    const b = Number(r.retail_price ?? 0),
      t = targets[r.id];
    return b > 0 && t != null && t > 0 && t < b ? Math.round((1 - t / b) * 100 * 1e5) / 1e5 : 0;
  };
  const priceOk =
    priceMode === "price" &&
    ids.length > 0 &&
    rows.length === ids.length &&
    rows.every((r) => pctOf(r) > 0 && pctOf(r) <= 90);
  const target = ids.length === 1 ? (targets[ids[0]!] ?? null) : null;
  const pct =
    priceMode === "price" ? (priceOk ? Math.max(...rows.map(pctOf)) : 0) : Number(percent) || 0;
  /** Na loja o percentual aparece inteiro ("25% OFF"); o preço é que fica exato. */
  const pctLabel = String(Math.round(pct));
  const promoVars: CampaignVars = {
    discount: pctLabel,
    product: name.trim() || "seus perfumes",
    category:
      appliesTo === "DECANT" ? "decants" : appliesTo === "FULL" ? "frascos" : "todo o catálogo",
  };

  const promoPrice = base != null ? applyPercent(base, pct) : null;

  const reset = () => {
    setStep(0);
    setName("");
    setPercent(10);
    setAppliesTo("BOTH");
    setSizes([]);
    setIds([]);
    setStarts("");
    setEnds("");
    setEndPick(0);
    setBadgeLabel("");
    setCopy(emptyCampaignCopy());
    setPriceMode("percent");
    setTargets({});
  };
  const close = () => {
    reset();
    onClose();
  };

  /**
   * Black November em um toque: nome com "Black" (é isso que liga o visual de
   * vitrine na loja), fim real em 30/11 às 23:59 e o aviso "Esquenta Black".
   * Desconto, produtos e datas continuam editáveis nos próximos passos.
   */
  const black = isBlack({ name });
  const applyBlackPreset = (kind: "esquenta" | "november") => {
    const year = new Date().getFullYear();
    setName(kind === "esquenta" ? "Black Orium" : "Black November");
    if (priceMode === "percent" && !(pct >= 10)) setPercent(15);
    setEndPick(null);
    setEnds(kind === "esquenta" ? nextFridayMorning() : `${year}-11-30T23:59`);
    setAppExclusive(false);
    setAnnounce(true);
    setCopy({
      ...emptyCampaignCopy(),
      title: `${kind === "esquenta" ? "Black Orium" : "Black November"}: até {discount}% OFF`,
      message: "Perfumes árabes originais com preço de Black. Enquanto durar o estoque.",
      cta: "Ver ofertas",
      theme: "PROMO",
    });
  };

  const stepOk = [
    name.trim().length > 0 && pct > 0 && pct <= 90,
    true,
    !(starts && ends && ends <= starts),
    true,
  ];

  const create = async () => {
    if (!name.trim()) {
      toast.error("Dê um nome para a promoção.");
      setStep(0);
      return;
    }
    if (!(pct > 0 && pct <= 90)) {
      toast.error(
        priceMode === "price"
          ? 'Escolha os perfumes e preencha o "por" de cada um, menor que o preço atual (até 90% OFF).'
          : "O desconto deve ficar entre 1% e 90%.",
      );
      setStep(0);
      return;
    }
    if (announce && campaignCopyIssues(copy, promoVars).length > 0) {
      toast.error("Há variáveis sem valor na comunicação da campanha.");
      return;
    }
    setBusy(true);
    try {
      const common = {
        name: name.trim(),
        applies_to: appliesTo,
        decant_sizes: appliesTo === "FULL" ? [] : sizes,
        starts_at: saoPauloDateTimeToIso(starts),
        ends_at: saoPauloDateTimeToIso(ends),
        app_exclusive: appExclusive,
        app_badge_label: badgeLabel.trim() || null,
        ...campaignCopyPayload(copy),
        active: true,
      };
      if (priceMode === "price") {
        // uma linha por perfume, cada uma com o próprio percentual; o aviso sai uma vez só
        const { data: saved, error } = await supabase
          .from("promotions")
          .insert(
            rows.map((r, i) => ({
              ...common,
              discount_percent: pctOf(r),
              product_ids: [r.id],
              announce: announce && i === 0,
            })),
          )
          .select("product_ids, discount_percent");
        if (error) throw error;
        // confere o preço que o banco realmente vai cobrar
        const off = rows.filter((r) => {
          const row = (saved ?? []).find((x) => (x.product_ids ?? [])[0] === r.id);
          const real = row
            ? applyPercent(Number(r.retail_price), Number(row.discount_percent))
            : targets[r.id];
          return Math.abs(Number(real) - Number(targets[r.id])) >= 0.01;
        });
        if (off.length)
          toast.warning(
            `Promoção criada. ${off.length} preço(s) ficaram alguns centavos diferentes porque o banco ainda arredonda o desconto.`,
          );
        else
          toast.success(
            rows.length === 1 ? "Promoção criada." : `Promoção criada com ${rows.length} perfumes.`,
          );
      } else {
        const { error } = await supabase
          .from("promotions")
          .insert({ ...common, discount_percent: pct, product_ids: ids, announce });
        if (error) throw error;
        toast.success("Promoção criada.");
      }
      qc.invalidateQueries();
      close();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível criar.");
    } finally {
      setBusy(false);
    }
  };

  const scope =
    ids.length === 0
      ? "Catálogo inteiro"
      : ids.length === 1
        ? productTitle(single?.canonical_name ?? "1 perfume")
        : `${ids.length} perfumes`;

  const card = (
    <PromoPreviewCard
      black={black}
      name={name}
      appliesTo={appliesTo}
      pctLabel={pctLabel}
      base={base}
      promoPrice={promoPrice}
      single={single}
      scope={scope}
      starts={starts}
      ends={ends}
      appExclusive={appExclusive}
      badgeLabel={badgeLabel}
    />
  );

  return (
    <PxWizard
      open={open}
      onClose={close}
      title="Nova promoção"
      steps={PROMO_STEPS}
      step={step}
      onStep={setStep}
      preview={card}
      summary={[
        {
          label: "Desconto",
          value:
            priceMode === "price"
              ? priceOk
                ? rows.length === 1
                  ? `de ${brl(base)} por ${brl(target)}`
                  : `${rows.length} perfumes, preço de cada um`
                : "falta preencher"
              : `${pctLabel}% OFF`,
        },
        { label: "Produtos", value: scope },
        {
          label: "Vale para",
          value: appliesShort({
            applies_to: appliesTo,
            decant_sizes: appliesTo === "FULL" ? [] : sizes,
          }),
        },
        { label: "Período", value: periodText(starts, ends) },
        { label: "Aviso ao cliente", value: announce ? "uma vez" : "não" },
      ]}
      canNext={stepOk[step]}
      onNext={() => void create()}
      finishLabel="Criar promoção"
      busy={busy}
    >
      {step === 0 ? (
        <>
          <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
            {(
              [
                { kind: "esquenta", title: "Black Orium", sub: "Curta: termina sexta às 09:00" },
                { kind: "november", title: "Black November", sub: "Até 30/11 às 23:59" },
              ] as const
            ).map((o) => {
              const on = name.trim().toLowerCase() === o.title.toLowerCase();
              return (
                <button
                  key={o.kind}
                  type="button"
                  onClick={() => applyBlackPreset(o.kind)}
                  className={cn(
                    "press flex w-full min-w-0 flex-col items-start gap-2 rounded-[18px] bg-black p-3.5 text-left ring-1 transition-colors",
                    on ? "ring-white" : "ring-white/15 hover:ring-white/40",
                  )}
                >
                  <BlackTag size="xs" />
                  <span className="block w-full min-w-0">
                    <span className="block truncate text-[14px] font-bold text-white">
                      {o.title} {on ? "✓" : ""}
                    </span>
                    <span className="block truncate text-[12px] text-[#A9A9A9]">{o.sub}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <PxField
            label="Nome da campanha"
            htmlFor="promo-name"
            hint="Qualquer nome com “Black” liga o visual Black na loja."
          >
            <PxInput
              id="promo-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex.: Semana dos decants"
            />
          </PxField>
          <PxField label="Vale para">
            <PxSeg
              label="O que entra na promoção"
              value={appliesTo}
              onChange={setAppliesTo}
              options={APPLIES_OPTIONS}
            />
          </PxField>
          <PxField label="Desconto">
            <PxSeg
              label="Tipo de desconto"
              value={priceMode}
              onChange={setPriceMode}
              options={[
                { value: "percent", label: "% de desconto" },
                { value: "price", label: "De / por (R$)" },
              ]}
            />
          </PxField>
          {priceMode === "percent" ? (
            <PxField label="Percentual">
              <PxQuick options={PERCENT_QUICK} value={pct} onPick={(v) => setPercent(v)} />
              <PercentInput id="promo-pct" value={percent} onChange={setPercent} />
            </PxField>
          ) : (
            <>
              <ProductPicker ids={ids} setIds={setIds} />
              {ids.length === 0 ? (
                <PxNote>
                  Escolha os perfumes. Para cada um, digite o preço “por”; o “de” é o preço atual do
                  frasco.
                </PxNote>
              ) : (
                <div className="min-w-0 space-y-2">
                  {rows.map((r) => {
                    const b = Number(r.retail_price ?? 0);
                    const t = targets[r.id] ?? null;
                    const p = pctOf(r);
                    return (
                      <div
                        key={r.id}
                        className="flex min-w-0 items-center gap-3 rounded-[18px] bg-[#1F1F1F] p-2.5"
                      >
                        {r.image_url ? (
                          <span className="shrink-0 overflow-hidden rounded-[12px] bg-white">
                            <ItemThumb src={r.image_url} alt={r.canonical_name ?? ""} size={44} />
                          </span>
                        ) : null}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13.5px] font-semibold text-white">
                            {productTitle(r.canonical_name ?? "")}
                          </span>
                          <span className="block truncate text-[12px] text-[#8C8C8C]">
                            {b > 0 ? (
                              <>
                                de <span className="line-through tabular-nums">{brl(b)}</span>
                              </>
                            ) : (
                              "sem preço de frasco"
                            )}
                            {p > 0 ? (
                              <span className="ml-1.5 font-bold text-[#FFD599]">
                                {Math.round(p)}% OFF
                              </span>
                            ) : null}
                            {t != null && b > 0 && t >= b ? (
                              <span className="ml-1.5 text-[#FF8A7A]">maior que o preço atual</span>
                            ) : null}
                          </span>
                        </span>
                        <span className="w-[118px] shrink-0">
                          <MoneyInput
                            id={`por-${r.id}`}
                            value={t}
                            onChange={(v) => setTargets((prev) => ({ ...prev, [r.id]: v }))}
                          />
                        </span>
                      </div>
                    );
                  })}
                  {appliesTo !== "FULL" ? (
                    <PxNote>
                      Os decants de cada perfume recebem o mesmo percentual do frasco.
                    </PxNote>
                  ) : null}
                </div>
              )}
            </>
          )}
          {priceMode === "percent" && !(pct > 0 && pct <= 90) ? (
            <PxNote tone="warning">O desconto deve ficar entre 1% e 90%.</PxNote>
          ) : null}
        </>
      ) : step === 1 ? (
        <>
          <ProductPicker ids={ids} setIds={setIds} />
          {appliesTo !== "FULL" ? (
            <PxField label="Tamanhos de decant" hint="Nenhum marcado = todos os tamanhos.">
              <div className="flex min-w-0 gap-2">
                {SIZES.map((ml) => (
                  <PxChip
                    key={ml}
                    on={sizes.includes(ml)}
                    onClick={() =>
                      setSizes(sizes.includes(ml) ? sizes.filter((s) => s !== ml) : [...sizes, ml])
                    }
                  >
                    {ml} ml
                  </PxChip>
                ))}
              </div>
            </PxField>
          ) : null}
        </>
      ) : step === 2 ? (
        <>
          <PxField label="Começa" hint="Vazio = começa assim que você criar.">
            <PxInput
              id="promo-start"
              type="datetime-local"
              value={starts}
              onChange={(e) => setStarts(e.target.value)}
            />
          </PxField>
          <PxField label="Termina">
            <PxQuick
              options={END_QUICK}
              value={endPick}
              onPick={(v) => {
                setEndPick(v);
                setEnds(v === 0 ? "" : pxEndInDays(v));
              }}
            />
            <PxInput
              id="promo-end"
              type="datetime-local"
              value={ends}
              onChange={(e) => {
                setEnds(e.target.value);
                setEndPick(e.target.value ? null : 0);
              }}
            />
          </PxField>
          {starts && ends && ends <= starts ? (
            <PxNote tone="warning">O fim precisa ser depois do começo.</PxNote>
          ) : null}
        </>
      ) : (
        <>
          <PxSwitchRow
            title="Desconto exclusivo do aplicativo"
            hint="Mostra um selo no perfume para quem compra pelo app."
            checked={appExclusive}
            onChange={setAppExclusive}
          />
          {appExclusive ? (
            <PxField label="Texto do selo (opcional)" htmlFor="promo-badge">
              <PxInput
                id="promo-badge"
                value={badgeLabel}
                onChange={(e) => setBadgeLabel(e.target.value.slice(0, 28))}
                placeholder="Exclusivo no app"
              />
            </PxField>
          ) : null}
          <PxSwitchRow
            title="Avisar o cliente uma vez"
            hint="Um aviso na loja quando a promoção entrar no ar."
            checked={announce}
            onChange={setAnnounce}
          />
          {announce ? (
            <CampaignCopyEditor
              idPrefix="promo-copy"
              value={copy}
              onChange={setCopy}
              vars={promoVars}
              badge={`${pctLabel}% OFF`}
              fallbackMessage={`${pctLabel}% OFF em ${name.trim() || "seus perfumes"}`}
            />
          ) : null}
        </>
      )}
    </PxWizard>
  );
}

/* ---------------------- editar promoção existente ---------------------- */

type PromotionRow = Tables<"promotions">;

const EDIT_STEPS: PxStep[] = [
  {
    key: "desconto",
    label: "Desconto",
    hint: "Nome, o que entra e o preço final ou o percentual.",
  },
  { key: "produtos", label: "Produtos", hint: "Perfumes e tamanhos de decant da promoção." },
  { key: "periodo", label: "Período", hint: "Estenda ou antecipe as datas, pause ou ative." },
  { key: "loja", label: "Na loja", hint: "Selo do app, cupom junto e o aviso ao cliente." },
];

/** Percentual para mostrar: inteiro quando dá, senão no máximo 1 casa ("37,4"). */
const pctShow = (v: number) => {
  const r = Math.round(Number(v) * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1).replace(".", ",");
};

function EditPromotionSheet({
  row,
  siblings,
  onClose,
}: {
  row: PromotionRow;
  /** outras promoções com o mesmo nome (ex.: os outros perfumes da Esquenta Black) */
  siblings: number;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const save = useServerFn(adminUpdatePromotion);
  const [step, setStep] = useState(0);
  const [name, setName] = useState(row.name);
  const [appliesTo, setAppliesTo] = useState<AppliesTo>((row.applies_to as AppliesTo) ?? "BOTH");
  const [sizes, setSizes] = useState<number[]>(row.decant_sizes ?? []);
  const [ids, setIds] = useState<string[]>(row.product_ids ?? []);
  const storedPct = Number(row.discount_percent);
  const [percent, setPercent] = useState<number | null>(storedPct);
  const [starts, setStarts] = useState(isoToSaoPauloInput(row.starts_at));
  const [ends, setEnds] = useState(isoToSaoPauloInput(row.ends_at));
  const [active, setActive] = useState(row.active);
  const [sameName, setSameName] = useState(siblings > 0);
  const [stackable, setStackable] = useState(row.stackable);
  const [appExclusive, setAppExclusive] = useState(row.app_exclusive);
  const [badgeLabel, setBadgeLabel] = useState(row.app_badge_label ?? "");
  const [announce, setAnnounce] = useState(row.announce);
  const [headline, setHeadline] = useState(row.headline ?? "");
  const [ctaLabel, setCtaLabel] = useState(row.cta_label ?? "");
  const [copy, setCopy] = useState<CampaignCopyValue>({
    title: row.announce_title ?? "",
    message: row.announce_message ?? "",
    cta: row.announce_cta ?? "",
    footnote: row.announce_footnote ?? "",
    theme: normalizeTheme(row.announce_theme),
    showAgain: false,
  });
  const [busy, setBusy] = useState(false);

  const { data: preview } = useQuery({
    queryKey: ["promo-preview", ids[0] ?? ""],
    enabled: ids.length === 1,
    queryFn: async () =>
      (
        await supabase
          .from("products")
          .select("canonical_name, brand, image_url, retail_price")
          .eq("id", ids[0]!)
          .maybeSingle()
      ).data,
  });
  const single = ids.length === 1 ? preview : null;
  const base =
    single?.retail_price != null && Number(single.retail_price) > 0
      ? Number(single.retail_price)
      : null;

  /** Um perfume com preço → começa no "preço final" (o jeito como a campanha foi pensada). */
  const [priceMode, setPriceMode] = useState<"percent" | "price">(
    (row.product_ids ?? []).length === 1 ? "price" : "percent",
  );
  const [target, setTarget] = useState<number | null>(null);
  const [targetTouched, setTargetTouched] = useState(false);
  /** Antes de digitar, o preço final é o que a loja cobra hoje. */
  const shownTarget = targetTouched ? target : base != null ? applyPercent(base, storedPct) : null;
  const usePrice = priceMode === "price" && ids.length === 1 && base != null;

  const pricePct =
    usePrice && shownTarget != null && shownTarget > 0 && shownTarget < base!
      ? Math.round((1 - shownTarget / base!) * 100 * 1e5) / 1e5
      : 0;
  const pct = usePrice ? (targetTouched ? pricePct : storedPct) : Number(percent) || 0;
  const pctLabel = String(Math.round(pct));
  const promoPrice =
    base != null ? (usePrice && shownTarget != null ? shownTarget : applyPercent(base, pct)) : null;
  const priceIssue = usePrice
    ? shownTarget == null || !(shownTarget > 0)
      ? "Digite o preço final."
      : shownTarget >= base!
        ? `O preço final precisa ser menor que ${brl(base)}.`
        : !(pricePct > 0 && pricePct <= 90)
          ? "O desconto deve ficar entre 1% e 90%."
          : null
    : !(pct > 0 && pct <= 90)
      ? "O desconto deve ficar entre 1% e 90%."
      : null;
  const periodIssue =
    starts && ends && ends <= starts ? "O fim precisa ser depois do começo." : null;

  const promoVars: CampaignVars = {
    discount: pctLabel,
    product: name.trim() || "seus perfumes",
    category:
      appliesTo === "DECANT" ? "decants" : appliesTo === "FULL" ? "frascos" : "todo o catálogo",
  };
  const scope =
    ids.length === 0
      ? "Catálogo inteiro"
      : ids.length === 1
        ? productTitle(single?.canonical_name ?? "1 perfume")
        : `${ids.length} perfumes`;

  const endsIso = saoPauloDateTimeToIso(ends);
  const liveAfter = active && (!endsIso || new Date(endsIso).getTime() > Date.now());

  const submit = async () => {
    if (!name.trim()) {
      toast.error("Dê um nome para a promoção.");
      setStep(0);
      return;
    }
    if (priceIssue) {
      toast.error(priceIssue);
      setStep(0);
      return;
    }
    if (periodIssue) {
      toast.error(periodIssue);
      setStep(2);
      return;
    }
    if (announce && campaignCopyIssues(copy, promoVars).length > 0) {
      toast.error("Há variáveis sem valor na comunicação da campanha.");
      setStep(3);
      return;
    }
    setBusy(true);
    try {
      const res = await save({
        data: {
          id: row.id,
          name: name.trim(),
          applies_to: appliesTo,
          decant_sizes: appliesTo === "FULL" ? [] : sizes,
          product_ids: ids,
          discount_percent: pct,
          final_price: usePrice && targetTouched ? shownTarget : null,
          starts_at: saoPauloDateTimeToIso(starts),
          ends_at: endsIso,
          active,
          stackable,
          app_exclusive: appExclusive,
          app_badge_label: badgeLabel.trim() || null,
          announce,
          headline: headline.trim() || null,
          cta_label: ctaLabel.trim() || null,
          ...campaignCopyPayload(copy),
          show_again: copy.showAgain,
          same_name_period: siblings > 0 && sameName,
        },
      });
      toast.success(
        res.siblings > 0
          ? `Promoção salva. Período aplicado a mais ${res.siblings} perfume${res.siblings === 1 ? "" : "s"}.`
          : "Promoção salva.",
      );
      qc.invalidateQueries();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível salvar.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <PxWizard
      open
      onClose={onClose}
      title="Editar promoção"
      steps={EDIT_STEPS}
      step={step}
      onStep={setStep}
      freeNav
      preview={
        <PromoPreviewCard
          black={isBlack({ name })}
          name={name}
          appliesTo={appliesTo}
          pctLabel={pctLabel}
          base={base}
          promoPrice={promoPrice}
          single={single}
          scope={scope}
          starts={starts}
          ends={ends}
          appExclusive={appExclusive}
          badgeLabel={badgeLabel}
        />
      }
      summary={[
        {
          label: "Preço",
          value: base != null ? `de ${brl(base)} por ${brl(promoPrice)}` : `${pctLabel}% OFF`,
        },
        { label: "Desconto", value: `${pctShow(pct)}%` },
        { label: "Produtos", value: scope },
        { label: "Período", value: periodText(starts, ends) },
        { label: "Situação", value: liveAfter ? "no ar" : active ? "encerrada" : "pausada" },
      ]}
      canNext={step === 0 ? !priceIssue && !!name.trim() : step === 2 ? !periodIssue : true}
      onNext={() => void submit()}
      finishLabel="Salvar alterações"
      busy={busy}
    >
      {step === 0 ? (
        <>
          <PxField
            label="Nome da campanha"
            htmlFor="edit-promo-name"
            hint="Qualquer nome com “Black” liga o visual Black na loja."
          >
            <PxInput id="edit-promo-name" value={name} onChange={(e) => setName(e.target.value)} />
          </PxField>
          <PxField label="Vale para">
            <PxSeg
              label="O que entra na promoção"
              value={appliesTo}
              onChange={setAppliesTo}
              options={APPLIES_OPTIONS}
            />
          </PxField>
          {ids.length === 1 && base != null ? (
            <PxField label="Desconto">
              <PxSeg
                label="Tipo de desconto"
                value={priceMode}
                onChange={(v) => {
                  if (v === "percent") setPercent(Math.round(pct * 100) / 100);
                  setPriceMode(v);
                }}
                options={[
                  { value: "price", label: "Preço final (R$)" },
                  { value: "percent", label: "% de desconto" },
                ]}
              />
            </PxField>
          ) : null}
          {usePrice ? (
            <PxField
              label="Preço final do frasco"
              hint={
                <>
                  Preço cheio <span className="line-through tabular-nums">{brl(base)}</span>
                  {pricePct > 0 ? (
                    <span className="ml-1.5 font-bold text-[#FFD599]">
                      {pctShow(targetTouched ? pricePct : storedPct)}% OFF
                    </span>
                  ) : null}
                </>
              }
            >
              <MoneyInput
                id="edit-promo-price"
                value={shownTarget}
                onChange={(v) => {
                  setTarget(v);
                  setTargetTouched(true);
                }}
              />
            </PxField>
          ) : (
            <PxField
              label="Percentual"
              hint={base != null ? `O frasco fica ${brl(applyPercent(base, pct))}.` : undefined}
            >
              <PxQuick options={PERCENT_QUICK} value={pct} onPick={(v) => setPercent(v)} />
              <PercentInput id="edit-promo-pct" value={percent} onChange={setPercent} />
            </PxField>
          )}
          {usePrice && appliesTo !== "FULL" ? (
            <PxNote>Os decants recebem o mesmo percentual do frasco.</PxNote>
          ) : null}
          {priceIssue ? <PxNote tone="warning">{priceIssue}</PxNote> : null}
        </>
      ) : step === 1 ? (
        <>
          <ProductPicker ids={ids} setIds={setIds} />
          {ids.length > 1 && priceMode === "price" ? (
            <PxNote>Com mais de um perfume o desconto vale em percentual para todos.</PxNote>
          ) : null}
          {appliesTo !== "FULL" ? (
            <PxField label="Tamanhos de decant" hint="Nenhum marcado = todos os tamanhos.">
              <div className="flex min-w-0 gap-2">
                {SIZES.map((ml) => (
                  <PxChip
                    key={ml}
                    on={sizes.includes(ml)}
                    onClick={() =>
                      setSizes(sizes.includes(ml) ? sizes.filter((s) => s !== ml) : [...sizes, ml])
                    }
                  >
                    {ml} ml
                  </PxChip>
                ))}
              </div>
            </PxField>
          ) : null}
        </>
      ) : step === 2 ? (
        <>
          <PxField label="Começa" hint="Vazio = já valendo.">
            <PxInput
              id="edit-promo-start"
              type="datetime-local"
              value={starts}
              onChange={(e) => setStarts(e.target.value)}
            />
          </PxField>
          <PxField label="Termina" hint="Vazio = sem data final.">
            {ends ? (
              <PxQuick
                options={[1, 2, 7].map((d) => ({
                  value: d,
                  label: `+${d} dia${d === 1 ? "" : "s"}`,
                }))}
                value={null}
                onPick={(d) => {
                  const iso = saoPauloDateTimeToIso(ends);
                  if (iso)
                    setEnds(
                      isoToSaoPauloInput(
                        new Date(new Date(iso).getTime() + d * 86400_000).toISOString(),
                      ),
                    );
                }}
              />
            ) : null}
            <PxInput
              id="edit-promo-end"
              type="datetime-local"
              value={ends}
              onChange={(e) => setEnds(e.target.value)}
            />
          </PxField>
          {periodIssue ? <PxNote tone="warning">{periodIssue}</PxNote> : null}
          <PxSwitchRow
            title="Promoção ativa"
            hint={
              active
                ? "Desligue para pausar sem apagar."
                : "Pausada: o preço volta ao normal na loja."
            }
            checked={active}
            onChange={setActive}
          />
          {siblings > 0 ? (
            <PxSwitchRow
              title={`Aplicar às outras ${siblings} “${row.name}”`}
              hint="Mesmo nome, datas e ativa/pausada nos outros perfumes desta campanha. O preço de cada um não muda."
              checked={sameName}
              onChange={setSameName}
            />
          ) : null}
        </>
      ) : (
        <>
          <PxSwitchRow
            title="Desconto exclusivo do aplicativo"
            hint="Mostra um selo no perfume para quem compra pelo app."
            checked={appExclusive}
            onChange={setAppExclusive}
          />
          {appExclusive ? (
            <PxField label="Texto do selo (opcional)" htmlFor="edit-promo-badge">
              <PxInput
                id="edit-promo-badge"
                value={badgeLabel}
                onChange={(e) => setBadgeLabel(e.target.value.slice(0, 28))}
                placeholder="Exclusivo no app"
              />
            </PxField>
          ) : null}
          <PxSwitchRow
            title="Acumula com cupom"
            hint="Ligado: o cupom dá desconto em cima do preço da promoção."
            checked={stackable}
            onChange={setStackable}
          />
          <PxSwitchRow
            title="Avisar o cliente uma vez"
            hint="Um aviso na loja enquanto a promoção estiver no ar."
            checked={announce}
            onChange={setAnnounce}
          />
          {announce ? (
            <CampaignCopyEditor
              idPrefix={`edit-promo-${row.id}`}
              value={copy}
              onChange={setCopy}
              vars={promoVars}
              badge={`${pctLabel}% OFF`}
              fallbackMessage={`${pctLabel}% OFF em ${name.trim() || "seus perfumes"}`}
              withShowAgain
            />
          ) : null}
          <AdminTechDetails label="Textos curtos (opcional)">
            <div className="min-w-0 space-y-3">
              <PxField label="Chamada" htmlFor="edit-promo-headline">
                <PxInput
                  id="edit-promo-headline"
                  value={headline}
                  onChange={(e) => setHeadline(e.target.value.slice(0, 120))}
                  placeholder="Ex.: Só até sexta"
                />
              </PxField>
              <PxField label="Texto do botão" htmlFor="edit-promo-cta">
                <PxInput
                  id="edit-promo-cta"
                  value={ctaLabel}
                  onChange={(e) => setCtaLabel(e.target.value.slice(0, 40))}
                  placeholder="Ex.: Comprar agora"
                />
              </PxField>
            </div>
          </AdminTechDetails>
        </>
      )}
    </PxWizard>
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
  const [previewOffers, setPreviewOffers] = useState<Awaited<ReturnType<typeof load>>["offers"]>(
    [],
  );
  const [busy, setBusy] = useState(false);

  const inspect = async (showPreview: boolean) => {
    setBusy(true);
    try {
      const result = await load({
        data: {
          deviceId: deviceId(),
          userId: session?.user.id ?? null,
          previewPromotionId: promotionId,
        },
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
    <div className="mt-3 min-w-0 border-t border-white/[0.06] pt-3">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <PxSecondary
          disabled={busy}
          icon={<Eye className="size-4" />}
          onClick={() => void inspect(true)}
        >
          Testar popup
        </PxSecondary>
        <button
          type="button"
          disabled={busy}
          onClick={() => void inspect(false)}
          className="press h-11 rounded-full px-4 text-[14px] font-bold text-[#A9A9A9] transition-colors hover:text-white disabled:opacity-40"
        >
          Verificar exibição
        </button>
      </div>
      {diagnostic ? (
        <p
          className={cn(
            "mt-2 text-[13px] font-semibold",
            diagnostic.reason === "ELIGIBLE" ? "text-[#7FCF9F]" : "text-[#A9A9A9]",
          )}
        >
          {REASON_LABEL[diagnostic.reason]}
        </p>
      ) : null}
      {previewOffers.length ? (
        <OfferPopup offers={previewOffers} preview onDone={() => setPreviewOffers([])} />
      ) : null}
    </div>
  );
}

/* --------------------------- cupons --------------------------- */

export function CouponsPanel({
  creating,
  onCreatingChange,
}: {
  creating: boolean;
  onCreatingChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const [term, setTerm] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);

  const { data: list, isPending } = useAdminCoupons();
  const all = useMemo(() => list ?? [], [list]);

  const rows = useMemo(() => {
    const clean = term.trim().toUpperCase();
    return all.filter((c) => !clean || String(c.code).toUpperCase().includes(clean));
  }, [all, term]);

  const stats = useMemo(
    () => ({
      ativos: all.filter((c) => campaignStatus(c as never) === "ativa").length,
      publicos: all.filter((c) => c.visibility === "PUBLIC").length,
      usos: all.reduce((s, c) => s + Number(c.redemptions ?? 0), 0),
      desconto: all.reduce((s, c) => s + Number(c.discount_total ?? 0), 0),
      vendido: all.reduce((s, c) => s + Number(c.sales_total ?? 0), 0),
    }),
    [all],
  );

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
    <div className="min-w-0 space-y-4">
      <PxKpiRow>
        <PxKpi
          hero
          i={2}
          label="Cupons ativos"
          icon={<Ticket className="size-[18px]" strokeWidth={2.2} />}
          loading={isPending}
          value={stats.ativos}
          foot={`${all.length} no total`}
        />
        <PxKpi
          i={3}
          label="Públicos"
          icon={<Users className="size-[18px]" strokeWidth={2.2} />}
          loading={isPending}
          value={stats.publicos}
          foot={`${all.length - stats.publicos} secretos`}
        />
        <PxKpi
          i={4}
          label="Usos"
          icon={<Percent className="size-[18px]" strokeWidth={2.2} />}
          loading={isPending}
          value={stats.usos}
          foot="vezes que um cupom entrou"
        />
        <PxKpi
          i={5}
          label="Desconto dado"
          icon={<HandCoins className="size-[18px]" strokeWidth={2.2} />}
          loading={isPending}
          value={brl(stats.desconto)}
          foot={`${brl(stats.vendido)} vendidos com cupom`}
        />
      </PxKpiRow>

      <div className="grid min-w-0 gap-3 lg:gap-4 xl:grid-cols-[minmax(0,1fr)_380px] xl:items-start">
        <section className="min-w-0 space-y-3">
          <label className="flex h-[56px] min-w-0 items-center gap-3 rounded-full bg-[#1A1A1A] px-5 focus-within:ring-2 focus-within:ring-[#FFD599]/50">
            <Search className="size-[18px] shrink-0 text-[#8C8C8C]" strokeWidth={2.2} />
            <input
              data-slot="input-group-control"
              value={term}
              onChange={(e) => setTerm(e.target.value.toUpperCase())}
              placeholder="Buscar cupom pelo código"
              className="h-full min-w-0 flex-1 bg-transparent text-[16px] uppercase outline-none placeholder:normal-case placeholder:text-[#6F6F6F]"
            />
            {term ? (
              <button
                type="button"
                onClick={() => setTerm("")}
                aria-label="Limpar"
                className="press grid size-8 shrink-0 place-items-center rounded-full bg-[#2E2E2E]"
              >
                <X className="size-4" />
              </button>
            ) : null}
          </label>

          {isPending ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {[0, 1].map((i) => (
                <div key={i} className="admin-skeleton h-[220px] rounded-[28px]" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <AdminEmpty>Nenhum cupom encontrado.</AdminEmpty>
          ) : (
            <ul className="grid min-w-0 gap-3 sm:grid-cols-2">
              {rows.map((c, i) => {
                const used = Number(c.redemptions ?? 0);
                const max = c.max_redemptions ? Number(c.max_redemptions) : null;
                return (
                  <li key={c.id} className="ord-in min-w-0" style={{ ["--i" as string]: i }}>
                    <article className="dash-card flex h-full min-w-0 flex-col gap-4 p-5 lg:p-6">
                      <div className="flex min-w-0 items-start justify-between gap-3">
                        <PxStatus status={campaignStatus(c as never)} />
                        <AdminMore
                          actions={[
                            {
                              label: c.active ? "Pausar cupom" : "Ativar cupom",
                              onSelect: () => void toggle(c.id, !c.active),
                            },
                            {
                              label: "Excluir cupom",
                              danger: true,
                              separated: true,
                              onSelect: () => setRemoving(c.id),
                            },
                          ]}
                        />
                      </div>

                      {/* o cupom como um ticket */}
                      <div className="relative flex min-w-0 items-stretch overflow-hidden rounded-[22px] bg-[#232323]">
                        <div className="min-w-0 flex-1 p-4">
                          <p className="text-[12.5px] font-semibold text-[#8C8C8C]">Código</p>
                          <p className="truncate text-[22px] leading-tight font-bold tracking-[0.04em]">
                            {c.code}
                          </p>
                        </div>
                        <span
                          aria-hidden
                          className="my-3 w-0 border-l-[1.5px] border-dashed border-white/15"
                        />
                        <div className="grid shrink-0 place-items-center px-4">
                          <p className="text-[24px] leading-none font-bold tracking-[-0.03em] text-[#FFD599] tabular-nums">
                            {Number(c.discount_percent)}%
                          </p>
                          <p className="text-[11.5px] font-bold text-[#8C8C8C]">OFF</p>
                        </div>
                      </div>

                      <div className="flex min-w-0 flex-wrap gap-1.5">
                        <PxTag gold={c.visibility === "PUBLIC"}>
                          {c.visibility === "PUBLIC" ? "Público" : "Secreto"}
                        </PxTag>
                        <PxTag>{appliesShort(c as never)}</PxTag>
                        <PxTag>{c.ends_at ? `até ${dateBR(c.ends_at)}` : "sem data final"}</PxTag>
                      </div>

                      <div>
                        <div className="flex items-baseline justify-between text-[13px]">
                          <span className="text-[#A9A9A9]">Usos</span>
                          <span className="font-bold tabular-nums">
                            {used}
                            {max ? (
                              <span className="text-[#8C8C8C]"> / {max}</span>
                            ) : (
                              <span className="text-[#8C8C8C]"> · sem limite</span>
                            )}
                          </span>
                        </div>
                        {max ? (
                          <div className="ord-progress mt-2 h-2 overflow-hidden rounded-full bg-[#2E2E2E]">
                            <span
                              className="block h-full rounded-full bg-[#FFD599]"
                              style={{ width: `${Math.min(100, (used / max) * 100)}%` }}
                            />
                          </div>
                        ) : null}
                      </div>

                      <div className="mt-auto">
                        <AdminTechDetails label="Restrições e comunicação">
                          <div className="mb-3 space-y-1 text-[13.5px]">
                            <p>Aplicável a: {APPLIES_LABEL[c.applies_to as AppliesTo]}</p>
                            <p>Usos por cliente: {c.max_per_user ?? "sem limite"}</p>
                            <p>Acumula com promoção: {c.stackable ? "Sim" : "Não"}</p>
                            <p>
                              Perfumes:{" "}
                              {(c.product_ids ?? []).length
                                ? `${(c.product_ids ?? []).length}`
                                : "todos"}
                            </p>
                            <p>
                              {brl(Number(c.sales_total ?? 0))} vendidos ·{" "}
                              {brl(Number(c.discount_total ?? 0))} de desconto
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
                                c.applies_to === "DECANT"
                                  ? "decants"
                                  : c.applies_to === "FULL"
                                    ? "frascos"
                                    : "todo o catálogo",
                            }}
                            fallbackMessage={`Use ${String(c.code).toUpperCase()} e economize ${Number(c.discount_percent)}% no seu pedido.`}
                          />
                        </AdminTechDetails>
                      </div>
                    </article>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <div className="min-w-0 xl:sticky xl:top-4">
          <CouponTester coupons={all as never} />
        </div>
      </div>

      <NewCouponSheet open={creating} onClose={() => onCreatingChange(false)} />
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
    if (!isRunning(coupon as never))
      return { ok: false as const, reason: "Cupom inativo ou fora do período." };
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
    <PxCard>
      <PxCardHead
        title="Testar cupom"
        sub="Nenhum pedido é criado neste teste."
        icon={<FlaskConical className="size-[18px]" strokeWidth={2.2} />}
      />
      <PxCardBody className="space-y-3">
        <div className="grid min-w-0 grid-cols-2 gap-2">
          <PxField label="Carrinho (R$)" htmlFor="test-cart">
            <PxInput
              id="test-cart"
              inputMode="decimal"
              value={cart}
              onChange={(e) => setCart(e.target.value)}
              className="tabular-nums"
            />
          </PxField>
          <PxField label="Cupom" htmlFor="test-code">
            <PxInput
              id="test-code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="ORIUM10"
              className="uppercase"
            />
          </PxField>
        </div>
        <PxSeg
          label="Tipo de item"
          value={variant}
          onChange={setVariant}
          options={[
            { value: "FULL", label: "Frasco" },
            { value: "DECANT", label: "Decant" },
          ]}
        />

        {result ? (
          result.ok ? (
            <div className="admin-value-in grid min-w-0 grid-cols-2 gap-2">
              <PxStat label="Desconto" value={brl(result.discount)} tone="gold" />
              <PxStat label="Final" value={brl(result.final)} />
              {result.note ? (
                <div className="col-span-2">
                  <PxNote>{result.note}</PxNote>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="admin-value-in">
              <PxNote tone="warning">{result.reason}</PxNote>
            </div>
          )
        ) : null}
      </PxCardBody>
    </PxCard>
  );
}

const COUPON_STEPS: PxStep[] = [
  {
    key: "codigo",
    label: "Código",
    hint: "O que o cliente digita na Sacola e quanto ele economiza.",
  },
  {
    key: "quem",
    label: "Onde vale",
    hint: "Quem pode ver o cupom e em quais produtos ele funciona.",
  },
  { key: "limites", label: "Limites", hint: "Quantas vezes pode ser usado e até quando." },
  {
    key: "aviso",
    label: "Divulgação",
    hint: "Cupons públicos podem aparecer uma vez para o cliente na loja.",
  },
];

const USES_QUICK = [
  { value: "", label: "Sem limite" },
  { value: "10", label: "10" },
  { value: "50", label: "50" },
  { value: "100", label: "100" },
];
const PER_USER_QUICK = [
  { value: "1", label: "1 vez" },
  { value: "2", label: "2 vezes" },
  { value: "", label: "Sem limite" },
];

/** Código fácil de ditar: ORIUM + 4 letras/números sem confusão (sem 0/O, 1/I). */
function randomCouponCode() {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 4; i++) s += abc[Math.floor(Math.random() * abc.length)];
  return `ORIUM${s}`;
}

function NewCouponSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [step, setStep] = useState(0);
  const [code, setCode] = useState("");
  const [percent, setPercent] = useState<number | null>(10);
  const [visibility, setVisibility] = useState<"PUBLIC" | "SECRET">("SECRET");
  const [appliesTo, setAppliesTo] = useState<AppliesTo>("BOTH");
  const [ids, setIds] = useState<string[]>([]);
  const [maxTotal, setMaxTotal] = useState("");
  const [maxPerUser, setMaxPerUser] = useState("1");
  const [ends, setEnds] = useState("");
  const [endPick, setEndPick] = useState<number | null>(0);
  const [stackable, setStackable] = useState(false);
  const [announce, setAnnounce] = useState(false);
  const [copy, setCopy] = useState<CampaignCopyValue>(emptyCampaignCopy());
  const [busy, setBusy] = useState(false);

  const pct = Number(percent) || 0;
  const clean = code.trim().toUpperCase().replace(/\s+/g, "");
  const couponVars: CampaignVars = {
    coupon: clean || "CUPOM",
    discount: String(pct),
    category:
      appliesTo === "DECANT" ? "decants" : appliesTo === "FULL" ? "frascos" : "todo o catálogo",
  };
  const showAnnounce = announce && visibility === "PUBLIC";

  const reset = () => {
    setStep(0);
    setCode("");
    setPercent(10);
    setVisibility("SECRET");
    setAppliesTo("BOTH");
    setIds([]);
    setMaxTotal("");
    setMaxPerUser("1");
    setEnds("");
    setEndPick(0);
    setStackable(false);
    setAnnounce(false);
    setCopy(emptyCampaignCopy());
  };
  const close = () => {
    reset();
    onClose();
  };

  const stepOk = [clean.length >= 3 && pct > 0 && pct <= 90, true, true, true];

  const create = async () => {
    if (clean.length < 3) {
      toast.error("O código precisa ter ao menos 3 letras.");
      setStep(0);
      return;
    }
    if (!(pct > 0 && pct <= 90)) {
      toast.error("O desconto deve ficar entre 1% e 90%.");
      setStep(0);
      return;
    }
    if (showAnnounce && campaignCopyIssues(copy, { ...couponVars, coupon: clean }).length > 0) {
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
        throw new Error(
          error.message.includes("duplicate")
            ? "Já existe um cupom com esse código."
            : error.message,
        );
      toast.success("Cupom criado.");
      qc.invalidateQueries();
      close();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível criar.");
      if (err instanceof Error && err.message.includes("Já existe")) setStep(0);
    } finally {
      setBusy(false);
    }
  };

  const ticket = (
    <div className="min-w-0 overflow-hidden rounded-[26px] bg-[#FFD599] text-[#15130F]">
      <div className="flex min-w-0 items-stretch">
        <div className="min-w-0 flex-1 p-5">
          <p className="text-[12.5px] font-bold opacity-60">
            {visibility === "PUBLIC" ? "Cupom público" : "Cupom secreto"}
          </p>
          <p className="mt-1 truncate text-[28px] leading-tight font-bold tracking-[0.04em]">
            {clean || "CUPOM"}
          </p>
          <p className="mt-1 truncate text-[13px] font-semibold opacity-60">
            {ids.length
              ? `${ids.length} ${ids.length === 1 ? "perfume" : "perfumes"}`
              : APPLIES_LABEL[appliesTo]}
          </p>
        </div>
        <span
          aria-hidden
          className="relative my-0 w-0 border-l-[1.5px] border-dashed border-[#15130F]/25"
        >
          <span className="absolute -top-3 -left-3 size-6 rounded-full bg-[#121212] lg:bg-[#0C0C0C]" />
          <span className="absolute -bottom-3 -left-3 size-6 rounded-full bg-[#121212] lg:bg-[#0C0C0C]" />
        </span>
        <div className="grid shrink-0 place-items-center px-5">
          <div className="text-center">
            <p className="text-[34px] leading-none font-bold tracking-[-0.04em] tabular-nums">
              {pct}%
            </p>
            <p className="text-[12px] font-bold opacity-60">OFF</p>
          </div>
        </div>
      </div>
      <div className="border-t border-dashed border-[#15130F]/20 px-5 py-3 text-[12.5px] font-semibold opacity-70">
        R$ 300 na Sacola → {brl(applyPercent(300, pct))}
      </div>
    </div>
  );

  return (
    <PxWizard
      open={open}
      onClose={close}
      title="Novo cupom"
      steps={COUPON_STEPS}
      step={step}
      onStep={setStep}
      preview={ticket}
      summary={[
        { label: "Desconto", value: `${pct}% OFF` },
        { label: "Visibilidade", value: visibility === "PUBLIC" ? "Público" : "Secreto" },
        {
          label: "Vale para",
          value: ids.length ? `${ids.length} perfumes` : APPLIES_LABEL[appliesTo],
        },
        {
          label: "Usos",
          value: `${maxTotal || "sem limite"} · ${maxPerUser ? `${maxPerUser} por cliente` : "livre por cliente"}`,
        },
        { label: "Validade", value: ends ? `até ${pxShortDate(ends)}` : "sem data final" },
        { label: "Com promoção", value: stackable ? "acumula" : "a melhor condição" },
      ]}
      canNext={stepOk[step]}
      onNext={() => void create()}
      finishLabel="Criar cupom"
      busy={busy}
    >
      {step === 0 ? (
        <>
          <PxField
            label="Código"
            htmlFor="cup-code"
            hint="Letras e números, sem espaço. Mínimo 3 caracteres."
          >
            <div className="flex min-w-0 gap-2">
              <PxInput
                id="cup-code"
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase().replace(/\s+/g, ""))}
                placeholder="ORIUM10"
                className="flex-1 font-bold tracking-[0.06em] uppercase"
              />
              <PxSecondary
                className="h-[52px] shrink-0 px-4"
                onClick={() => setCode(randomCouponCode())}
              >
                Gerar
              </PxSecondary>
            </div>
          </PxField>
          <PxField label="Desconto">
            <PxQuick options={PERCENT_QUICK} value={pct} onPick={(v) => setPercent(v)} />
            <PercentInput id="cup-pct" value={percent} onChange={setPercent} />
          </PxField>
        </>
      ) : step === 1 ? (
        <>
          <div className="grid min-w-0 grid-cols-2 gap-2">
            {(
              [
                ["SECRET", "Secreto", "Só quem recebe o código consegue usar."],
                ["PUBLIC", "Público", "Pode aparecer na loja para todos."],
              ] as const
            ).map(([v, label, hint]) => (
              <button
                key={v}
                type="button"
                aria-pressed={visibility === v}
                onClick={() => setVisibility(v)}
                className={cn(
                  "press min-w-0 rounded-[22px] p-4 text-left transition-colors duration-200",
                  visibility === v
                    ? "bg-white text-[#15130F]"
                    : "bg-[#232323] text-white hover:bg-[#2A2A2A]",
                )}
              >
                <span className="block text-[16px] font-bold">{label}</span>
                <span
                  className={cn(
                    "mt-1 block text-[13px] leading-snug",
                    visibility === v ? "text-[#15130F]/65" : "text-[#8C8C8C]",
                  )}
                >
                  {hint}
                </span>
              </button>
            ))}
          </div>
          <PxField label="Vale para">
            <PxSeg
              label="Vale para"
              value={appliesTo}
              onChange={setAppliesTo}
              options={APPLIES_OPTIONS}
            />
          </PxField>
          <ProductPicker ids={ids} setIds={setIds} />
        </>
      ) : step === 2 ? (
        <>
          <PxField label="Usos no total">
            <PxQuick options={USES_QUICK} value={maxTotal} onPick={setMaxTotal} />
            <PxInput
              id="cup-max"
              inputMode="numeric"
              value={maxTotal}
              onChange={(e) => setMaxTotal(e.target.value.replace(/\D/g, ""))}
              placeholder="sem limite"
              className="tabular-nums"
            />
          </PxField>
          <PxField label="Usos por cliente">
            <PxQuick options={PER_USER_QUICK} value={maxPerUser} onPick={setMaxPerUser} />
          </PxField>
          <PxField label="Válido até">
            <PxQuick
              options={END_QUICK}
              value={endPick}
              onPick={(v) => {
                setEndPick(v);
                setEnds(v === 0 ? "" : pxEndInDays(v));
              }}
            />
            <PxInput
              id="cup-end"
              type="datetime-local"
              value={ends}
              onChange={(e) => {
                setEnds(e.target.value);
                setEndPick(e.target.value ? null : 0);
              }}
            />
          </PxField>
          <PxSwitchRow
            title="Acumular com promoção"
            hint="Desligado: o cliente recebe sempre a melhor condição."
            checked={stackable}
            onChange={setStackable}
          />
        </>
      ) : visibility === "PUBLIC" ? (
        <>
          <PxSwitchRow
            title="Avisar o cliente uma vez"
            hint="Um aviso na loja com o código do cupom."
            checked={announce}
            onChange={setAnnounce}
          />
          {announce ? (
            <CampaignCopyEditor
              idPrefix="cup-copy"
              value={copy}
              onChange={setCopy}
              vars={couponVars}
              badge={`${clean || "CUPOM"} · ${pct}% OFF`}
              fallbackMessage={`Use ${clean || "CUPOM"} e economize ${pct}% no seu pedido.`}
            />
          ) : null}
        </>
      ) : (
        <PxNote>
          Cupom secreto não aparece na loja: só quem recebe o código consegue usar. Para divulgar na
          loja, volte e escolha “Público”.
        </PxNote>
      )}
    </PxWizard>
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
      <PxPrimary className="h-12 w-full" loading={busy} onClick={() => void save()}>
        Salvar comunicação
      </PxPrimary>
    </div>
  );
}
