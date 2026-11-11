import { Trash2, X, ShoppingBag } from "lucide-react";
import { toast } from "sonner";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { brl } from "@/lib/format";
import { useKit } from "@/lib/kit";
import { useCart } from "@/lib/cart";
import { trackDecant } from "@/lib/decants";
import { flyToCart } from "@/lib/fly-to-cart";
import { SizeSelector } from "./DecantPicker";
import { cn } from "@/lib/utils";

/** Rodapé sticky do modo "Montar Kit": pequeno, respeita a área segura e nunca cobre conteúdo. */
export function KitBar() {
  const kit = useKit();
  if (!kit.active) return null;
  const n = kit.entries.length;

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border/60 bg-surface-1/95 px-4 pt-2.5 pb-safe backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl items-center gap-3">
        <button
          onClick={kit.stop}
          aria-label="Sair do modo kit"
          className="press grid size-10 shrink-0 place-items-center rounded-full border border-border/70"
        >
          <X className="size-4" />
        </button>
        <div className="min-w-0 flex-1">
          <p key={n} className="value-in truncate text-sm font-semibold">
            {n === 0 ? "Monte seu kit" : n === 1 ? "1 fragrância selecionada" : `${n} fragrâncias selecionadas`}
          </p>
          <p className="truncate text-[11px] text-muted-foreground">
            {n === 0 ? "Toque em “Adicionar ao kit” nos perfumes" : `Subtotal ${brl(kit.subtotal)}`}
          </p>
        </div>
        <Button className="press h-11 shrink-0 rounded-full px-5" disabled={n === 0} onClick={() => kit.setOpen(true)}>
          Ver meu kit
        </Button>
      </div>
    </div>
  );
}

/** Bottom sheet "Meu Kit": muda tamanho de cada perfume e envia tudo ao carrinho de uma vez. */
export function KitSheet() {
  const kit = useKit();
  const cart = useCart();

  const addAll = (e: React.MouseEvent) => {
    if (kit.entries.length === 0) return;
    cart.addMany(
      kit.entries.map((k) => ({
        quantity: 1,
        item: {
          productId: k.productId,
          variant: "DECANT" as const,
          decantMl: k.ml,
          slug: k.slug,
          name: k.name,
          brand: k.brand,
          image: k.image,
          volumeMl: k.ml,
          concentration: null,
          retailPrice: k.prices[k.ml],
          wholesalePrice: k.prices[k.ml],
        },
      })),
    );
    flyToCart(e.currentTarget as HTMLElement, kit.entries[0]?.image);
    trackDecant("kit_added_to_cart", { details: { count: kit.entries.length, subtotal: kit.subtotal } });
    toast.success(`${kit.entries.length} decants adicionados ao carrinho`, {
      action: { label: "Ver sacola", onClick: () => cart.setOpen(true) },
    });
    kit.clear();
    kit.stop();
  };

  return (
    <Drawer open={kit.open} onOpenChange={kit.setOpen}>
      <DrawerContent className="max-h-[88dvh] r-sheet border-border/60 px-0 pb-0">
        <DrawerTitle className="display px-5 pt-3 text-xl">Meu Kit</DrawerTitle>
        <p className="px-5 text-xs text-muted-foreground">Ajuste o tamanho de cada decant. Sem desconto automático — o preço é o de cada tamanho.</p>

        <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto overscroll-contain px-4 pt-3 pb-3">
          {kit.entries.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">Seu kit está vazio.</div>
          ) : (
            kit.entries.map((k) => (
              <div key={k.productId} className="value-in rounded-2xl border border-border/70 bg-surface-3 p-3">
                <div className="flex gap-3">
                  <div className="size-14 shrink-0 overflow-hidden rounded-xl bg-accent/60">
                    {k.image ? <img src={k.image} alt={k.name} loading="lazy" className="size-full object-cover" /> : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{k.name}</p>
                    <p className="truncate text-[11px] tracking-wide text-muted-foreground uppercase">{k.brand}</p>
                    <p key={k.ml} className={cn("price-morph mt-1 text-sm font-semibold text-gold")}>
                      {k.ml}ml · {brl(k.prices[k.ml])}
                    </p>
                  </div>
                  <button
                    className="press -mt-1 grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground"
                    aria-label={`Remover ${k.name} do kit`}
                    onClick={() => kit.remove(k.productId)}
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
                <SizeSelector className="mt-2.5" size="sm" value={k.ml} prices={k.prices} onChange={(ml) => kit.setMl(k.productId, ml)} />
              </div>
            ))
          )}
        </div>

        <div className="border-t border-border/60 bg-popover/95 px-4 pt-3 pb-safe backdrop-blur-xl">
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-sm font-medium">Subtotal · {kit.entries.length} decant{kit.entries.length === 1 ? "" : "s"}</span>
            <span key={kit.subtotal} className="value-in text-lg font-semibold tabular-nums">
              {brl(kit.subtotal)}
            </span>
          </div>
          <Button className="press h-13 w-full rounded-full text-base" disabled={kit.entries.length === 0} onClick={addAll}>
            <ShoppingBag className="size-4" /> Adicionar kit à sacola
          </Button>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
