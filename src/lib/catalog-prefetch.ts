/**
 * Primeira página do catálogo pedida JÁ no <head> da Home.
 *
 * Sem isto o pedido só saía depois de baixar e iniciar todo o JavaScript
 * (HTML → JS → React → consulta). Agora a consulta corre em paralelo com o
 * download do app e, quando a grade monta, os perfumes geralmente já chegaram.
 * Só vale para a Home sem filtros; qualquer falha cai na consulta normal.
 */

/** Exatamente os argumentos que a Home usa na primeira página sem filtros. */
export const CATALOG_FIRST_ARGS = { p_q: "", p_availability: "todos", p_limit: 24, p_offset: 0 } as const;
const BODY = JSON.stringify(CATALOG_FIRST_ARGS);
const MAX_AGE = 60_000;

/**
 * Só as variáveis VITE_ (trocadas no build, iguais no servidor e no navegador):
 * o <head> sai idêntico nos dois lados e nunca quebra a hidratação.
 */
function env() {
  const url = (import.meta.env["VITE_SUPABASE_URL"] as string | undefined) ?? "";
  const key = (import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"] as string | undefined) ?? "";
  return { url, key };
}

/** Endereço do banco para o preconnect (economiza o aperto de mão TLS). */
export function supabaseOrigin() {
  try {
    return new URL(env().url).origin;
  } catch {
    return "";
  }
}

/** Script curto que dispara a consulta antes do app carregar. */
export function catalogPrefetchScript() {
  const { url, key } = env();
  if (!url || !key) return "";
  return `(function(){try{if(location.pathname!=='/'||location.search)return;var k=${JSON.stringify(key)};var h={'apikey':k,'Content-Type':'application/json'};if(k.indexOf('sb_')!==0)h.Authorization='Bearer '+k;window.__oriumCat0={at:Date.now(),p:fetch(${JSON.stringify(`${url}/rest/v1/rpc/search_catalog`)},{method:'POST',headers:h,body:${JSON.stringify(BODY)}}).then(function(r){return r.ok?r.json():null}).catch(function(){return null})}}catch(e){}})()`;
}

type Pending = { at: number; p: Promise<unknown> };

/** Usa (uma vez) a resposta antecipada, se os argumentos forem os mesmos. */
export function takeCatalogPrefetch(args: Record<string, unknown>): Promise<unknown[] | null> | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { __oriumCat0?: Pending };
  const pending = w.__oriumCat0;
  if (!pending) return null;
  delete w.__oriumCat0;
  if (Date.now() - pending.at > MAX_AGE || JSON.stringify(args) !== BODY) return null;
  return pending.p.then((d) => (Array.isArray(d) ? d : null));
}
