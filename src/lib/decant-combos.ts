/**
 * COMBO DE DECANTS — regra pura (sem acesso a banco), usada no navegador (exibição)
 * e no servidor (verdade). Ex.: "leve 3 decants de 5 ml por R$ 100".
 *
 * Como funciona:
 *  - todos os decants elegíveis do carrinho viram unidades avulsas;
 *  - as unidades mais caras formam os conjuntos de N (favorece o cliente);
 *  - cada conjunto completo custa o preço do combo, se isso for menos que a soma;
 *  - a economia é repartida entre as linhas proporcionalmente ao preço de cada unidade;
 *  - o que sobra (menos de N unidades) paga o preço normal.
 *
 * O valor real é SEMPRE recalculado no servidor (promotions.server.ts).
 */

export type DecantCombo = {
  id: string;
  name: string;
  /** quantos decants formam um combo */
  quantity: number;
  /** preço do combo inteiro */
  combo_price: number;
  /** tamanhos que entram (2, 5, 10). Vazio = todos */
  decant_sizes: number[];
  starts_at: string | null;
  ends_at: string | null;
  active: boolean;
};

export type ComboLine = {
  key: string;
  variant: "FULL" | "DECANT";
  ml: number | null;
  /** preço unitário já com eventual promoção percentual */
  unit: number;
  quantity: number;
};

export type ComboApplied = { combo: DecantCombo; sets: number; saved: number };

export type ComboProgress = {
  combo: DecantCombo;
  /** decants elegíveis que ainda não entraram em outro combo */
  eligible: number;
  /** combos completos já formados */
  sets: number;
  /** unidades do conjunto em andamento (0 .. quantity-1) */
  inProgress: number;
  /** quantas faltam para fechar o próximo combo */
  missing: number;
};

export type ComboResult = {
  /** economia por linha (chave do item) */
  byLine: Map<string, number>;
  total: number;
  applied: ComboApplied[];
  progress: ComboProgress[];
};

const money = (v: number) => Number(Number(v).toFixed(2));

export function isComboRunning(c: Pick<DecantCombo, "active" | "starts_at" | "ends_at">, now: number = Date.now()) {
  if (!c.active) return false;
  if (c.starts_at && new Date(c.starts_at).getTime() > now) return false;
  if (c.ends_at && new Date(c.ends_at).getTime() <= now) return false;
  return true;
}

/** O tamanho entra neste combo? Lista vazia = todos os tamanhos. */
export function comboAcceptsSize(c: Pick<DecantCombo, "decant_sizes">, ml: number | null | undefined) {
  const sizes = c.decant_sizes ?? [];
  return sizes.length === 0 || sizes.includes(Number(ml));
}

/** Combos válidos agora, normalizados (números de verdade, quantidade inteira). */
export function runningCombos(list: DecantCombo[], now?: number): DecantCombo[] {
  return (list ?? [])
    .map((c) => ({
      ...c,
      quantity: Math.floor(Number(c.quantity)),
      combo_price: Number(c.combo_price),
      decant_sizes: (c.decant_sizes ?? []).map(Number),
    }))
    .filter((c) => isComboRunning(c, now) && c.quantity >= 2 && c.combo_price > 0);
}

export function applyDecantCombos(lines: ComboLine[], combosIn: DecantCombo[], now?: number): ComboResult {
  const combos = runningCombos(combosIn, now);
  const byLine = new Map<string, number>();
  const applied: ComboApplied[] = [];
  const progress: ComboProgress[] = [];

  // unidades avulsas de decant, ainda livres
  type Unit = { key: string; ml: number; price: number; used: boolean };
  const units: Unit[] = [];
  for (const l of lines) {
    if (l.variant !== "DECANT" || !l.ml) continue;
    const q = Math.max(0, Math.floor(Number(l.quantity)));
    for (let i = 0; i < q; i++) units.push({ key: l.key, ml: Number(l.ml), price: Number(l.unit), used: false });
  }

  // o combo que mais economiza por unidade escolhe primeiro
  const regularOf = (c: DecantCombo) => {
    const eligible = units.filter((u) => comboAcceptsSize(c, u.ml));
    if (eligible.length === 0) return 0;
    const avg = eligible.reduce((s, u) => s + u.price, 0) / eligible.length;
    return avg - c.combo_price / c.quantity;
  };
  const ordered = [...combos].sort((a, b) => regularOf(b) - regularOf(a));

  for (const combo of ordered) {
    const pool = units
      .filter((u) => !u.used && comboAcceptsSize(combo, u.ml))
      .sort((a, b) => b.price - a.price);
    const fullSets = Math.floor(pool.length / combo.quantity);
    let sets = 0;
    let saved = 0;

    for (let s = 0; s < fullSets; s++) {
      const group = pool.slice(s * combo.quantity, (s + 1) * combo.quantity);
      const sum = money(group.reduce((acc, u) => acc + u.price, 0));
      const discount = money(sum - combo.combo_price);
      if (discount <= 0) continue; // o combo não compensa para estes itens: pagam normal
      let given = 0;
      group.forEach((u, idx) => {
        const part =
          idx === group.length - 1 ? money(discount - given) : money((discount * u.price) / (sum || 1));
        given = money(given + part);
        byLine.set(u.key, money((byLine.get(u.key) ?? 0) + part));
        u.used = true;
      });
      sets += 1;
      saved = money(saved + discount);
    }

    if (sets > 0) applied.push({ combo, sets, saved });
    const left = pool.filter((u) => !u.used).length;
    const inProgress = left % combo.quantity;
    progress.push({
      combo,
      eligible: pool.length,
      sets,
      inProgress,
      missing: combo.quantity - inProgress,
    });
  }

  const total = money([...byLine.values()].reduce((s, v) => s + v, 0));
  return { byLine, total, applied, progress };
}

/* ---------- textos (um só lugar, para loja e admin dizerem a mesma coisa) ---------- */

const brl = (v: number) =>
  Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: Number.isInteger(Number(v)) ? 0 : 2 });

/** "5 ml", "2 e 5 ml", "2, 5 e 10 ml" — vazio vira "decants". */
export function comboSizesLabel(sizes: number[]): string {
  const s = [...(sizes ?? [])].map(Number).sort((a, b) => a - b);
  if (s.length === 0) return "";
  if (s.length === 1) return `${s[0]} ml`;
  return `${s.slice(0, -1).join(", ")} e ${s[s.length - 1]} ml`;
}

/** "Leve 3 decants" */
export const comboTitle = (c: Pick<DecantCombo, "quantity">) => `Leve ${c.quantity} decants`;

/** "por R$ 100" */
export const comboPriceLine = (c: Pick<DecantCombo, "combo_price">) => `por ${brl(c.combo_price)}`;

/** "Decants de 5 ml · misture os perfumes que quiser" */
export function comboSubtitle(c: Pick<DecantCombo, "decant_sizes">): string {
  const sizes = comboSizesLabel(c.decant_sizes);
  return `${sizes ? `Decants de ${sizes}` : "Qualquer decant"} · misture os perfumes que quiser`;
}

/** Preço médio de cada decant dentro do combo. */
export const comboUnitPrice = (c: Pick<DecantCombo, "quantity" | "combo_price">) =>
  money(Number(c.combo_price) / Math.max(1, Number(c.quantity)));

/** Maior vantagem: quanto o cliente deixa de pagar vs o menor preço normal dos tamanhos do combo. */
export function comboSaving(c: Pick<DecantCombo, "quantity" | "combo_price">, regularUnit: number): number {
  return money(Math.max(0, regularUnit * c.quantity - c.combo_price));
}

export { brl as comboBrl };
