import { useEffect, useRef, useState } from "react";
import { MessageCircle } from "lucide-react";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { productTitle } from "@/lib/format";
import { negotiationWhatsappLink, type NegotiationItem } from "@/lib/negotiation";
import { recordNegotiationInterest } from "@/lib/negotiation-interest.functions";
import { deviceId } from "@/lib/promotions";
import { useVisualViewport } from "@/hooks/use-visual-viewport";

/**
 * Antes de abrir o WhatsApp, pedimos só o nome do cliente — nada de telefone,
 * porque a conversa acontece no próprio WhatsApp dele. O nome entra na mensagem
 * automática e fica registrado para a equipe.
 */
export function NegotiationContactSheet({
  item,
  open,
  onOpenChange,
}: {
  item: Pick<NegotiationItem, "id" | "name">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [name, setName] = useState("");
  const [sending, setSending] = useState(false);
  const input = useRef<HTMLInputElement | null>(null);
  // Acompanha o teclado virtual: enquanto ele está aberto, empurramos o conteúdo
  // para cima com padding (nunca transform), então ao fechar nada fica preso.
  const vv = useVisualViewport(open);
  const keyboardOffset = open ? vv.keyboardOffset : 0;

  useEffect(() => {
    if (open) {
      if (!window.matchMedia("(pointer: fine)").matches) return;
      const t = setTimeout(() => input.current?.focus({ preventScroll: true }), 320);
      return () => clearTimeout(t);
    }
    setSending(false);
    return;
  }, [open]);

  const clean = name.trim();
  const canContinue = clean.length >= 2 && !sending;

  const go = () => {
    if (!canContinue) return;
    setSending(true);
    // O WhatsApp abre na hora; o registro do interesse vai em segundo plano.
    void recordNegotiationInterest({
      data: { itemId: item.id, visitorId: deviceId(), customerName: clean },
    }).catch(() => {});
    window.open(negotiationWhatsappLink(item, clean), "_blank", "noopener,noreferrer");
    onOpenChange(false);
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange} repositionInputs={false}>
      <DrawerContent
        className="max-h-[90dvh] overflow-y-auto px-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))] transition-[padding-bottom] duration-200 ease-out"
        style={{
          paddingBottom: keyboardOffset
            ? `calc(1.25rem + env(safe-area-inset-bottom) + ${keyboardOffset}px)`
            : undefined,
          maxHeight: vv.isKeyboardOpen && vv.height ? `${vv.height - 24}px` : undefined,
        }}
      >
        <DrawerHeader className="px-0 text-left">
          <DrawerTitle className="display text-xl">Como podemos te chamar?</DrawerTitle>
        </DrawerHeader>
        <p className="-mt-2 text-sm text-muted-foreground">
          Só o seu nome para a conversa sobre o {productTitle(item.name)} já começar certa.
        </p>

        <form
          className="mt-4"
          onSubmit={(e) => {
            e.preventDefault();
            go();
          }}
        >
          <Input
            ref={input}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Seu nome"
            autoComplete="given-name"
            enterKeyHint="go"
            className="h-12 rounded-2xl text-base"
            aria-label="Seu nome"
          />
          <Button
            type="submit"
            disabled={!canContinue}
            className="press mt-3 h-12 w-full rounded-full text-sm font-semibold"
          >
            <MessageCircle className="size-4" /> Continuar para o WhatsApp
          </Button>
        </form>
      </DrawerContent>
    </Drawer>
  );
}
