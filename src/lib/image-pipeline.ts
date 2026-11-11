import { optimizePhoto } from "@/lib/image-optimize";
import { fetchSourceImage, registerImageError, registerOptimizedImage } from "@/lib/image-pipeline.functions";

/**
 * Otimiza uma foto externa (fornecedor/importação): baixa pelo servidor,
 * gera as versões WebP e publica pela Orium. Em caso de falha o produto
 * continua com a foto de origem e o erro fica marcado para reprocessar.
 */
export async function optimizeRemoteImage(sourceUrl: string) {
  try {
    const src = await fetchSourceImage({ data: { url: sourceUrl } });
    const bin = Uint8Array.from(atob(src.base64), (c) => c.charCodeAt(0));
    const o = await optimizePhoto(new Blob([bin], { type: src.contentType }));
    const res = await registerOptimizedImage({
      data: {
        sourceUrl,
        main: o.main,
        card: o.card,
        thumb: o.thumb,
        width: o.width,
        height: o.height,
        originalBytes: src.bytes,
        ms: o.ms,
      },
    });
    return { ok: true as const, url: res.url, before: src.bytes, after: o.mainBytes, card: o.cardBytes };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Falha ao otimizar.";
    await registerImageError({ data: { sourceUrl, error: message } }).catch(() => undefined);
    return { ok: false as const, error: message };
  }
}

/** OPTIMIZE_EXISTING_PRODUCT_IMAGES — processa em fila, 3 por vez. */
export async function optimizeExistingProductImages(
  list: () => Promise<{ pending: Array<{ url: string }> }>,
  onProgress: (done: number, total: number, failed: number) => void,
) {
  const { pending } = await list();
  let done = 0;
  let failed = 0;
  let savedBytes = 0;
  const queue = pending.map((p) => p.url);
  const worker = async () => {
    for (let url = queue.shift(); url; url = queue.shift()) {
      const r = await optimizeRemoteImage(url);
      if (r.ok) savedBytes += Math.max(0, r.before - r.card);
      else failed += 1;
      done += 1;
      onProgress(done, pending.length, failed);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return { total: pending.length, failed, savedBytes };
}
