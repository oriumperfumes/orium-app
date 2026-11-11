/**
 * "Quer ajuda para escolher?" — ação discreta, nunca competindo com o botão
 * principal de compra. Se o cliente ainda é anônimo, pedimos apenas nome e
 * WhatsApp antes de abrir a conversa; quem já se identificou segue direto.
 *
 * A mensagem é humanizada: nada de código, ID ou referência técnica.
 */
import { ChevronRight, MessageCircle } from "lucide-react";
import { productTitle } from "@/lib/format";
import { useLead } from "@/lib/lead";
import { track } from "@/lib/analytics";

const WHATSAPP = "5521977174508";

export function HelpChooseButton({
  productId,
  name,
  variant,
  decantMl,
}: {
  productId: string;
  name: string;
  variant: "FULL" | "DECANT";
  decantMl?: number | null;
}) {
  const { requestLead } = useLead();
  const perfume = productTitle(name);

  const open = () => {
    track("consultant_help_clicked", { productId, variant, decantMl: decantMl ?? null });
    requestLead({
      trigger: "ajuda_para_escolher",
      title: "Como podemos te chamar?",
      subtitle: `A Orium te ajuda a escolher entre o ${perfume} e outras opções.`,
      benefit: "Assim conseguimos continuar seu atendimento de onde você parou.",
      cta: "Continuar para o WhatsApp",
      onDone: (lead) => {
        const first = lead.name.trim().split(" ")[0];
        const msg =
          `Olá! Meu nome é ${first}. Estou olhando o ${perfume} na Orium e queria ajuda para escolher uma fragrância.`;
        window.open(`https://wa.me/${WHATSAPP}?text=${encodeURIComponent(msg)}`, "_blank", "noopener,noreferrer");
      },
    });
  };

  return (
    <button
      type="button"
      onClick={open}
      className="press mt-6 flex w-full items-center gap-3 rounded-[20px] bg-[#1A1A1A] p-4 text-left transition-colors hover:bg-[#1F1F1F]"
    >
      <span className="o-pop-icon">
        <MessageCircle className="size-[19px]" strokeWidth={2.2} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-bold text-white">Quer ajuda para escolher?</span>
        <span className="block text-[13px] text-[#A9A9A9]">Fale com a gente no WhatsApp</span>
      </span>
      <ChevronRight className="size-5 shrink-0 text-[#8C8C8C]" strokeWidth={2.2} />
    </button>
  );
}

/**
 * Mesmo fluxo de "Quer ajuda para escolher?", mas sem um perfume específico —
 * usado nos atalhos da Home. A aparência é livre (children), a mecânica é a
 * mesma: pedimos nome/WhatsApp só de quem ainda não se identificou.
 */
export function HelpChooseSheetTrigger({
  children,
  className,
  source,
}: {
  children: React.ReactNode;
  className?: string;
  source: string;
}) {
  const { requestLead } = useLead();

  const open = () => {
    track("consultant_help_clicked", { meta: { source } });
    requestLead({
      trigger: "ajuda_para_escolher",
      title: "Como podemos te chamar?",
      subtitle: "A Orium te ajuda a encontrar o perfume certo para o seu estilo.",
      benefit: "Assim conseguimos continuar seu atendimento de onde você parou.",
      cta: "Continuar para o WhatsApp",
      onDone: (lead) => {
        const first = lead.name.trim().split(" ")[0];
        const msg = `Olá! Meu nome é ${first}. Queria ajuda para escolher um perfume na Orium.`;
        window.open(`https://wa.me/${WHATSAPP}?text=${encodeURIComponent(msg)}`, "_blank", "noopener,noreferrer");
      },
    });
  };

  return (
    <button type="button" onClick={open} className={className}>
      {children}
    </button>
  );
}
