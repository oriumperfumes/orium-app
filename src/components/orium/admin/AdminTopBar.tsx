/**
 * TOPO DO ADMIN NO COMPUTADOR — navegação em pílulas.
 *
 * Símbolo da Orium · Início · Pedidos · Produtos · Estoque · Clientes · Mais
 * À direita: busca (abre a paleta de comandos, ⌘K), "+" (novo pedido) e o perfil.
 * O celular continua com a barra inferior e o menu lateral.
 */
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowUpRight, ChevronDown, CornerDownLeft, Plus, Search, ShoppingBag, Store, type LucideIcon } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import symbolLight from "@/assets/orium-symbol-light.png.asset.json";
import { AdminAvatar, NAV_GROUPS, displayName, isActive, type NavItem } from "@/components/orium/AdminShell";
import { useCopilot } from "@/components/orium/copilot/CopilotPanel";
import { CopilotOrb } from "@/components/orium/copilot/CopilotOrb";

const PRIMARY = ["/admin", "/admin/pedidos", "/admin/produtos", "/admin/estoque", "/admin/clientes"];
/** lido na hora (AdminShell importa este arquivo: nada de NAV_GROUPS no topo do módulo) */
const allItems = (): NavItem[] => NAV_GROUPS.flatMap((g) => g.items);
const OPEN_EVENT = "orium:admin-search";

export const openAdminSearch = () => window.dispatchEvent(new Event(OPEN_EVENT));

export function AdminTopBar({ pathname, orders }: { pathname: string; orders: number }) {
  const { session, role } = useAuth();
  const name = displayName(session) || (session?.user.email ?? "").replace(/@.*/, "");
  const primary = PRIMARY.map((to) => allItems().find((i) => i.to === to)!).filter(Boolean);
  const inMore = !primary.some((i) => isActive(pathname, i));

  return (
    <header className="adm-top sticky top-0 z-40 hidden lg:block">
      <div className="flex h-[84px] items-center gap-3 px-10 wide:px-14">
        <Link
          to="/"
          preload="intent"
          aria-label="Voltar para a loja"
          title="Voltar para a loja"
          className="press grid size-12 shrink-0 place-items-center rounded-full transition-colors hover:bg-white/[0.06]"
        >
          <img src={symbolLight.url} alt="Orium" className="size-8 object-contain" />
        </Link>

        <nav aria-label="Seções do admin" className="ml-6 flex min-w-0 items-center gap-1.5">
          {primary.map((item) => {
            const active = isActive(pathname, item);
            const count = item.badge === "orders" ? orders : 0;
            return (
              <Link
                key={item.to}
                to={item.to}
                preload="intent"
                activeOptions={{ exact: true }}
                data-active={active}
                className="adm-pill press"
              >
                {item.label}
                {count > 0 ? <span className="adm-pill-count">{count > 99 ? "99+" : count}</span> : null}
              </Link>
            );
          })}
          <MoreMenu pathname={pathname} active={inMore} />
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-2.5">
          <CopilotPill />
          <button type="button" onClick={openAdminSearch} className="adm-search press" aria-label="Procurar (Ctrl K)">
            <span className="grid size-9 place-items-center rounded-full bg-[#232323]">
              <Search className="size-[17px]" strokeWidth={2.2} />
            </span>
            <span className="hidden flex-1 truncate text-left xl:block">Procurar no painel</span>
            <kbd className="hidden rounded-md border border-white/10 px-1.5 py-0.5 font-sans text-[11px] font-semibold text-[#8C8C8C] xl:block">
              Ctrl K
            </kbd>
          </button>
          <Link
            to="/admin/pedidos"
            search={{ novo: true } as never}
            preload="intent"
            aria-label="Novo pedido"
            title="Novo pedido"
            className="press grid size-12 place-items-center rounded-full border border-white/[0.08] bg-[#161616] text-white transition-colors hover:border-white/20 hover:bg-[#1F1F1F]"
          >
            <Plus className="size-5" strokeWidth={2.2} />
          </Link>
          <div className="ml-1 flex items-center gap-3 rounded-full py-1 pr-1 pl-1 xl:pr-4">
            <AdminAvatar className="size-12 text-[15px]" />
            <div className="hidden min-w-0 leading-tight xl:block">
              <p className="max-w-[140px] truncate text-[15px] font-bold">{name || "Equipe Orium"}</p>
              <p className="text-[13px] text-[#8C8C8C]">{role === "owner" ? "Dono" : "Equipe"}</p>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}

/** Entrada do Copilot no computador: pílula com o orbe vivo (Ctrl/⌘ J). */
function CopilotPill() {
  const { open, toggle, activity } = useCopilot();
  const busy = activity.orb !== "idle";
  return (
    <button
      type="button"
      onClick={toggle}
      data-open={open}
      aria-expanded={open}
      aria-label="Orium Copilot (Ctrl J)"
      title="Orium Copilot · Ctrl J"
      className="cp-pill press"
    >
      <CopilotOrb state={activity.orb} size={34} />
      <span className="hidden max-w-[150px] truncate 2xl:inline xl:inline">{busy && activity.label ? activity.label : "Copilot"}</span>
      <kbd className={cn("hidden rounded-md border px-1.5 py-0.5 font-sans text-[11px] font-semibold xl:block", open ? "border-black/15 text-[#15130F]/60" : "border-white/10 text-[#8C8C8C]")}>
        Ctrl J
      </kbd>
    </button>
  );
}

/** "Mais": todas as outras seções, agrupadas, num painel que abre abaixo da pílula. */
function MoreMenu({ pathname, active }: { pathname: string; active: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", off);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", off);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  useEffect(() => setOpen(false), [pathname]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-expanded={open}
        data-active={active}
        onClick={() => setOpen((v) => !v)}
        className="adm-pill press"
      >
        Mais
        <ChevronDown className={cn("size-4 transition-transform duration-200", open && "rotate-180")} strokeWidth={2.4} />
      </button>
      {open ? (
        <div className="adm-pop absolute top-[calc(100%+10px)] left-0 z-50 grid w-[640px] grid-cols-3 gap-x-2 gap-y-5 rounded-[28px] border border-white/[0.08] bg-[#161616] p-5">
          {NAV_GROUPS.map((g) => (
            <div key={g.label}>
              <p className="mb-1.5 px-3 text-[12px] font-semibold text-[#6F6F6F]">{g.label}</p>
              <ul>
                {g.items.map((item) => (
                  <li key={item.to}>
                    <Link
                      to={item.to}
                      preload="intent"
                      activeOptions={{ exact: true }}
                      data-active={isActive(pathname, item)}
                      className="adm-nav press flex h-10 items-center gap-2.5 rounded-[12px] px-3 text-[14.5px] font-semibold"
                    >
                      <item.icon className="adm-nav-ico size-[17px] shrink-0" strokeWidth={1.9} />
                      <span className="truncate">{item.label}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <Link
            to="/"
            className="press flex h-10 items-center gap-2 self-end rounded-[12px] px-3 text-[14.5px] font-semibold text-[#A9A9A9] hover:text-white"
          >
            Ver a loja <ArrowUpRight className="size-4" />
          </Link>
        </div>
      ) : null}
    </div>
  );
}

type Cmd = { id: string; label: string; hint: string; icon: LucideIcon; to: string; search?: Record<string, unknown> };

/** Paleta de comandos: seções, atalhos e busca de pedidos. Abre com Ctrl/⌘ K. */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const show = () => {
      setQ("");
      setSel(0);
      setOpen(true);
    };
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        show();
      }
    };
    window.addEventListener(OPEN_EVENT, show);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener(OPEN_EVENT, show);
      window.removeEventListener("keydown", key);
    };
  }, []);
  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  const cmds = useMemo<Cmd[]>(() => {
    const term = q.trim();
    const actions: Cmd[] = [
      { id: "novo", label: "Novo pedido", hint: "Ação", icon: Plus, to: "/admin/pedidos", search: { novo: true } },
      { id: "venda", label: "Registrar venda da loja", hint: "Ação", icon: Store, to: "/admin/vendas-loja", search: { registrar: "manual" } },
    ];
    const sections: Cmd[] = allItems().map((i) => ({ id: i.to, label: i.label, hint: "Seção", icon: i.icon, to: i.to }));
    const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    const list = [...actions, ...sections].filter((c) => !term || norm(c.label).includes(norm(term)));
    if (term.length >= 2)
      list.unshift({ id: "busca", label: `Procurar “${term}” nos pedidos`, hint: "Cliente, telefone ou perfume", icon: ShoppingBag, to: "/admin/pedidos", search: { busca: term } });
    return list.slice(0, 9);
  }, [q]);

  const go = (c: Cmd | undefined) => {
    if (!c) return;
    setOpen(false);
    void navigate({ to: c.to as never, search: (c.search ?? {}) as never });
  };

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="admin-theme fixed inset-0 z-[80] flex items-start justify-center px-4 pt-[12vh]" role="dialog" aria-label="Procurar no painel">
      <div className="adm-fade absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
      <div className="adm-pop relative w-full max-w-[560px] overflow-hidden rounded-[28px] border border-white/[0.08] bg-[#161616] text-white">
        <div className="flex items-center gap-3 border-b border-white/[0.06] px-5">
          <Search className="size-5 shrink-0 text-[#8C8C8C]" strokeWidth={2.2} />
          <input data-slot="input-group-control"
            ref={inputRef}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setSel(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpen(false);
              else if (e.key === "ArrowDown") {
                e.preventDefault();
                setSel((v) => Math.min(v + 1, cmds.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSel((v) => Math.max(v - 1, 0));
              } else if (e.key === "Enter") go(cmds[sel]);
            }}
            placeholder="Ir para… ou procurar cliente, telefone, perfume"
            className="h-[62px] min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-[#6F6F6F]"
          />
          <kbd className="rounded-md border border-white/10 px-1.5 py-0.5 text-[11px] font-semibold text-[#8C8C8C]">Esc</kbd>
        </div>
        <ul className="max-h-[56vh] overflow-y-auto p-2">
          {cmds.map((c, i) => (
            <li key={c.id}>
              <button
                type="button"
                onMouseEnter={() => setSel(i)}
                onClick={() => go(c)}
                data-on={i === sel}
                className="flex h-14 w-full items-center gap-3 rounded-[16px] px-3 text-left transition-colors data-[on=true]:bg-white/[0.06]"
              >
                <span className={cn("grid size-9 shrink-0 place-items-center rounded-full", i === sel ? "bg-[#FFD599] text-[#15130F]" : "bg-[#232323] text-[#A9A9A9]")}>
                  <c.icon className="size-[17px]" strokeWidth={2.1} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold">{c.label}</span>
                  <span className="block truncate text-[12.5px] text-[#8C8C8C]">{c.hint}</span>
                </span>
                {i === sel ? <CornerDownLeft className="size-4 text-[#8C8C8C]" /> : null}
              </button>
            </li>
          ))}
          {cmds.length === 0 ? <li className="px-4 py-6 text-center text-[14px] text-[#8C8C8C]">Nada encontrado.</li> : null}
        </ul>
      </div>
    </div>,
    document.body,
  );
}
