import { Heart } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useFavorites } from "@/lib/favorites";
import { cn } from "@/lib/utils";

/**
 * Coração de favorito — funciona para visitante e para quem está logado.
 * Animação curta (mola), sem confete e sem bloquear o toque no card.
 */
export function FavoriteButton({
  productId,
  name,
  className,
  size = "md",
  surface,
}: {
  productId: string;
  name?: string | null;
  className?: string;
  size?: "sm" | "md";
  /** true quando o coração fica sobre um fundo da interface, não sobre a foto. */
  surface?: boolean;
}) {
  const { isFavorite, toggle } = useFavorites();
  const active = isFavorite(productId);
  const [pop, setPop] = useState(false);

  return (
    <button
      type="button"
      aria-label={active ? `Remover ${name ?? "perfume"} dos favoritos` : `Salvar ${name ?? "perfume"} nos favoritos`}
      aria-pressed={active}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const added = toggle(productId);
        setPop(true);
        window.setTimeout(() => setPop(false), 260);
        toast.success(added ? "Salvo nos seus favoritos" : "Removido dos favoritos", { duration: 1600 });
      }}
      className={cn(
        "grid place-items-center rounded-full border transition-[transform,background-color,color] duration-200 ease-[var(--ease-orium)] active:scale-90 motion-reduce:transition-none",
        active
          ? "border-gold/60 bg-[#2A2217]/90 text-gold"
          : surface
            ? "border-border/70 bg-surface-3 text-muted-foreground"
            : "border-white/15 bg-black/40 text-[oklch(0.96_0.008_88)]",
        size === "sm" ? "size-8" : "size-10",
        pop && "fav-pop",
        className,
      )}
    >

      <Heart
        className={cn(size === "sm" ? "size-4" : "size-[18px]", active && "fill-current")}
        strokeWidth={1.7}
      />

    </button>
  );
}
