/**
 * Evita skeleton eterno quando uma chamada pública ao Supabase fica pendente.
 * A consulta é cancelada ao atingir o limite e o TanStack Query recebe erro,
 * podendo exibir a ação de tentar novamente. Não modifica dados do catálogo.
 */
export async function withQueryTimeout<T>(
  request: (signal: AbortSignal) => PromiseLike<T>,
  timeoutMs: number,
  externalSignal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const onExternalAbort = () => controller.abort();
  if (externalSignal?.aborted) controller.abort();
  else externalSignal?.addEventListener("abort", onExternalAbort, { once: true });

  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new Error("Tempo excedido ao consultar a Orium. Tente novamente."));
    }, timeoutMs);
  });
  try {
    return await Promise.race([Promise.resolve().then(() => request(controller.signal)), deadline]);
  } finally {
    if (timeout) clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", onExternalAbort);
  }
}
