import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, Gem } from "lucide-react";
import { productTitle } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  negotiationPhoto,
  NEGOTIATION_TAGLINE,
  useNegotiationItems,
  type NegotiationItem,
} from "@/lib/negotiation";
import { HCarousel } from "@/components/orium/HCarousel";
import { PhotoFade } from "@/components/orium/PhotoFade";



/**
 * "Negociação" — perfumes da própria Orium, deslacrados e praticamente cheios,
 * negociados diretamente pelo WhatsApp. Sem preço: o CTA deixa isso claro.
 */
export function NegotiationRow() {
  const { items, isLoading } = useNegotiationItems(12);
  const scroller = useRef<HTMLDivElement | null>(null);
  const section = useRef<HTMLElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = section.current;
    if (!el || typeof IntersectionObserver === "undefined") return setVisible(true);
    const io = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -10% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);


  const nudge = (dir: -1 | 1) => {
    const el = scroller.current;
    if (!el) return;
    const card = el.firstElementChild as HTMLElement | null;
    el.scrollBy({ left: dir * ((card?.offsetWidth ?? 160) + 10) * 2, behavior: "smooth" });
  };

  if (isLoading) {
    return (
      <section className="mb-6">
        <div className="mb-2.5 h-6 w-40 rounded-full bg-surface-3" />
        <div className="page-bleed-r flex gap-2.5 overflow-hidden">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="w-[56%] shrink-0 overflow-hidden r-card card-surface tab:w-[36%] md:w-[30%] lg:w-[24%]">
              <div className="aspect-[4/5] w-full bg-surface-3" />
              <div className="space-y-2 px-3 pt-2.5 pb-3">
                <div className="h-3 w-3/4 rounded-full bg-surface-3" />
                <div className="h-3 w-1/2 rounded-full bg-surface-3" />
                <div className="h-11 r-btn bg-surface-3" />
              </div>
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (!items.length) return null;

  return (
    <section
      ref={section}
      aria-label="Negociação"
      className={cn("mb-6", visible ? "reveal-in" : "reveal-pre")}
    >
      <div className="mb-2.5 flex items-end gap-2">
        <div className="min-w-0">
          <h2 className="display flex items-center gap-2 text-xl">
            <Gem className="size-4 text-gold" /> Negociação
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{NEGOTIATION_TAGLINE}</p>
        </div>
        <div className="ml-auto hidden shrink-0 gap-1 sm:flex">
          <Arrow label="Anterior" onClick={() => nudge(-1)}>
            <ChevronLeft className="size-4" />
          </Arrow>
          <Arrow label="Próximo" onClick={() => nudge(1)}>
            <ChevronRight className="size-4" />
          </Arrow>
        </div>
      </div>

      {/* Mesmo trilho dos "perfumes parecidos" da página do perfume. */}
      <HCarousel
        ref={scroller}
        resetKey={items.length}
        className="page-bleed-r gap-2.5"
      >
        {items.map((item, i) => (
          <div
            key={item.id}
            className="flex w-[56%] shrink-0 snap-start tab:w-[36%] md:w-[30%] lg:w-[24%]"
            style={{ "--d": `${Math.min(i, 6) * 45}ms` } as React.CSSProperties}
          >
            {/* Os primeiros cards já vêm com a Home; o resto carrega ao rolar. */}
            <NegotiationCard item={item} priority={i < 3} />

          </div>
        ))}
      </HCarousel>

    </section>
  );
}

function Arrow({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="press grid size-8 place-items-center rounded-full border border-border/70 bg-surface-3 text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
    >
      {children}
    </button>
  );
}

/**
 * Mesmo acabamento dos cards do catálogo: bloco único arredondado, foto grande
 * como protagonista e CTA dourado.
 */
export function NegotiationCard({ item, priority = false }: { item: NegotiationItem; priority?: boolean }) {
  // Card/carrossel usa a versão leve da foto; a página individual usa a maior.
  const photo = negotiationPhoto(item.image_url, "card");

  return (
    <div
      className="card-cv stagger-in r-card flex h-full flex-col overflow-hidden border border-gold/25 bg-card shadow-soft"
      style={{ animationDelay: `var(--d, 0ms)` }}
    >
      <Link
        to="/negociacao/$id"
        params={{ id: item.id }}
        preload="intent"
        className="tap-card flex flex-1 flex-col"
      >
        <div className="relative aspect-[4/5] w-full overflow-hidden bg-surface-3">
          {photo ? (
            <PhotoFade src={photo} alt={`${item.brand ?? "Orium"} ${item.name}`} priority={priority} />
          ) : (
            <div className="grid size-full place-items-center text-muted-foreground">
              <Gem className="size-6" />
            </div>
          )}
          <span className="absolute top-2 left-2 rounded-full border border-gold/40 bg-black/45 px-2 py-0.5 text-[9.5px] font-semibold tracking-wide text-gold uppercase backdrop-blur-md">
            {item.status === "NEGOTIATING" ? "Em negociação" : "Negociação"}
          </span>
        </div>

        <div className="flex flex-1 flex-col px-3 pt-2.5">
          <p className="truncate text-[10px] tracking-[0.12em] text-muted-foreground uppercase">
            {item.brand ?? "Orium"}
          </p>
          <p className="mt-0.5 truncate text-[14px] leading-tight font-semibold">{productTitle(item.name)}</p>
          <p className="mt-1 line-clamp-2 text-[10.5px] leading-snug text-muted-foreground">
            Deslacrado · {item.condition_note}
            {item.volume_ml ? ` · ${item.volume_ml}ml` : ""}
          </p>
          <p className="mt-2 flex-1 text-[13px] font-semibold text-gold">Preço a combinar</p>
        </div>
      </Link>

      <div className="px-3 pt-2 pb-3">
        <Link
          to="/negociacao/$id"
          params={{ id: item.id }}
          preload="intent"
          className="press flex h-11 w-full items-center justify-center r-btn bg-gradient-to-b from-gold-soft to-gold text-[13px] font-semibold text-gold-foreground"
        >
          Negociar
        </Link>
      </div>
    </div>
  );
}
