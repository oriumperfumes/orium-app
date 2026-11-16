import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Camera, ChevronLeft, ChevronRight, Gem, MessageCircle, ShieldCheck, Truck } from "lucide-react";
import { productTitle } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  negotiationLevel,
  negotiationPhoto,
  useNegotiationAccords,
  useNegotiationCount,
  useNegotiationItems,
  type NegotiationItem,
} from "@/lib/negotiation";
import { lazyUI, MountWhen, useIdlePrefetch } from "@/lib/lazy-ui";
import { useRevealOnce } from "@/components/orium/Reveal";
import { PhotoFade } from "@/components/orium/PhotoFade";
import { HCarousel } from "@/components/orium/HCarousel";
import { track } from "@/lib/analytics";

const ContactSheet = lazyUI(() =>
  import("@/components/orium/NegotiationContactSheet").then((m) => ({ default: m.NegotiationContactSheet })),
);

/* ------------------------------------------------------------------ *
 * VITRINE DE NEGOCIAÇÃO (Home) — entra logo abaixo do vídeo, no lugar
 * dos cartões de Decants/Frascos (que descem para baixo dela).
 *
 * Peça única, foto grande, quanto ainda tem no frasco, as notas que
 * fazem querer e UM botão: "Fazer minha oferta" abre o nome → WhatsApp
 * direto da Home (sem passar pela página do item). Sem preço: o valor é
 * combinado na conversa. Movimento só na entrada (uma vez), e some com
 * "reduzir movimento".
 * ------------------------------------------------------------------ */

/** A Home pergunta antes de decidir o layout: há algo para negociar? */
export function useHasNegotiation() {
  const { items, isLoading } = useNegotiationItems(12);
  return { has: items.length > 0, isLoading };
}

export function NegotiationShowcase() {
  const { items } = useNegotiationItems(12);
  const total = Math.max(useNegotiationCount().data ?? 0, items.length);
  const accords = useNegotiationAccords(items.map((i) => i.product_id ?? ""));
  const { ref, seen } = useRevealOnce<HTMLElement>();
  const [contact, setContact] = useState<NegotiationItem | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);
  const nudge = (dir: -1 | 1) => {
    const el = scroller.current;
    const card = el?.firstElementChild as HTMLElement | null;
    el?.scrollBy({ left: dir * ((card?.offsetWidth ?? 260) + 12) * 2, behavior: "smooth" });
  };
  useIdlePrefetch([ContactSheet.prefetch], items.length > 0);

  if (!items.length) return null;
  const first = items[0];
  const rest = items.slice(1);
  const notesOf = (it: NegotiationItem) => (it.product_id ? (accords.data?.get(it.product_id) ?? []) : []).slice(0, 4);
  const offer = (it: NegotiationItem, where: string) => {
    track("discovery_clicked", { meta: { card: "negociacao_oferta", id: it.id, where } });
    setContact(it);
  };

  return (
    <section ref={ref} aria-label="Negociação" className={cn("neg-show relative z-10 mt-5", seen ? "is-in" : "is-pre")}>
      <header className="neg-rise mb-5 flex flex-col gap-4 tab:flex-row tab:items-end" style={{ "--nd": "0ms" } as CSSProperties}>
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[13px] font-semibold tracking-[0.14em] text-[#FFD599] uppercase">
            <span className="relative size-2 rounded-full bg-[#FFD599] ui-beacon" aria-hidden />
            {total > 1 ? `${total} peças únicas · ao vivo` : "Peça única · ao vivo"}
          </p>
          <h2 className="home-title mt-2">Negociação</h2>
          <p className="home-subtitle max-w-[620px]">
            Perfumes da coleção Orium, deslacrados e quase cheios. Só existe um de cada — quem chama primeiro leva.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2 tab:ml-auto">
          {total > 1 ? (
            <Link
              to="/negociacao"
              preload="intent"
              onClick={() => track("discovery_clicked", { meta: { card: "negociacao_ver_todas", where: "titulo" } })}
              className="press group inline-flex h-11 items-center gap-1.5 rounded-full bg-[#1F1F1F] pr-3.5 pl-4 text-[14px] font-semibold whitespace-nowrap text-white transition-colors hover:bg-[#2A2A2A]"
            >
              Ver todas
              <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-0.5" strokeWidth={2.4} />
            </Link>
          ) : null}
        {items.length > 3 ? (
          <div className="hidden shrink-0 gap-2 tab:flex">
            <Arrow label="Anterior" onClick={() => nudge(-1)}>
              <ChevronLeft className="size-5" />
            </Arrow>
            <Arrow label="Próximo" onClick={() => nudge(1)}>
              <ChevronRight className="size-5" />
            </Arrow>
          </div>
        ) : null}
        </div>
      </header>

      {/* um perfume: destaque grande. Vários: uma fileira só, que desliza — a altura nunca cresce */}
      {rest.length === 0 ? (
        <FeatureCard item={first!} notes={notesOf(first!)} onOffer={() => offer(first!, "destaque")} />
      ) : (
        <PiecesRow scrollerRef={scroller} items={items} total={total} notesOf={notesOf} onOffer={(it) => offer(it, "fileira")} />
      )}

      <MountWhen when={!!contact}>
        {contact ? <ContactSheet item={contact} open={!!contact} onOpenChange={(o) => !o && setContact(null)} /> : null}
      </MountWhen>
    </section>
  );
}

/* ─────────────── destaque ─────────────── */

function FeatureCard({ item, notes, onOffer }: { item: NegotiationItem; notes: string[]; onOffer: () => void }) {
  const photo = negotiationPhoto(item.image_url);
  const lvl = negotiationLevel(item);
  const fill = lvl.pct;
  const negotiating = item.status === "NEGOTIATING";
  return (
    <article
      className="neg-rise neg-feature grid overflow-hidden rounded-[28px] bg-[#1A1A1A] tab:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] tab:rounded-[32px]"
      style={{ "--nd": "90ms" } as CSSProperties}
    >
      <Link
        to="/negociacao/$id"
        params={{ id: item.id }}
        preload="intent"
        aria-label={`Ver ${productTitle(item.name)}`}
        className="group relative block aspect-square overflow-hidden bg-[#F2F1ED] tab:aspect-auto tab:min-h-[520px]"
      >
        {photo ? (
          <span className="neg-photo absolute inset-0 block">
            <PhotoFade src={photo} alt={`${item.brand ?? "Orium"} ${item.name}`} priority />
          </span>
        ) : (
          <span className="grid size-full place-items-center text-[#8C8C8C]">
            <Gem className="size-10" strokeWidth={1.4} />
          </span>
        )}
        <span className="absolute top-4 left-4 inline-flex h-8 items-center gap-1.5 rounded-full bg-[#15130F] px-3.5 text-[12.5px] font-bold tracking-wide text-[#FFD599]">
          <Gem className="size-3.5" /> Peça única
        </span>
        {negotiating ? (
          <span className="absolute top-4 right-4 inline-flex h-8 items-center gap-2 rounded-full bg-white px-3.5 text-[12.5px] font-bold text-[#15130F]">
            <span className="relative size-2 rounded-full bg-[#E8913A] ui-beacon" aria-hidden /> Em negociação
          </span>
        ) : null}
      </Link>

      <div className="flex min-w-0 flex-col p-6 tab:p-9 lg:p-11">
        <p className="neg-line text-[12.5px] font-semibold tracking-[0.16em] text-[#8C8C8C] uppercase" style={{ "--nd": "220ms" } as CSSProperties}>
          {item.brand ?? "Orium"}
        </p>
        <h3
          className="neg-line mt-2 text-[34px] leading-[1.02] font-bold tracking-[-0.035em] text-balance text-white tab:text-[44px] lg:text-[52px]"
          style={{ "--nd": "280ms" } as CSSProperties}
        >
          {productTitle(item.name)}
        </h3>
        <p className="neg-line mt-3 text-[15px] text-[#A9A9A9]" style={{ "--nd": "340ms" } as CSSProperties}>
          {[item.volume_ml ? `Frasco de ${item.volume_ml} ml` : null, "deslacrado"].filter(Boolean).join(" · ")}
        </p>

        {fill != null ? (
          <div className="neg-line mt-7" style={{ "--nd": "400ms" } as CSSProperties}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[14px] font-semibold text-[#D4D4D4]">Quanto ainda tem</span>
              <span className="text-[14px] text-[#A9A9A9] tabular-nums">
                {lvl.ml != null ? (
                  <>
                    <b className="text-[18px] font-bold text-white">{lvl.ml} ml</b> de {item.volume_ml} ml
                  </>
                ) : (
                  <b className="text-[18px] font-bold text-white">~{fill}%</b>
                )}
              </span>
            </div>
            <FillBar value={fill} big />
            <p className="mt-2 text-[13.5px] text-[#A9A9A9]">{lvl.label}</p>
          </div>
        ) : (
          <p className="neg-line mt-6 text-[15px] text-[#D4D4D4]" style={{ "--nd": "400ms" } as CSSProperties}>
            {lvl.label}
          </p>
        )}

        {notes.length ? (
          <div className="neg-line mt-7" style={{ "--nd": "460ms" } as CSSProperties}>
            <p className="text-[14px] font-semibold text-[#D4D4D4]">O que você sente</p>
            <ul className="mt-3 flex flex-wrap gap-2">
              {notes.map((n, i) => (
                <li
                  key={n}
                  className="neg-chip rounded-full bg-[#262626] px-4 py-2 text-[14px] font-semibold text-white capitalize"
                  style={{ "--nd": `${520 + i * 60}ms` } as CSSProperties}
                >
                  {n}
                </li>
              ))}
            </ul>
          </div>
        ) : item.description ? (
          <p className="neg-line mt-6 line-clamp-3 text-[15px] leading-relaxed text-[#A9A9A9]" style={{ "--nd": "460ms" } as CSSProperties}>
            {item.description}
          </p>
        ) : null}

        <ul className="neg-line mt-7 grid grid-cols-3 gap-2" style={{ "--nd": "520ms" } as CSSProperties}>
          {[
            { icon: <ShieldCheck />, text: "Original da Orium" },
            { icon: <Camera />, text: "Foto real do frasco" },
            { icon: <Truck />, text: "Entrega combinada" },
          ].map((t) => (
            <li key={t.text} className="flex flex-col items-start gap-2 rounded-[18px] bg-[#222] p-3 text-[12.5px] leading-snug text-[#BDBDBD] [&_svg]:size-[18px] [&_svg]:text-[#FFD599]">
              {t.icon}
              {t.text}
            </li>
          ))}
        </ul>

        <div className="neg-line mt-auto pt-7" style={{ "--nd": "580ms" } as CSSProperties}>
          {negotiating ? (
            <p className="mb-3 rounded-[16px] bg-[#2A2014] px-4 py-3 text-[14px] leading-snug text-[#F2C46D]">
              Alguém já está conversando sobre este. Ainda dá tempo de consultar o valor.
            </p>
          ) : null}
          <button
            type="button"
            onClick={onOffer}
            className="neg-cta press group flex h-[58px] w-full items-center justify-center gap-2.5 rounded-full bg-[#FFD599] text-[17px] font-bold text-[#15130F] transition-colors hover:bg-[#FFDDAA]"
          >
            <MessageCircle className="size-5" strokeWidth={2.4} />
            Consultar valor
            <ArrowRight className="size-5 transition-transform duration-300 group-hover:translate-x-1" strokeWidth={2.4} />
          </button>
          <p className="mt-3 text-center text-[13px] text-[#8C8C8C]">A Orium te passa o valor no WhatsApp. Sem compromisso.</p>
        </div>
      </div>
    </article>
  );
}

/* ─────────────── fileira de peças ─────────────── */

function PiecesRow({
  scrollerRef,
  items,
  total,
  notesOf,
  onOffer,
}: {
  scrollerRef: React.MutableRefObject<HTMLDivElement | null>;
  items: NegotiationItem[];
  total: number;
  notesOf: (it: NegotiationItem) => string[];
  onOffer: (it: NegotiationItem) => void;
}) {
  const slot = "flex w-[78%] shrink-0 snap-start tab:w-[44%] md:w-[31.5%] lg:w-[23.8%]";
  return (
    <div className="neg-rise" style={{ "--nd": "90ms" } as CSSProperties}>
      <HCarousel ref={scrollerRef} resetKey={items.length} className="page-bleed-r gap-3">
        {items.map((it, i) => (
          <div key={it.id} className={slot}>
            <NegotiationPiece item={it} notes={notesOf(it)} onOffer={() => onOffer(it)} delay={i} priority={i < 2} />
          </div>
        ))}
        <div className={slot}>
          <SeeAllTile total={total} delay={items.length} />
        </div>
      </HCarousel>
    </div>
  );
}

/** Último cartão da fileira: leva para a página com todas as peças, uma embaixo da outra. */
function SeeAllTile({ total, delay }: { total: number; delay: number }) {
  return (
    <Link
      to="/negociacao"
      preload="intent"
      onClick={() => track("discovery_clicked", { meta: { card: "negociacao_ver_todas", where: "fim_da_fileira" } })}
      className="neg-piece press group flex h-full min-h-[320px] w-full flex-col justify-between rounded-[28px] bg-[#FFD599] p-6 text-[#15130F]"
      style={{ "--nd": `${Math.min(delay, 6) * 70 + 260}ms` } as CSSProperties}
    >
      <Gem className="size-7" strokeWidth={1.8} />
      <span>
        <span className="block text-[44px] leading-none font-bold tracking-[-0.04em] tabular-nums">{total}</span>
        <span className="mt-2 block text-[24px] leading-[1.1] font-bold tracking-[-0.03em]">peças únicas na Negociação</span>
        <span className="mt-2 block text-[14.5px] leading-snug text-[#15130F]/70">Veja todas, uma embaixo da outra, e escolha a sua.</span>
      </span>
      <span className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-[#15130F] text-[15px] font-bold text-[#FFD599]">
        Ver todas
        <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-1" strokeWidth={2.6} />
      </span>
    </Link>
  );
}

/**
 * Cartão de uma peça (trilho da Home e "outras peças" na página do item).
 * Sem `onOffer`, o botão leva à página do item.
 */
export function NegotiationPiece({
  item,
  notes = [],
  onOffer,
  delay = 0,
  priority = false,
  compact = false,
}: {
  item: NegotiationItem;
  notes?: string[];
  onOffer?: () => void;
  /** grade de 2 colunas no celular (página "Ver todas") */
  compact?: boolean;
  delay?: number;
  priority?: boolean;
}) {
  const photo = negotiationPhoto(item.image_url, "card");
  const lvl = negotiationLevel(item);
  const fill = lvl.pct;
  const negotiating = item.status === "NEGOTIATING";
  const cta = (
    <>
      Consultar valor <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-0.5" strokeWidth={2.6} />
    </>
  );
  return (
    <article
      className="neg-piece flex h-full w-full flex-col overflow-hidden rounded-[28px] bg-[#1A1A1A]"
      style={{ "--nd": `${Math.min(delay, 6) * 70 + 260}ms` } as CSSProperties}
    >
      <Link to="/negociacao/$id" params={{ id: item.id }} preload="intent" className="tap-card group flex flex-1 flex-col">
        <span className="relative block aspect-[4/5] overflow-hidden bg-[#F2F1ED]">
          {photo ? (
            <span className="neg-piece-img absolute inset-0 block">
              <PhotoFade src={photo} alt={`${item.brand ?? "Orium"} ${item.name}`} priority={priority} />
            </span>
          ) : (
            <span className="grid size-full place-items-center text-[#8C8C8C]">
              <Gem className="size-7" strokeWidth={1.4} />
            </span>
          )}
          <span className="absolute top-3 left-3 inline-flex h-7 items-center gap-1 rounded-full bg-[#15130F] px-2.5 text-[11.5px] font-bold text-[#FFD599]">
            <Gem className="size-3" /> Peça única
          </span>
          {negotiating ? (
            <span className="absolute top-3 right-3 inline-flex h-7 items-center gap-1.5 rounded-full bg-white px-2.5 text-[11.5px] font-bold text-[#15130F]">
              <span className="size-1.5 rounded-full bg-[#E8913A]" aria-hidden /> Negociando
            </span>
          ) : null}
        </span>
        <span className={cn("flex flex-1 flex-col", compact ? "px-3 pt-3 tab:px-4 tab:pt-4" : "px-4 pt-4")}>
          <span className="truncate text-[11.5px] font-semibold tracking-[0.14em] text-[#8C8C8C] uppercase">{item.brand ?? "Orium"}</span>
          <span className={cn("mt-1 line-clamp-2 leading-[1.15] font-bold tracking-[-0.02em] text-white", compact ? "text-[16px] tab:text-[19px]" : "text-[19px]")}>{productTitle(item.name)}</span>
          {fill != null ? (
            <span className="mt-3 block">
              <span className="flex items-baseline justify-between text-[12.5px] text-[#A9A9A9]">
                <span>{lvl.label}</span>
                <b className="font-bold text-white tabular-nums">{lvl.ml != null ? `${lvl.ml} ml` : `~${fill}%`}</b>
              </span>
              <FillBar value={fill} />
            </span>
          ) : (
            <span className="mt-2 text-[13px] text-[#A9A9A9]">{lvl.label}</span>
          )}
          {notes.length ? <span className={cn("mt-3 line-clamp-1 text-[13px] text-[#8C8C8C] capitalize", compact && "max-tab:hidden")}>{notes.slice(0, 3).join(" · ")}</span> : null}
        </span>
      </Link>
      <div className={compact ? "px-3 pt-3 pb-3 tab:px-4 tab:pt-4 tab:pb-4" : "px-4 pt-4 pb-4"}>
        {onOffer ? (
          <button
            type="button"
            onClick={onOffer}
            className={cn("press group flex w-full items-center justify-center gap-1.5 rounded-full bg-[#FFD599] font-bold text-[#15130F] transition-colors hover:bg-[#FFDDAA]", compact ? "h-11 text-[13.5px] tab:h-12 tab:text-[15px]" : "h-12 text-[15px]")}
          >
            {cta}
          </button>
        ) : (
          <Link
            to="/negociacao/$id"
            params={{ id: item.id }}
            preload="intent"
            className={cn("press group flex w-full items-center justify-center gap-1.5 rounded-full bg-[#FFD599] font-bold text-[#15130F] transition-colors hover:bg-[#FFDDAA]", compact ? "h-11 text-[13.5px] tab:h-12 tab:text-[15px]" : "h-12 text-[15px]")}
          >
            {cta}
          </Link>
        )}
      </div>
    </article>
  );
}

/** Barra "quanto ainda tem": enche da esquerda quando a vitrine aparece. */
export function FillBar({ value, big }: { value: number; big?: boolean }) {
  const [shown, setShown] = useState(false);
  const el = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const node = el.current;
    if (!node || typeof IntersectionObserver === "undefined") return setShown(true);
    const io = new IntersectionObserver(([e]) => {
      if (e?.isIntersecting) {
        setShown(true);
        io.disconnect();
      }
    });
    io.observe(node);
    return () => io.disconnect();
  }, []);
  return (
    <span
      ref={el}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
      aria-label="Quanto ainda tem no frasco"
      className={cn("relative mt-2 block overflow-hidden rounded-full bg-[#2E2E2E]", big ? "h-3" : "h-2")}
    >
      <span className="neg-fill absolute inset-y-0 left-0 block rounded-full bg-[#FFD599]" style={{ width: shown ? `${value}%` : "0%" }} />
    </span>
  );
}

function Arrow({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="press grid size-11 place-items-center rounded-full bg-[#1F1F1F] text-white transition-colors hover:bg-[#2A2A2A]"
    >
      {children}
    </button>
  );
}
