import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ImageOff, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * MENU DE UM ITEM (perfume do catálogo, perfume da Negociação…).
 *
 * Mesmo desenho e movimento do menu do pedido (orders/OrderMenu.tsx): nasce
 * do ponto do clique com uma mola (computador) ou sobe de baixo (celular).
 * Topo: quem é o item. Atalhos: até 4 botões grandes. Depois as ações, com o
 * próximo passo em destaque, e por fim as perigosas, separadas e em coral.
 *
 * Abre pelo "⋯" (`ItemMenuButton`), pelo botão direito ou segurando o dedo
 * sobre qualquer elemento com `data-item-id` dentro de `ItemMenuZone`.
 */

export type ItemMenuEntry = {
  key: string;
  label: string;
  icon: ReactNode;
  hint?: string;
  onSelect?: () => void;
  href?: string;
  danger?: boolean;
  primary?: boolean;
  disabled?: boolean;
  /** marcado (ex.: situação atual) */
  active?: boolean;
};

export type ItemMenuSpec = {
  image?: string | null;
  title: string;
  subtitle?: ReactNode;
  quick?: ItemMenuEntry[];
  /** título pequeno acima do grupo de escolhas (ex.: "Situação") */
  choicesLabel?: string;
  choices?: ItemMenuEntry[];
  main?: ItemMenuEntry[];
  danger?: ItemMenuEntry[];
};

export type MenuPos = { x: number; y: number; anchor?: DOMRect | null };

/** Estado do menu de uma tela: `open(pos, spec)` e o elemento para renderizar. */
export function useItemMenu() {
  const [state, setState] = useState<{ pos: MenuPos; spec: ItemMenuSpec; n: number; id?: string } | null>(null);
  const open = useCallback(
    (pos: MenuPos, spec: ItemMenuSpec, id?: string) => setState((s) => ({ pos, spec, id, n: (s?.n ?? 0) + 1 })),
    [],
  );
  const node = state ? <ItemMenu key={state.n} pos={state.pos} spec={state.spec} itemId={state.id} onClose={() => setState(null)} /> : null;
  return { open, node };
}

/** "⋯" que abre o menu embaixo do botão. */
export function ItemMenuButton({
  onOpen,
  className,
  label = "Mais opções",
  size = "md",
}: {
  onOpen: (pos: MenuPos) => void;
  className?: string;
  label?: string;
  size?: "sm" | "md";
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-haspopup="menu"
      onClick={(e) => {
        e.stopPropagation();
        const r = e.currentTarget.getBoundingClientRect();
        onOpen({ x: r.right, y: r.bottom, anchor: r });
      }}
      className={cn(
        "press grid shrink-0 place-items-center rounded-full bg-[#232323] text-white transition-colors duration-200 hover:bg-[#2E2E2E]",
        size === "sm" ? "size-9" : "size-10",
        className,
      )}
    >
      <MoreHorizontal className="size-[18px]" strokeWidth={2.2} />
    </button>
  );
}

/**
 * Área com itens: botão direito (computador) ou segurar ~0,45 s (celular)
 * em qualquer elemento com `data-item-id` chama `onOpen(id, pos)`.
 * Shift + botão direito ainda abre o menu do navegador.
 */
export function ItemMenuZone({
  onOpen,
  children,
  className,
}: {
  onOpen: (id: string, pos: MenuPos) => void;
  children: ReactNode;
  className?: string;
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  const target = (el: EventTarget | null) => {
    if (!(el instanceof Element)) return null;
    if (el.closest("input, textarea, [contenteditable='true']")) return null;
    return el.closest<HTMLElement>("[data-item-id]")?.dataset.itemId ?? null;
  };
  const stop = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  return (
    <div
      className={cn("item-menu-zone", className)}
      onContextMenu={(e) => {
        if (e.shiftKey) return;
        if (fired.current) return void e.preventDefault();
        const id = target(e.target);
        if (!id) return;
        e.preventDefault();
        stop();
        onOpen(id, { x: e.clientX, y: e.clientY });
      }}
      onTouchStart={(e) => {
        const t = e.touches[0];
        const id = e.touches.length === 1 ? target(e.target) : null;
        fired.current = false;
        if (!t || !id) return;
        start.current = { x: t.clientX, y: t.clientY };
        stop();
        timer.current = setTimeout(() => {
          fired.current = true;
          navigator.vibrate?.(8);
          onOpen(id, { ...start.current! });
        }, 450);
      }}
      onTouchMove={(e) => {
        const t = e.touches[0];
        if (t && start.current && Math.hypot(t.clientX - start.current.x, t.clientY - start.current.y) > 8) stop();
      }}
      onTouchEnd={(e) => {
        stop();
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

const W = 316;
const EASE_OUT = "cubic-bezier(0.22, 1, 0.36, 1)";
const SPRING = "cubic-bezier(0.34, 1.56, 0.64, 1)";
const reduced = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function ItemMenu({ pos, spec, itemId, onClose }: { pos: MenuPos; spec: ItemMenuSpec; itemId?: string; onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  const back = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLSpanElement>(null);
  const closing = useRef(false);
  const [place, setPlace] = useState<{ left: number; top: number; ox: number; oy: number } | null>(null);
  const sheet = typeof window !== "undefined" && window.innerWidth < 640;

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
    top = Math.max(m, Math.min(top, vh - m - h));
    setPlace({ left, top, ox: Math.min(W, Math.max(0, pos.x - left)), oy: Math.min(h, Math.max(0, pos.y - top)) });
  }, [pos, sheet]);

  useLayoutEffect(() => {
    const p = panel.current;
    if (!p || (!sheet && !place) || reduced()) return;
    back.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, easing: "ease-out", fill: "both" });
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
      el.animate([from, { opacity: 1, transform: "none" }], {
        duration: kind === "tile" ? 460 : 380,
        delay: 70 + Math.min(i, 14) * 30,
        easing: kind === "tile" ? SPRING : EASE_OUT,
        fill: "both",
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [place?.left, place?.top, sheet]);

  // o item fica marcado enquanto o menu está aberto
  useEffect(() => {
    if (!itemId) return;
    const rows = Array.from(document.querySelectorAll<HTMLElement>(`[data-item-id="${CSS.escape(itemId)}"]`));
    rows.forEach((r) => (r.dataset.menuOpen = "true"));
    return () => rows.forEach((r) => delete r.dataset.menuOpen);
  }, [itemId]);

  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    document.querySelectorAll<HTMLElement>("[data-item-id][data-menu-open]").forEach((r) => delete r.dataset.menuOpen);
    const p = panel.current;
    if (!p || reduced()) return onClose();
    back.current?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: "ease-in", fill: "both" });
    const a = sheet
      ? p.animate([{ transform: "none" }, { transform: "translateY(100%)" }], { duration: 260, easing: "cubic-bezier(0.4, 0, 1, 1)", fill: "both" })
      : p.animate([{ opacity: 1, transform: "scale(1)" }, { opacity: 0, transform: "scale(0.92)" }], { duration: 170, easing: "ease-in", fill: "both" });
    a.onfinish = onClose;
  }, [onClose, sheet]);

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

  const pick = (it: ItemMenuEntry) => {
    if (it.disabled) return;
    close();
    setTimeout(() => it.onSelect?.(), sheet ? 120 : 60);
  };

  let n = 1;
  const row = (it: ItemMenuEntry) => {
    const i = n++;
    const cls = cn(
      "group flex h-11 w-full items-center gap-3 rounded-[14px] px-3 text-left text-[14px] font-semibold outline-none transition-colors duration-200 hover:bg-white/[0.06] focus-visible:bg-white/[0.08] disabled:opacity-40 max-sm:h-12 max-sm:text-[15px]",
      it.danger ? "text-[#FF9A8A]" : "text-white",
      it.primary && "bg-[#FFD599] text-[#15130F] hover:bg-[#FFE0B2] focus-visible:bg-[#FFE0B2]",
    );
    const body = (
      <>
        <span
          className={cn(
            "grid size-5 shrink-0 place-items-center transition-transform duration-300 group-hover:scale-110 [&_svg]:size-[17px]",
            it.primary ? "text-[#15130F]" : it.danger ? "text-[#FF9A8A]" : "text-[#A9A9A9] group-hover:text-white",
          )}
        >
          {it.icon}
        </span>
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
          <button role="menuitem" data-menu-item type="button" disabled={it.disabled} onClick={() => pick(it)} className={cls}>
            {body}
          </button>
        )}
      </li>
    );
  };

  const tile = (it: ItemMenuEntry) => {
    const i = n++;
    const cls =
      "group flex h-[66px] w-full flex-col items-center justify-center gap-1.5 rounded-[18px] bg-[#232323] text-[12px] font-semibold text-[#D4D4D4] outline-none transition-colors duration-200 hover:bg-[#2C2C2C] hover:text-white focus-visible:bg-[#2C2C2C] disabled:opacity-35 [&_svg]:size-[19px] max-sm:h-[74px]";
    const body = (
      <>
        <span className="transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:scale-110">{it.icon}</span>
        <span className="max-w-full truncate px-1">{it.label}</span>
      </>
    );
    return (
      <li key={it.key} data-anim={i} data-kind="tile" role="none">
        {it.href ? (
          <a role="menuitem" data-menu-item href={it.href} target="_blank" rel="noreferrer" onClick={() => close()} className={cls}>
            {body}
          </a>
        ) : (
          <button role="menuitem" data-menu-item type="button" disabled={it.disabled} onClick={() => pick(it)} className={cls}>
            {body}
          </button>
        )}
      </li>
    );
  };

  const choice = (it: ItemMenuEntry) => {
    const i = n++;
    return (
      <li key={it.key} data-anim={i} data-kind="tile" role="none" className="min-w-0">
        <button
          role="menuitemradio"
          aria-checked={!!it.active}
          data-menu-item
          type="button"
          disabled={it.disabled}
          onClick={() => (it.active ? close() : pick(it))}
          className={cn(
            "flex h-10 w-full min-w-0 items-center justify-center gap-1.5 rounded-full px-2 text-[12.5px] font-semibold outline-none transition-colors duration-200 [&_svg]:size-[14px]",
            it.active ? "bg-white text-[#15130F]" : "bg-[#232323] text-[#A9A9A9] hover:bg-[#2C2C2C] hover:text-white focus-visible:bg-[#2C2C2C]",
          )}
        >
          {it.icon}
          <span className="truncate">{it.label}</span>
        </button>
      </li>
    );
  };

  if (typeof document === "undefined") return null;
  const quick = spec.quick ?? [];
  const choices = spec.choices ?? [];
  const main = spec.main ?? [];
  const danger = spec.danger ?? [];

  return createPortal(
    <div className="admin-theme fixed inset-0 z-[95]" onContextMenu={(e) => (e.preventDefault(), close())}>
      <div ref={back} className={cn("absolute inset-0", sheet ? "bg-black/60" : "bg-black/25")} onMouseDown={close} onTouchStart={close} />
      {!pos.anchor ? (
        <span ref={ring} aria-hidden className="pointer-events-none absolute size-[120px] rounded-full border-2 border-white/70 opacity-0" style={{ left: pos.x, top: pos.y }} />
      ) : null}
      <div
        ref={panel}
        role="menu"
        aria-label={spec.title}
        className={cn(
          "absolute flex flex-col bg-[#1A1A1A] text-white shadow-[0_24px_70px_-12px_rgba(0,0,0,0.75)] ring-1 ring-white/[0.08]",
          sheet ? "inset-x-0 bottom-0 max-h-[86dvh] rounded-t-[28px] px-3 pt-2 pb-[calc(env(safe-area-inset-bottom,0px)+14px)]" : "max-h-[calc(100dvh-24px)] rounded-[26px] p-2",
        )}
        style={
          sheet
            ? undefined
            : { width: W, left: place?.left ?? -9999, top: place?.top ?? -9999, transformOrigin: place ? `${place.ox}px ${place.oy}px` : "top left" }
        }
      >
        {sheet ? <span aria-hidden className="mx-auto mb-2 h-1 w-10 shrink-0 rounded-full bg-white/20" /> : null}
        <div className="min-h-0 overflow-y-auto overscroll-contain">
          <div data-anim={0} data-kind="head" className="flex items-center gap-3 px-2 pt-1.5 pb-3">
            {spec.image !== undefined ? (
              <span className="grid size-[46px] shrink-0 place-items-center overflow-hidden rounded-[14px] bg-[#232323] text-[#6F6F6F]">
                {spec.image ? <img src={spec.image} alt="" className="size-full object-cover" /> : <ImageOff className="size-4" />}
              </span>
            ) : null}
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15.5px] leading-tight font-bold">{spec.title}</p>
              {spec.subtitle ? <div className="mt-1 flex min-w-0 items-center gap-1.5 truncate text-[12.5px] text-[#8C8C8C]">{spec.subtitle}</div> : null}
            </div>
          </div>

          {quick.length ? (
            <ul className={cn("grid gap-1.5 px-0.5 pb-2", quick.length >= 4 ? "grid-cols-4" : quick.length === 3 ? "grid-cols-3" : "grid-cols-2")}>
              {quick.map(tile)}
            </ul>
          ) : null}

          {choices.length ? (
            <div className="px-0.5 pb-2">
              {spec.choicesLabel ? <p className="px-2.5 pt-1 pb-1.5 text-[11.5px] font-semibold tracking-wide text-[#6F6F6F] uppercase">{spec.choicesLabel}</p> : null}
              <ul className={cn("grid gap-1.5", choices.length >= 4 ? "grid-cols-2" : "grid-cols-3")}>{choices.map(choice)}</ul>
            </div>
          ) : null}

          {main.length ? <ul className="space-y-0.5">{main.map(row)}</ul> : null}
          {danger.length ? (
            <>
              <div className="mx-3 my-1.5 h-px bg-white/[0.07]" />
              <ul className="space-y-0.5">{danger.map(row)}</ul>
            </>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
