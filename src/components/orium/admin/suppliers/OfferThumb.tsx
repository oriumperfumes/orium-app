import { useState } from "react";
import { ImageOff } from "lucide-react";
import { imgVariant } from "@/lib/product-img";

/** Miniatura de perfume nas telas de fornecedor: foto da oferta, senão a do produto canônico. */
export function OfferThumb({ src, fallback, alt, size = 48 }: { src?: string | null; fallback?: string | null; alt: string; size?: number }) {
  const urls = [src, fallback].filter((u, i, a): u is string => !!u && a.indexOf(u) === i);
  const [idx, setIdx] = useState(0);
  const url = imgVariant(urls[idx], "thumb");
  return (
    <div className="shrink-0 overflow-hidden rounded-lg border border-border/60 bg-muted/30" style={{ width: size, height: size }}>
      {url ? (
        <img src={url} alt={alt} loading="lazy" decoding="async" referrerPolicy="no-referrer" className="size-full object-contain" onError={() => setIdx((i) => i + 1)} />
      ) : (
        <div className="flex size-full items-center justify-center text-muted-foreground"><ImageOff className="size-4" /></div>
      )}
    </div>
  );
}
