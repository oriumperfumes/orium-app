import { Link, useRouterState } from "@tanstack/react-router";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { navigatingFromLayer, useBackToClose } from "@/hooks/use-back-to-close";
import {
  ArrowLeft,
  ArrowUpRight,
  ClipboardList,
  House,
  LayoutGrid,
  Package,
  Settings,
  ShoppingBag,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { OriumLogo } from "@/components/orium/OriumLogo";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import symbolLight from "@/assets/orium-symbol-light.png.asset.json";
import { CopilotProvider, useCopilot } from "@/components/orium/copilot/CopilotPanel";
import { CopilotOrb } from "@/components/orium/copilot/CopilotOrb";
import { AdminTopBar, CommandPalette } from "@/components/orium/admin/AdminTopBar";

/**
 * ADMIN DA ORIUM — mesma linguagem da loja.
 *
 * Barras #0A0A0A com fio de 6% de branco, fundo #101010, cartões #1A1A1A,
 * dourado #FFD599 só como acento. Sem desfoque, sem brilho, sem degradê.
 *
 * - Seis áreas (NAV_HUBS): Início, Pedidos, Produtos, Compras, Clientes e
 *   Configurações. Telas parecidas viram abas no topo da página da área.
 * - Celular: barra inferior com o que se usa todo dia; "Menu" abre as áreas.
 * - Cada página tem um título grande (como "Favoritos" na loja); ao rolar,
 *   ele passa para a barra de cima do celular.
 */

export type NavItem = { to: string; label: string; icon: LucideIcon; exact?: boolean; badge?: "orders" };

/** Uma aba dentro de uma área; `also` são telas filhas que acendem a mesma aba. */
export type NavSection = { to: string; label: string; also?: string[] };
export type NavHub = NavItem & { sections: NavSection[] };

/**
 * As seis áreas do Admin. Cada tela continua no mesmo endereço; o que mudou foi
 * o agrupamento. Atendimento saiu do menu (a tela segue em /admin/atendimento).
 */
export const NAV_HUBS: NavHub[] = [
  { to: "/admin", label: "Início", icon: House, exact: true, sections: [] },
  {
    to: "/admin/pedidos",
    label: "Pedidos",
    icon: ShoppingBag,
    badge: "orders",
    sections: [
      { to: "/admin/pedidos", label: "Pedidos" },
      { to: "/admin/vendas-loja", label: "Vendas da loja" },
    ],
  },
  {
    to: "/admin/produtos",
    label: "Produtos",
    icon: Package,
    sections: [
      { to: "/admin/produtos", label: "Catálogo" },
      { to: "/admin/estoque", label: "Estoque" },
      { to: "/admin/precificacao", label: "Precificação" },
      { to: "/admin/manutencao", label: "Manutenção" },
    ],
  },
  {
    to: "/admin/reposicao",
    label: "Compras",
    icon: ClipboardList,
    sections: [
      { to: "/admin/reposicao", label: "Reposição" },
      { to: "/admin/fornecedores", label: "Fornecedores", also: ["/admin/fornecedores-rota"] },
      { to: "/admin/negociacao", label: "Negociação" },
    ],
  },
  {
    to: "/admin/clientes",
    label: "Clientes",
    icon: Users,
    sections: [
      { to: "/admin/clientes", label: "Clientes" },
      { to: "/admin/aovivo", label: "Ao vivo" },
      { to: "/admin/conversao", label: "Conversão" },
    ],
  },
  {
    to: "/admin/configuracoes",
    label: "Configurações",
    icon: Settings,
    sections: [
      { to: "/admin/configuracoes", label: "Configurações" },
      { to: "/admin/widgets", label: "Widgets" },
    ],
  },
];

export const isActive = (pathname: string, item: { to: string; exact?: boolean }) =>
  item.exact ? pathname === item.to || pathname === `${item.to}/` : pathname === item.to || pathname.startsWith(`${item.to}/`);

const sectionActive = (pathname: string, s: NavSection) =>
  isActive(pathname, s) || (s.also ?? []).some((to) => isActive(pathname, { to }));

/** A área acende em qualquer uma das suas abas. */
export const hubActive = (pathname: string, hub: NavHub) =>
  hub.exact ? isActive(pathname, hub) : isActive(pathname, hub) || hub.sections.some((s) => sectionActive(pathname, s));

/** Todas as telas do menu, para a busca do painel (Ctrl K). */
export const navSections = (): Array<{ to: string; label: string; hub: string; icon: LucideIcon }> =>
  NAV_HUBS.flatMap((h) =>
    h.sections.length ? h.sections.map((s) => ({ to: s.to, label: s.label, hub: h.label, icon: h.icon })) : [{ to: h.to, label: h.label, hub: h.label, icon: h.icon }],
  );

/** Abas da área no topo da página: só aparecem quando a área junta mais de uma tela. */
function SectionTabs({ pathname }: { pathname: string }) {
  const hub = NAV_HUBS.find((h) => h.sections.length > 1 && h.sections.some((s) => sectionActive(pathname, s)));
  const ref = useRef<HTMLElement>(null);
  // celular: a fileira rola sozinha até a aba aberta (sem mexer na rolagem da página)
  useEffect(() => {
    const nav = ref.current;
    const on = nav?.querySelector<HTMLElement>('[data-active="true"]');
    if (!nav || !on) return;
    const left = on.offsetLeft - (nav.clientWidth - on.offsetWidth) / 2;
    nav.scrollLeft = Math.max(0, left);
  }, [pathname]);
  if (!hub) return null;
  return (
    <nav ref={ref} aria-label={hub.label} className="adm-scroll -mx-1 mb-5 overflow-x-auto px-1 pb-1 lg:mb-7">
      <div className="inline-flex min-w-max items-center gap-1 rounded-full bg-[#1A1A1A] p-1 ring-1 ring-white/[0.06]">
        {hub.sections.map((s) => {
          const active = sectionActive(pathname, s);
          return (
            <Link
              key={s.to}
              to={s.to}
              preload="intent"
              aria-current={active ? "page" : undefined}
              data-active={active}
              className="press flex h-10 items-center rounded-full px-3.5 text-[14px] font-semibold sm:px-4 sm:text-[14.5px] whitespace-nowrap text-[#A9A9A9] transition-colors duration-[var(--motion-fast)] hover:text-white data-[active=true]:bg-white data-[active=true]:text-[#15130F]"
            >
              {s.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/** O título da página vive no shell (título grande + barra do celular). */
const TitleContext = createContext<(t: string) => void>(() => {});

export function AdminChrome({ children }: { children: ReactNode }) {
  return (
    <CopilotProvider>
      <AdminChromeInner>{children}</AdminChromeInner>
    </CopilotProvider>
  );
}

function AdminChromeInner({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const { open: copilotOpen, setOpen: setCopilotOpen } = useCopilot();
  const [title, setTitle] = useState("");
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const scrolled = useScrolledPast(56);
  const orders = usePaidOrders().data ?? 0;

  // No celular o menu tem prioridade: abrir o menu fecha o Copilot.
  const openDrawer = useCallback(() => {
    setCopilotOpen(false);
    setOpen(true);
  }, [setCopilotOpen]);
  const closeDrawer = useCallback(() => setOpen(false), []);
  useBackToClose(open, closeDrawer);
  // Tocou numa seção no menu do celular: a página nova ocupa a entrada do menu
  // no histórico (senão o "voltar" que fecha o menu desfaz a navegação).
  const leaveDrawer = useCallback(() => {
    navigatingFromLayer();
    setOpen(false);
  }, []);

  return (
    <TitleContext.Provider value={setTitle}>
      <AdminBodyMode />
      <div className="admin-theme min-h-dvh bg-[#101010] text-white">
        <div
          className={cn(
            "flex min-w-0 flex-col transition-[padding] duration-200",
            copilotOpen && "2xl:pr-[calc(var(--copilot-w)+12px)]",
          )}
        >
          {/* barra de cima (computador): pílulas, busca, novo pedido e perfil */}
          <AdminTopBar pathname={pathname} orders={orders} />

          {/* barra de cima (celular e tablet) */}
          <header className="adm-bar sticky top-0 z-40 lg:hidden" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
            <div className="page-x relative flex h-14 items-center justify-between">
              {/* seta: volta para a loja */}
              <Link
                to="/"
                preload="intent"
                aria-label="Voltar para a loja"
                className="press -ml-2 grid size-11 place-items-center rounded-full text-white"
              >
                <ArrowLeft className="size-6" strokeWidth={2.2} />
              </Link>
              {/* logo branca no meio (vira o título da página ao rolar) */}
              <div className="pointer-events-none absolute inset-x-16 flex h-full items-center justify-center">
                <span className={cn("adm-bar-mark absolute", scrolled && title ? "is-off" : "is-on")} aria-hidden>
                  <img src={symbolLight.url} alt="" className="size-7 object-contain" />
                </span>
                <span
                  className={cn(
                    "adm-bar-title absolute max-w-full truncate text-[16px] font-bold tracking-[-0.01em]",
                    scrolled && title ? "is-on" : "is-off",
                  )}
                >
                  {title}
                </span>
              </div>
              {/* foto real do perfil (iniciais quando não há foto) */}
              <AdminAvatar className="size-9 text-[13px]" />
            </div>
          </header>

          {/* menu do celular: folha que sobe de baixo (sem painel lateral) */}
          <Drawer open={open} onOpenChange={(v) => (v ? openDrawer() : closeDrawer())}>
            <DrawerContent className="max-h-[88dvh] border-0 bg-[#0E0E0E] px-0 pb-[env(safe-area-inset-bottom,0px)] text-white lg:hidden">
              <DrawerTitle className="px-6 pt-3 pb-2 text-[22px] font-bold tracking-[-0.02em]">Menu</DrawerTitle>
              <div className="adm-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-3">
                <AdminNav pathname={pathname} orders={orders} onNavigate={leaveDrawer} />
              </div>
              <RailFooter onNavigate={leaveDrawer} />
            </DrawerContent>
          </Drawer>

          <main className="page-x min-w-0 flex-1 pt-5 pb-[calc(6.5rem+env(safe-area-inset-bottom))] lg:px-10 lg:pt-8 lg:pb-16 wide:px-14">
            <SectionTabs pathname={pathname} />
            {children}
          </main>
          <AdminTabBar pathname={pathname} orders={orders} onMenu={openDrawer} menuOpen={open} />
          <CommandPalette />
        </div>
      </div>
    </TitleContext.Provider>
  );
}

function AdminNav({ pathname, orders, onNavigate }: { pathname: string; orders: number; onNavigate?: () => void }) {
  return (
    <nav aria-label="Áreas do admin">
      <ul className="space-y-1">
        {NAV_HUBS.map((hub) => {
          const active = hubActive(pathname, hub);
          const count = hub.badge === "orders" ? orders : 0;
          const parts = hub.sections.length > 1 ? hub.sections.map((s) => s.label).join(", ") : null;
          return (
            <li key={hub.to}>
              <Link
                to={hub.to}
                preload="intent"
                onClick={onNavigate}
                replace={!!onNavigate}
                activeOptions={{ exact: true }}
                data-active={active}
                className="adm-nav press flex min-h-[56px] items-center gap-3.5 rounded-[16px] px-3 py-2"
              >
                <hub.icon className="adm-nav-ico size-[21px] shrink-0" strokeWidth={1.9} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[16px] font-semibold">{hub.label}</span>
                  {parts ? <span className="mt-0.5 block truncate text-[12.5px] font-medium text-[#7A7A7A]">{parts}</span> : null}
                </span>
                {count > 0 ? (
                  <span className="grid h-[22px] min-w-[22px] place-items-center rounded-full bg-[#FFD599] px-1.5 text-[11.5px] font-bold text-[#15130F] tabular-nums">
                    {count > 99 ? "99+" : count}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function RailFooter({ onNavigate }: { onNavigate?: () => void }) {
  const { session } = useAuth();
  const name = displayName(session);
  return (
    <div className="border-t border-white/[0.06] p-3">
      <div className="flex items-center gap-3 px-2 py-2">
        <AdminAvatar className="size-9 text-[13px]" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold text-white">{name || "Equipe Orium"}</p>
          <p className="truncate text-[12px] text-[#8C8C8C]">{session?.user.email ?? ""}</p>
        </div>
      </div>
      <Link
        to="/"
        preload="intent"
        onClick={onNavigate}
        replace={!!onNavigate}
        className="press mt-1 flex h-11 items-center justify-between rounded-full bg-[#1A1A1A] px-4 text-[14px] font-semibold text-white transition-colors hover:bg-[#222]"
      >
        Ver a loja
        <ArrowUpRight className="size-4 text-[#A9A9A9]" strokeWidth={2.2} />
      </Link>
    </div>
  );
}

export function displayName(session: ReturnType<typeof useAuth>["session"]) {
  const meta = (session?.user.user_metadata?.["name"] as string | undefined) ?? "";
  return meta.trim();
}

export function AdminAvatar({ className }: { className?: string }) {
  const { session } = useAuth();
  const name = displayName(session) || session?.user.email || "";
  const initials =
    name
      .replace(/@.*/, "")
      .split(/[\s._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("") || "O";
  const meta = (session?.user.user_metadata ?? {}) as Record<string, unknown>;
  const photo = String(meta["avatar_url"] ?? meta["picture"] ?? "").trim() || null;
  const [broken, setBroken] = useState(false);
  return (
    <span
      aria-label="Administrador"
      className={cn("grid shrink-0 place-items-center overflow-hidden rounded-full bg-[#232323] font-bold text-[#FFD599]", className)}
    >
      {photo && !broken ? (
        <img src={photo} alt="" referrerPolicy="no-referrer" className="size-full object-cover" onError={() => setBroken(true)} />
      ) : (
        initials
      )}
    </span>
  );
}

/** Passou do título grande da página? (a barra do celular mostra o título) */
function useScrolledPast(px: number) {
  const [past, setPast] = useState(false);
  useEffect(() => {
    let raf = 0;
    const read = () => setPast(window.scrollY > px);
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
  }, [px]);
  return past;
}

/**
 * Pedidos PAGOS aguardando entrega — mesma definição do Início:
 * status "pedido feito", ou "pendente" já confirmado. Pendente sem confirmação não conta.
 */
function usePaidOrders() {
  return useQuery({
    queryKey: ["admin-paid-orders-count"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("catalog_orders")
        .select("id", { count: "exact", head: true })
        .is("deleted_at", null)
        .is("canceled_at", null)
        .or('status.eq."pedido feito",and(status.eq.pendente,is_confirmed.eq.true)');
      if (error) throw error;
      return count ?? 0;
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

const TABS: NavItem[] = [
  { to: "/admin", label: "Início", icon: House, exact: true },
  { to: "/admin/pedidos", label: "Pedidos", icon: ShoppingBag, badge: "orders" },
  { to: "/admin/produtos", label: "Produtos", icon: Package },
];

/** Orbe do Copilot no centro da barra do celular: tocar abre; segurar já ouve. */
function CopilotTab() {
  const { open, setOpen, listen, activity } = useCopilot();
  const [holding, setHolding] = useState(false);
  const timer = useRef<number | null>(null);
  const fired = useRef(false);
  const clear = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    setHolding(false);
  };
  return (
    <button
      type="button"
      aria-label="Orium Copilot (segure para falar)"
      aria-expanded={open}
      onPointerDown={() => {
        fired.current = false;
        setHolding(true);
        timer.current = window.setTimeout(() => {
          fired.current = true;
          setHolding(false);
          navigator.vibrate?.(12);
          listen();
        }, 420);
      }}
      onPointerUp={() => {
        const longPress = fired.current;
        clear();
        if (!longPress) setOpen(!open);
      }}
      onPointerLeave={clear}
      onPointerCancel={clear}
      onContextMenu={(e) => e.preventDefault()}
      className="press relative flex flex-col items-center justify-start gap-1 text-[#8C8C8C] [touch-action:manipulation] select-none"
    >
      <span className="cp-tab-orb" data-holding={holding}>
        <CopilotOrb state={holding ? "listening" : activity.orb} level={holding ? 0.12 : 0} size={44} />
      </span>
      <span className={cn("text-[10.5px] leading-none font-semibold", open && "text-white")}>Copilot</span>
    </button>
  );
}

function AdminTabBar({
  pathname,
  orders,
  onMenu,
  menuOpen,
}: {
  pathname: string;
  orders: number;
  onMenu: () => void;
  menuOpen: boolean;
}) {
  // "Menu" fica aceso nas áreas que não têm aba própria
  const elsewhere = !TABS.some((t) => isActive(pathname, t) || NAV_HUBS.some((h) => h.to === t.to && hubActive(pathname, h)));
  const item =
    "press relative flex flex-col items-center justify-center gap-1 text-[#8C8C8C] transition-colors duration-[var(--motion-fast)] data-[active=true]:text-white";
  return (
    <nav
      aria-label="Navegação do admin"
      className="adm-tabbar fixed inset-x-0 bottom-0 z-40 lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <div className="mx-auto grid h-[60px] max-w-[460px] grid-cols-5 px-2">
        {TABS.flatMap((t, ti) => {
          const hub = NAV_HUBS.find((h) => h.to === t.to);
          const active = hub ? hubActive(pathname, hub) : isActive(pathname, t);
          const count = t.badge === "orders" ? orders : 0;
          const tab = (
            <Link key={t.to} to={t.to} preload="intent" activeOptions={{ exact: true }} data-active={active} className={item}>
              <span className="relative">
                <t.icon className="size-[22px]" strokeWidth={active ? 2.1 : 1.8} />
                {count > 0 ? (
                  <span
                    aria-label={`${count} pedidos pagos aguardando entrega`}
                    className="absolute -top-1.5 -right-3 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-[#FFD599] px-1 text-[10px] font-bold text-[#15130F] tabular-nums ring-2 ring-[#0A0A0A]"
                  >
                    {count > 99 ? "99+" : count}
                  </span>
                ) : null}
              </span>
              <span className="text-[10.5px] leading-none font-semibold">{t.label}</span>
            </Link>
          );
          return ti === 1 ? [tab, <CopilotTab key="copilot" />] : [tab];
        })}
        <button
          type="button"
          onClick={onMenu}
          data-active={elsewhere || menuOpen}
          className={item}
        >
          <LayoutGrid className="size-[22px]" strokeWidth={elsewhere ? 2.1 : 1.8} />
          <span className="text-[10.5px] leading-none font-semibold">Menu</span>
        </button>
      </div>
    </nav>
  );
}

/**
 * Página do Admin: título grande, uma linha de apoio opcional e no máximo
 * uma ação principal. `bare` esconde o título (telas de tela cheia, como o Copilot).
 */
export function AdminShell({
  title,
  description,
  children,
  action,
  wide,
  bare,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  action?: ReactNode;
  /** páginas de trabalho (listas densas) usam toda a largura disponível */
  wide?: boolean;
  bare?: boolean;
}) {
  const setTitle = useContext(TitleContext);
  useEffect(() => {
    setTitle(title);
  }, [title, setTitle]);

  return (
    <div className={cn("admin-page @container/page mx-auto w-full min-w-0", wide ? "max-w-none" : "max-w-[1440px]")}>
      {bare ? null : (
        <header className="flex min-w-0 flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0">
            <h1 className="text-[30px] leading-[1.1] font-bold tracking-[-0.035em] break-words text-white text-balance lg:text-[36px]">
              {title}
            </h1>
            {description ? <p className="mt-1.5 max-w-prose text-[15px] leading-snug text-[#A9A9A9]">{description}</p> : null}
          </div>
          {action ? <div className="flex min-w-0 shrink-0 md:justify-end">{action}</div> : null}
        </header>
      )}
      <div className={cn("admin-in min-w-0", bare ? "" : "mt-6 lg:mt-8")}>{children}</div>
    </div>
  );
}

/** Marca o <body> enquanto o Admin está aberto: modais/sheets (em portal) herdam o mesmo estilo. */
function AdminBodyMode() {
  useEffect(() => {
    document.body.classList.add("admin-mode");
    return () => document.body.classList.remove("admin-mode");
  }, []);
  return null;
}
