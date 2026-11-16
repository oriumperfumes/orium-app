import { Link, useRouterState } from "@tanstack/react-router";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { navigatingFromLayer, useBackToClose } from "@/hooks/use-back-to-close";
import {
  ArrowUpRight,
  BadgePercent,
  Boxes,
  ClipboardList,
  Gem,
  House,
  LayoutGrid,
  MessagesSquare,
  Package,
  Radio,
  Settings,
  ShoppingBag,
  Store,
  TrendingUp,
  Truck,
  Users,
  Wrench,
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
import { AdminTopBar, CommandPalette } from "@/components/orium/admin/AdminTopBar";

/**
 * ADMIN DA ORIUM — mesma linguagem da loja.
 *
 * Barras #0A0A0A com fio de 6% de branco, fundo #101010, cartões #1A1A1A,
 * dourado #FFD599 só como acento. Sem desfoque, sem brilho, sem degradê.
 *
 * - Computador: menu lateral fixo com o nome da seção e nada mais.
 * - Celular: barra inferior com o que se usa todo dia; "Menu" abre o resto.
 * - Cada página tem um título grande (como "Favoritos" na loja); ao rolar,
 *   ele passa para a barra de cima do celular.
 */

export type NavItem = { to: string; label: string; icon: LucideIcon; exact?: boolean; badge?: "orders" };

export const NAV_GROUPS: Array<{ label: string; items: NavItem[] }> = [
  {
    label: "Dia a dia",
    items: [
      { to: "/admin", label: "Início", icon: House, exact: true },
      { to: "/admin/pedidos", label: "Pedidos", icon: ShoppingBag, badge: "orders" },
      { to: "/admin/atendimento", label: "Atendimento", icon: MessagesSquare },
      { to: "/admin/vendas-loja", label: "Vendas da loja", icon: Store },
      { to: "/admin/aovivo", label: "Ao vivo", icon: Radio },
    ],
  },
  {
    label: "Catálogo",
    items: [
      { to: "/admin/produtos", label: "Produtos", icon: Package },
      { to: "/admin/estoque", label: "Estoque", icon: Boxes },
      { to: "/admin/precificacao", label: "Precificação", icon: BadgePercent },
      { to: "/admin/manutencao", label: "Manutenção", icon: Wrench },
    ],
  },
  {
    label: "Compras",
    items: [
      { to: "/admin/reposicao", label: "Reposição", icon: ClipboardList },
      { to: "/admin/fornecedores", label: "Fornecedores", icon: Truck },
      { to: "/admin/negociacao", label: "Negociação", icon: Gem },
    ],
  },
  {
    label: "Clientes",
    items: [
      { to: "/admin/clientes", label: "Clientes", icon: Users },
      { to: "/admin/conversao", label: "Conversão", icon: TrendingUp },
    ],
  },
  {
    label: "Sistema",
    items: [
      { to: "/admin/widgets", label: "Widgets", icon: LayoutGrid },
      { to: "/admin/configuracoes", label: "Configurações", icon: Settings },
    ],
  },
];

export const isActive = (pathname: string, item: { to: string; exact?: boolean }) =>
  item.exact ? pathname === item.to || pathname === `${item.to}/` : pathname === item.to || pathname.startsWith(`${item.to}/`);

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
            copilotOpen && "lg:pr-[var(--copilot-w)]",
          )}
        >
          {/* barra de cima (computador): pílulas, busca, novo pedido e perfil */}
          <AdminTopBar pathname={pathname} orders={orders} />

          {/* barra de cima (celular e tablet) */}
          <header className="adm-bar sticky top-0 z-40 lg:hidden" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
            <div className="page-x relative flex h-14 items-center justify-between">
              {/* logo branca, sem fundo: volta para a loja */}
              <Link to="/" preload="intent" aria-label="Voltar para a loja" className="press -ml-1 grid size-11 place-items-center">
                <img src={symbolLight.url} alt="Orium" className="size-7 object-contain" />
              </Link>
              <div className="pointer-events-none absolute inset-x-16 flex h-full items-center justify-center">
                <span
                  className={cn(
                    "adm-bar-title absolute max-w-full truncate text-[16px] font-bold tracking-[-0.01em]",
                    scrolled && title ? "is-on" : "is-off",
                  )}
                >
                  {title}
                </span>
              </div>
              <Link
                to="/"
                preload="intent"
                aria-label="Voltar para a loja"
                className="press -mr-1 grid size-11 place-items-center rounded-full bg-[#1A1A1A] text-white transition-colors hover:bg-[#232323]"
              >
                <House className="size-[19px]" strokeWidth={2.1} />
              </Link>
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
    <nav aria-label="Seções do admin" className="space-y-6">
      {NAV_GROUPS.map((group) => (
        <div key={group.label}>
          <p className="mb-1.5 px-3 text-[12px] font-semibold text-[#6F6F6F]">{group.label}</p>
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const active = isActive(pathname, item);
              const count = item.badge === "orders" ? orders : 0;
              return (
                <li key={item.to}>
                  <Link
                    to={item.to}
                    preload="intent"
                    onClick={onNavigate}
                    replace={!!onNavigate}
                    activeOptions={{ exact: true }}
                    data-active={active}
                    className="adm-nav press flex h-11 items-center gap-3 rounded-[14px] px-3 text-[15px] font-semibold"
                  >
                    <item.icon className="adm-nav-ico size-[19px] shrink-0" strokeWidth={1.9} />
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
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
        </div>
      ))}
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
  return (
    <span
      aria-label="Administrador"
      className={cn("grid shrink-0 place-items-center rounded-full bg-[#232323] font-bold text-[#FFD599]", className)}
    >
      {initials}
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
  { to: "/admin/estoque", label: "Estoque", icon: Boxes },
];

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
  // "Menu" fica aceso nas seções que não têm aba própria
  const elsewhere = !TABS.some((t) => isActive(pathname, t));
  const item =
    "press relative flex flex-col items-center justify-center gap-1 text-[#8C8C8C] transition-colors duration-[var(--motion-fast)] data-[active=true]:text-white";
  return (
    <nav
      aria-label="Navegação do admin"
      className="adm-tabbar fixed inset-x-0 bottom-0 z-40 lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <div className="mx-auto grid h-[60px] max-w-[460px] grid-cols-5 px-2">
        {TABS.map((t) => {
          const active = isActive(pathname, t);
          const count = t.badge === "orders" ? orders : 0;
          return (
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
