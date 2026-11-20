/**
 * TOPO DO ADMIN NO COMPUTADOR — navegação em pílulas.
 *
 * Símbolo da Orium · Início · Pedidos · Produtos · Compras · Clientes
 * À direita: Copilot, busca (Ctrl K), "+" (novo pedido), engrenagem (Configurações) e o perfil.
 * À direita: busca (abre a paleta de comandos, ⌘K), "+" (novo pedido) e o perfil.
 * O celular continua com a barra inferior e o menu lateral.
 */
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CornerDownLeft, Plus, Search, Settings, ShoppingBag, Store, type LucideIcon } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import symbolLight from "@/assets/orium-symbol-light.png.asset.json";
import { AdminAvatar, NAV_HUBS, displayName, hubActive, navSections } from "@/components/orium/AdminShell";
import { useCopilot } from "@/components/orium/copilot/CopilotPanel";
import { CopilotOrb } from "@/components/orium/copilot/CopilotOrb";

const OPEN_EVENT = "orium:admin-search";
/** Configurações vira a engrenagem da direita: sobra espaço para as áreas do dia a dia. */
const SETTINGS_TO = "/admin/configuracoes";

export const openAdminSearch = () => window.dispatchEvent(new Event(OPEN_EVENT));

export function AdminTopBar({ pathname, orders }: { pathname: string; orders: number }) {
  const { session, role } = useAuth();
  // lido na hora (AdminShell importa este arquivo: nada de NAV_HUBS no topo do módulo)
  const settings = NAV_HUBS.find((h) => h.to === SETTINGS_TO)!;
  const name = displayName(session) || (session?.user.email ?? "").replace(/@.*/, "");

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
          {NAV_HUBS.filter((h) => h.to !== SETTINGS_TO).map((item) => {
            const active = hubActive(pathname, item);
            const count = item.badge === "orders" ? orders : 0;
            return (
              <Link
                key={item.to}
                to={item.to}
                preload="intent"
                activeOptions={{ exact: true }}
                data-active={active}
                aria-current={active ? "page" : undefined}
                className="adm-pill press"
              >
                {item.label}
                {count > 0 ? <span className="adm-pill-count">{count > 99 ? "99+" : count}</span> : null}
              </Link>
            );
          })}
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
          <Link
            to={SETTINGS_TO}
            preload="intent"
            aria-label="Configurações"
            title="Configurações"
            data-active={hubActive(pathname, settings)}
            aria-current={hubActive(pathname, settings) ? "page" : undefined}
            className="press grid size-12 place-items-center rounded-full border border-white/[0.08] bg-[#161616] text-white transition-colors hover:border-white/20 hover:bg-[#1F1F1F] data-[active=true]:border-transparent data-[active=true]:bg-white data-[active=true]:text-[#15130F]"
          >
            <Settings className="size-5" strokeWidth={2.1} />
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
    const sections: Cmd[] = navSections().map((i) => ({ id: i.to, label: i.label, hint: i.label === i.hub ? "Área" : i.hub, icon: i.icon, to: i.to }));
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
