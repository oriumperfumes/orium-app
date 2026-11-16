import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Gem } from "lucide-react";
import { SiteHeader } from "@/components/orium/SiteHeader";
import { SiteFooter } from "@/components/orium/SiteFooter";
import { NegotiationPiece } from "@/components/orium/NegotiationShowcase";
import { NegotiationContactSheet } from "@/components/orium/NegotiationContactSheet";
import { useNegotiationAccords, useNegotiationItems, type NegotiationItem } from "@/lib/negotiation";
import { track } from "@/lib/analytics";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/negociacao/")({
  head: () => ({
    meta: [
      { title: "Negociação · Orium Perfumes" },
      { name: "description", content: "Todas as peças únicas da coleção Orium, deslacradas, para consultar o valor direto pelo WhatsApp." },
      { property: "og:title", content: "Negociação · Orium Perfumes" },
      { property: "og:description", content: "Peças únicas da coleção Orium. Consulte o valor pelo WhatsApp." },
    ],
  }),
  component: NegotiationList,
});

/* ------------------------------------------------------------------ *
 * NEGOCIAÇÃO › VER TODAS — todas as peças, uma embaixo da outra, na
 * mesma grade do catálogo (2/3/4/5 colunas). Filtro rápido por situação
 * e por quanto ainda tem no frasco. O botão de cada peça abre a mesma
 * janela de consulta da Home (nome → WhatsApp).
 * ------------------------------------------------------------------ */

type Filter = "todas" | "disponiveis" | "cheios";
const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: "todas", label: "Todas" },
  { key: "disponiveis", label: "Disponíveis agora" },
  { key: "cheios", label: "Quase cheios" },
];

/** quanto ainda tem, em %, para ordenar e filtrar (sem ml cadastrado: no fim) */
const fullness = (it: NegotiationItem) =>
  it.remaining_ml != null && it.volume_ml ? it.remaining_ml / it.volume_ml : -1;

function NegotiationList() {
  const { items, isLoading } = useNegotiationItems(200);
  const accords = useNegotiationAccords(items.map((i) => i.product_id ?? ""));
  const [filter, setFilter] = useState<Filter>("todas");
  const [contact, setContact] = useState<NegotiationItem | null>(null);

  const shown = useMemo(() => {
    if (filter === "disponiveis") return items.filter((i) => i.status === "AVAILABLE");
    if (filter === "cheios") return items.filter((i) => fullness(i) >= 0.9 || /cheio|lacrad/i.test(i.condition_note));
    return items;
  }, [items, filter]);

  const notesOf = (it: NegotiationItem) => (it.product_id ? (accords.data?.get(it.product_id) ?? []) : []).slice(0, 3);
  const counts: Record<Filter, number> = {
    todas: items.length,
    disponiveis: items.filter((i) => i.status === "AVAILABLE").length,
    cheios: items.filter((i) => fullness(i) >= 0.9 || /cheio|lacrad/i.test(i.condition_note)).length,
  };

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="shell pt-2 pb-[calc(7rem+env(safe-area-inset-bottom))] lg:pb-24">
        <section aria-label="Negociação" className="cat-head mb-6">
          <p className="mt-3 flex items-center gap-2 text-[13px] font-semibold tracking-[0.14em] text-[#FFD599] uppercase tab:mt-6">
            <span className="relative size-2 rounded-full bg-[#FFD599] ui-beacon" aria-hidden />
            {isLoading ? "Peças únicas · ao vivo" : `${items.length} ${items.length === 1 ? "peça única" : "peças únicas"} · ao vivo`}
          </p>
          <h1 className="mt-2 text-[40px] leading-[1.1] font-bold tracking-[-0.035em] text-white tab:text-[48px]">Negociação</h1>
          <p className="mt-1 max-w-[640px] text-[16px] font-medium text-[#BABABA]">
            Perfumes da coleção Orium, deslacrados. Só existe um de cada — quem chama primeiro leva.
          </p>
        </section>

        {/* filtros rápidos, no mesmo jeito dos chips do catálogo */}
        <div className="-mx-[var(--page-gutter,20px)] mb-6 overflow-x-auto px-[var(--page-gutter,20px)] [scrollbar-width:none]">
          <div className="flex w-max gap-2">
            {FILTERS.map((f) => {
              const on = filter === f.key;
              return (
                <button
                  key={f.key}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setFilter(f.key)}
                  className={cn(
                    "press inline-flex h-11 items-center gap-2 rounded-full px-5 text-[15px] font-semibold transition-colors duration-200",
                    on ? "bg-white text-[#15130F]" : "bg-[#1A1A1A] text-[#D4D4D4] hover:bg-[#222]",
                  )}
                >
                  {f.label}
                  {!isLoading ? (
                    <span className={cn("rounded-full px-1.5 text-[12px] font-bold tabular-nums", on ? "bg-[#15130F] text-[#FFD599]" : "bg-[#2A2A2A] text-[#A9A9A9]")}>
                      {counts[f.key]}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>

        {isLoading ? (
          <div className="product-grid">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="aspect-[4/6.2] skeleton rounded-[28px]" />
            ))}
          </div>
        ) : shown.length === 0 ? (
          <div className="flex flex-col items-center rounded-[28px] bg-[#1A1A1A] px-6 py-14 text-center">
            <span className="grid size-14 place-items-center rounded-full bg-[#232323] text-[#FFD599]">
              <Gem className="size-6" />
            </span>
            <p className="mt-4 text-[18px] font-bold text-white">{items.length ? "Nenhuma peça com esse filtro" : "Nenhuma peça na vitrine agora"}</p>
            <p className="mt-1 text-[15px] text-[#A9A9A9]">
              {items.length ? "Tire o filtro para ver todas." : "Novas peças entram toda semana. Enquanto isso, veja o catálogo."}
            </p>
            {items.length ? (
              <button type="button" onClick={() => setFilter("todas")} className="press mt-5 h-11 rounded-full bg-white px-5 text-[15px] font-bold text-[#15130F]">
                Ver todas
              </button>
            ) : (
              <Link to="/" className="press mt-5 inline-flex h-11 items-center rounded-full bg-[#FFD599] px-5 text-[15px] font-bold text-[#15130F]">
                Ver o catálogo
              </Link>
            )}
          </div>
        ) : (
          <div key={filter} className="neg-show is-in product-grid">
            {shown.map((it, i) => (
              <NegotiationPiece
                key={it.id}
                item={it}
                notes={notesOf(it)}
                delay={i}
                priority={i < 4}
                compact
                onOffer={() => {
                  track("discovery_clicked", { meta: { card: "negociacao_oferta", id: it.id, where: "ver_todas" } });
                  setContact(it);
                }}
              />
            ))}
          </div>
        )}
      </main>
      <div className="hidden lg:block">
        <SiteFooter />
      </div>
      {contact ? <NegotiationContactSheet item={contact} open={!!contact} onOpenChange={(o) => !o && setContact(null)} /> : null}
    </div>
  );
}
