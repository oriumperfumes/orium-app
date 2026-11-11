/**
 * Validação de endereços de fornecedores contra SSRF.
 * Só https público, sem credenciais, sem IP literal privado/local nem portas incomuns.
 */
const PRIVATE_V4 = [/^10\./, /^127\./, /^0\./, /^169\.254\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./];

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

export function assertSafePublicUrl(raw: string): URL {
  let input = (raw ?? "").trim();
  if (!input) throw new UnsafeUrlError("Informe o endereço do site.");
  if (!/^[a-z]+:\/\//i.test(input)) input = `https://${input}`;
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new UnsafeUrlError("Endereço inválido.");
  }
  if (url.protocol !== "https:") throw new UnsafeUrlError("Use um endereço https.");
  if (url.username || url.password) throw new UnsafeUrlError("Endereços com usuário/senha não são aceitos.");
  if (url.port && url.port !== "443") throw new UnsafeUrlError("Porta não permitida.");
  const host = url.hostname.toLowerCase();
  if (!host.includes(".") || host === "localhost" || /\.(local|internal|localhost|lan|home|corp)$/.test(host)) {
    throw new UnsafeUrlError("Destino interno não permitido.");
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.startsWith("[")) {
    if (host.startsWith("[") || PRIVATE_V4.some((r) => r.test(host))) throw new UnsafeUrlError("Destino interno não permitido.");
    throw new UnsafeUrlError("Use o domínio do site, não um IP.");
  }
  return url;
}

/** fetch com timeout, sem seguir redirecionamentos para destinos inseguros. */
export async function safeFetch(raw: string, init: RequestInit & { timeoutMs?: number } = {}, maxRedirects = 3): Promise<Response> {
  let url = assertSafePublicUrl(raw);
  for (let i = 0; i <= maxRedirects; i++) {
    const res = await fetch(url.toString(), { ...init, redirect: "manual", signal: AbortSignal.timeout(init.timeoutMs ?? 15_000) });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = assertSafePublicUrl(new URL(res.headers.get("location")!, url).toString());
      continue;
    }
    return res;
  }
  throw new UnsafeUrlError("Redirecionamentos demais.");
}
