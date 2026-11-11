import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { brl } from "@/lib/format";
import type { AdminProductInsight } from "@/lib/admin-insight.functions";
import { cn } from "@/lib/utils";
import { navigatingFromLayer } from "@/hooks/use-back-to-close";

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";

const signed = (v: number) => `${v >= 0 ? "+" : "–"}${brl(Math.abs(v))}`;
const marginPct = (i: AdminProductInsight) =>
  i.margin != null && i.retailPrice ? Math.round((i.margin / i.retailPrice) * 100) : null;

/**
 * Camada da equipe no card do catálogo (e da busca): lucro, quanto a Orium
 * paga e de quem compra — só isso, para ler num relance. O toque abre o
 * painel completo. Nada disso existe para o cliente.
 */
export function AdminCatalogChip({
  insight,
  name,
  className,
}: {
  insight: AdminProductInsight;
  name: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const loss = insight.margin != null && insight.margin < 0;

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
        aria-label={`Custos e lucro de ${name}`}
        className={cn(
          "insight-chip press mt-2.5 w-full rounded-[14px] border border-white/[0.07] bg-[#171717] px-3 pt-2 pb-2 text-left transition-colors hover:bg-[#1C1C1C]",
          className,
        )}
      >
        <span className="flex items-baseline justify-between gap-2">
          <span className="text-[11px] text-[#8C8C8C]">Lucro</span>
          <span
            className={cn(
              "text-[15px] leading-tight font-bold tabular-nums whitespace-nowrap",
              loss ? "text-[#FF9A8A]" : "text-[#FFD599]",
            )}
          >
            {insight.margin != null ? signed(insight.margin) : "—"}
          </span>
        </span>
        <span className="mt-0.5 flex items-baseline justify-between gap-2">
          <span className="text-[11px] text-[#8C8C8C]">Você paga</span>
          <span className="text-[13px] font-semibold text-white tabular-nums whitespace-nowrap">
            {insight.cost != null ? brl(insight.cost) : "—"}
          </span>
        </span>
        <span className="mt-1.5 flex items-center gap-1 border-t border-white/[0.06] pt-1.5 text-[11px] text-[#A9A9A9]">
          <span className="min-w-0 truncate">{insight.bestSupplier ?? "Sem fornecedor"}</span>
          <ChevronRight className="ml-auto size-3.5 shrink-0 text-[#6F6F6F]" strokeWidth={2.4} />
        </span>
      </button>
      <AdminInsightSheet insight={insight} name={name} open={open} onOpenChange={setOpen} />
    </>
  );
}

/**
 * Barra de onde vai o dinheiro: a parte que paga o fornecedor e a parte que
 * fica com a Orium, sobre o preço de venda.
 */
export function ProfitBar({ insight }: { insight: AdminProductInsight }) {
  const sale = insight.retailPrice ?? 0;
  const cost = insight.cost ?? 0;
  if (!sale || !insight.cost) return null;
  const costShare = Math.min(100, Math.max(0, (cost / sale) * 100));
  return (
    <div className="mt-4">
      <div className="flex h-2.5 overflow-hidden rounded-full bg-[#2A2A2A]" aria-hidden>
        <span className="h-full bg-[#5A5A5A]" style={{ width: `${costShare}%` }} />
        <span className="h-full flex-1 bg-[#FFD599]" />
      </div>
      <div className="mt-2.5 flex items-start justify-between gap-3 text-[13px]">
        <span>
          <span className="block text-[#8C8C8C]">Você paga</span>
          <span className="block text-[17px] font-bold text-white tabular-nums">{brl(cost)}</span>
        </span>
        <span className="text-right">
          <span className="block text-[#8C8C8C]">Vende por</span>
          <span className="block text-[17px] font-bold text-white tabular-nums">{brl(sale)}</span>
        </span>
      </div>
    </div>
  );
}

/** Painel completo — reutilizado no catálogo, na busca e na página do perfume. */
export function AdminInsightSheet({
  insight,
  name,
  open,
  onOpenChange,
}: {
  insight: AdminProductInsight;
  name: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const pct = marginPct(insight);
  const loss = insight.margin != null && insight.margin < 0;
  const offers = [...insight.offers].sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[90vh]">
        <div className="overflow-y-auto px-5 pt-3 pb-[calc(1.25rem+env(safe-area-inset-bottom))] text-white">
          <p className="text-[12px] font-semibold text-[#8C8C8C]">Só a equipe vê</p>
          <DrawerTitle className="mt-1 text-[22px] leading-tight font-bold tracking-[-0.02em] text-white">{name}</DrawerTitle>

          {/* lucro em destaque e a barra custo → venda */}
          <section className="mt-5 rounded-[22px] bg-[#1A1A1A] p-5">
            <p className="text-[13px] text-[#A9A9A9]">Lucro por frasco</p>
            <div className="mt-0.5 flex items-baseline gap-2.5">
              <span
                className={cn(
                  "text-[36px] leading-none font-bold tracking-[-0.035em] tabular-nums",
                  loss ? "text-[#FF9A8A]" : "text-[#FFD599]",
                )}
              >
                {insight.margin != null ? signed(insight.margin) : "—"}
              </span>
              {pct != null ? <span className="text-[14px] font-semibold text-[#A9A9A9]">{pct}% da venda</span> : null}
            </div>
            <ProfitBar insight={insight} />
          </section>

          <h3 className="mt-7 text-[17px] font-bold text-white">Fornecedores</h3>
          <ul className="mt-2.5 overflow-hidden rounded-[20px] bg-[#1A1A1A]">
            {offers.length === 0 ? (
              <li className="px-4 py-4 text-[14px] text-[#A9A9A9]">Nenhuma oferta ativa.</li>
            ) : (
              offers.map((o, i) => {
                const best = o.supplier === insight.bestSupplier;
                return (
                  <li
                    key={`${o.supplier}-${i}`}
                    className="flex items-center gap-3 border-b border-white/[0.06] px-4 py-3.5 last:border-0"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-[15px] font-bold text-white">{o.supplier}</span>
                        {best ? (
                          <span className="shrink-0 rounded-full bg-[#FFD599] px-2 py-0.5 text-[10px] font-bold text-[#15130F]">
                            Usado no custo
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-0.5 block truncate text-[12px] text-[#8C8C8C]">{o.rawName}</span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block text-[15px] font-bold text-white tabular-nums">
                        {o.price != null ? brl(o.price) : "—"}
                      </span>
                      <span className={cn("block text-[12px]", o.inStock ? "text-[#A9A9A9]" : "text-[#FF9A8A]")}>
                        {o.inStock ? "Em estoque" : "Sem estoque"}
                      </span>
                    </span>
                  </li>
                );
              })
            )}
          </ul>

          <h3 className="mt-7 text-[17px] font-bold text-white">Detalhes</h3>
          <dl className="mt-2.5 overflow-hidden rounded-[20px] bg-[#1A1A1A] text-[15px]">
            <Row label="Preço de atacado" value={insight.wholesalePrice != null ? brl(insight.wholesalePrice) : "—"} />
            <Row label="Estoque da Orium" value={insight.stockQuantity != null ? `${insight.stockQuantity} un.` : "—"} />
            <Row label="Na loja" value={insight.inStock ? "Disponível" : "Indisponível"} />
            <Row label="Sincronizado" value={when(insight.lastSyncedAt)} />
          </dl>

          <div className="mt-6 grid grid-cols-2 gap-2.5">
            <Link
              to="/admin/produtos/$id"
              params={{ id: insight.productId }}
              replace
              onClick={navigatingFromLayer}
              className="press grid h-[52px] place-items-center rounded-full bg-[#FFD599] text-[15px] font-bold text-[#15130F]"
            >
              Editar produto
            </Link>
            <Link
              to="/admin/precificacao"
              replace
              onClick={navigatingFromLayer}
              className="press grid h-[52px] place-items-center rounded-full bg-[#1F1F1F] text-[15px] font-bold text-white"
            >
              Precificação
            </Link>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-white/[0.06] px-4 py-3.5 last:border-0">
      <dt className="text-[#A9A9A9]">{label}</dt>
      <dd className="font-semibold text-white tabular-nums">{value}</dd>
    </div>
  );
}
