import { setPriceView } from "@/lib/decant-size";
import { decantPrice } from "@/lib/decants";
import { track } from "@/lib/analytics";
import { brl } from "@/lib/format";
import { useDecantSettings } from "@/lib/use-decant-settings";
import { useRevealOnce } from "@/components/orium/Reveal";
import { DecantComboCard, useFeaturedCombo } from "@/components/orium/DecantCombo";
import { cn } from "@/lib/utils";
import { DecantStageCard } from "@/components/orium/home/DecantStageCard";
import { FrascosSpinCard } from "@/components/orium/home/FrascosSpinCard";
import trioImg from "@/assets/home-frascos-trio.webp";
import { usePricesOnRequestAll } from "@/lib/price-on-request";

/**
 * Dois cartões logo abaixo do vídeo: Decants (o decant 3D em tempo real) e
 * Frascos (o frasco girando em 360° com fotos reais). Preço mínimo e total de perfumes vêm dos dados reais.
 */
export function HomeShortcuts({
  onExplore,
  total,
}: {
  onExplore: () => void;
  total?: number | undefined;
}) {
  const settings = useDecantSettings();
  // só mostra o preço depois que a configuração chega: nada de valor provisório
  const onRequestAll = usePricesOnRequestAll();
  const from = settings === undefined || onRequestAll ? null : decantPrice(null, settings, 2);
  const { ref, seen } = useRevealOnce<HTMLDivElement>();
  // com promoção no ar, o cartão dela ocupa o lugar de "Decants": um só banner de decant na Home
  const { ready, featured: combo } = useFeaturedCombo();
  // preços sob consulta: sem cartão de combo com valor
  const featured = onRequestAll ? null : combo;

  return (
    <div
      ref={ref}
      data-home-shortcuts
      className={cn(
        "relative z-10 mt-5 grid gap-3 tab:grid-cols-2 tab:gap-4",
        seen ? "home-cards-in" : "home-cards-pre",
      )}
    >
      {featured ? (
        <DecantComboCard
          featured={featured}
          onExplore={onExplore}
          fromPrice={from}
          style={{ "--card-d": "0ms" } as React.CSSProperties}
        />
      ) : (
        <DecantStageCard
          onExplore={onExplore}
          style={
            { "--card-d": "0ms", visibility: ready ? undefined : "hidden" } as React.CSSProperties
          }
        />
      )}

      <FrascosSpinCard
        onExplore={onExplore}
        total={total}
        style={{ "--card-d": "90ms" } as React.CSSProperties}
        fallback={
          <ShortcutCard
            label="Frascos completos"
            onClick={() => {
              setPriceView("frasco");
              track("discovery_clicked", { meta: { card: "frascos" } });
              onExplore();
            }}
            image={trioImg}
            imageAlt="9AM Dive, 9PM e 9PM Night Out, da Afnan"
            imageW={642}
            imageH={272}
            imageClass="max-w-[420px]"
            style={{ "--card-d": "90ms" } as React.CSSProperties}
          >
            <span className="text-[36px] leading-[1.04] font-bold tracking-[-0.035em]">
              Frascos
            </span>
            <span className="mt-3 text-[17px] text-[#5F5A53]">
              A fragrância completa.
              {total ? <span className="value-in"> {total} perfumes.</span> : null}
            </span>
            <span className="mt-5 inline-flex h-[46px] items-center rounded-full bg-[#15130F] px-6 text-[15px] font-semibold text-white transition-transform duration-[var(--motion-fast)] ease-[var(--ease-orium)] group-hover:scale-[1.03]">
              Ver frascos
            </span>
          </ShortcutCard>
        }
      />
    </div>
  );
}

function ShortcutCard({
  label,
  onClick,
  image,
  imageAlt,
  imageW,
  imageH,
  imageClass,
  style,
  hidden,
  children,
}: {
  label: string;
  onClick: () => void;
  image: string;
  imageAlt: string;
  imageW: number;
  imageH: number;
  imageClass?: string;
  style?: React.CSSProperties;
  /** ocupa o espaço mas não aparece (enquanto a Home ainda decide se há promoção) */
  hidden?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      data-label={label}
      aria-hidden={hidden || undefined}
      tabIndex={hidden ? -1 : undefined}
      onClick={onClick}
      style={style}
      className={cn(
        "home-card press group flex flex-col items-center overflow-hidden rounded-[28px] bg-[#F2F1ED] px-5 pt-10 pb-0 text-center text-[#15130F] tab:rounded-[32px]",
        hidden && "invisible",
      )}
    >
      {children}
      <img
        src={image}
        alt={imageAlt}
        width={imageW}
        height={imageH}
        loading="lazy"
        decoding="async"
        className={cn(
          "mt-auto block h-auto w-full pt-5 transition-transform duration-700 ease-[var(--ease-orium)] group-hover:scale-[1.035]",
          imageClass,
        )}
      />
    </button>
  );
}
