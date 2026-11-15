import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Orçamento de chamadas externas por requisição.
 *
 * O plano Free do Cloudflare Workers aceita 50 chamadas externas (fetch) por
 * requisição — Supabase e sites de fornecedores contam igual. Passando disso o
 * fetch lança "Too many subrequests" e o supabase-js devolve `data: null`,
 * o que antes aparecia como "Fornecedor não encontrado" com a rodada cortada.
 *
 * Aqui cada requisição que abre um orçamento ganha um contador próprio
 * (AsyncLocalStorage: tráfego de visitantes na mesma instância não interfere).
 * O motor consulta `remainingSubrequests()` e para a rodada com folga,
 * guardando o cursor para retomar de onde parou.
 */

type Budget = { limit: number; used: number };

const storage = new AsyncLocalStorage<Budget>();
let installed = false;

/**
 * Limite do plano Free (50) menos margem. A margem é grande de propósito: cada redirecionamento
 * seguido pelo fetch conta como outra chamada para a plataforma e este contador não os enxerga.
 */
export const FREE_PLAN_SUBREQUEST_BUDGET = 40;

function install() {
  if (installed) return;
  installed = true;
  const original = globalThis.fetch.bind(globalThis);
  globalThis.fetch = ((...args: Parameters<typeof fetch>) => {
    const budget = storage.getStore();
    if (budget) budget.used += 1;
    return original(...args);
  }) as typeof fetch;
}

/** Executa `fn` contando cada fetch feito dentro dela (inclusive pelo supabase-js). */
export function withSubrequestBudget<T>(limit: number, fn: () => Promise<T>): Promise<T> {
  install();
  return storage.run({ limit, used: 0 }, fn);
}

/** Chamadas ainda disponíveis nesta requisição (Infinity fora de um orçamento). */
export function remainingSubrequests(): number {
  const budget = storage.getStore();
  return budget ? budget.limit - budget.used : Number.POSITIVE_INFINITY;
}

export function usedSubrequests(): number {
  return storage.getStore()?.used ?? 0;
}
