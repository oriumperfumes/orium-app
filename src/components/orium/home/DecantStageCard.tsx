import { useEffect, useRef, useState } from "react";
import { setPriceView } from "@/lib/decant-size";
import { decantPrice, trackDecant } from "@/lib/decants";
import { brl } from "@/lib/format";
import { useDecantSettings } from "@/lib/use-decant-settings";
import { usePricesOnRequestAll } from "@/lib/price-on-request";
import { cn } from "@/lib/utils";
import vialsImg from "@/assets/home-decants-vials.webp";
import type { DecantMl, DecantRT } from "@/components/orium/home/decant-rt";

const SIZES: DecantMl[] = [2, 5, 10];
const LASTS: Record<DecantMl, string> = { 2: "cerca de 1 semana", 5: "cerca de 2 semanas", 10: "cerca de 1 mês" };
const BG: [number, number, number] = [12, 12, 12];

/**
 * Card "Decants" da Home: um decant de verdade, em 3D, traçado por raio na
 * placa de vídeo do celular. Arrastar gira e balança o frasco — o perfume
 * acompanha com física; trocar o tamanho muda o frasco na proporção real.
 * Sem WebGL2 (aparelho muito antigo), mostra a foto de sempre.
 */
export function DecantStageCard({ onExplore, style }: { onExplore: () => void; style?: React.CSSProperties }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<DecantRT | null>(null);
  const [ml, setMl] = useState<DecantMl>(5);
  const [state, setState] = useState<"loading" | "live" | "fallback">("loading");
  const [touched, setTouched] = useState(false);
  const settings = useDecantSettings();
  const onRequestAll = usePricesOnRequestAll();
  const price = (s: DecantMl) => (settings === undefined || onRequestAll ? null : decantPrice(null, settings, s));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    let stage: DecantRT | null = null;
    // o código do palco só baixa quando o card chega perto da tela
    const start = () =>
      import("@/components/orium/home/decant-rt").then(({ createDecantRT }) => {
        if (cancelled) return;
        stage = createDecantRT(canvas, { ml, bg: BG, onFirstFrame: () => !cancelled && setState("live") });
        stageRef.current = stage;
        if (!stage) setState("fallback");
      });
    const io =
      typeof IntersectionObserver === "function"
        ? new IntersectionObserver(
            ([e]) => {
              if (e?.isIntersecting) {
                io?.disconnect();
                void start();
              }
            },
            { rootMargin: "300px 0px" },
          )
        : null;
    if (io) io.observe(canvas);
    else void start();
    return () => {
      cancelled = true;
      io?.disconnect();
      stage?.destroy();
      stageRef.current = null;
    };
    // o tamanho inicial só vale na criação; trocas passam por setSize
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pick = (s: DecantMl) => {
    setMl(s);
    stageRef.current?.setSize(s);
    trackDecant("decant_size_selected", { variant: `DECANT_${s}`, details: { source: "home_3d" } });
  };

  const from = price(2);

  return (
    <section
      style={style}
      aria-label="Decants de 2, 5 e 10 ml"
      className="home-card relative flex flex-col items-center overflow-hidden rounded-[28px] bg-[#0C0C0C] px-5 pt-9 pb-6 text-center text-white ring-1 ring-white/[0.06] tab:rounded-[32px]"
    >
      <h2 className="text-[36px] leading-[1.04] font-bold tracking-[-0.035em]">
        2 ml. 5 ml.
        <br />
        10 ml.
      </h2>
      <p className="mt-3 max-w-[290px] text-[16.5px] leading-[1.4] text-[#A9A9A9]">
        Prove antes do frasco.
        {from != null ? <span className="value-in"> A partir de {brl(from)}.</span> : null}
      </p>

      <div className="relative mt-2 h-[340px] w-full max-w-[380px] tab:h-[360px]" onPointerDown={() => setTouched(true)}>
        {state === "fallback" ? (
          <img src={vialsImg} alt="Três decants com perfume âmbar, de 2, 5 e 10 ml" className="mx-auto mt-10 block w-full max-w-[330px]" />
        ) : (
          <canvas
            ref={canvasRef}
            aria-label={`Decant de ${ml} ml em 3D. Arraste para girar.`}
            role="img"
            className={cn(
              "absolute inset-0 h-full w-full cursor-grab transition-opacity duration-700 active:cursor-grabbing",
              state === "live" ? "opacity-100" : "opacity-0",
            )}
          />
        )}
        {state === "live" ? (
          <span
            aria-hidden
            className={cn(
              "pointer-events-none absolute inset-x-0 bottom-1 text-[12px] font-medium text-[#6E6E6E] transition-opacity duration-500",
              touched && "opacity-0",
            )}
          >
            Arraste para girar
          </span>
        ) : null}
      </div>

      {/* tamanhos: fundo branco desliza até o escolhido */}
      <div role="radiogroup" aria-label="Tamanho do decant" className="relative mt-3 grid w-full max-w-[340px] grid-cols-3 rounded-full bg-[#1A1A1A] p-1">
        <span
          aria-hidden
          className="pd-thumb absolute top-1 bottom-1 left-1 rounded-full bg-white"
          style={{ width: "calc((100% - 0.5rem) / 3)", transform: `translateX(${SIZES.indexOf(ml) * 100}%)` }}
        />
        {SIZES.map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={ml === s}
            onClick={() => pick(s)}
            className={cn(
              "relative z-10 h-11 rounded-full text-[15px] transition-colors duration-300",
              ml === s ? "font-bold text-[#15130F]" : "font-medium text-[#CFCFCF]",
            )}
          >
            {s} ml
          </button>
        ))}
      </div>
      <p key={ml} className="value-in mt-3 text-[14px] text-[#A9A9A9]">
        {price(ml) != null ? <strong className="font-bold text-white tabular-nums">{brl(price(ml))}</strong> : null}
        {price(ml) != null ? " · " : ""}
        dura {LASTS[ml]}
      </p>

      <button
        type="button"
        onClick={() => {
          setPriceView(ml);
          trackDecant("decant_size_selected", { variant: `DECANT_${ml}`, details: { source: "home_3d_cta" } });
          onExplore();
        }}
        className="press mt-5 inline-flex h-[46px] items-center rounded-full bg-[#FFD599] px-6 text-[15px] font-bold text-[#15130F] transition-colors hover:bg-[#FFDDAA]"
      >
        Escolher decants de {ml} ml
      </button>
    </section>
  );
}
