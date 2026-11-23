/**
 * BLACK NOVEMBER — regras puras da campanha.
 *
 * Não existe coluna nova no banco: uma promoção entra no visual Black quando o
 * nome dela (escrito no Admin) tem a palavra "Black" — "Black November",
 * "Esquenta Black", "Black Friday". Desconto, período e produtos continuam
 * sendo os da própria promoção, e o servidor continua sendo a verdade do preço.
 *
 * Urgência sempre verdadeira:
 * - contagem regressiva só existe quando a promoção tem data de fim real;
 * - "Última unidade" / "Restam N" só com estoque real do frasco (1 a 3);
 * - o preço riscado é o preço cheio de verdade, sem inflar nada.
 */
import { useSyncExternalStore } from "react";
import { isRunning, type Promotion } from "@/lib/promotions";
import { usePublicPricingSettings } from "@/lib/pricing-settings";

export const BLACK_RE = /\bblack\b/i;

export function isBlack(promotion: Pick<Promotion, "name"> | null | undefined): boolean {
  return !!promotion && BLACK_RE.test(promotion.name ?? "");
}

/**
 * Nome da campanha mostrado no site. O Admin manda (Precificação → nome da campanha);
 * vazio, vale o nome da promoção com "Black" (ex.: "Black November").
 */
export function blackTitle(
  custom: string | null | undefined,
  promotionName?: string | null,
): string {
  const c = (custom ?? "").trim();
  if (c) return c;
  const n = (promotionName ?? "").trim();
  return n && BLACK_RE.test(n) ? n : "Black November";
}

/** Nome da campanha em uso agora (lê a configuração pública da loja). */
export function useBlackTitle(promotion?: Pick<Promotion, "name"> | null): string {
  const { data } = usePublicPricingSettings();
  return blackTitle(data?.black_title, promotion?.name);
}

/** Selo em duas partes: "Black Orium" → BLACK | ORIUM. */
export function blackLabel(title: string): { a: string; b: string } {
  const words = title.trim().split(/\s+/).filter(Boolean);
  return { a: (words[0] ?? "Black").toUpperCase(), b: words.slice(1).join(" ").toUpperCase() };
}

/** Promoções Black em vigor agora. */
export function runningBlack(list: Promotion[], now = Date.now()): Promotion[] {
  return list.filter((p) => isBlack(p) && isRunning(p, now));
}

/** Fim mais próximo entre as campanhas Black (para a contagem da Home). */
export function blackEndsAt(list: Promotion[]): number | null {
  const ends = list
    .map((p) => (p.ends_at ? new Date(p.ends_at).getTime() : NaN))
    .filter((t) => Number.isFinite(t) && t > Date.now());
  return ends.length ? Math.min(...ends) : null;
}

/** Maior desconto real entre as campanhas Black. */
export function blackMaxPercent(list: Promotion[]): number {
  return list.reduce((m, p) => Math.max(m, Number(p.discount_percent) || 0), 0);
}

/**
 * Escassez real do frasco. Só fala quando o estoque é contado e baixo.
 * Decant sai do frasco aberto: nunca recebe aviso de "última unidade".
 */
export function scarcity(product: { in_stock?: boolean | null; stock_quantity?: number | null }): {
  left: number;
  text: string;
} | null {
  if (!product.in_stock) return null;
  const n = Number(product.stock_quantity);
  if (!Number.isFinite(n) || n < 1 || n > 3) return null;
  if (n === 1) return { left: 1, text: "Última unidade" };
  return { left: n, text: `Restam só ${n} unidades` };
}

/* ---------- relógio único: um intervalo para todos os contadores da tela ---------- */

let tick = Date.now();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(fn: () => void) {
  listeners.add(fn);
  if (!timer) {
    tick = Date.now();
    timer = setInterval(() => {
      tick = Date.now();
      listeners.forEach((l) => l());
    }, 1000);
  }
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/** Hora atual que avança de segundo em segundo (0 no servidor: nada de hidratação errada). */
export function useNowSeconds(): number {
  return useSyncExternalStore(
    subscribe,
    () => tick,
    () => 0,
  );
}

export type Remaining = { d: number; h: number; m: number; s: number; total: number };

export function remaining(endsAt: number, now: number): Remaining | null {
  const total = Math.max(0, endsAt - now);
  if (!now || total <= 0) return null;
  const sec = Math.floor(total / 1000);
  return {
    d: Math.floor(sec / 86400),
    h: Math.floor((sec % 86400) / 3600),
    m: Math.floor((sec % 3600) / 60),
    s: sec % 60,
    total,
  };
}
