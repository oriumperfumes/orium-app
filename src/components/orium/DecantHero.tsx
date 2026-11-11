import { ArrowRight } from "lucide-react";
import heroImg from "@/assets/home-hero-asad.webp";

/**
 * Abertura da Orium — imagem editorial contínua (full-bleed) do Asad Bourbon
 * que se dissolve no fundo da Home; os atalhos sobem por cima do fade.
 */
export function DecantHero({ onExplore }: { onExplore: () => void }) {
  const fade =
    "linear-gradient(180deg, #000 0%, #000 52%, rgba(0,0,0,0.7) 68%, rgba(0,0,0,0.25) 86%, transparent 100%)";
  return (
    <section
      aria-label="Seu próximo perfume"
      className="hero-in page-bleed relative isolate mt-[calc(-9rem-env(safe-area-inset-top))] overflow-hidden text-[oklch(0.97_0.008_88)] "
    >
      <img
        src={heroImg}
        alt="Asad Bourbon, da Lattafa"
        width={1024}
        height={1280}
        fetchPriority="high"
        style={{ maskImage: fade, WebkitMaskImage: fade }}
        className="hero-img absolute inset-0 -z-20 size-full object-cover object-[62%_30%] sm:object-[85%_40%]"
      />
      <div aria-hidden className="absolute inset-x-0 top-0 -z-10 h-48 bg-gradient-to-b from-[oklch(0.08_0.01_60/0.55)] to-transparent" />
      <div
        style={{ maskImage: fade, WebkitMaskImage: fade }}
        className="absolute inset-0 -z-10 bg-[linear-gradient(90deg,oklch(0.1_0.012_60/0.85)_0%,oklch(0.1_0.012_60/0.35)_45%,transparent_70%)]"
      />

      <div className="flex min-h-[680px] max-w-[54%] flex-col justify-start px-0 pt-[calc(13rem+env(safe-area-inset-top))] pb-40 min-[400px]:min-h-[720px] sm:min-h-[760px] sm:max-w-[46%] sm:px-10 sm:pt-[calc(13rem+env(safe-area-inset-top))]">
        <h1 className="hero-line text-[34px] leading-[1.02] font-semibold tracking-[-0.035em] min-[375px]:text-[38px] sm:text-[60px]">
          Seu próximo
          <br />
          perfume.
        </h1>
        <p className="hero-line mt-4 max-w-[17ch] text-[14.5px] leading-snug opacity-85 [animation-delay:90ms] sm:text-[17px]">
          Perfumes árabes em decants e frascos.
        </p>
        <button
          onClick={onExplore}
          className="hero-line press mt-8 inline-flex h-12 items-center justify-center gap-2 self-start rounded-full bg-gold px-5 text-[14.5px] font-semibold whitespace-nowrap text-gold-foreground shadow-[0_10px_30px_-10px_var(--gold)] [animation-delay:170ms] min-[375px]:px-6"
        >
          Explorar perfumes <ArrowRight className="size-4 shrink-0" strokeWidth={2} />
        </button>
        <p className="hero-line mt-5 text-[11.5px] tracking-wide opacity-60 [animation-delay:240ms]">
          Asad Bourbon · Lattafa
        </p>
      </div>
    </section>
  );
}
