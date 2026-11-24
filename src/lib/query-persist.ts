import type { QueryClient } from "@tanstack/react-query";

/**
 * CRM instantâneo: guarda no navegador a última versão das telas do CRM
 * (conversas, leads, resumo, perfumes...) e mostra na hora ao abrir,
 * atualizando por trás. Só neste aparelho; apagado ao sair da conta.
 */
const KEY = "orium-crm-cache-v1";
const MAX_AGE = 24 * 60 * 60_000;
const SINGLE = new Set([
  "wa-inbox",
  "crm-leads",
  "crm-staff",
  "wa-avatars",
  "crm-pulse",
  "crm-insights-overview",
]);
const MANY: Record<string, number> = { "wa-thread": 30, "wa-insight": 40, "crm-quote": 30 };

type Entry = { k: unknown[]; d: unknown; t: number };

function persistable(key: readonly unknown[]) {
  const head = String(key[0] ?? "");
  return SINGLE.has(head) || head in MANY;
}

function read(): Entry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as Entry[];
    const now = Date.now();
    return Array.isArray(list)
      ? list.filter((e) => e && Array.isArray(e.k) && now - e.t < MAX_AGE)
      : [];
  } catch {
    return [];
  }
}

function write(qc: QueryClient) {
  const out: Entry[] = [];
  const counts: Record<string, number> = {};
  const queries = qc
    .getQueryCache()
    .getAll()
    .filter(
      (q) => q.state.status === "success" && q.state.data !== undefined && persistable(q.queryKey),
    )
    .sort((a, b) => b.state.dataUpdatedAt - a.state.dataUpdatedAt);
  for (const q of queries) {
    const head = String(q.queryKey[0]);
    const limit = MANY[head];
    if (limit !== undefined) {
      counts[head] = (counts[head] ?? 0) + 1;
      if (counts[head] > limit) continue;
    }
    out.push({ k: q.queryKey as unknown[], d: q.state.data, t: q.state.dataUpdatedAt });
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(out));
  } catch {
    // cheio: guarda sem as fotos e sem conversas antigas
    try {
      const slim = out.filter((e) => e.k[0] !== "wa-avatars").slice(0, 40);
      localStorage.setItem(KEY, JSON.stringify(slim));
    } catch {
      /* sem espaço: segue sem cache local */
    }
  }
}

export function clearCrmCache() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignora */
  }
}

/** Liga a persistência (só no navegador). */
export function persistCrmQueries(qc: QueryClient) {
  if (typeof window === "undefined") return;
  // 1) devolve o que estava salvo, marcado com a hora antiga (a tela atualiza sozinha)
  for (const e of read()) {
    if (!qc.getQueryData(e.k)) qc.setQueryData(e.k, e.d, { updatedAt: e.t });
  }
  // 2) salva (no máximo a cada 3 s) quando algo do CRM chega
  let timer: ReturnType<typeof setTimeout> | null = null;
  qc.getQueryCache().subscribe((ev) => {
    if (ev.type !== "updated" || ev.action.type !== "success" || !persistable(ev.query.queryKey))
      return;
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      write(qc);
    }, 3000);
  });
  // 3) saiu da conta: apaga
  void import("@/integrations/supabase/client").then(({ supabase }) =>
    supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") clearCrmCache();
    }),
  );
}
