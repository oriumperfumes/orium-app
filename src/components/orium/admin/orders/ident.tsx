import { useEffect, useState } from "react";
import { ChevronDown, Sparkles } from "lucide-react";
import { brl } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Identificar o pedido de relance (Painel, Quadro e Lista):
 * - foto montada com TODOS os perfumes (2 = metade/metade, 3 = 1 + 2, 4+ = grade);
 * - nomes com quantidade ("2× Bidaya Gris · Black Exposed");
 * - selo "Atacado";
 * - "ver perfumes" abre a lista ali mesmo, sem abrir o pedido.
 */

type ImageOf = (l: any) => string | null | undefined;

/** um perfume por foto (2 linhas do mesmo perfume = 1 foto) */
function photosOf(lines: any[], imageOf: ImageOf) {
  const seen = new Set<string>();
  const out: Array<{ key: string; src: string | null | undefined; name: string }> = [];
  for (const l of lines) {
    const key = String(l.product_id ?? l.product_name_snapshot ?? l.id);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, src: imageOf(l), name: l.product_name_snapshot ?? "" });
  }
  return out;
}

function Cell({ src, className }: { src: string | null | undefined; className?: string }) {
  return (
    <span className={cn("relative grid min-h-0 min-w-0 place-items-center overflow-hidden bg-white", className)}>
      {src ? <img src={src} alt="" loading="lazy" className="size-full object-contain p-[3px]" /> : <Sparkles className="size-3 text-[#15130F]/30" />}
    </span>
  );
}

/** Foto do pedido com todos os perfumes. `size` em px. */
export function OrderPhotos({ lines, imageOf, size = 48, radius = 14 }: { lines: any[]; imageOf: ImageOf; size?: number; radius?: number }) {
  const ph = photosOf(lines, imageOf);
  const n = ph.length;
  const style = { width: size, height: size, borderRadius: radius };
  if (n <= 1) {
    return (
      <span className="grid shrink-0 overflow-hidden" style={style}>
        <Cell src={ph[0]?.src} className="p-[2px]" />
      </span>
    );
  }
  const extra = n - 4;
  return (
    <span
      className={cn("grid shrink-0 gap-px overflow-hidden bg-[#DADADA]", n === 2 ? "grid-cols-2" : "grid-cols-2 grid-rows-2")}
      style={style}
      aria-label={`${n} perfumes`}
    >
      {n === 2 ? (
        <>
          <Cell src={ph[0]!.src} />
          <Cell src={ph[1]!.src} />
        </>
      ) : n === 3 ? (
        <>
          <Cell src={ph[0]!.src} className="row-span-2" />
          <Cell src={ph[1]!.src} />
          <Cell src={ph[2]!.src} />
        </>
      ) : (
        <>
          <Cell src={ph[0]!.src} />
          <Cell src={ph[1]!.src} />
          <Cell src={ph[2]!.src} />
          <span className="relative min-h-0 min-w-0">
            <Cell src={ph[3]!.src} className="size-full" />
            {extra > 0 ? (
              <span className="absolute inset-0 grid place-items-center bg-[#15130F]/75 text-[11px] font-bold text-white">+{extra}</span>
            ) : null}
          </span>
        </>
      )}
    </span>
  );
}

/** "2× Bidaya Gris · Black Exposed · Decant Asad 5ml" */
export function itemsText(lines: any[]) {
  if (!lines.length) return "Sem itens";
  return lines
    .map((l) => {
      const q = Number(l.quantity ?? 1);
      const name = l.product_name_snapshot ?? "Perfume";
      const dec = l.variant === "DECANT" ? ` ${l.decant_ml ?? ""}ml` : "";
      return `${q > 1 ? `${q}× ` : ""}${l.variant === "DECANT" ? "Decant " : ""}${name}${dec}`;
    })
    .join(" · ");
}

/** Selo "Atacado" (pedido com preço de atacado). */
export function TierBadge({ o, className }: { o: any; className?: string }) {
  if (o?.pricing_tier !== "atacado") return null;
  return <span className={cn("shrink-0 rounded-full bg-[#2A2418] px-2 py-px text-[11px] font-bold text-[#FFD599]", className)}>Atacado</span>;
}

/** Botão "ver perfumes" (não abre o pedido). */
export function ExpandButton({ open, count, onToggle, className }: { open: boolean; count: number; onToggle: () => void; className?: string }) {
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      onKeyDown={(e) => e.stopPropagation()}
      className={cn(
        "press inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2.5 text-[12px] font-semibold transition-colors",
        open ? "bg-white text-[#15130F]" : "bg-[#2A2A2A] text-[#D4D4D4] hover:text-white",
        className,
      )}
    >
      {count} {count === 1 ? "perfume" : "perfumes"}
      <ChevronDown className={cn("size-3.5 transition-transform duration-[420ms] ease-[cubic-bezier(0.22,1,0.36,1)]", open && "rotate-180")} strokeWidth={2.4} />
    </button>
  );
}

/** Os perfumes do pedido, abertos embaixo da linha. */
export function ItemsExpand({ lines, imageOf, o }: { lines: any[]; imageOf: ImageOf; o: any }) {
  const partial = lines.length > 1 && lines.some((l) => l.paid) && !lines.every((l) => l.paid);
  return (
    <div className="mt-1.5 rounded-[18px] bg-[#1A1A1A] p-2">
      <ul className="ui-stagger space-y-1">
        {lines.map((l, i) => {
          const img = imageOf(l);
          const sold = Number(l.unit_sale_price ?? 0);
          const decant = l.variant === "DECANT";
          return (
            <li key={l.id} style={{ ["--i" as string]: i }} className="flex min-w-0 items-center gap-3 rounded-[14px] px-1.5 py-1.5">
              <span className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-[12px] bg-white">
                {img ? <img src={img} alt="" loading="lazy" className="size-full object-contain p-1" /> : <Sparkles className="size-3.5 text-[#15130F]/30" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-bold">{l.product_name_snapshot}</span>
                <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
                  <span className={cn("rounded-full px-2 py-px text-[11px] font-bold", decant ? "bg-[#2A2418] text-[#FFD599]" : "bg-[#262626] text-[#D4D4D4]")}>
                    {decant ? `Decant ${l.decant_ml ?? "?"}ml` : (l.variant_label ?? "Frasco")}
                  </span>
                  <span className="text-[12px] text-[#8C8C8C] tabular-nums">
                    {l.quantity}× {brl(sold)}
                  </span>
                  {partial ? (
                    <span className={cn("rounded-full px-2 py-px text-[11px] font-bold", l.paid ? "bg-[#1C2A21] text-[#7FCF9F]" : "bg-[#2A1A18] text-[#FF9A8A]")}>
                      {l.paid ? "Pago" : "Falta pagar"}
                    </span>
                  ) : null}
                </span>
              </span>
              <span className="shrink-0 text-[14px] font-bold tabular-nums">{brl(l.subtotal ?? sold * Number(l.quantity ?? 1))}</span>
            </li>
          );
        })}
      </ul>
      {o?.pricing_tier === "atacado" ? <p className="px-2 pt-1.5 pb-0.5 text-[12px] text-[#FFD599]">Preço de atacado neste pedido.</p> : null}
    </div>
  );
}

/* ─────────────── urgência: quando entregar ─────────────── */

/** relógio compartilhado que bate a cada 30 s (um só timer para a tela toda) */
let tickers = new Set<() => void>();
let tickTimer: ReturnType<typeof setInterval> | null = null;
function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const f = () => setNow(Date.now());
    tickers.add(f);
    if (!tickTimer) tickTimer = setInterval(() => tickers.forEach((t) => t()), 30_000);
    return () => {
      tickers.delete(f);
      if (!tickers.size && tickTimer) {
        clearInterval(tickTimer);
        tickTimer = null;
      }
    };
  }, []);
  return now;
}

/** minutos até HH:MM de hoje no horário de Brasília */
function minutesUntil(at: string, now: number) {
  const [h, m] = at.split(":").map(Number);
  if (h == null || Number.isNaN(h)) return null;
  const br = new Date(new Date(now).toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  return h * 60 + (m || 0) - (br.getHours() * 60 + br.getMinutes());
}

function inWords(min: number) {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const r = min % 60;
  return r && h < 3 ? `${h}h${String(r).padStart(2, "0")}` : `${h}h`;
}

/**
 * Quando entregar, com urgência que se lê de relance sem poluir:
 * - hoje: pílula dourada com ponto que "respira" e contagem ("em 2h", "em 40 min");
 * - faltando 1 h ou menos, passou da hora ou atrasado: pílula coral;
 * - amanhã e depois: texto simples.
 */
export function WhenPill({ when, big, className }: { when: { text: string; tone: string; at?: string | null }; big?: boolean; className?: string }) {
  const now = useNow();
  const left = when.tone === "gold" && when.at ? minutesUntil(when.at, now) : null;
  const hot = when.tone === "red" || (left != null && left <= 60);
  const pill = when.tone === "red" || when.tone === "gold";
  if (!pill) {
    return (
      <span className={cn("whitespace-nowrap", big ? "text-[13.5px]" : "text-[12.5px]", when.tone === "muted" ? "text-[#8C8C8C]" : "text-white", className)}>
        {when.text}
      </span>
    );
  }
  // contagem só quando importa (até 6 h antes); longe disso, só "Hoje · 18:00"
  const extra = left == null ? null : left < 0 ? "passou da hora" : left === 0 ? "agora" : left <= 360 ? `em ${inWords(left)}` : null;
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-full font-semibold whitespace-nowrap transition-colors duration-500",
        big ? "h-7 px-2.5 text-[13px]" : "h-6 px-2 text-[12px]",
        hot ? "bg-[#2A1A18] text-[#FF9A8A]" : "bg-[#2A2418] text-[#FFD599]",
        className,
      )}
    >
      <span className={cn("ui-beacon relative size-1.5 shrink-0 rounded-full", hot ? "bg-[#FF8A75]" : "bg-[#FFD599]")} />
      <span className="truncate">
        {when.text}
        {extra ? <span className="opacity-75"> · {extra}</span> : null}
      </span>
    </span>
  );
}
