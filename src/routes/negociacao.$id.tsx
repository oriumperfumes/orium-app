import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link, useCanGoBack, useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { ArrowRight, Camera, ChevronLeft, Gem, Handshake, MessageCircle, Share, ShieldCheck, Store, Truck } from "lucide-react";
import { productTitle } from "@/lib/format";
import { negotiationLevel, negotiationPhoto, useNegotiationItem } from "@/lib/negotiation";
import { SiteHeader } from "@/components/orium/SiteHeader";
import { SiteFooter } from "@/components/orium/SiteFooter";
import { ProductScent } from "@/components/orium/ProductScent";
import { OtherNegotiations } from "@/components/orium/OtherNegotiations";
import { PhotoFade } from "@/components/orium/PhotoFade";
import { FillBar } from "@/components/orium/NegotiationShowcase";
import { NegotiationContactSheet } from "@/components/orium/NegotiationContactSheet";
import { track } from "@/lib/analytics";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/negociacao/$id")({
  head: () => ({
    meta: [
      { title: "Negociação · Orium Perfumes" },
      {
        name: "description",
        content: "Perfume deslacrado da coleção Orium, peça única, para negociar direto pelo WhatsApp.",
      },
      { property: "og:title", content: "Negociação · Orium Perfumes" },
      { property: "og:description", content: "Peça única da coleção Orium. Consulte o valor pelo WhatsApp." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: NegotiationDetail,
});

/* ------------------------------------------------------------------ *
 * PÁGINA DE UM PERFUME EM NEGOCIAÇÃO — mesmo esqueleto da página de
 * perfume do catálogo (foto no quadro branco à esquerda, identidade e
 * compra à direita, aroma abaixo), com o que faz querer:
 *  - "Peça única" e a situação ao vivo (disponível / alguém negociando);
 *  - quanto ainda tem no frasco (ml de verdade, barra que enche);
 *  - o cartão da oferta: preço a combinar + UM botão "Fazer minha oferta"
 *    (nome → WhatsApp), que também fica preso embaixo no celular;
 *  - confiança (original, foto real, loja física) e como funciona;
 *  - notas e acordes (mesmo bloco do catálogo) e outras peças.
 * Nada de número inventado: a urgência é real (só existe um).
 * ------------------------------------------------------------------ */

function NegotiationDetail() {
  const { id } = Route.useParams();
  const { data: item, isLoading } = useNegotiationItem(id);
  const [contact, setContact] = useState(false);
  const ctaRef = useRef<HTMLButtonElement | null>(null);
  const [ctaVisible, setCtaVisible] = useState(true);

  // a barra de baixo (celular) só aparece quando o botão principal sai da tela
  useEffect(() => {
    const el = ctaRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setCtaVisible(!!e?.isIntersecting), { rootMargin: "0px 0px -80px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [item?.id]);

  const offer = (where: string) => {
    if (!item) return;
    track("discovery_clicked", { meta: { card: "negociacao_oferta", id: item.id, where } });
    setContact(true);
  };

  if (isLoading) {
    return (
      <Shell>
        <div className="page-x mx-auto max-w-xl pt-2 md:shell md:grid md:max-w-none md:grid-cols-2 md:gap-8 md:pt-4 lg:gap-14 lg:pt-8">
          <div className="aspect-square w-full skeleton rounded-[30px]" />
          <div>
            <div className="mt-6 h-4 w-24 skeleton rounded-full md:mt-0" />
            <div className="mt-3 h-9 w-2/3 skeleton rounded-full" />
            <div className="mt-8 h-[180px] skeleton rounded-[24px]" />
          </div>
        </div>
      </Shell>
    );
  }

  if (!item) {
    return (
      <Shell>
        <div className="page-x mx-auto max-w-lg py-16 text-center">
          <span className="mx-auto grid size-16 place-items-center rounded-full bg-[#1A1A1A] text-[#FFD599]">
            <Gem className="size-7" />
          </span>
          <h1 className="mt-5 text-[26px] font-bold tracking-[-0.02em] text-white">Essa peça já foi negociada</h1>
          <p className="mt-2 text-[15px] text-[#A9A9A9]">Ela não está mais na vitrine. Veja as outras peças únicas que ainda estão disponíveis.</p>
          <Link to="/" className="press mt-6 inline-flex h-12 items-center justify-center rounded-full bg-[#FFD599] px-6 text-[15px] font-bold text-[#15130F]">
            Ver a Negociação
          </Link>
        </div>
      </Shell>
    );
  }

  const photo = negotiationPhoto(item.image_url);
  const lvl = negotiationLevel(item);
  const negotiating = item.status === "NEGOTIATING";
  const title = productTitle(item.name);

  return (
    <Shell title={title}>
      <div className="page-x mx-auto max-w-xl md:max-w-none md:p-0">
        <div className="md:shell md:grid md:grid-cols-2 md:items-start md:gap-8 md:pt-4 lg:grid-cols-[minmax(0,1.08fr)_minmax(0,1fr)] lg:gap-14 lg:pt-8 wide:gap-20">
          {/* ---------- foto no quadro branco ---------- */}
          <div className="md:sticky md:top-[68px] lg:top-[92px]">
            <div className="pd-photo">
              <div className="relative aspect-square w-full overflow-hidden rounded-[30px] bg-white">
                {photo ? (
                  <PhotoFade src={photo} alt={`${item.brand ?? "Orium"} ${item.name}`} priority />
                ) : (
                  <div className="grid size-full place-items-center text-[#8C8C8C]">
                    <Gem className="size-10" strokeWidth={1.4} />
                  </div>
                )}
                <span className="absolute top-4 left-4 inline-flex h-9 items-center gap-1.5 rounded-full bg-[#15130F] px-4 text-[13px] font-bold tracking-wide text-[#FFD599]">
                  <Gem className="size-4" /> Peça única
                </span>
              </div>
            </div>
          </div>

          <div className="min-w-0 md:pt-1 lg:pt-2">
            {/* ---------- identidade ---------- */}
            <div className="pd-in mt-6 md:mt-0">
              <p className="flex items-center gap-2 text-[13px] font-semibold tracking-[0.14em] text-[#FFD599] uppercase">
                <span className={cn("relative size-2 rounded-full ui-beacon", negotiating ? "bg-[#E8913A]" : "bg-[#7FCF9F]")} aria-hidden />
                {negotiating ? "Em negociação agora" : "Disponível para negociar"}
              </p>
              <p className="mt-3 text-[18px] font-semibold text-[#9E9E9E]">{item.brand ?? "Orium"}</p>
              <h1 className="mt-0.5 text-[32px] leading-[1.12] font-bold tracking-[-0.03em] text-white lg:text-[clamp(38px,3.4vw,48px)] lg:leading-[1.06]">
                {title}
              </h1>
              <p className="mt-1.5 text-[16px] font-semibold text-[#878787]">
                {[item.volume_ml ? `Frasco de ${item.volume_ml} ml` : null, "Deslacrado", "Coleção Orium"].filter(Boolean).join(" · ")}
              </p>
            </div>

            {/* ---------- quanto ainda tem ---------- */}
            {lvl.pct != null ? (
              <div className="pd-in mt-6 rounded-[24px] bg-[#1A1A1A] p-5" style={{ animationDelay: "60ms" }}>
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <p className="text-[14px] font-semibold text-[#A9A9A9]">Quanto ainda tem</p>
                    <p className="mt-1 text-[17px] font-bold text-white">{lvl.label}</p>
                  </div>
                  <p className="text-right text-[14px] text-[#A9A9A9] tabular-nums">
                    {lvl.ml != null ? (
                      <>
                        <span className="block text-[30px] leading-none font-bold tracking-[-0.03em] text-white">{lvl.ml} ml</span>
                        de {item.volume_ml} ml
                      </>
                    ) : (
                      <span className="block text-[30px] leading-none font-bold tracking-[-0.03em] text-white">~{lvl.pct}%</span>
                    )}
                  </p>
                </div>
                <FillBar value={lvl.pct} big />
              </div>
            ) : null}

            {/* ---------- a oferta ---------- */}
            <div className="pd-in mt-3 rounded-[24px] bg-[#1A1A1A] p-5" style={{ animationDelay: "120ms" }}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[14px] font-semibold text-[#A9A9A9]">Preço</p>
                  <p className="mt-1 text-[26px] leading-tight font-bold tracking-[-0.03em] text-[#FFD599]">A combinar</p>
                </div>
                <span className="grid size-11 place-items-center rounded-full bg-[#232323] text-[#FFD599]">
                  <Handshake className="size-5" />
                </span>
              </div>
              <p className="mt-2 text-[14.5px] leading-snug text-[#A9A9A9]">
                Chame no WhatsApp e a Orium te passa o valor desta peça. Dependendo dela, dá para negociar um preço mais baixo.
              </p>
              {negotiating ? (
                <p className="mt-4 rounded-[16px] bg-[#2A2014] px-4 py-3 text-[14px] leading-snug text-[#F2C46D]">
                  Alguém já está conversando sobre este. Ainda dá tempo de consultar o valor.
                </p>
              ) : (
                <p className="mt-4 rounded-[16px] bg-[#232323] px-4 py-3 text-[14px] leading-snug text-[#D4D4D4]">
                  Só existe um. Quando alguém fechar, ele sai da loja.
                </p>
              )}
              <button
                ref={ctaRef}
                type="button"
                onClick={() => offer("pagina")}
                className="neg-cta-pulse press group mt-4 flex h-[58px] w-full items-center justify-center gap-2.5 rounded-full bg-[#FFD599] text-[17px] font-bold text-[#15130F] transition-colors hover:bg-[#FFDDAA]"
              >
                <MessageCircle className="size-5" strokeWidth={2.4} />
                Consultar valor
                <ArrowRight className="size-5 transition-transform duration-300 group-hover:translate-x-1" strokeWidth={2.4} />
              </button>
              <p className="mt-3 text-center text-[13px] text-[#8C8C8C]">Sem cadastro · sem compromisso</p>
            </div>

            {/* ---------- confiança ---------- */}
            <ul className="pd-in mt-3 grid grid-cols-3 gap-2" style={{ animationDelay: "180ms" }}>
              {[
                { icon: <ShieldCheck />, t: "Original da Orium" },
                { icon: <Camera />, t: "Foto real do frasco" },
                { icon: <Store />, t: "Loja em Itaguaí" },
              ].map((x) => (
                <li key={x.t} className="flex flex-col items-start gap-2 rounded-[18px] bg-[#1A1A1A] p-3.5 text-[13px] leading-snug font-semibold text-[#D4D4D4] [&_svg]:size-[19px] [&_svg]:text-[#FFD599]">
                  {x.icon}
                  {x.t}
                </li>
              ))}
            </ul>

            {/* ---------- sobre este frasco ---------- */}
            {item.description ? (
              <div className="pd-in mt-6" style={{ animationDelay: "220ms" }}>
                <p className="text-[13px] font-semibold tracking-[0.14em] text-[#8C8C8C] uppercase">Sobre este frasco</p>
                <p className="mt-2 text-[16px] leading-relaxed whitespace-pre-line text-[#D4D4D4]">{item.description}</p>
              </div>
            ) : null}

            {/* ---------- como funciona ---------- */}
            <div className="pd-in mt-6 rounded-[24px] border border-white/[0.07] p-5" style={{ animationDelay: "260ms" }}>
              <p className="text-[16px] font-bold text-white">Como funciona</p>
              <ol className="mt-4 space-y-4">
                {[
                  { icon: <MessageCircle />, t: "Consulte o valor", d: "Seu nome e pronto: a Orium te diz no WhatsApp quanto está saindo." },
                  { icon: <Handshake />, t: "Negocie", d: "Dependendo da peça, dá para baixar o valor. Vocês fecham o preço juntos." },
                  { icon: <Truck />, t: "Receba ou retire", d: "Entrega combinada ou retirada na loja em Itaguaí." },
                ].map((s, i) => (
                  <li key={s.t} className="flex gap-3">
                    <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[#232323] text-[#FFD599] [&_svg]:size-4">{s.icon}</span>
                    <span>
                      <span className="block text-[15px] font-bold text-white">
                        {i + 1}. {s.t}
                      </span>
                      <span className="mt-0.5 block text-[14px] leading-snug text-[#A9A9A9]">{s.d}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>

        {/* ---------- aroma e outras peças ---------- */}
        <div className="md:shell lg:mt-8">
          {item.product_id ? <ProductScent productId={item.product_id} /> : null}
          <OtherNegotiations currentId={item.id} />
        </div>
      </div>

      {/* celular: o botão fica preso embaixo quando o principal sai da tela */}
      <div
        className={cn(
          "fixed inset-x-0 bottom-0 z-40 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] transition-[transform,opacity] duration-300 ease-[var(--ease-orium)] lg:hidden",
          ctaVisible ? "pointer-events-none translate-y-4 opacity-0" : "translate-y-0 opacity-100",
        )}
      >
        <button
          type="button"
          tabIndex={ctaVisible ? -1 : 0}
          onClick={() => offer("barra")}
          className="press mx-auto flex h-14 w-full max-w-lg items-center gap-3 rounded-full bg-[#FFD599] pr-2 pl-5 text-[#15130F] shadow-[0_18px_40px_-12px_rgba(0,0,0,0.8)]"
        >
          <span className="min-w-0 flex-1 truncate text-left text-[15px] font-bold">Consultar valor · {title}</span>
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[#15130F] text-[#FFD599]">
            <MessageCircle className="size-[18px]" />
          </span>
        </button>
      </div>

      <NegotiationContactSheet item={item} open={contact} onOpenChange={setContact} />
    </Shell>
  );
}

/** Moldura da página: mesma navegação da loja (computador) e barra própria (celular). */
function Shell({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <div className="min-h-screen bg-background">
      <SiteHeader className="hidden lg:block" />
      <TopBar title={title} />
      <main className="pb-[calc(6rem+env(safe-area-inset-bottom))] lg:pb-28">{children}</main>
      <div className="hidden lg:block">
        <SiteFooter />
      </div>
    </div>
  );
}

function TopBar({ title }: { title?: string | undefined }) {
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const share = async () => {
    const url = `${window.location.origin}${window.location.pathname}`;
    const text = title ? `Olha essa peça única na Orium: ${title}` : "Olha essa peça única na Orium";
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: title ?? "Orium", text, url });
        return;
      } catch (e) {
        if ((e as DOMException)?.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copiado", { description: "É só colar no WhatsApp ou onde quiser.", duration: 2200 });
    } catch {
      toast("Copie o link", { description: url, duration: 6000 });
    }
  };
  return (
    <header data-site-header className="header-safe sticky top-0 z-40 bg-[#0A0A0A] lg:hidden">
      <div className="shell flex h-[52px] items-center">
        <button
          type="button"
          onClick={() => (canGoBack ? router.history.back() : void router.navigate({ to: "/" }))}
          className="press -ml-2.5 inline-flex h-10 items-center gap-1 rounded-full pr-3 pl-1.5 text-[16px] font-semibold text-white"
        >
          <ChevronLeft className="size-[22px]" strokeWidth={2.4} />
          Voltar
        </button>
        <button type="button" onClick={() => void share()} aria-label="Compartilhar" className="press -mr-2.5 ml-auto grid size-10 place-items-center rounded-full text-white hover:bg-white/10">
          <Share className="size-[19px]" strokeWidth={2.1} />
        </button>
      </div>
    </header>
  );
}

