import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Foto com fundo neutro do mesmo tamanho enquanto carrega e um fade curto
 * quando aparece. O espaço já está reservado pelo container (aspect ratio),
 * então nada empurra o layout.
 */
export function PhotoFade({
  src,
  alt,
  priority = false,
  className,
}: {
  src: string;
  alt: string;
  /** Primeiros cards visíveis: carregam junto com o resto da Home. */
  priority?: boolean;
  className?: string;
}) {
  const [loaded, setLoaded] = useState(false);

  return (
    <>
      {!loaded ? <div aria-hidden className="absolute inset-0 bg-surface-3 motion-safe:animate-pulse" /> : null}
      <img
        src={src}
        alt={alt}
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : "auto"}
        decoding="async"
        onLoad={() => setLoaded(true)}
        onError={() => setLoaded(true)}
        className={cn(
          "size-full object-cover transition-opacity duration-200 ease-out",
          loaded ? "opacity-100" : "opacity-0",
          className,
        )}
      />
    </>
  );
}
