import { imgSrcSet, imgVariant, isOriumPhoto } from "@/lib/product-img";
import { SiteHeader } from "@/components/orium/SiteHeader";
import { SiteFooter } from "@/components/orium/SiteFooter";
import type { DecantMl } from "@/lib/decants";
import { createFileRoute, Link, useCanGoBack, useRouter } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { withQueryTimeout } from "@/lib/request-timeout";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, MessageCircle, Share, ShoppingBag } from "lucide-react";
import { toast } from "sonner";
import { registerCartTarget } from "@/lib/fly-to-cart";
import { supabase } from "@/integrations/supabase/client";
import { StockBadge } from "@/components/orium/badges";
import { isBlack } from "@/lib/black";
import type { CatalogProduct } from "@/components/orium/ProductCard";
import { usePromotionsResolved } from "@/lib/use-promotions";
import { matches, priceUnit } from "@/lib/promotions";
import { useFavorites } from "@/lib/favorites";
import { IconHeart } from "@/components/orium/NavIcons";
import { StockAlertCard } from "@/components/orium/StockAlertCard";
import { cn } from "@/lib/utils";
import { productTitle } from "@/lib/format";
import { useCart } from "@/lib/cart";
import { usePriceView } from "@/lib/decant-size";
import { canDecant, canFullBottle } from "@/lib/decants";
import { logProductView } from "@/lib/product-views";
import { getProductPreview } from "@/lib/product-preview";
import { useRouteMotion } from "@/lib/route-motion";
import { SimilarPerfumes } from "@/components/orium/SimilarPerfumes";
import { usePublicPricingSettings } from "@/lib/pricing-settings";
import { AdminInternalSection } from "@/components/orium/AdminInternalSection";
import { HelpChooseButton } from "@/components/orium/HelpChooseButton";
import { ProductPurchase, type BuyMode } from "@/components/orium/ProductPurchase";
import { consultLink, isOnRequest, useConsultIds } from "@/lib/price-on-request";
import { ProductScent } from "@/components/orium/ProductScent";
import { track, watchProductDwell } from "@/lib/analytics";

/**
 * Campos públicos do produto: nada de preços-base internos nem dados de
 * conferência de identidade, que ficam restritos à equipe.
 */
const PUBLIC_PRODUCT_COLUMNS =
  "id, slug, canonical_name, brand, brand_id, gender, gender_norm, concentration, volume_ml, image_url, image_urls, product_line, flanker, product_type, active, catalog_eligible, in_stock, stock_quantity, sale_mode, full_bottle_available, retail_price, wholesale_price, decant_available, decant_price_2ml, decant_price_5ml, decant_price_10ml, weight_g, height_cm, width_cm, length_cm, price_on_request, created_at, updated_at";

export const Route = createFileRoute("/perfume/$slug")({
  validateSearch: (search: Record<string, unknown>): { frasco?: number; ml?: number } => {
    const out: { frasco?: number; ml?: number } = {};
    if (Number(search['frasco']) === 1) out.frasco = 1;
    const ml = Number(search['ml']);
    if ([2, 5, 10].includes(ml)) out.ml = ml;
    return out;
  },

  head: ({ params }) => ({
    meta: [
      { title: `Perfume — Orium Perfumes` },
      { name: "description", content: "Detalhes do perfume no catálogo Orium Perfumes." },
      { property: "og:title", content: "Perfume — Orium Perfumes" },
      { property: "og:description", content: "Detalhes do perfume no catálogo Orium Perfumes." },
      { property: "og:type", content: "product" },
      { property: "og:url", content: `/perfume/${params.slug}` },
    ],
    links: [{ rel: "canonical", href: `/perfume/${params.slug}` }],
  }),
  component: ProductPage,
});

function ProductPage() {
  const { slug } = Route.useParams();
  const { frasco, ml } = Route.useSearch();
  return <ProductPageContent key={slug} slug={slug} frasco={frasco} ml={ml} />;
}

/**
 * A chave pelo slug remonta toda a experiência ao navegar pelas recomendações.
 * Assim nenhum estado do perfume anterior sobrevive ao primeiro render do novo.
 */
function ProductPageContent({
  slug,
  frasco,
  ml,
}: {
  slug: string;
  frasco: number | undefined;
  ml: number | undefined;
}) {
  const cart = useCart();
  const imgRef = useRef<HTMLDivElement | null>(null);
  const motion = useRouteMotion();
  /** null = ninguém tocou no seletor: vale a decisão automática deste perfume. */
  const [selectedPurchaseMode, setSelectedPurchaseMode] = useState<BuyMode | null>(null);
  /** O que o cliente estava vendo no catálogo: Frasco ou um tamanho de decant. */
  const catalogView = usePriceView();
  /** tamanho escolhido NESTA página — estado local, nunca vai para o catálogo */
  const [localDecantSize, setLocalDecantSize] = useState<DecantMl>(2);

  const { data: settings } = usePublicPricingSettings();

  /**
   * Primeiro frame instantâneo: começa com foto, marca, nome e preço que o card
   * já conhecia e completa com o banco assim que a resposta chega.
   */
  const { data, isLoading, isFetching, isError, refetch } = useQuery({
    queryKey: ["product", slug],
    retry: 1,
    placeholderData: () =>
      (getProductPreview(slug) as unknown as { id: string } | null) as never,
    queryFn: async ({ signal }) => {
      const { data, error } = (await withQueryTimeout(
        (requestSignal) => supabase
          .from("products")
          .select(PUBLIC_PRODUCT_COLUMNS)
          .eq("slug", slug)
          .eq("active", true)
          .abortSignal(requestSignal)
          .maybeSingle() as any,
        12_000,
        signal,
      )) as { data: any; error: any };
      if (error) throw error;
      return data;
    },
  });

  /**
   * "Perfume não encontrado" só aparece quando a consulta terminou de verdade.
   * Sem esse cuidado, o placeholder vazio (slug que não passou por um card)
   * marcava a busca como concluída e piscava o aviso antes do perfume abrir.
   */
  const showSkeleton = !data && !isError && (isLoading || isFetching);
  


  /**
   * Perfil olfativo REAL: chips e frase curta saem só dos acordes e da família
   * cadastrados. Sem dado, nada aparece — nunca inventamos característica.
   */
  const { data: profile } = useQuery({
    queryKey: ["product-profile", data?.id ?? ""],
    enabled: !!data?.id,
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const [accords, details] = await Promise.all([
        supabase
          .from("fragrance_accords")
          .select("accord_name, position")
          .eq("product_id", data!.id)
          .order("position", { ascending: true })
          .limit(3),
        supabase
          .from("fragrance_details")
          .select("olfactory_family, status, verified, locked")
          .eq("product_id", data!.id)
          .maybeSingle(),
      ]);
      const d = details.data;
      const trusted = !!d && (d.verified || d.locked || d.status === "completo" || d.status === "parcial");
      return {
        accords: ((accords.data ?? []).map((a) => a.accord_name).filter(Boolean) as string[]).slice(0, 3),
        family: trusted ? (d?.olfactory_family ?? null) : null,
      };
    },
  });

  const accords = profile?.accords ?? [];

  const minQty = settings?.wholesale_min_quantity ?? 6;
  const decantOk = canDecant(data);
  /** Produto "somente Decant" nunca oferece frasco completo. */
  const bottleOk = canFullBottle(data);

  /**
   * Acesso real: só conta quando a página do perfume abre de verdade.
   * O banco despreza repetições da mesma pessoa em 30 minutos.
   */
  useEffect(() => {
    if (!data?.id) return;
    logProductView(data.id);
    track("product_view", { productId: data.id, variant: decantOk && !bottleOk ? "DECANT" : "FULL" });
    return watchProductDwell(data.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.id]);

  const { promotions, ready: promoReady } = usePromotionsResolved();
  const fullPriced = priceUnit(Number(data?.retail_price ?? 0), promotions, {
    productId: data?.id ?? "",
    variant: "FULL",
  });

  /** Promoção exclusiva de decant deste perfume (abre em Decant, no tamanho anunciado). */
  const decantOnlyPromo =
    data
      ? promotions.find(
          (p) =>
            p.applies_to === "DECANT" &&
            matches(p, {
              productId: data.id,
              variant: "DECANT",
              decantMl: p.decant_sizes?.[0] ?? 2,
            }),
        ) ?? null
      : null;

  /**
   * Estado inicial decidido no próprio render, antes do seletor aparecer:
   * 1) promoção/link de frasco → Frasco; 2) promoção/link de decant → Decant;
   * 3) a seleção atual do catálogo (Frasco / 2ml / 5ml / 10ml);
   * 4) sem contexto nenhum → padrão.
   */
  const automaticPurchaseMode: BuyMode = !bottleOk && decantOk
    ? "decant"
    : !decantOk
      ? "bottle"
      : frasco === 1
      ? "bottle"
      : ml
        ? "decant"
        : fullPriced.promotion
          ? "bottle"
          : decantOnlyPromo
            ? "decant"
            : catalogView === "frasco"
              ? "bottle"
              : "decant";
  const effectivePurchaseMode: BuyMode = selectedPurchaseMode ?? automaticPurchaseMode;

  // Link/campanha de decant abre no tamanho anunciado — só nesta página, nunca no catálogo.
  const promoSize = decantOnlyPromo?.decant_sizes?.[0];
  const initialDecantSize: DecantMl | undefined =
    ml === 2 || ml === 5 || ml === 10 ? ml : promoSize === 2 || promoSize === 5 || promoSize === 10 ? promoSize : undefined;

  const showDecant = decantOk && (effectivePurchaseMode === "decant" || !bottleOk);

  // uma foto por perfume: a principal (sem carrossel nem bolinhas)
  const gallery = data?.image_url ? [data.image_url] : [];
  const genderLabel =
    data?.gender_norm === "MALE" ? "Masculino" : data?.gender_norm === "FEMALE" ? "Feminino" : data?.gender_norm === "UNISEX" ? "Unissex" : null;
  const meta = [data?.concentration, profile?.family, genderLabel].filter(Boolean).join(" · ");
  // perfume sob consulta, ou a loja inteira (Admin → Precificação)
  const onRequest = isOnRequest(data as never, useConsultIds());

  return (
    <div className="min-h-screen bg-background">
      {/* computador: a mesma navegação da loja; celular: barra própria do perfume */}
      <SiteHeader className="hidden lg:block" />
      <ProductTopBar
        productId={data?.id ?? null}
        name={data ? productTitle(data.canonical_name) : null}
        cartCount={cart.totalQuantity}
        onOpenCart={() => cart.setOpen(true)}
      />
      <main className="pb-[calc(7rem+env(safe-area-inset-bottom))] lg:pb-28">
        {showSkeleton ? (
          <div className="page-x mx-auto max-w-xl pt-2">
            <div className="aspect-square w-full skeleton rounded-[30px]" />
            <div className="mt-6 h-4 w-20 skeleton rounded-full" />
            <div className="mt-3 h-8 w-2/3 skeleton rounded-full" />
            <div className="mt-3 h-4 w-1/2 skeleton rounded-full" />
            <div className="mt-8 h-[124px] skeleton rounded-[20px]" />
          </div>
        ) : isError ? (
          <div className="page-x mx-auto max-w-md py-24 text-center" role="alert">
            <h1 className="text-[24px] font-bold tracking-[-0.02em] text-white">Não conseguimos abrir este perfume</h1>
            <p className="mt-3 text-[15px] leading-relaxed text-[#A9A9A9]">
              A conexão demorou mais que o esperado. Tente de novo em instantes.
            </p>
            <button
              type="button"
              className="press mt-6 inline-flex h-12 items-center rounded-full bg-[#FFD599] px-6 text-[15px] font-bold text-[#15130F]"
              onClick={() => void refetch()}
            >
              Tentar de novo
            </button>
            <Link to="/" className="mt-4 block text-[14px] font-semibold text-[#A9A9A9]">
              Voltar ao início
            </Link>
          </div>
        ) : !data ? (
          <div className="page-x py-28 text-center">
            <h1 className="text-[26px] font-bold tracking-[-0.02em] text-white">Perfume não encontrado</h1>
            <p className="mt-2 text-[15px] text-[#A9A9A9]">Ele pode ter saído do catálogo.</p>
            <Link
              to="/"
              search={{ ver: "catalogo" } as never}
              className="press mt-6 inline-flex h-12 items-center rounded-full bg-[#FFD599] px-6 text-[15px] font-bold text-[#15130F]"
            >
              Ver o catálogo
            </Link>
          </div>
        ) : (
          <div key={motion.key} className={cn(motion.className, "page-x mx-auto max-w-xl md:max-w-none md:p-0")}>
            <div className="md:shell md:grid md:grid-cols-2 md:items-start md:gap-8 md:pt-4 lg:grid-cols-[minmax(0,1.08fr)_minmax(0,1fr)] lg:gap-14 lg:pt-8 wide:gap-20">
            {/* ---------- foto no quadro branco (galeria quando houver mais de uma) ---------- */}
            <div className="md:sticky md:top-[68px] lg:top-[92px]">
              <ProductGallery
                imgRef={imgRef}
                images={gallery}
                alt={`${data.brand ?? ""} ${data.canonical_name}`}
                fallback={data.brand ?? ""}
              />
            </div>

            <div className="min-w-0 md:pt-1 lg:pt-2">
            {/* ---------- identidade ---------- */}
            <div className="pd-in mt-6 md:mt-0">
              {data.brand ? <p className="text-[18px] font-semibold text-[#9E9E9E]">{data.brand}</p> : null}
              <h1 className="mt-0.5 text-[32px] leading-[1.12] font-bold tracking-[-0.03em] text-white lg:text-[clamp(38px,3.4vw,48px)] lg:leading-[1.06]">
                {productTitle(data.canonical_name)}
              </h1>
              {meta ? <p className="mt-1.5 text-[16px] font-semibold text-[#878787]">{meta}</p> : null}
              <div className="mt-2.5">
                {bottleOk && !showDecant && fullPriced.saved > 0 ? (
                  <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[#FFD599]">
                    <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-[#FFD599]" />
                    {isBlack(fullPriced.promotion) ? "Desconto de Black já aplicado" : "Desconto já aplicado"}
                  </span>
                ) : (
                  <StockBadge inStock={data.in_stock} productId={data.id} />
                )}
              </div>
            </div>

            {/* ---------- como levar, preço e barra fixa ---------- */}
            {!promoReady ? (
              <div className="mt-8 space-y-3">
                <div className="h-[124px] skeleton rounded-[20px]" />
                <div className="h-12 skeleton rounded-full" />
              </div>
            ) : onRequest ? (
              <ConsultPanel product={data as any} />
            ) : (
              <ProductPurchase
                product={data as unknown as CatalogProduct}
                mode={showDecant ? "decant" : "bottle"}
                onModeChange={(m) => {
                  setSelectedPurchaseMode(m);
                  track(m === "decant" ? "decant_selected" : "bottle_selected", { productId: data.id });
                }}
                decantOk={decantOk}
                initialSize={initialDecantSize}
                onSizeChange={setLocalDecantSize}
                bottleOk={bottleOk}
                minQty={minQty}
                flyFrom={imgRef}
              />
            )}

            {!data.in_stock && !onRequest ? (
              <div className="mt-5">
                <StockAlertCard productId={data.id} name={data.canonical_name} />
              </div>
            ) : null}

            <HelpChooseButton
              productId={data.id}
              name={data.canonical_name}
              variant={showDecant ? "DECANT" : "FULL"}
              decantMl={showDecant ? localDecantSize : null}
            />

            <p className="mt-4 flex items-center justify-center gap-2 text-[12.5px] font-medium text-[#8C8C8C]">
              <span aria-hidden className="size-1 rounded-full bg-[#FFD599]" />
              Loja física em Itaguaí · Produtos 100% originais
            </p>

            <AdminInternalSection productId={data.id} name={productTitle(data.canonical_name)} />
            </div>
            </div>

            {/* Abaixo da dobra: entra só quando o cliente chega perto. */}
            <div className="md:shell lg:mt-8">
            <BelowFold>
              <ProductScent productId={data.id} />
              <SimilarPerfumes
                productId={data.id}
                brand={data.brand}
                type={data.product_type}
                minQty={minQty}
                decantMode={showDecant}
              />
            </BelowFold>
            </div>
          </div>
        )}
      </main>
      <div className="hidden lg:block">
        <SiteFooter />
      </div>
    </div>
  );
}

/** Copia texto com a API moderna e, se bloqueada, pelo método clássico. */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* bloqueado: tenta o método clássico */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none";
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/** Foto principal no quadro branco; com várias fotos, desliza para o lado. */
function ProductGallery({
  images,
  alt,
  fallback,
  imgRef,
}: {
  images: string[];
  alt: string;
  fallback: string;
  imgRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [at, setAt] = useState(0);
  const rail = useRef<HTMLDivElement | null>(null);
  const onScroll = () => {
    const el = rail.current;
    if (!el) return;
    setAt(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
  };
  return (
    <div className="pd-photo">
      <div ref={imgRef} className="pd-hero-tile relative aspect-square w-full overflow-hidden rounded-[30px] bg-white">
        {images.length ? (
          <div
            ref={rail}
            onScroll={onScroll}
            className="scrollbar-none flex size-full snap-x snap-mandatory overflow-x-auto overscroll-x-contain"
          >
            {images.map((src, i) => (
              <img
                key={src}
                src={imgVariant(src, "full") ?? src}
                srcSet={imgSrcSet(src)}
                sizes="(min-width: 640px) 560px, 100vw"
                alt={i === 0 ? alt : ""}
                width={900}
                height={900}
                loading={i === 0 ? "eager" : "lazy"}
                decoding="async"
                fetchPriority={i === 0 ? "high" : "auto"}
                // a versão do card (já no cache) segura o lugar até a foto grande chegar
                style={
                  i === 0 && isOriumPhoto(src)
                    ? {
                        backgroundImage: `url("${imgVariant(src, "card")}")`,
                        backgroundSize: "contain",
                        backgroundRepeat: "no-repeat",
                        backgroundPosition: "center",
                        backgroundOrigin: "content-box",
                      }
                    : undefined
                }
                className="size-full shrink-0 snap-center object-contain p-5"
              />
            ))}
          </div>
        ) : (
          <span className="grid size-full place-items-center px-6 text-center text-[28px] font-bold text-[#B1B1B1]">{fallback}</span>
        )}
      </div>
      {images.length > 1 ? (
        <div className="mt-3 flex justify-center gap-1.5" aria-hidden>
          {images.map((_, i) => (
            <span
              key={i}
              className={cn(
                "h-1.5 rounded-full transition-all duration-300 ease-[var(--ease-orium)]",
                i === at ? "w-5 bg-white" : "w-1.5 bg-white/25",
              )}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Topo da página do perfume (Figma): "‹ Voltar" à esquerda; compartilhar,
 * favoritar e sacola com contador à direita. Fundo da página; ao rolar,
 * vira a mesma barra preta do resto do app.
 */
function ProductTopBar({
  productId,
  name,
  cartCount,
  onOpenCart,
}: {
  productId: string | null;
  name: string | null;
  cartCount: number;
  onOpenCart: () => void;
}) {
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const { isFavorite, toggle } = useFavorites();
  const [scrolled, setScrolled] = useState(false);
  const fav = productId ? isFavorite(productId) : false;
  const [pop, setPop] = useState(0);
  // nesta página a sacola do topo é quem recebe a foto ao adicionar
  const bagRef = useCallback((el: HTMLButtonElement | null) => {
    if (el && !window.matchMedia("(min-width: 64rem)").matches) registerCartTarget(el);
  }, []);

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 6);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  const back = () => {
    if (canGoBack) router.history.back();
    else void router.navigate({ to: "/" });
  };
  /**
   * Compartilhar: menu nativo do celular quando existe; se o navegador não
   * deixar (computador, app dentro de outro app, preview), copia o link.
   * Nunca falha em silêncio — o cliente sempre recebe uma resposta.
   */
  const share = async () => {
    if (typeof window === "undefined") return;
    const url = `${window.location.origin}${window.location.pathname}`;
    const title = name ? `${name} na Orium` : "Orium Perfumes";
    const text = name ? `Olha esse perfume na Orium: ${name}` : "Olha esse perfume na Orium";
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title, text, url });
        return;
      } catch (e) {
        if ((e as DOMException)?.name === "AbortError") return; // o cliente fechou o menu
      }
    }
    if (await copyText(url)) {
      toast.success("Link copiado", { description: "É só colar no WhatsApp ou onde quiser.", duration: 2200 });
    } else {
      toast("Copie o link do perfume", { description: url, duration: 6000 });
    }
  };
  const icon = "press grid size-10 place-items-center rounded-full text-white transition-colors hover:bg-white/10";

  return (
    <header
      data-site-header
      className={cn(
        "header-safe sticky top-0 z-40 transition-[background-color,border-color] duration-300 lg:hidden",
        scrolled ? "border-b border-white/[0.06] bg-[#0A0A0A]" : "border-b border-transparent bg-[#0A0A0A]",
      )}
    >
      <div className="shell flex h-[52px] items-center">
        <button
          type="button"
          onClick={back}
          className="press -ml-2.5 inline-flex h-10 items-center gap-1 rounded-full pr-3 pl-1.5 text-[16px] font-semibold text-white"
        >
          <ChevronLeft className="size-[22px]" strokeWidth={2.4} />
          Voltar
        </button>
        <div className="-mr-2.5 ml-auto flex items-center gap-0.5">
          <button type="button" onClick={share} aria-label="Compartilhar" className={icon}>
            <Share className="size-[19px]" strokeWidth={2.1} />
          </button>
          {productId ? (
            <button
              type="button"
              aria-pressed={fav}
              aria-label={fav ? "Remover dos favoritos" : "Salvar nos favoritos"}
              onClick={() => {
                const added = toggle(productId);
                setPop((n) => n + 1);
                toast.success(added ? "Salvo nos seus favoritos" : "Removido dos favoritos", { duration: 1600 });
              }}
              className={icon}
            >
              <span key={pop} className={cn(pop > 0 && "badge-pop", "grid place-items-center")}>
                <IconHeart filled={fav} className={cn("size-[21px]", fav && "text-[#FFD599]")} />
              </span>
            </button>
          ) : null}
          <button
            type="button"
            ref={bagRef}
            onClick={onOpenCart}
            aria-label={`Abrir sacola${cartCount ? ` com ${cartCount} itens` : ""}`}
            className={cn(icon, "relative")}
          >
            <ShoppingBag className="size-[20px]" strokeWidth={2.1} />
            {cartCount > 0 ? (
              <span
                key={cartCount}
                className="badge-pop absolute top-0.5 right-0 grid min-w-[18px] place-items-center rounded-full bg-[#FFD599] px-1 text-[10px] leading-[18px] font-bold text-[#15130F] tabular-nums"
              >
                {cartCount > 99 ? "99+" : cartCount}
              </span>
            ) : null}
          </button>
        </div>
      </div>
    </header>
  );
}

/**
 * Conteúdo abaixo da dobra: monta quando entra (ou está perto de entrar) na tela.
 */
function BelowFold({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [show, setShow] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || show) return;
    if (typeof IntersectionObserver !== "function") {
      setShow(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShow(true);
          io.disconnect();
        }
      },
      { rootMargin: "400px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [show]);
  return <div ref={ref}>{show ? children : <div className="mt-12 h-40 rounded-3xl bg-muted/40" />}</div>;
}

/** Perfume sob consulta: no lugar do preço e do carrinho, conversa direta no WhatsApp. */
function ConsultPanel({ product }: { product: { id: string; canonical_name: string; brand?: string | null; volume_ml?: number | null } }) {
  return (
    <div className="mt-8 rounded-[24px] bg-[#1A1A1A] p-5">
      <p className="text-[13px] font-semibold text-[#8C8C8C]">{product.volume_ml ? `Frasco ${product.volume_ml}ml` : "Frasco completo"}</p>
      <p className="mt-1 text-[28px] leading-tight font-bold tracking-[-0.02em] text-[#FFD599]">Sob consulta</p>
      <p className="mt-1 text-[14px] leading-snug text-[#A9A9A9]">Fale com a Orium para saber o preço e a disponibilidade deste perfume.</p>
      <a
        href={consultLink(product)}
        target="_blank"
        rel="noreferrer"
        onClick={() => track("consultant_help_clicked", { productId: product.id, meta: { reason: "sob-consulta" } })}
        className="press mt-4 flex h-14 w-full items-center justify-center gap-2 rounded-full bg-[#FFD599] text-[16px] font-bold text-black transition-colors hover:bg-[#FFDDAA]"
      >
        <MessageCircle className="size-5" strokeWidth={2.4} /> Consultar no WhatsApp
      </a>
    </div>
  );
}
