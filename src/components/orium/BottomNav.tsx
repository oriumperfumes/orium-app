import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { useCart, type CartItem } from "@/lib/cart";
import { useAuth } from "@/lib/auth";
import { onCartPulse, registerCartTarget } from "@/lib/fly-to-cart";
import { imgVariant } from "@/lib/product-img";
import { HelpChooseSheetTrigger } from "@/components/orium/HelpChooseButton";
import { lazyUI, MountWhen, useIdlePrefetch } from "@/lib/lazy-ui";

import { IconBag, IconChat, IconHome, IconPerson, IconSearch } from "@/components/orium/NavIcons";
import { useVisualViewport } from "@/hooks/use-visual-viewport";
import { Avatar, OPEN_ACCOUNT } from "@/components/orium/account-shared";
import { cn } from "@/lib/utils";
import { CountUp } from "@/lib/celebration";
import { brl } from "@/lib/format";

const CartDrawer = lazyUI(() => import("@/components/orium/CartSheet").then((m) => ({ default: m.CartDrawer })));

/** Rotas com barra própria (compra, negociação, painel) e o login: a navegação não aparece. */
const NO_NAV = ["/admin", "/perfume", "/negociacao/", "/auth"];
/** Quanto tempo o aviso "Adicionado" fica na tela. */
const TOAST_MS = 2800;

const variantLabel = (it: CartItem) =>
  it.decantMl ? `${it.decantMl} ml` : it.volumeMl ? `Frasco ${it.volumeMl}ml` : "Frasco";

/**
 * Na Home a barra só entra depois que o cliente sai da tela do vídeo:
 * a abertura fica limpa, só com o header de vidro.
 */
function usePastHero(path: string) {
  const [past, setPast] = useState(path !== "/");
  useEffect(() => {
    if (path !== "/") {
      setPast(true);
      return;
    }
    let raf = 0;
    const read = () => {
      const hero = document.querySelector<HTMLElement>("[data-home-hero]");
      // com a Procurar aberta a barra sempre aparece (como no Figma)
      if (document.documentElement.dataset.searchOpen === "1") return setPast(true);
      if (!hero) return setPast(true);
      setPast(hero.getBoundingClientRect().bottom < window.innerHeight * 0.62);
    };
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(read);
    };
    read();
    const t = window.setTimeout(read, 160); // depois da restauração de scroll
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    window.addEventListener("orium:hero-change", schedule);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(t);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("orium:hero-change", schedule);
    };
  }, [path]);
  return past;
}

/**
 * Barra inferior do Figma — Início · Procurar · [carrinho] · Ajuda · Conta.
 * A sacola é o orbe central com aro dourado; recebe o "voo" do produto,
 * pulsa a cada item e abre a gaveta do carrinho.
 */
export function BottomNav() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const cart = useCart();
  const { session } = useAuth();
  const { isKeyboardOpen } = useVisualViewport();
  const pastHero = usePastHero(path);
  // a sacola é a tela mais aberta da loja: o código já fica pronto em segundo plano
  useIdlePrefetch([CartDrawer.prefetch]);

  const orb = useRef<HTMLButtonElement | null>(null);
  const [bump, setBump] = useState(0);
  useEffect(() => {
    registerCartTarget(orb.current);
    return () => registerCartTarget(null);
  }, []);
  // produto pousou na sacola: ela pula, solta faíscas e (se veio de um "adicionar") vira a cápsula
  const pending = useRef<{ item: CartItem; at: number } | null>(null);
  useEffect(
    () =>
      onCartPulse(() => {
        setBump((n) => n + 1);
        const p = pending.current;
        if (p && Date.now() - p.at < 2500) {
          pending.current = null;
          openToast(p.item);
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const routeHasNav = !NO_NAV.some((r) => path.startsWith(r));
  const shown = routeHasNav && pastHero && !isKeyboardOpen;

  // ——— aviso "Adicionado" que nasce do carrinho ———
  const [toast, setToast] = useState<{ item: CartItem; n: number } | null>(null);
  const [toastOpen, setToastOpen] = useState(false);
  const prev = useRef<Map<string, number> | null>(null);
  const timer = useRef<number | null>(null);
  function openToast(item: CartItem) {
    setToast((cur) => ({ item, n: (cur?.n ?? 0) + 1 }));
    setToastOpen(true);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToastOpen(false), TOAST_MS);
  }
  const shownRef = useRef(shown);
  shownRef.current = shown;

  useEffect(() => {
    const now = new Map(cart.items.map((i) => [i.key, i.quantity]));
    const before = prev.current;
    prev.current = now;
    if (!before) return; // carrinho restaurado ao abrir: não anuncia
    const added = cart.items.find((i) => i.quantity > (before.get(i.key) ?? 0));
    if (!added || !shownRef.current) return;
    // espera o produto chegar voando (o pulso da sacola abre a cápsula);
    // se nada voar, abre logo em seguida
    pending.current = { item: added, at: Date.now() };
    window.setTimeout(() => {
      if (pending.current?.item.key === added.key) {
        pending.current = null;
        openToast(added);
      }
    }, 900);
  }, [cart.items]);
  useEffect(() => {
    if (!shown || cart.open) setToastOpen(false);
  }, [shown, cart.open]);
  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );

  const goSearch = async () => {
    if (path !== "/") await navigate({ to: "/" });
    window.setTimeout(() => window.dispatchEvent(new Event("orium:focus-search")), path !== "/" ? 380 : 0);
  };

  const home = path === "/";
  const item = "press relative flex flex-col items-center justify-center gap-1 text-white/90 outline-none transition-colors duration-[var(--motion-fast)] aria-[current=page]:text-white";
  const label = "text-[10px] leading-none font-semibold tracking-[0.01em]";
  const qty = cart.totalQuantity;

  if (path.startsWith("/admin")) return null;

  return (
    <>
      {routeHasNav ? <div aria-hidden className="hidden h-16 tab:block lg:hidden" /> : null}

      {routeHasNav ? (
        <div
          aria-live="polite"
          className={cn(
            "cart-toast pointer-events-none fixed inset-x-0 z-50 hidden justify-center px-4 lg:flex",
            toastOpen && toast ? "is-open" : "",
          )}
          style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 78px)" }}
        >
          {toast ? (
            <button
              type="button"
              tabIndex={toastOpen ? 0 : -1}
              onClick={() => {
                setToastOpen(false);
                cart.setOpen(true);
              }}
              className="cart-toast-card press pointer-events-auto flex w-full max-w-[380px] items-center gap-3 rounded-[22px] p-2 pr-2.5 text-left text-white"
            >
              <span className="relative size-11 shrink-0 overflow-hidden rounded-[14px] bg-white">
                {toast.item.image ? (
                  <img key={toast.n} src={imgVariant(toast.item.image, "thumb") ?? undefined} alt="" className="size-full object-contain" />
                ) : null}
              </span>
              <span key={toast.n} className="cart-toast-text min-w-0 flex-1">
                <span className="block text-[11px] leading-tight font-bold tracking-[0.06em] text-[#FFD599] uppercase">Adicionado</span>
                <span className="block truncate text-[14px] leading-snug font-semibold">
                  {toast.item.name} · {variantLabel(toast.item)}
                </span>
              </span>
              <span className="flex h-10 shrink-0 items-center gap-1 rounded-full bg-[#FFD599] px-3.5 text-[13px] font-bold text-[#15130F]">
                Ver sacola <ArrowRight className="size-4" strokeWidth={2.4} />
              </span>
            </button>
          ) : null}
        </div>
      ) : null}

      {routeHasNav ? (
        <nav
          aria-label="Navegação"
          {...(shown ? {} : { inert: true, "aria-hidden": true })}
          className={cn("orium-nav fixed inset-x-0 bottom-0 z-[46] lg:hidden", shown ? "is-shown" : "is-hidden")}
        >
          <div className="orium-navbar" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
            <div className="mx-auto grid h-[60px] max-w-[380px] grid-cols-5 items-center px-2">
              <Link
                to="/"
                onClick={() => window.dispatchEvent(new Event("orium:close-search"))}
                className={item}
                aria-current={home ? "page" : undefined}
              >
                <IconHome className="size-[21px]" />
                <span className={label}>Início</span>
              </Link>

              <button type="button" className={item} onClick={goSearch}>
                <IconSearch className="size-[20px]" />
                <span className={label}>Procurar</span>
              </button>

              <span aria-hidden />

              <HelpChooseSheetTrigger source="navegacao_inferior" className={item}>
                <IconChat className="size-[21px]" />
                <span className={label}>Ajuda</span>
              </HelpChooseSheetTrigger>

              {session ? (
                <button
                  type="button"
                  className={item}
                  aria-label="Sua conta"
                  onClick={() => window.dispatchEvent(new Event(OPEN_ACCOUNT))}
                >
                  <Avatar size={25} className="ring-[1.5px] ring-white/80" />
                  <span className={label}>Conta</span>
                </button>
              ) : (
                <Link to="/auth" className={item} aria-label="Entrar na sua conta">
                  <IconPerson className="size-[21px]" />
                  <span className={label}>Conta</span>
                </Link>
              )}
            </div>
          </div>

          {/* orbe do carrinho: metade para fora da barra, como no Figma */}
          <button
            ref={(el) => {
              orb.current = el;
              // o carrinho volta a receber o "voo" sempre que a barra reaparece
              // (no computador quem recebe é a sacola do topo)
              if (el && !window.matchMedia("(min-width: 64rem)").matches) registerCartTarget(el);
            }}
            type="button"
            onClick={() => {
              setToastOpen(false);
              cart.setOpen(true);
            }}
            aria-label={qty > 0 ? `Abrir sacola com ${qty} ${qty === 1 ? "item" : "itens"}` : "Abrir sacola"}
            className="orium-cart-orb press absolute grid size-[50px] place-items-center rounded-full text-white"
            style={{ top: -20, left: "calc(50% - 25px)" }}
          >
            <span key={bump} className={cn("grid place-items-center", bump > 0 && "cart-bump")}>
              <IconBag className="size-[21px]" />
            </span>
            {/* faíscas douradas quando o produto pousa */}
            {bump > 0 ? (
              <span key={`b${bump}`} aria-hidden className="orb-burst">
                {Array.from({ length: 8 }).map((_, i) => (
                  <i key={i} style={{ "--a": `${i * 45 + 22}deg` } as React.CSSProperties} />
                ))}
              </span>
            ) : null}
            {qty > 0 ? (
              <span
                key={`qq${qty}`}
                aria-hidden={toastOpen}
                style={{ opacity: toastOpen && toast ? 0 : 1, transition: "opacity 200ms ease" }}
                className="badge-pop absolute -top-1 -right-1 grid min-w-[18px] place-items-center rounded-full bg-[#FFD599] px-1 text-[10px] leading-[18px] font-bold text-[#15130F] tabular-nums shadow-[0_2px_8px_rgba(0,0,0,0.4)]"
              >
                {qty > 99 ? "99+" : qty}
              </span>
            ) : null}
          </button>

          {/* a sacola se estica numa cápsula: foto, nome e o total subindo; depois volta a ser o botão */}
          {toast ? (
            <button
              type="button"
              tabIndex={toastOpen ? 0 : -1}
              aria-hidden={!toastOpen}
              onClick={() => {
                setToastOpen(false);
                cart.setOpen(true);
              }}
              className={cn("bag-island", toastOpen && "is-open")}
            >
              <span key={`t${toast.n}`} className="bag-island-thumb">
                {toast.item.image ? (
                  <img src={imgVariant(toast.item.image, "thumb") ?? undefined} alt="" className="size-full object-contain p-0.5" />
                ) : null}
              </span>
              <span key={`x${toast.n}`} className="bag-island-text">
                <span className="block truncate text-[13.5px] leading-tight font-bold text-white">{toast.item.name}</span>
                <span className="mt-0.5 block truncate text-[12px] leading-tight text-[#A9A9A9]">
                  {variantLabel(toast.item)} · na sacola{" "}
                  <CountUp value={cart.total} format={brl} className="font-bold text-[#FFD599] tabular-nums" />
                </span>
              </span>
              <span className="bag-island-go">
                Ver
                <ArrowRight className="size-3.5" strokeWidth={2.6} />
              </span>
            </button>
          ) : null}
        </nav>
      ) : null}

      <MountWhen when={cart.open}>
        <CartDrawer />
      </MountWhen>
    </>
  );
}
