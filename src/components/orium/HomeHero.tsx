import { useEffect, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import posterImg from "@/assets/home-hero-poster.webp";
import posterWideImg from "@/assets/home-hero-poster-wide.webp";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { usePromotions } from "@/lib/use-promotions";
import { usePublicPricingSettings } from "@/lib/pricing-settings";
import { blackEndsAt, blackMaxPercent, runningBlack } from "@/lib/black";
import { priceUnit } from "@/lib/promotions";
import { brl, productTitle } from "@/lib/format";
import { BlackCountdown, BlackTag } from "@/components/orium/black/Black";

/**
 * Modo Black da abertura: liga sozinho enquanto houver campanha com "Black"
 * no nome em vigor e a chave do Admin (Precificação › Abertura da Home em
 * modo Black) estiver ligada — ela já vem ligada.
 */
function useHeroBlack() {
  const promotions = usePromotions();
  const { data: settings } = usePublicPricingSettings();
  const black = runningBlack(promotions);
  const on = settings?.black_hero !== false && black.length > 0;
  const ids = [...new Set(black.flatMap((p) => p.product_ids ?? []))].slice(0, 40);
  // o perfume do vídeo (Asad Bourbon) em destaque; sem ele, a maior oferta
  const { data: deal } = useQuery({
    queryKey: ["hero-black-deal", ids.join(",")],
    enabled: on && ids.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("products")
        .select("id, slug, canonical_name, brand, retail_price, in_stock")
        .in("id", ids)
        .eq("active", true);
      const rows = (data ?? [])
        .filter((r) => r.retail_price != null && r.in_stock !== false)
        .map((r) => ({ ...r, priced: priceUnit(Number(r.retail_price), promotions, { productId: r.id, variant: "FULL" }) }))
        .filter((r) => r.priced.percent > 0);
      const asad = rows.find((r) => /asad/i.test(r.canonical_name ?? "") && /bourbon/i.test(r.canonical_name ?? ""));
      return asad ?? rows.sort((a, b) => b.priced.percent - a.priced.percent)[0] ?? null;
    },
  });
  return {
    on,
    pct: Math.round(blackMaxPercent(black)),
    endsAt: blackEndsAt(black),
    title: black.some((p) => /esquenta/i.test(p.name)) ? "Esquenta Black" : /friday/i.test(black[0]?.name ?? "") ? "Black Friday" : "Black November",
    name: black[0]?.name ?? "Black November",
    deal: deal ?? null,
  };
}

/** Rola até a vitrine da Black (logo abaixo da abertura). */
function goToBlack(fallback: () => void) {
  const el = document.getElementById("black-november");
  if (!el) return fallback();
  el.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
}

/** Vídeo do Asad Bourbon com grãos de cacau caindo — 8s, loop contínuo. */
const HERO_VIDEO = "/videos/asad-hero.mp4";
/** Mesma cena em 16:9 para tablet e computador. */
const HERO_VIDEO_WIDE = "/videos/asad-hero-wide.mp4";
/** A partir do tablet a Home usa o vídeo horizontal. */
const WIDE_QUERY = "(min-width: 600px)";

/**
 * Abertura da Home — vídeo em tela cheia, em loop, por trás do header de vidro.
 *
 * - O poster (primeiro quadro do vídeo) aparece na hora; o vídeo entra por
 *   cima com fade quando realmente começa a tocar, sem flash preto.
 * - Pausa fora da tela e com a aba em segundo plano (bateria e dados).
 * - O vídeo é o cenário da marca: toca sempre, em loop, sem som.
 */
export function HomeHero({ onExplore }: { onExplore: () => void }) {
  const section = useRef<HTMLElement | null>(null);
  const black = useHeroBlack();
  const video = useRef<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(false);
  /**
   * O vídeo só começa a baixar depois que a página terminou de carregar: o
   * poster (mesmo quadro) é o que aparece primeiro, e os 1,4 MB do vídeo não
   * disputam banda com as fotos do catálogo. Modo economia de dados: só o poster.
   */
  const [videoOn, setVideoOn] = useState(false);
  // celular: vídeo vertical · tablet e computador: o horizontal (decidido ao montar o vídeo)
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(WIDE_QUERY);
    const sync = () => setWide(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  const src = wide ? HERO_VIDEO_WIDE : HERO_VIDEO;
  // trocou de vídeo (girou o tablet): o novo entra com o mesmo fade
  useEffect(() => setPlaying(false), [src]);

  useEffect(() => {
    const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    if (conn?.saveData) return;
    let done = false;
    const start = () => {
      if (done) return;
      done = true;
      setVideoOn(true);
    };
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
    const idle = () => (w.requestIdleCallback ? w.requestIdleCallback(start, { timeout: 900 }) : window.setTimeout(start, 200));
    if (document.readyState === "complete") idle();
    else window.addEventListener("load", idle, { once: true });
    // rede lenta não pode segurar o vídeo para sempre
    const cap = window.setTimeout(start, 2500);
    return () => {
      done = true;
      window.removeEventListener("load", idle);
      window.clearTimeout(cap);
    };
  }, []);

  /**
   * Celular: o vídeo ocupa exatamente a tela visível ao abrir (com as barras do
   * navegador), em qualquer aparelho — sem faixa preta embaixo e sem limite de
   * altura. Medido uma vez e só refeito quando a largura muda (girou a tela),
   * para o vídeo não "pular" quando a barra do navegador some ao rolar.
   */
  useEffect(() => {
    const root = document.documentElement;
    let w = 0;
    const set = () => {
      if (window.innerWidth === w) return;
      w = window.innerWidth;
      root.style.setProperty("--hero-vh", `${window.innerHeight}px`);
    };
    set();
    window.addEventListener("resize", set);
    window.addEventListener("orientationchange", set);
    return () => {
      window.removeEventListener("resize", set);
      window.removeEventListener("orientationchange", set);
    };
  }, []);

  // a barra inferior acompanha a saída do cliente desta tela
  useEffect(() => {
    window.dispatchEvent(new Event("orium:hero-change"));
    return () => {
      window.dispatchEvent(new Event("orium:hero-change"));
    };
  }, []);

  useEffect(() => {
    const v = video.current;
    const el = section.current;
    if (!videoOn || !v || !el) return;

    /*
     * O HTML vem do servidor e o vídeo pode começar a tocar ANTES do React
     * assumir a página — o evento "playing" se perdia e o vídeo ficava
     * invisível atrás do poster. Agora os eventos são ligados aqui e o
     * estado atual é conferido na hora.
     */
    const markPlaying = () => {
      if (!v.paused && v.readyState >= 2) setPlaying(true);
    };
    v.addEventListener("playing", markPlaying);
    v.addEventListener("timeupdate", markPlaying);

    // iOS/Chrome só tocam sozinho com mudo + inline definidos como propriedade
    v.muted = true;
    v.defaultMuted = true;
    v.playsInline = true;
    v.setAttribute("muted", "");
    v.setAttribute("playsinline", "");
    v.setAttribute("webkit-playsinline", "");

    let inView = true;
    const tryPlay = () => {
      const p = v.play();
      if (p) p.then(markPlaying).catch(() => {});
    };
    const sync = () => {
      if (inView && document.visibilityState === "visible") tryPlay();
      else v.pause();
    };

    // modo economia / autoplay bloqueado: o primeiro toque ou rolagem destrava
    const unlock = () => {
      if (inView) tryPlay();
    };
    const unlockEvents = ["touchstart", "pointerdown", "scroll", "keydown"] as const;
    for (const ev of unlockEvents) window.addEventListener(ev, unlock, { passive: true, once: true });

    const io =
      typeof IntersectionObserver !== "undefined"
        ? new IntersectionObserver(
            ([entry]) => {
              inView = !!entry?.isIntersecting;
              sync();
            },
            { threshold: 0.02 },
          )
        : null;
    io?.observe(el);
    document.addEventListener("visibilitychange", sync);
    if (v.readyState === 0) v.load();
    sync();
    markPlaying();

    return () => {
      io?.disconnect();
      document.removeEventListener("visibilitychange", sync);
      v.removeEventListener("playing", markPlaying);
      v.removeEventListener("timeupdate", markPlaying);
      for (const ev of unlockEvents) window.removeEventListener(ev, unlock);
    };
  }, [videoOn, src]);

  return (
    <section
      ref={section}
      data-home-hero
      aria-label={black.on ? black.title : "Encontre aqui o seu próximo perfume"}
      className="hero-in relative isolate mt-[calc(-53px-env(safe-area-inset-top))] h-[max(560px,var(--hero-vh,100dvh))] w-full overflow-hidden rounded-b-[30px] bg-[#2A160C] text-white tab:h-[clamp(560px,78svh,760px)] tab:rounded-b-[36px] lg:mt-[-69px] lg:h-[clamp(620px,calc(100svh-24px),880px)] lg:rounded-b-[44px]"
    >
      {/* primeiro quadro: aparece na hora e fica como base do vídeo (vertical no celular, 16:9 do tablet em diante) */}
      <picture>
        <source media={WIDE_QUERY} srcSet={posterWideImg} width={1080} height={606} />
        <img
          src={posterImg}
          alt=""
          aria-hidden
          width={720}
          height={1280}
          fetchPriority="high"
          decoding="async"
          className="hero-depth absolute inset-0 -z-20 size-full object-cover object-[50%_18%] tab:object-[50%_42%]"
        />
      </picture>
      {videoOn ? (
        <video
          key={src}
          ref={video}
          muted
          loop
          playsInline
          autoPlay
          preload="auto"
          aria-hidden
          tabIndex={-1}
          poster={wide ? posterWideImg : posterImg}
          className={cn(
            "hero-depth absolute inset-0 -z-20 size-full object-cover object-[50%_18%] transition-opacity duration-700 ease-[var(--ease-orium)] tab:object-[50%_42%]",
            playing ? "opacity-100" : "opacity-0",
          )}
        >
          <source src={src} type="video/mp4" />
        </video>
      ) : null}

      {/* topo escurecido para o header respirar sobre o vídeo */}
      <div aria-hidden className="absolute inset-x-0 top-0 -z-10 h-56 bg-gradient-to-b from-black/45 to-transparent" />
      {/* base escurecida só onde o texto mora */}
      <div aria-hidden className="absolute inset-x-0 bottom-0 -z-10 h-[46%] bg-gradient-to-t from-[#101010]/80 via-[#101010]/35 to-transparent tab:h-[60%]" />
      {/* modo Black: base mais escura para o título grande e o botão */}
      {black.on ? (
        <div aria-hidden className="absolute inset-x-0 bottom-0 -z-10 h-[64%] bg-gradient-to-t from-black/90 via-black/55 to-transparent" />
      ) : null}
      {/* tablet e computador: o texto fica à esquerda, então a sombra vem da esquerda */}
      <div aria-hidden className="absolute inset-y-0 left-0 -z-10 hidden w-[62%] bg-gradient-to-r from-black/55 via-black/20 to-transparent tab:block" />

      {black.on ? (
        <>
          {/* oferta do vídeo: cartão discreto no alto, longe do texto */}
          {black.deal ? (
            <Link
              to="/perfume/$slug"
              params={{ slug: black.deal.slug }}
              className="hero-line press absolute right-[var(--page-gutter)] bottom-16 z-10 hidden w-[230px] rounded-[20px] bg-black/75 p-4 text-left ring-1 ring-white/15 [animation-delay:240ms] tab:block lg:bottom-[clamp(4rem,9vh,6.5rem)] lg:w-[250px]"
              aria-label={`${productTitle(black.deal.canonical_name ?? "")}: de ${brl(black.deal.priced.basePrice)} por ${brl(black.deal.priced.finalPrice)}`}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="text-[10.5px] font-bold tracking-[0.08em] text-[#A9A9A9] uppercase">No vídeo</span>
                <span className="rounded-full bg-[#FFD599] px-2 py-0.5 text-[11.5px] font-black text-black tabular-nums">
                  -{Math.round(black.deal.priced.percent)}%
                </span>
              </span>
              <span className="mt-2 block truncate text-[14px] leading-tight font-bold text-white tab:text-[15.5px]">
                {productTitle(black.deal.canonical_name ?? "")}
              </span>
              <span className="mt-1.5 block text-[12px] text-[#8C8C8C] tabular-nums">
                de <span className="line-through">{brl(black.deal.priced.basePrice)}</span>
              </span>
              <span className="block text-[21px] leading-none font-extrabold tracking-[-0.02em] text-white tabular-nums tab:text-[24px]">
                {brl(black.deal.priced.finalPrice)}
              </span>
            </Link>
          ) : null}

          <div className="hero-copy-depth shell absolute inset-x-0 bottom-0 pb-[calc(3.25rem+env(safe-area-inset-bottom))] tab:pb-16 lg:pb-[clamp(4rem,9vh,6.5rem)]">
            <BlackTag promotion={{ name: black.name }} size="md" className="hero-line" />
            <h1 className="hero-line mt-3 max-w-[10em] text-[46px] leading-[0.95] font-black tracking-[-0.045em] text-balance uppercase [animation-delay:70ms] [text-shadow:0_2px_24px_rgba(0,0,0,0.35)] tab:mt-4 tab:text-[72px] lg:text-[clamp(80px,7vw,112px)]">
              {black.title}
            </h1>
            <p className="hero-line mt-3 max-w-[22em] text-[16.5px] leading-snug font-semibold text-[#E5E5E5] [animation-delay:140ms] tab:mt-4 tab:text-[19px]">
              {black.pct > 0 ? (
                <>
                  Até <span className="font-black text-[#FFD599]">{black.pct}% OFF</span> em perfumes árabes originais.
                </>
              ) : (
                "Preços de Black em perfumes árabes originais."
              )}
            </p>
            {black.endsAt ? (
              <BlackCountdown endsAt={black.endsAt} label="Acaba em" className="hero-line mt-2 [animation-delay:180ms] tab:text-[13px]" />
            ) : null}
            {/* celular: a oferta do vídeo numa linha, entre o texto e o botão */}
            {black.deal ? (
              <Link
                to="/perfume/$slug"
                params={{ slug: black.deal.slug }}
                className="hero-line press mt-4 flex w-full max-w-[360px] items-center gap-3 rounded-[16px] bg-black/70 px-3.5 py-2.5 ring-1 ring-white/12 [animation-delay:200ms] tab:hidden"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-bold text-white">{productTitle(black.deal.canonical_name ?? "")}</span>
                  <span className="block text-[12px] text-[#A9A9A9] tabular-nums">
                    de <span className="line-through">{brl(black.deal.priced.basePrice)}</span> por{" "}
                    <span className="font-extrabold text-white">{brl(black.deal.priced.finalPrice)}</span>
                  </span>
                </span>
                <span className="shrink-0 rounded-full bg-[#FFD599] px-2.5 py-1 text-[12.5px] font-black text-black tabular-nums">
                  -{Math.round(black.deal.priced.percent)}%
                </span>
              </Link>
            ) : null}
            <div className="hero-line mt-4 [animation-delay:240ms] tab:mt-7">
              <button
                type="button"
                onClick={() => goToBlack(onExplore)}
                className="press group inline-flex h-[56px] w-full max-w-[360px] items-center justify-between gap-3 rounded-full bg-[#FFD599] pr-2 pl-6 text-[17px] font-extrabold text-black transition-colors hover:bg-[#FFDDAA] tab:h-[60px] tab:w-auto tab:min-w-[320px] tab:text-[18px]"
              >
                Ver ofertas da Black
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-black text-[#FFD599] transition-transform duration-300 group-hover:translate-x-0.5 tab:size-11">
                  <ArrowRight className="size-[18px]" strokeWidth={2.4} aria-hidden />
                </span>
              </button>
            </div>
          </div>
        </>
      ) : (
      <div className="hero-copy-depth shell absolute inset-x-0 bottom-0 pb-[calc(4rem+env(safe-area-inset-bottom))] tab:pb-16 lg:pb-[clamp(4rem,9vh,6.5rem)]">
          <h1 className="hero-line max-w-[11.5em] text-[32px] leading-[1.22] font-bold tracking-[-0.02em] text-balance [text-shadow:0_2px_24px_rgba(0,0,0,0.35)] tab:text-[52px] tab:leading-[1.06] tab:tracking-[-0.03em] lg:text-[clamp(56px,5.2vw,76px)]">
            Encontre aqui o seu próximo perfume.
          </h1>
          <p className="hero-line mt-1.5 text-[16px] font-medium text-[#E5E5E5] [animation-delay:90ms] tab:mt-4 tab:text-[18px] lg:text-[19px]">
            Asad Bourbon · Lattafa
          </p>
          <div className="hero-line mt-[18px] [animation-delay:170ms] tab:mt-7 lg:mt-9">
            <button
              type="button"
              onClick={onExplore}
              className="press inline-flex h-[47px] w-full max-w-[302px] items-center justify-center gap-2 rounded-full bg-[#FFD599] text-[16px] font-bold text-black transition-colors hover:bg-[#FFDDAA] tab:h-[54px] tab:w-auto tab:px-9 tab:text-[17px]"
            >
              Explorar perfumes
              <ArrowRight className="size-[17px] shrink-0" strokeWidth={2.2} aria-hidden />
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
