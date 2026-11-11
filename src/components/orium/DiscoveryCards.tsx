import { ArrowUpRight } from "lucide-react";
import { HelpChooseSheetTrigger } from "@/components/orium/HelpChooseButton";
import { setPriceView } from "@/lib/decant-size";
import { trackDecant } from "@/lib/decants";
import { usePromotions } from "@/lib/use-promotions";
import { track } from "@/lib/analytics";
import helpImg from "@/assets/disc-help.jpg";
import styleImg from "@/assets/disc-style.jpg";
import offerImg from "@/assets/disc-offer.jpg";

/**
 * Três cartões editoriais logo abaixo da busca. Cada um abre um caminho real:
 * ajuda humana pelo WhatsApp, descoberta por acordes e — só quando existe
 * promoção de verdade — as ofertas do momento. Sem oferta ativa o terceiro
 * cartão mostra os decants, que sempre existem.
 */
export function DiscoveryCards({ onExplore }: { onExplore: () => void }) {
  const promotions = usePromotions();
  const hasOffers = promotions.length > 0;

  const goDecant = () => {
    setPriceView(5);
    trackDecant("decant_size_selected", { variant: "DECANT_5", details: { source: "atalho" } });
    onExplore();
  };

  return (
    <div className="page-bleed scrollbar-none mt-4 flex gap-3 overflow-x-auto pb-1 tab:mx-0 tab:grid tab:grid-cols-3 tab:px-0">
      <HelpChooseSheetTrigger
        className="press r-card relative h-[132px] w-[47%] shrink-0 overflow-hidden border border-border/50 text-left tab:w-auto"
        source="home_descoberta"
      >
        <CardArt image={helpImg} title="Não sabe qual escolher?" note="Eu te ajudo a encontrar." />
      </HelpChooseSheetTrigger>

      <button
        type="button"
        onClick={() => {
          track("discovery_clicked", { meta: { card: "estilo" } });
          onExplore();
        }}
        className="press r-card relative h-[132px] w-[47%] shrink-0 overflow-hidden border border-border/50 text-left tab:w-auto"
      >
        <CardArt image={styleImg} title="Encontre seu estilo" note="Descubra novas fragrâncias." />
      </button>

      <button
        type="button"
        onClick={() => {
          track("discovery_clicked", { meta: { card: hasOffers ? "ofertas" : "decants" } });
          if (hasOffers) onExplore();
          else goDecant();
        }}
        className="press r-card relative h-[132px] w-[47%] shrink-0 overflow-hidden border border-border/50 text-left tab:w-auto"
      >
        <CardArt
          image={offerImg}
          title={hasOffers ? "Ofertas exclusivas" : "Experimente em decant"}
          note={hasOffers ? "Aproveite no app." : "A partir de 2ml."}
        />
      </button>
    </div>
  );
}

function CardArt({ image, title, note }: { image: string; title: string; note: string }) {
  return (
    <>
      <img
        src={image}
        alt=""
        aria-hidden
        loading="lazy"
        decoding="async"
        width={640}
        height={640}
        className="absolute inset-0 size-full object-cover"
      />
      <span className="absolute inset-0 bg-gradient-to-t from-[oklch(0.12_0.012_70/0.94)] via-[oklch(0.12_0.012_70/0.62)] to-[oklch(0.12_0.012_70/0.28)]" />
      <span className="relative flex h-full flex-col justify-end gap-0.5 p-3">
        <span className="pr-9 text-[13.5px] leading-tight font-semibold text-[oklch(0.97_0.006_88)]">{title}</span>
        <span className="pr-9 text-[11px] leading-snug text-[oklch(0.88_0.01_88)]">{note}</span>
        <span className="absolute right-2.5 bottom-2.5 grid size-7 place-items-center rounded-full border border-gold/45 bg-gold/18 text-gold">
          <ArrowUpRight className="size-3.5" strokeWidth={2} />
        </span>
      </span>
    </>
  );
}
