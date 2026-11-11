import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { HeaderBrand } from "@/components/orium/HeaderBrand";
import { IconBag, IconHeart, IconSearch, IconSliders } from "@/components/orium/NavIcons";
import { HelpChooseSheetTrigger } from "@/components/orium/HelpChooseButton";
import { Avatar, OPEN_ACCOUNT } from "@/components/orium/account-shared";
import { useFavorites } from "@/lib/favorites";
import { useCart } from "@/lib/cart";
import { useAuth } from "@/lib/auth";
import { registerCartTarget } from "@/lib/fly-to-cart";
import { cn } from "@/lib/utils";

const iconBtn =
  "press relative grid size-10 place-items-center rounded-full text-white transition-[background-color,transform] duration-[var(--motion-fast)] ease-[var(--ease-orium)] hover:bg-white/10";

const badge =
  "badge-pop absolute top-1 right-0.5 grid min-w-4 place-items-center rounded-full bg-[#FFD599] px-1 text-[9px] leading-4 font-bold text-[#15130F] tabular-nums";

/** Computador: a partir daqui a barra inferior some e a navegação mora no topo. */
export const DESKTOP_QUERY = "(min-width: 64rem)";

/** Coração do header: abre os favoritos; com itens salvos, ganha o selo dourado. */
function FavoritesLink() {
  const { count } = useFavorites();
  return (
    <Link to="/favoritos" className={iconBtn} aria-label={count > 0 ? `Meus favoritos (${count})` : "Meus favoritos"}>
      <IconHeart className="size-[19px]" />
      {count > 0 ? (
        <span key={count} className={badge}>
          {count > 9 ? "9+" : count}
        </span>
      ) : null}
    </Link>
  );
}

/**
 * A pesquisa mora na Home. Fora dela (página do perfume, favoritos…) vai primeiro
 * para a Home e só então pede o foco — igual à barra inferior do celular.
 */
function useOpenSearch() {
  const navigate = useNavigate();
  const path = useRouterState({ select: (s) => s.location.pathname }) as unknown as string;
  return () => {
    if (path === "/") {
      window.dispatchEvent(new Event("orium:focus-search"));
      return;
    }
    void navigate({ to: "/" }).then(() => {
      window.setTimeout(() => window.dispatchEvent(new Event("orium:focus-search")), 380);
    });
  };
}

/** "/" abre a pesquisa no computador (fora de campos de texto). */
function useSlashToSearch(open: () => void) {
  const ref = useRef(open);
  ref.current = open;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      e.preventDefault();
      ref.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

/**
 * Navegação do computador (e do tablet deitado): Início · Catálogo · Ajuda.
 * No celular e no tablet em pé isso fica na barra inferior.
 */
function DesktopNav() {
  const path = useRouterState({ select: (s) => s.location.pathname }) as unknown as string;
  const ver: string | undefined = useRouterState({
    select: (s) => (s.location.search as Record<string, unknown> | undefined)?.["ver"] as string | undefined,
  });
  const onHome = path === "/" && ver !== "catalogo";
  const onCatalog = path === "/" && ver === "catalogo";
  const link =
    "press relative inline-flex h-10 items-center rounded-full px-4 text-[15px] font-semibold transition-colors duration-200 hover:bg-white/[0.07] hover:text-white";
  return (
    <nav aria-label="Principal" className="ml-5 hidden items-center gap-0.5 lg:flex">
      <Link
        to="/"
        search={{} as never}
        className={cn(link, onHome ? "text-white" : "text-[#A9A9A9]")}
        aria-current={onHome ? "page" : undefined}
      >
        Início
        {onHome ? <span aria-hidden className="nav-dot" /> : null}
      </Link>
      <Link
        to="/"
        search={{ ver: "catalogo" } as never}
        className={cn(link, onCatalog ? "text-white" : "text-[#A9A9A9]")}
        aria-current={onCatalog ? "page" : undefined}
      >
        Catálogo
        {onCatalog ? <span aria-hidden className="nav-dot" /> : null}
      </Link>
      <HelpChooseSheetTrigger source="header_computador" className={cn(link, "text-[#A9A9A9]")}>
        Ajuda
      </HelpChooseSheetTrigger>
    </nav>
  );
}

/** Busca, sacola e conta no topo — só no computador. */
function DesktopActions({ clear, openSearch }: { clear: boolean; openSearch: () => void }) {
  const cart = useCart();
  const { session } = useAuth();
  const qty = cart.totalQuantity;
  return (
    <>
      <button
        type="button"
        onClick={openSearch}
        className={cn(
          "press mr-2 hidden h-11 w-[clamp(220px,22vw,320px)] items-center gap-2.5 rounded-full border pr-2 pl-4 text-left text-[15px] transition-colors duration-300 lg:flex",
          clear
            ? "border-white/20 bg-black/30 text-white/80 hover:bg-black/45"
            : "border-white/[0.08] bg-[#161616] text-[#8C8C8C] hover:border-white/15 hover:bg-[#1C1C1C]",
        )}
      >
        <IconSearch className="size-[18px] shrink-0" />
        <span className="min-w-0 flex-1 truncate">Procurar perfume ou marca</span>
        <kbd className="grid h-6 min-w-6 place-items-center rounded-md border border-white/15 px-1.5 font-sans text-[12px] font-semibold text-white/60">
          /
        </kbd>
      </button>
      <button
        ref={(el) => {
          // no computador a sacola do topo recebe o "voo" do produto
          if (el && typeof window !== "undefined" && window.matchMedia(DESKTOP_QUERY).matches) registerCartTarget(el);
        }}
        type="button"
        onClick={() => cart.setOpen(true)}
        className={cn(iconBtn, "hidden lg:order-2 lg:grid")}
        aria-label={qty > 0 ? `Abrir sacola com ${qty} ${qty === 1 ? "item" : "itens"}` : "Abrir sacola"}
      >
        <IconBag className="size-[19px]" />
        {qty > 0 ? (
          <span key={qty} className={badge}>
            {qty > 99 ? "99+" : qty}
          </span>
        ) : null}
      </button>
      {session ? (
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event(OPEN_ACCOUNT))}
          aria-label="Sua conta"
          className="press ml-1 hidden size-10 lg:order-3 place-items-center rounded-full transition-colors hover:bg-white/10 lg:grid"
        >
          <Avatar size={30} className="ring-[1.5px] ring-white/70" />
        </button>
      ) : (
        <Link
          to="/auth"
          className="press ml-2 hidden h-10 lg:order-3 items-center rounded-full bg-white px-5 text-[14px] font-bold text-[#15130F] transition-colors hover:bg-[#F2F1ED] lg:inline-flex"
        >
          Entrar
        </Link>
      )}
    </>
  );
}

/**
 * Header do app — preto sólido do Figma. No celular: símbolo da Orium à
 * esquerda, favoritos e filtros à direita (conta e sacola na barra inferior).
 * No computador vira a navegação completa da loja.
 */
export function SiteHeader({
  onOpenFilters,
  filtersCount = 0,
  clearAtTop = false,
  onBack,
  backLabel = "Início",
  className,
}: {
  /** @deprecated o header agora é sempre o mesmo; mantido por compatibilidade */
  hideOnScroll?: boolean;
  /** @deprecated idem */
  overlay?: boolean;
  /** @deprecated idem */
  threshold?: number;
  /** Abre a gaveta de filtros (ícone ao lado do coração). */
  onOpenFilters?: (() => void) | undefined;
  /** Quantos filtros estão aplicados (selo dourado no ícone). */
  filtersCount?: number;
  /** Home: totalmente transparente sobre o vídeo; fica preto ao rolar. */
  clearAtTop?: boolean;
  /** Telas de dentro no celular: "‹ Início" no lugar do símbolo (no computador o menu já leva de volta). */
  onBack?: (() => void) | undefined;
  backLabel?: string;
  className?: string;
} = {}) {
  const [atTop, setAtTop] = useState(clearAtTop);
  const openSearch = useOpenSearch();
  useSlashToSearch(openSearch);
  useEffect(() => {
    if (!clearAtTop) {
      setAtTop(false);
      return;
    }
    let raf = 0;
    const read = () => setAtTop(window.scrollY < 8);
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(read);
    };
    read();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
    };
  }, [clearAtTop]);
  const clear = clearAtTop && atTop;

  return (
    <header data-site-header className={cn("orium-topbar header-safe sticky top-0 z-40 text-white", clear && "is-clear", className)}>
      <div className="shell flex h-[52px] items-center gap-3 lg:h-[68px]">
        {onBack ? (
          <>
            <button
              key="back"
              type="button"
              onClick={onBack}
              className="hdr-swap press -ml-2.5 inline-flex h-10 items-center gap-1 rounded-full pr-3 pl-1.5 text-[16px] font-semibold text-white lg:hidden"
            >
              <ChevronLeft className="size-[22px]" strokeWidth={2.4} />
              {backLabel}
            </button>
            <span className="hidden lg:inline-flex">
              <HeaderBrand className="-ml-0.5 [&_span]:h-[38px] [&_span]:w-[28px]" />
            </span>
          </>
        ) : (
          <span key="brand" className="hdr-swap inline-flex">
            <HeaderBrand className="-ml-0.5 [&_span]:h-[34px] [&_span]:w-[25px] lg:[&_span]:h-[38px] lg:[&_span]:w-[28px]" />
          </span>
        )}

        <DesktopNav />

        <div className="-mr-2.5 ml-auto flex shrink-0 items-center gap-1.5">
          <DesktopActions clear={clear} openSearch={openSearch} />
          <FavoritesLink />
          {onOpenFilters ? (
            <button type="button" aria-label="Filtros" onClick={onOpenFilters} className={iconBtn}>
              <IconSliders className="size-[19px]" />
              {filtersCount > 0 ? (
                <span key={filtersCount} className={badge}>
                  {filtersCount}
                </span>
              ) : null}
            </button>
          ) : null}
        </div>
      </div>
    </header>
  );
}
