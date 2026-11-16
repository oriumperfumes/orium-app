import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal } from "lucide-react";
import { brl } from "@/lib/format";
import { cn } from "@/lib/utils";
import { OrderPhotos } from "./ident";

/**
 * Menu do pedido: abre no "⋯" do pedido, com o botão direito em qualquer
 * pedido da lista (computador) ou segurando o dedo (celular).
 *
 * Topo: quem é o pedido (fotos, nome, número, total, etapa).
 * Atalhos: 4 botões grandes (Abrir, Editar, WhatsApp, Copiar).
 * Ações: o próximo passo do pedido em destaque + o resto.
 * Fim: cancelar / lixeira, separados e em coral.
 */

export type MenuItem = {
  key: string;
  label: string;
  icon: ReactNode;
  hint?: string;
  onSelect?: (at?: { x: number; y: number }) => void;
  href?: string;
  danger?: boolean;
  /** próximo passo do pedido: aparece em destaque */
  primary?: boolean;
  disabled?: boolean;
};
export type OrderMenuModel = { quick: MenuItem[]; main: MenuItem[]; danger: MenuItem[] };
export type OrderMenuInfo = { phase?: { label: string; dot: string } | null; total: number };

type Pos = { x: number; y: number; anchor?: DOMRect | null };
type Ctx = { open: (o: any, pos: Pos) => void };
const MenuCtx = createContext<Ctx | null>(null);

export function OrderMenuProvider({
  children,
  build,
  linesOf,
  imageOf,
  infoOf,
}: {
  children: ReactNode;
  build: (o: any) => OrderMenuModel;
  linesOf: (o: any) => any[];
  imageOf: (l: any) => string | null | undefined;
  infoOf: (o: any) => OrderMenuInfo;
}) {
  const [state, setState] = useState<{ o: any; pos: Pos; n: number } | null>(null);
  const open = useCallback((o: any, pos: Pos) => setState((s) => ({ o, pos, n: (s?.n ?? 0) + 1 })), []);
  const value = useMemo(() => ({ open }), [open]);
  return (
    <MenuCtx.Provider value={value}>
      {children}
      {state ? (
        <OrderMenu
          key={state.n}
          o={state.o}
          pos={state.pos}
          model={build(state.o)}
          lines={linesOf(state.o)}
          imageOf={imageOf}
          info={infoOf(state.o)}
          onClose={() => setState(null)}
        />
      ) : null}
    </MenuCtx.Provider>
  );
}

/**
 * Área de pedidos: botão direito (computador) ou segurar o dedo (~0,45 s,
 * celular) em qualquer linha/cartão com `data-order-id` abre o menu daquele
 * pedido. Shift + botão direito ainda abre o menu do navegador.
 */
export function OrderMenuZone({ orderOf, children, className }: { orderOf: (id: string) => any; children: ReactNode; className?: string }) {
  const ctx = useContext(MenuCtx);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  const target = (el: EventTarget | null) => {
    if (!(el instanceof Element)) return null;
    // campos de texto continuam com o menu normal (copiar/colar)
    if (el.closest("input, textarea, [contenteditable='true']")) return null;
    const id = el.closest<HTMLElement>("[data-order-id]")?.dataset.orderId;
    return id ? orderOf(id) : null;
  };
  const stop = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  return (
    <div
      className={cn("order-menu-zone", className)}
      onContextMenu={(e) => {
        if (!ctx || e.shiftKey) return;
        // no celular o "segurar" já abriu o menu; o menu do sistema não aparece
        if (fired.current) return void e.preventDefault();
        const o = target(e.target);
        if (!o) return;
        e.preventDefault();
        stop();
        ctx.open(o, { x: e.clientX, y: e.clientY });
      }}
      onTouchStart={(e) => {
        const t = e.touches[0];
        const o = ctx && e.touches.length === 1 ? target(e.target) : null;
        fired.current = false;
        if (!t || !o) return;
        start.current = { x: t.clientX, y: t.clientY };
        stop();
        timer.current = setTimeout(() => {
          fired.current = true;
          navigator.vibrate?.(8);
          ctx!.open(o, { ...start.current! });
        }, 450);
      }}
      onTouchMove={(e) => {
        const t = e.touches[0];
        if (t && start.current && Math.hypot(t.clientX - start.current.x, t.clientY - start.current.y) > 8) stop();
      }}
      onTouchEnd={(e) => {
        stop();
        // segurou para abrir o menu: soltar o dedo não abre o pedido
        if (fired.current && e.cancelable) e.preventDefault();
      }}
      onTouchCancel={stop}
      onClickCapture={(e) => {
        if (fired.current) {
          e.stopPropagation();
          e.preventDefault();
          fired.current = false;
        }
      }}
    >
      {children}
    </div>
  );
}

/** O "⋯" do pedido (painel do pedido): abre o mesmo menu embaixo do botão. */
export function OrderMenuButton({ o, className }: { o: any; className?: string }) {
  const ctx = useContext(MenuCtx);
  if (!ctx) return null;
  return (
    <button
      type="button"
      aria-label="Mais opções do pedido"
      aria-haspopup="menu"
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        ctx.open(o, { x: r.right, y: r.bottom, anchor: r });
      }}
      className={cn("press grid size-11 shrink-0 place-items-center rounded-full bg-[#1F1F1F] text-white hover:bg-[#2A2A2A]", className)}
    >
      <MoreHorizontal className="size-5" strokeWidth={2} />
    </button>
  );
}

const W = 312;
const EASE_OUT = "cubic-bezier(0.22, 1, 0.36, 1)";
const SPRING = "cubic-bezier(0.34, 1.56, 0.64, 1)";
const reduced = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function OrderMenu({
  o,
  pos,
  model,
  lines,
  imageOf,
  info,
  onClose,
}: {
  o: any;
  pos: Pos;
  model: OrderMenuModel;
  lines: any[];
  imageOf: (l: any) => string | null | undefined;
  info: OrderMenuInfo;
  onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const back = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLSpanElement>(null);
  const closing = useRef(false);
  const [place, setPlace] = useState<{ left: number; top: number; ox: number; oy: number } | null>(null);
  const sheet = typeof window !== "undefined" && window.innerWidth < 640;

  // posição: perto do clique, sempre dentro da tela
  useLayoutEffect(() => {
    if (sheet || !panel.current) return;
    const h = panel.current.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const m = 12;
    let left = pos.anchor ? pos.anchor.right - W : pos.x + 6;
    let top = pos.anchor ? pos.anchor.bottom + 8 : pos.y + 6;
    if (left + W > vw - m) left = pos.anchor ? vw - m - W : pos.x - W - 6;
    if (top + h > vh - m) top = pos.anchor ? pos.anchor.top - h - 8 : Math.max(m, vh - m - h);
    left = Math.max(m, Math.min(left, vw - m - W));
    top = Math.max(m, top);
    setPlace({ left, top, ox: Math.min(W, Math.max(0, pos.x - left)), oy: Math.min(h, Math.max(0, pos.y - top)) });
  }, [pos, sheet]);

  // entrada: o painel nasce do ponto do clique, com uma mola; o conteúdo vem em cascata
  useLayoutEffect(() => {
    const p = panel.current;
    if (!p || (!sheet && !place) || reduced()) return;
    back.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, easing: "ease-out", fill: "both" });
    // onda no ponto do clique: o menu "nasce" dali
    if (!pos.anchor && ring.current) {
      ring.current.animate(
        [
          { opacity: 0.5, transform: "translate(-50%, -50%) scale(0.2)" },
          { opacity: 0, transform: "translate(-50%, -50%) scale(1)" },
        ],
        { duration: 560, easing: EASE_OUT, fill: "both" },
      );
    }
    if (sheet) {
      p.animate([{ transform: "translateY(100%)" }, { transform: "none" }], { duration: 520, easing: "cubic-bezier(0.2, 0.9, 0.1, 1)", fill: "both" });
    } else {
      p.animate(
        [
          { opacity: 0, transform: "scale(0.6)", borderRadius: "40px" },
          { opacity: 1, offset: 0.35 },
          { opacity: 1, transform: "scale(1)", borderRadius: "26px" },
        ],
        { duration: 520, easing: SPRING, fill: "both" },
      );
    }
    p.querySelectorAll<HTMLElement>("[data-anim]").forEach((el) => {
      const i = Number(el.dataset.anim);
      const kind = el.dataset.kind;
      const from =
        kind === "tile"
          ? { opacity: 0, transform: "translateY(10px) scale(0.85)" }
          : kind === "head"
            ? { opacity: 0, transform: "translateY(-6px)" }
            : { opacity: 0, transform: "translateX(-10px)" };
      el.animate([from, { opacity: 1, transform: "none" }], { duration: kind === "tile" ? 460 : 380, delay: 70 + i * 32, easing: kind === "tile" ? SPRING : EASE_OUT, fill: "both" });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [place?.left, place?.top, sheet]);

  // a linha do pedido fica marcada enquanto o menu está aberto
  useEffect(() => {
    const rows = Array.from(document.querySelectorAll<HTMLElement>(`[data-order-id="${CSS.escape(String(o.id))}"]`));
    rows.forEach((r) => (r.dataset.menuOpen = "true"));
    return () => rows.forEach((r) => delete r.dataset.menuOpen);
  }, [o.id]);

  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    document.querySelectorAll<HTMLElement>("[data-menu-open]").forEach((r) => delete r.dataset.menuOpen);
    const p = panel.current;
    if (!p || reduced()) return onClose();
    back.current?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: "ease-in", fill: "both" });
    const a = sheet
      ? p.animate([{ transform: "none" }, { transform: "translateY(100%)" }], { duration: 260, easing: "cubic-bezier(0.4, 0, 1, 1)", fill: "both" })
      : p.animate([{ opacity: 1, transform: "scale(1)" }, { opacity: 0, transform: "scale(0.92)" }], { duration: 170, easing: "ease-in", fill: "both" });
    a.onfinish = onClose;
  }, [onClose, sheet]);

  // teclado: setas andam, Enter escolhe, Esc fecha; rolar/redimensionar fecha
  useEffect(() => {
    const items = () => Array.from(panel.current?.querySelectorAll<HTMLElement>("[data-menu-item]:not([disabled])") ?? []);
    const t = setTimeout(() => items()[0]?.focus({ preventScroll: true }), 60);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return close();
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Tab") return;
      e.preventDefault();
      const list = items();
      const i = list.indexOf(document.activeElement as HTMLElement);
      const dir = e.key === "ArrowUp" || (e.key === "Tab" && e.shiftKey) ? -1 : 1;
      list[(i + dir + list.length) % list.length]?.focus();
    };
    const onScroll = (e: Event) => {
      if (panel.current && e.target instanceof Node && panel.current.contains(e.target)) return;
      if (!sheet) close();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [close, sheet]);

  const pick = (it: MenuItem, e: React.MouseEvent) => {
    if (it.disabled) return;
    const at = { x: e.clientX, y: e.clientY };
    close();
    // a ação roda logo depois, para o menu sair primeiro
    setTimeout(() => it.onSelect?.(at), sheet ? 120 : 60);
  };

  let n = 0;
  const row = (it: MenuItem) => {
    const i = n++;
    const cls = cn(
      "group flex h-11 w-full items-center gap-3 rounded-[14px] px-3 text-left text-[14px] font-semibold outline-none transition-colors duration-200 hover:bg-white/[0.06] focus-visible:bg-white/[0.08] disabled:opacity-40 max-sm:h-12 max-sm:text-[15px]",
      it.danger ? "text-[#FF9A8A]" : "text-white",
      it.primary && "bg-[#FFD599] text-[#15130F] hover:bg-[#FFE0B2] focus-visible:bg-[#FFE0B2]",
    );
    const icon = (
      <span
        className={cn(
          "grid size-5 shrink-0 place-items-center transition-transform duration-300 group-hover:scale-110 [&_svg]:size-[17px]",
          it.primary ? "text-[#15130F]" : it.danger ? "text-[#FF9A8A]" : "text-[#A9A9A9] group-hover:text-white",
        )}
      >
        {it.icon}
      </span>
    );
    const body = (
      <>
        {icon}
        <span className="min-w-0 flex-1 truncate">{it.label}</span>
        {it.hint ? <span className={cn("shrink-0 text-[12px] font-medium", it.primary ? "text-[#15130F]/60" : "text-[#6F6F6F]")}>{it.hint}</span> : null}
      </>
    );
    return (
      <li key={it.key} data-anim={i} role="none">
        {it.href ? (
          <a role="menuitem" data-menu-item href={it.href} target="_blank" rel="noreferrer" onClick={() => close()} className={cls}>
            {body}
          </a>
        ) : (
          <button role="menuitem" data-menu-item type="button" disabled={it.disabled} onClick={(e) => pick(it, e)} className={cls}>
            {body}
          </button>
        )}
      </li>
    );
  };

  const tile = (it: MenuItem, i: number) => {
    const cls =
      "group flex h-[66px] flex-col items-center justify-center gap-1.5 rounded-[18px] bg-[#232323] text-[12px] font-semibold text-[#D4D4D4] outline-none transition-colors duration-200 hover:bg-[#2C2C2C] hover:text-white focus-visible:bg-[#2C2C2C] disabled:opacity-35 [&_svg]:size-[19px] max-sm:h-[74px]";
    const body = (
      <>
        <span className="transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:scale-110">{it.icon}</span>
        {it.label}
      </>
    );
    return (
      <li key={it.key} data-anim={i} data-kind="tile" role="none">
        {it.href ? (
          <a role="menuitem" data-menu-item href={it.href} target="_blank" rel="noreferrer" onClick={() => close()} className={cls}>
            {body}
          </a>
        ) : (
          <button role="menuitem" data-menu-item type="button" disabled={it.disabled} onClick={(e) => pick(it, e)} className={cn(cls, "w-full")}>
            {body}
          </button>
        )}
      </li>
    );
  };

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="admin-theme fixed inset-0 z-[95]" onContextMenu={(e) => (e.preventDefault(), close())}>
      <div ref={back} className={cn("absolute inset-0", sheet ? "bg-black/60" : "bg-black/25")} onMouseDown={close} onTouchStart={close} />
      {!pos.anchor ? (
        <span
          ref={ring}
          aria-hidden
          className="pointer-events-none absolute size-[120px] rounded-full border-2 border-white/70 opacity-0"
          style={{ left: pos.x, top: pos.y }}
        />
      ) : null}
      <div
        ref={panel}
        role="menu"
        aria-label={`Pedido de ${o.customer_name ?? "cliente"}`}
        className={cn(
          "absolute flex flex-col bg-[#1A1A1A] text-white shadow-[0_24px_70px_-12px_rgba(0,0,0,0.75)] ring-1 ring-white/[0.08]",
          sheet
            ? "inset-x-0 bottom-0 max-h-[86dvh] rounded-t-[28px] px-3 pt-2 pb-[calc(env(safe-area-inset-bottom,0px)+14px)]"
            : "rounded-[26px] p-2",
        )}
        style={
          sheet
            ? undefined
            : {
                width: W,
                left: place?.left ?? -9999,
                top: place?.top ?? -9999,
                transformOrigin: place ? `${place.ox}px ${place.oy}px` : "top left",
              }
        }
      >
        {sheet ? <span aria-hidden className="mx-auto mb-2 h-1 w-10 shrink-0 rounded-full bg-white/20" /> : null}
        <div className="min-h-0 overflow-y-auto overscroll-contain">
          {/* quem é o pedido */}
          <div data-anim={0} data-kind="head" className="flex items-center gap-3 px-2 pt-1.5 pb-3">
            <OrderPhotos lines={lines} imageOf={imageOf} size={46} radius={14} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15.5px] leading-tight font-bold">{o.customer_name || "Cliente"}</p>
              <p className="mt-1 flex min-w-0 items-center gap-1.5 text-[12.5px] text-[#8C8C8C]">
                <span className="shrink-0 tabular-nums">{o.order_number ? `#${String(o.order_number).replace(/^OR-/, "")}` : "Pedido"}</span>
                <span className="text-[#3A3A3A]">·</span>
                <span className="shrink-0 font-semibold text-[#D4D4D4] tabular-nums">{brl(info.total)}</span>
                {info.phase ? (
                  <>
                    <span className="text-[#3A3A3A]">·</span>
                    <span className="size-1.5 shrink-0 rounded-full" style={{ background: info.phase.dot }} />
                    <span className="truncate">{info.phase.label}</span>
                  </>
                ) : null}
              </p>
            </div>
          </div>

          {model.quick.length ? <ul className="grid grid-cols-4 gap-1.5 px-0.5 pb-2">{model.quick.map((q, i) => tile(q, i + 1))}</ul> : null}

          {model.main.length ? <ul className="space-y-0.5">{model.main.map(row)}</ul> : null}
          {model.danger.length ? (
            <>
              <div className="mx-3 my-1.5 h-px bg-white/[0.07]" />
              <ul className="space-y-0.5">{model.danger.map(row)}</ul>
            </>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
