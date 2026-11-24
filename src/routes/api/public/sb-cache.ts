import { createFileRoute } from "@tanstack/react-router";
import { EDGE_TTL_SECONDS, cacheableRestPath } from "@/lib/sb-edge-cache";

/** Cache da borda (Cloudflare). Fora dela (dev/preview), simplesmente não usa. */
function edgeCache(): Cache | null {
  try {
    const c = (globalThis as unknown as { caches?: { default?: Cache } }).caches;
    return c?.default ?? null;
  } catch {
    return null;
  }
}

const FORWARD = ["accept", "accept-profile", "content-profile", "prefer", "range", "content-type"];

async function sha(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Leituras públicas do catálogo com cache de 60 s na borda.
 *
 * Por quê: cada visitante pedia ao banco exatamente os mesmos dados (catálogo,
 * preços, promoções). Agora o primeiro visitante busca e os seguintes recebem
 * a cópia da Cloudflare, sem tocar no banco. Só leituras anônimas de uma lista
 * fechada (ver `sb-edge-cache.ts`); o pedido vai ao banco com a chave pública,
 * então nunca vê nada além do que um visitante já veria.
 */
async function handle(request: Request) {
  const url = new URL(request.url);
  const p = url.searchParams.get("p") ?? "";
  const restPath = cacheableRestPath(request.method, p);
  if (!restPath) return new Response("Not found", { status: 404 });

  const base =
    (import.meta.env["VITE_SUPABASE_URL"] as string | undefined) || process.env["SUPABASE_URL"];
  const key =
    (import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"] as string | undefined) ||
    process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!base || !key) return new Response("Not configured", { status: 500 });

  const body = request.method === "POST" ? await request.text() : "";
  const headers = new Headers({ apikey: key });
  if (!key.startsWith("sb_")) headers.set("authorization", `Bearer ${key}`);
  for (const h of FORWARD) {
    const v = request.headers.get(h);
    if (v) headers.set(h, v);
  }

  const edge = edgeCache();
  const fingerprint = await sha(
    [request.method, restPath, body, ...FORWARD.map((h) => headers.get(h) ?? "")].join("\n"),
  );
  const cacheKey = new Request(`${url.origin}/__sb-cache/${fingerprint}`);
  const hit = edge ? await edge.match(cacheKey).catch(() => undefined) : undefined;
  if (hit) {
    const r = new Response(hit.body, hit);
    r.headers.set("x-orium-cache", "hit");
    r.headers.set("cache-control", "no-store");
    return r;
  }

  const upstream = await fetch(`${base}/rest/v1/${restPath}`, {
    method: request.method,
    headers,
    body: request.method === "POST" ? body : undefined,
  });
  const data = await upstream.arrayBuffer();
  const out = new Headers();
  for (const h of ["content-type", "content-range", "preference-applied"]) {
    const v = upstream.headers.get(h);
    if (v) out.set(h, v);
  }
  if (edge && (upstream.status === 200 || upstream.status === 206)) {
    const stored = new Headers(out);
    stored.set("cache-control", `public, max-age=${EDGE_TTL_SECONDS}`);
    await edge
      .put(cacheKey, new Response(data, { status: upstream.status, headers: stored }))
      .catch(() => {});
  }
  out.set("x-orium-cache", "miss");
  out.set("cache-control", "no-store");
  return new Response(data, { status: upstream.status, headers: out });
}

export const Route = createFileRoute("/api/public/sb-cache")({
  server: {
    handlers: {
      GET: ({ request }) => handle(request),
      POST: ({ request }) => handle(request),
    },
  },
});
