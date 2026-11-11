import { Sparkles, Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { StockAlertCard } from "@/components/orium/StockAlertCard";
import { useFavorites } from "@/lib/favorites";

/**
 * “Quero experimentar” = favoritar o PERFUME (mesmo estado do coração do card).
 * Não depende de decant/frasco nem salva variante.
 */
export function ProductWishActions({
  productId,
  name,
  inStock,
}: {
  productId: string;
  name: string;
  inStock: boolean;
}) {
  const { isFavorite, toggle } = useFavorites();
  const active = isFavorite(productId);

  return (
    <div className="mt-3 space-y-3">
      <Button
        variant={active ? "secondary" : "outline"}
        aria-pressed={active}
        className="h-11 w-full rounded-full"
        onClick={() => {
          const added = toggle(productId);
          toast.success(added ? "Salvo nos seus favoritos" : "Removido dos favoritos", { duration: 1600 });
        }}
      >
        {active ? <Check className="size-4" /> : <Sparkles className="size-4" />}
        {active ? "Está nos seus favoritos" : "Quero experimentar"}
      </Button>

      {!inStock ? <StockAlertCard productId={productId} name={name} /> : null}
    </div>
  );
}
