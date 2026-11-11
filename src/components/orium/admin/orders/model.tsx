/**
 * PEDIDOS — peças compartilhadas do quadro, do painel e do lançamento.
 * Só leitura do que vem do banco; nenhuma regra de preço aqui.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";
import { useBackToClose } from "@/hooks/use-back-to-close";
import { paymentInfo } from "@/components/orium/admin/OrderPayment";
import { dayLabel, dueInfo } from "./controls";
import { deliveryState, fmtTime } from "@/lib/delivery";
import { cn } from "@/lib/utils";

/** As três colunas do quadro. Cancelados e lixeira ficam na lista. */
export type Stage = "novo" | "pago" | "entregue";
export const STAGES: Array<{ key: Stage; title: string; hint: string; status: string }> = [
  { key: "novo", title: "Novos", hint: "aguardando pagamento", status: "pendente" },
  { key: "pago", title: "Pagos", hint: "separar e entregar", status: "pedido feito" },
  { key: "entregue", title: "Entregues", hint: "concluídos", status: "entregue" },
];

export function stageOf(o: any): Stage | null {
  if (o.deleted_at || o.status === "cancelado") return null;
  if (o.status === "entregue") return "entregue";
  if (o.status === "pedido feito") return "pago";
  return "novo";
}

export const orderTotal = (o: any) => Number(o?.final_total ?? o?.grand_total ?? o?.sales_total ?? 0);

export const initials = (name: string | null | undefined) =>
  (name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "?";

/** "agora", "há 12 min", "há 3 h", "ontem", "há 4 dias", "12 out". */
export function timeAgo(iso: string | null | undefined) {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.round(ms / 60_000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.round(h / 24);
  if (d === 1) return "ontem";
  if (d < 7) return `há ${d} dias`;
  return new Date(iso).toLocaleDateString("pt-BR", { day: "numeric", month: "short", timeZone: "America/Sao_Paulo" }).replace(".", "").replace(" de ", " ");
}

export const ORIGIN: Record<string, string> = {
  CATALOG: "App",
  CATALOGO_WHATSAPP: "App",
  MANUAL: "Balcão",
  WHATSAPP: "WhatsApp",
};
export const originOf = (o: any) => ORIGIN[o.order_origin ?? o.origin ?? "CATALOG"] ?? "App";

/** Barra fina de pagamento: quanto do total já entrou. */
export function PayBar({ order, className }: { order: any; className?: string }) {
  const p = paymentInfo(order);
  const share = p.total > 0 ? Math.min(100, (p.paid / p.total) * 100) : 0;
  return (
    <div className={cn("min-w-0", className)}>
      <div className="flex items-center justify-between gap-2 text-[12px] font-semibold">
        <span className={p.status === "paid" ? "text-[#7FCF9F]" : p.status === "partial" ? "text-[#FFD599]" : "text-[#8C8C8C]"}>
          {p.status === "paid" ? "Pago" : p.status === "partial" ? `Sinal ${brlShort(p.paid)}` : "Não pago"}
        </span>
        {(() => {
          const d = dueInfo(order);
          if (order.status === "entregue" && p.due > 0) return <span className="rounded-full bg-[#2A1A18] px-2 py-px text-[11px] text-[#FF9A8A]">entregue devendo {brlShort(p.due)}</span>;
          if (d.state === "late") return <span className="rounded-full bg-[#2A1A18] px-2 py-px text-[11px] text-[#FF9A8A]">pagamento atrasado</span>;
          if (d.state === "today") return <span className="rounded-full bg-[#FFD599] px-2 py-px text-[11px] text-[#15130F]">paga hoje</span>;
          if (d.state !== "none") return <span className="text-[#8C8C8C]">paga {dayLabel(d.date).toLowerCase()}</span>;
          return p.status === "partial" ? <span className="text-[#A9A9A9] tabular-nums">falta {brlShort(p.due)}</span> : null;
        })()}
      </div>
      <div className="ord-progress mt-1.5 h-[5px] overflow-hidden rounded-full bg-[#2E2E2E]">
        <span
          className={cn("block h-full rounded-full", p.status === "paid" ? "bg-[#7FCF9F]" : "bg-[#FFD599]")}
          style={{ width: `${share}%` }}
        />
      </div>
    </div>
  );
}

const brlShort = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });

/** Etiqueta de entrega: atrasada (vermelha), hoje (dourada), amanhã, data. */
export function DeliveryChip({ order, className }: { order: any; className?: string }) {
  const st = deliveryState(order);
  if (st === "none" || st === "done" || !order.expected_delivery_date) return null;
  const ymd = String(order.expected_delivery_date).slice(0, 10);
  const time = fmtTime(order.expected_delivery_time);
  const label =
    st === "late" ? "Atrasada" : st === "today" ? "Hoje" : st === "tomorrow" ? "Amanhã" : `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1 rounded-full px-2.5 text-[11.5px] font-bold tabular-nums",
        st === "late" ? "bg-[#2A1A18] text-[#FF9A8A]" : st === "today" ? "bg-[#FFD599] text-[#15130F]" : "bg-[#2A2A2A] text-white",
        className,
      )}
    >
      {label}
      {time ? <span className="font-semibold opacity-80">· {time}</span> : null}
    </span>
  );
}

/** Fotos empilhadas dos itens (até 3) + "+N". */
export function PhotoStack({ images, more, size = 40 }: { images: Array<string | null | undefined>; more: number; size?: number }) {
  return (
    <div className="flex items-center">
      {images.slice(0, 3).map((src, i) => (
        <span
          key={i}
          className="grid shrink-0 place-items-center overflow-hidden rounded-[12px] bg-white ring-[3px] ring-[#1F1F1F]"
          style={{ width: size, height: size, marginLeft: i ? -size * 0.28 : 0, zIndex: 3 - i }}
        >
          {src ? <img src={src} alt="" loading="lazy" className="size-full object-contain p-[3px]" /> : <span className="size-2 rounded-full bg-[#ccc]" />}
        </span>
      ))}
      {more > 0 ? (
        <span
          className="grid shrink-0 place-items-center rounded-[12px] bg-[#2E2E2E] text-[12px] font-bold ring-[3px] ring-[#1F1F1F]"
          style={{ width: size, height: size, marginLeft: -size * 0.28 }}
        >
          +{more}
        </span>
      ) : null}
    </div>
  );
}

const EASE = "cubic-bezier(0.2, 0.9, 0.1, 1)";
const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Painel do Admin com "transformação de contêiner": quando vem de um cartão
 * (`originEl`), o painel nasce do retângulo do cartão e cresce até o lugar;
 * ao fechar, encolhe de volta para o cartão. Sem cartão, desliza da direita
 * (computador) ou de baixo (celular). Fecha no ✕, no fundo, no Esc e no voltar.
 */
export function SidePanel({
  open,
  onClose,
  label,
  wide,
  originEl,
  children,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  /** largura extra (lançamento de pedido) */
  wide?: boolean;
  /** cartão de onde o painel nasce (e para onde volta) */
  originEl?: HTMLElement | null;
  children: ReactNode;
}) {
  const [mounted, setMounted] = useState(open);
  const panelRef = useRef<HTMLDivElement>(null);
  const backRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const originRef = useRef<HTMLElement | null>(null);
  if (open && originEl) originRef.current = originEl;

  useBodyScrollLock(open);
  useBackToClose(open, onClose);
  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open, onClose]);

  // entrada
  useLayoutEffect(() => {
    if (!open || !mounted) return;
    const panel = panelRef.current;
    const back = backRef.current;
    const body = bodyRef.current;
    if (!panel || !back || !body) return;
    if (reduced()) return;
    back.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 320, easing: "ease-out", fill: "both" });
    const from = morphFrom(panel, originRef.current);
    if (from) {
      originRef.current!.style.visibility = "hidden";
      panel.animate([from, { transform: "none", borderRadius: getComputedStyle(panel).borderRadius || "32px" }], { duration: 620, easing: EASE, fill: "both" });
      body.animate([{ opacity: 0, transform: "translateY(18px)" }, { opacity: 1, transform: "none" }], { duration: 380, delay: 220, easing: EASE, fill: "both" });
    } else {
      panel.animate([{ transform: slideOff() }, { transform: "none" }], { duration: 480, easing: EASE, fill: "both" });
      body.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay: 120, easing: "ease-out", fill: "both" });
    }
  }, [open, mounted]);

  // saída
  useEffect(() => {
    if (open || !mounted) return;
    const panel = panelRef.current;
    const back = backRef.current;
    const body = bodyRef.current;
    const origin = originRef.current;
    const finish = () => {
      if (origin) origin.style.visibility = "";
      originRef.current = null;
      setMounted(false);
    };
    if (!panel || !back || !body || reduced()) return finish();
    back.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 360, easing: "ease-in", fill: "both" });
    const to = origin && origin.isConnected ? morphFrom(panel, origin) : null;
    let anim: Animation;
    if (to) {
      body.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140, easing: "ease-out", fill: "both" });
      anim = panel.animate([{ transform: "none" }, to], { duration: 460, easing: EASE, fill: "both" });
    } else {
      if (origin) origin.style.visibility = "";
      anim = panel.animate([{ transform: "none" }, { transform: slideOff() }], { duration: 380, easing: "cubic-bezier(0.4, 0, 1, 1)", fill: "both" });
    }
    anim.onfinish = finish;
    return () => {
      anim.onfinish = null;
    };
  }, [open, mounted]);

  if (!mounted || typeof document === "undefined") return null;
  return createPortal(
    <div className="admin-theme fixed inset-0 z-50" role="dialog" aria-modal aria-label={label}>
      <div ref={backRef} className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div
        ref={panelRef}
        className={cn(
          "absolute inset-x-0 bottom-0 flex h-[100dvh] origin-top-left flex-col overflow-hidden bg-[#121212] text-white will-change-transform lg:inset-y-3 lg:right-3 lg:left-auto lg:h-auto lg:rounded-[32px] lg:border lg:border-white/[0.07]",
          wide ? "lg:w-[min(1180px,calc(100vw-24px))]" : "lg:w-[560px]",
        )}
      >
        <div ref={bodyRef} className="flex min-h-0 flex-1 flex-col">
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Quadro-chave que encaixa o painel em cima do cartão de origem. */
function morphFrom(panel: HTMLElement, origin: HTMLElement | null): Keyframe | null {
  if (!origin || !origin.isConnected) return null;
  const o = origin.getBoundingClientRect();
  if (o.width < 10 || o.bottom < 0 || o.top > window.innerHeight) return null;
  const f = panel.getBoundingClientRect();
  const sx = o.width / f.width;
  const sy = o.height / f.height;
  return {
    transform: `translate(${o.left - f.left}px, ${o.top - f.top}px) scale(${sx}, ${sy})`,
    borderRadius: `${22 / sx}px / ${22 / sy}px`,
  };
}

const slideOff = () => (window.matchMedia("(min-width: 64rem)").matches ? "translate3d(calc(100% + 24px),0,0)" : "translate3d(0,100%,0)");

/**
 * Explosão curta de partículas douradas e brancas num ponto da tela
 * (pedido entregue, pedido criado). Some sozinha; respeita movimento reduzido.
 */
export function burst(x: number, y: number, count = 22) {
  if (typeof document === "undefined" || reduced()) return;
  const layer = document.createElement("div");
  layer.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:90;overflow:hidden";
  document.body.appendChild(layer);
  const colors = ["#FFD599", "#FFD599", "#FFFFFF", "#F5C26B", "#7FCF9F"];
  for (let i = 0; i < count; i++) {
    const p = document.createElement("span");
    const size = 5 + Math.random() * 6;
    const round = Math.random() > 0.5;
    p.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:${size}px;height:${round ? size : size * 0.45}px;border-radius:${round ? "999px" : "2px"};background:${colors[i % colors.length]}`;
    layer.appendChild(p);
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.5;
    const dist = 60 + Math.random() * 110;
    const dx = Math.cos(angle) * dist;
    const dy = Math.sin(angle) * dist - 40;
    p.animate(
      [
        { transform: "translate(-50%,-50%) scale(0.4) rotate(0deg)", opacity: 1 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(1) rotate(${Math.random() * 360}deg)`, opacity: 1, offset: 0.55 },
        { transform: `translate(calc(-50% + ${dx * 1.15}px), calc(-50% + ${dy + 90}px)) scale(0.8) rotate(${Math.random() * 540}deg)`, opacity: 0 },
      ],
      { duration: 900 + Math.random() * 400, easing: "cubic-bezier(0.15, 0.7, 0.3, 1)", fill: "both" },
    );
  }
  setTimeout(() => layer.remove(), 1500);
}

export function PanelClose({ onClose, className }: { onClose: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClose}
      aria-label="Fechar"
      className={cn("press grid size-11 shrink-0 place-items-center rounded-full bg-[#1F1F1F] text-white transition-colors hover:bg-[#2A2A2A]", className)}
    >
      <X className="size-5" strokeWidth={2.2} />
    </button>
  );
}
