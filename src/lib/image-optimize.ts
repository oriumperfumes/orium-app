/**
 * Otimização de foto no próprio navegador (Admin), antes do upload.
 *
 * JPG/PNG/WEBP entram, WebP de alta qualidade sai — em duas versões:
 * a principal (página individual) e a do card/carrossel. Nada de upscaling:
 * fotos menores que o limite continuam no tamanho original.
 */

export const MAIN_MAX_SIDE = 1400;
export const CARD_MAX_SIDE = 640;
export const THUMB_MAX_SIDE = 320;
/** Qualidade alta: reduz peso sem deixar o frasco/embalagem sem definição. */
export const WEBP_QUALITY = 0.9;

export type OptimizedPhoto = {
  main: string; // base64 (sem prefixo data:)
  card: string;
  thumb: string;
  width: number;
  height: number;
  originalBytes: number;
  mainBytes: number;
  cardBytes: number;
  thumbBytes: number;
  ms: number;
};

function fit(width: number, height: number, maxSide: number) {
  const longest = Math.max(width, height);
  if (longest <= maxSide) return { width, height };
  const scale = maxSide / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

async function decode(blob: Blob): Promise<{ draw: CanvasImageSource; width: number; height: number }> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(blob);
    return { draw: bitmap, width: bitmap.width, height: bitmap.height };
  }
  // Safari antigo: cai no <img> + object URL.
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Não foi possível ler a foto."));
      el.src = url;
    });
    return { draw: img, width: img.naturalWidth, height: img.naturalHeight };
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

async function toWebp(source: CanvasImageSource, width: number, height: number): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Não foi possível processar a foto.");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/webp", WEBP_QUALITY),
  );
  if (!blob || blob.type !== "image/webp") throw new Error("Este navegador não consegue gerar WebP.");
  return blob;
}

async function base64Of(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Converte a foto escolhida (inclusive direto da câmera do celular) em WebP. */
export async function optimizePhoto(input: Blob): Promise<OptimizedPhoto> {
  const t0 = performance.now();
  const { draw, width, height } = await decode(input);
  const main = fit(width, height, MAIN_MAX_SIDE);
  const card = fit(width, height, CARD_MAX_SIDE);

  const mainBlob = await toWebp(draw, main.width, main.height);
  const cardBlob = await toWebp(draw, card.width, card.height);
  const th = fit(width, height, THUMB_MAX_SIDE);
  const thumbBlob = await toWebp(draw, th.width, th.height);
  if ("close" in draw && typeof (draw as ImageBitmap).close === "function") (draw as ImageBitmap).close();

  const [mainB64, cardB64, thumbB64] = await Promise.all([base64Of(mainBlob), base64Of(cardBlob), base64Of(thumbBlob)]);
  return {
    main: mainB64,
    card: cardB64,
    thumb: thumbB64,
    width: main.width,
    height: main.height,
    originalBytes: input.size,
    mainBytes: mainBlob.size,
    cardBytes: cardBlob.size,
    thumbBytes: thumbBlob.size,
    ms: Math.round(performance.now() - t0),
  };
}
