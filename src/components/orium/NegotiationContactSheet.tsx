import { useEffect, useRef, useState } from "react";
import { Check, CheckCheck, Gem, MessageCircle } from "lucide-react";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { productTitle } from "@/lib/format";
import {
  negotiationMessage,
  negotiationPhoto,
  negotiationWhatsappLink,
  type NegotiationItem,
} from "@/lib/negotiation";
import { recordNegotiationInterest } from "@/lib/negotiation-interest.functions";
import { deviceId } from "@/lib/promotions";
import { useVisualViewport } from "@/hooks/use-visual-viewport";
import { cn } from "@/lib/utils";

const NAME_KEY = "orium-negociacao-nome";

/**
 * "Fazer minha oferta": antes de abrir o WhatsApp, só o nome (nada de
 * telefone — a conversa acontece no WhatsApp da pessoa). O nome entra na
 * mensagem automática e fica registrado para a equipe.
 *
 * - Topo: a peça escolhida (foto, marca, nome), para a pessoa ter certeza.
 * - A prévia da mensagem do WhatsApp se escreve enquanto o nome é digitado.
 * - O nome fica guardado no aparelho: na próxima oferta já vem preenchido.
 * - Ao continuar: o WhatsApp abre na hora (precisa ser no próprio toque) e a
 *   janela mostra "Pronto!" com o check desenhado antes de fechar.
 */
export function NegotiationContactSheet({
  item,
  open,
  onOpenChange,
}: {
  item: Pick<NegotiationItem, "id" | "name"> & Partial<Pick<NegotiationItem, "brand" | "image_url" | "condition_note" | "volume_ml">>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [name, setName] = useState("");
  const [sent, setSent] = useState(false);
  const input = useRef<HTMLInputElement | null>(null);
  // Acompanha o teclado virtual: enquanto ele está aberto, empurramos o conteúdo
  // para cima com padding (nunca transform), então ao fechar nada fica preso.
  const vv = useVisualViewport(open);
  const keyboardOffset = open ? vv.keyboardOffset : 0;

  useEffect(() => {
    if (!open) {
      const t = setTimeout(() => setSent(false), 400);
      return () => clearTimeout(t);
    }
    try {
      const saved = localStorage.getItem(NAME_KEY);
      if (saved && !name) setName(saved);
    } catch {
      /* sem armazenamento: começa vazio */
    }
    if (!window.matchMedia("(pointer: fine)").matches) return;
    const t = setTimeout(() => input.current?.focus({ preventScroll: true }), 360);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const clean = name.trim();
  const first = clean.split(/\s+/)[0] ?? "";
  const canContinue = clean.length >= 2 && !sent;
  const photo = negotiationPhoto(item.image_url ?? null, "card");

  const go = () => {
    if (!canContinue) return;
    try {
      localStorage.setItem(NAME_KEY, clean);
    } catch {
      /* ignora */
    }
    // O WhatsApp abre na hora (dentro do toque); o registro vai em segundo plano.
    void recordNegotiationInterest({
      data: { itemId: item.id, visitorId: deviceId(), customerName: clean },
    }).catch(() => {});
    window.open(negotiationWhatsappLink(item, clean), "_blank", "noopener,noreferrer");
    setSent(true);
    setTimeout(() => onOpenChange(false), 1500);
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange} repositionInputs={false}>
      <DrawerContent
        className="ncs max-h-[92dvh] overflow-y-auto rounded-t-[32px] border-0 bg-[#121212] px-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] text-white transition-[padding-bottom] duration-200 ease-out sm:mx-auto sm:max-w-[460px]"
        style={{
          paddingBottom: keyboardOffset ? `calc(1.5rem + env(safe-area-inset-bottom) + ${keyboardOffset}px)` : undefined,
          maxHeight: vv.isKeyboardOpen && vv.height ? `${vv.height - 24}px` : undefined,
        }}
      >
        {sent ? (
          <div className="ncs-done flex flex-col items-center px-2 pt-8 pb-6 text-center">
            <svg viewBox="0 0 96 96" className="size-24" aria-hidden>
              <circle className="ncs-ring" cx="48" cy="48" r="44" fill="none" stroke="#FFD599" strokeWidth="5" strokeLinecap="round" />
              <path className="ncs-tick" d="M30 49 L43 62 L67 36" fill="none" stroke="#FFD599" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <DrawerTitle className="ncs-pop mt-5 text-[26px] leading-tight font-bold tracking-[-0.03em]">
              Pronto{first ? `, ${first}` : ""}!
            </DrawerTitle>
            <p className="ncs-pop mt-2 max-w-[300px] text-[15px] leading-snug text-[#A9A9A9]" style={{ animationDelay: "120ms" }}>
              Abrimos o WhatsApp com a sua mensagem. É só enviar e fazer a sua oferta.
            </p>
          </div>
        ) : (
          <>
            {/* a peça escolhida */}
            <div className="ncs-in mt-5 flex items-center gap-3.5 rounded-[22px] bg-[#1A1A1A] p-2.5 pr-4" style={{ ["--ni" as string]: 0 }}>
              <span className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-[16px] bg-[#F2F1ED] text-[#8C8C8C]">
                {photo ? <img src={photo} alt="" className="size-full object-cover" /> : <Gem className="size-6" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[11.5px] font-semibold tracking-[0.14em] text-[#8C8C8C] uppercase">{item.brand ?? "Orium"}</span>
                <span className="mt-0.5 block truncate text-[17px] leading-tight font-bold">{productTitle(item.name)}</span>
                <span className="mt-1 inline-flex items-center gap-1 text-[12.5px] font-semibold text-[#FFD599]">
                  <Gem className="size-3" /> Peça única{item.condition_note ? ` · ${item.condition_note}` : ""}
                </span>
              </span>
            </div>

            <DrawerTitle className="ncs-in mt-6 text-[28px] leading-[1.08] font-bold tracking-[-0.035em]" style={{ ["--ni" as string]: 1 }}>
              {first ? `Prazer, ${first}!` : "Qual é o seu nome?"}
            </DrawerTitle>
            <p className="ncs-in mt-1.5 text-[15px] leading-snug text-[#A9A9A9]" style={{ ["--ni" as string]: 2 }}>
              {first ? "Sua mensagem já está pronta. Confira abaixo." : "É só isso. A conversa já começa com você."}
            </p>

            <form
              className="ncs-in mt-5"
              style={{ ["--ni" as string]: 3 }}
              onSubmit={(e) => {
                e.preventDefault();
                go();
              }}
            >
              <input
                ref={input}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Seu nome"
                autoComplete="given-name"
                autoCapitalize="words"
                enterKeyHint="go"
                maxLength={60}
                aria-label="Seu nome"
                className="pk-field h-14 w-full rounded-[18px] bg-[#232323] px-5 text-[17px] font-semibold text-white outline-none transition-colors duration-200 placeholder:font-normal placeholder:text-[#6F6F6F] hover:bg-[#262626] focus:bg-[#2A2A2A]"
              />

              {/* prévia da mensagem, no balão do WhatsApp */}
              <div className="mt-4 rounded-[22px] bg-[#0B141A] p-3.5" aria-live="polite">
                <p className="mb-2 flex items-center gap-1.5 px-1 text-[11.5px] font-semibold tracking-wide text-[#8696A0] uppercase">
                  <MessageCircle className="size-3.5" /> Sua mensagem
                </p>
                <div key={first ? "com-nome" : "sem-nome"} className="ncs-bubble relative ml-auto max-w-[92%] rounded-[16px] rounded-tr-[4px] bg-[#005C4B] px-3.5 pt-2.5 pb-1.5 text-[14.5px] leading-snug text-[#E9EDEF]">
                  {negotiationMessage(item, clean)}
                  <span className="mt-1 flex items-center justify-end gap-1 text-[11px] text-[#8FB8AE]">
                    agora <CheckCheck className={cn("size-3.5", clean.length >= 2 && "text-[#53BDEB]")} />
                  </span>
                </div>
              </div>

              <button
                type="submit"
                disabled={!canContinue}
                className={cn(
                  "press group mt-5 flex h-[58px] w-full items-center justify-center gap-2.5 rounded-full text-[17px] font-bold transition-[background-color,color,transform] duration-300",
                  canContinue ? "ncs-ready bg-[#25D366] text-[#0B141A] hover:bg-[#2EE073]" : "bg-[#232323] text-[#6F6F6F]",
                )}
              >
                <MessageCircle className="size-5" strokeWidth={2.4} />
                {canContinue ? "Enviar no WhatsApp" : "Digite seu nome"}
              </button>
              <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-[12.5px] text-[#8C8C8C]">
                <Check className="size-3.5 text-[#7FCF9F]" strokeWidth={3} /> Sem cadastro · sem compromisso
              </p>
            </form>
          </>
        )}
      </DrawerContent>
    </Drawer>
  );
}
