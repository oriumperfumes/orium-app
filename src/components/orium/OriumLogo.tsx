import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import symbolDark from "@/assets/orium-symbol-dark.png.asset.json";
import symbolLight from "@/assets/orium-symbol-light.png.asset.json";

/**
 * Única fonte visual da marca Orium: apenas o símbolo oficial, sem wordmark.
 * Variante clara/escura automática, proporção preservada e nenhum texto de fallback.
 */
export function OriumLogo({ className, size = "md" }: { className?: string | undefined; size?: "sm" | "md" | "lg" | undefined }) {
  const box = size === "sm" ? "size-8" : size === "lg" ? "size-14" : "size-9 sm:size-10";
  return (
    <span className={cn("relative block shrink-0", box, className)}>
      <img
        src={symbolDark.url}
        alt="Orium"
        className="absolute inset-0 size-full object-contain dark:hidden"
      />
      <img
        src={symbolLight.url}
        alt="Orium"
        className="absolute inset-0 hidden size-full object-contain dark:block"
      />
    </span>
  );
}

/** Logo clicável: sempre volta para a Home/Catálogo, em qualquer rota. */
export function OriumLogoLink({
  className,
  size,
}: {
  className?: string | undefined;
  size?: "sm" | "md" | "lg" | undefined;
}) {
  return (
    <Link to="/" aria-label="Orium — voltar ao catálogo" className={cn("press inline-flex shrink-0 items-center", className)}>
      <OriumLogo size={size} />
    </Link>
  );
}

