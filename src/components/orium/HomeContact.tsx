import { useRevealOnce } from "@/components/orium/Reveal";
import { cn } from "@/lib/utils";

/** Mesmo número do atendimento e da Negociação. */
const NEGOTIATION_WHATSAPP = "5521977174508";
const PHONE_LABEL = "(21) 97717-4508";
const WHATSAPP_URL = `https://wa.me/${NEGOTIATION_WHATSAPP}?text=${encodeURIComponent(
  "Olá! Vim pelo site da Orium e queria tirar uma dúvida.",
)}`;

/** Fecho da Home: atendimento humano pelo WhatsApp, no mesmo tom do resto. */
export function HomeContact() {
  const { ref, seen } = useRevealOnce<HTMLElement>();
  return (
    <section
      ref={ref}
      aria-label="Fale com a gente"
      className={cn(
        "mt-14 rounded-[30px] bg-[#1A1A1A] px-6 py-9 text-center tab:mx-auto tab:max-w-xl lg:mt-24 lg:flex lg:max-w-none lg:items-center lg:justify-between lg:gap-10 lg:rounded-[36px] lg:px-14 lg:py-12 lg:text-left",
        seen ? "home-cards-in" : "home-cards-pre",
      )}
    >
      <div>
        <h2
          className="home-card text-[34px] leading-[1.08] font-bold tracking-[-0.03em] text-white lg:text-[44px]"
          style={{ "--card-d": "0ms" } as React.CSSProperties}
        >
          Fale com a gente.
        </h2>
        <p
          className="home-card mx-auto mt-3 max-w-[26ch] text-[16px] leading-[1.45] text-[#A8A8A8] lg:mx-0 lg:max-w-[40ch] lg:text-[17px]"
          style={{ "--card-d": "60ms" } as React.CSSProperties}
        >
          Pedidos, dúvidas e atacado a partir de 6 peças, direto pelo WhatsApp.
        </p>
      </div>
      <div className="lg:flex lg:shrink-0 lg:items-center lg:gap-7">
        <a
          href={`tel:+${NEGOTIATION_WHATSAPP}`}
          className="home-card mt-4 inline-block text-[22px] font-semibold tracking-[-0.01em] text-white tabular-nums lg:mt-0 lg:text-[24px]"
          style={{ "--card-d": "110ms" } as React.CSSProperties}
        >
          {PHONE_LABEL}
        </a>
        <div className="home-card mt-5 lg:mt-0" style={{ "--card-d": "160ms" } as React.CSSProperties}>
          <a
            href={WHATSAPP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="press inline-flex h-12 items-center justify-center rounded-full bg-[#FFD599] px-7 text-[15px] font-bold text-[#15130F] transition-colors hover:bg-[#FFDDAA] lg:h-[54px] lg:px-9 lg:text-[16px]"
          >
            Chamar no WhatsApp
          </a>
        </div>
      </div>
    </section>
  );
}
