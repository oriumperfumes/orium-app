import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ArrowRight, Check, Sparkles } from "lucide-react";
import { useCart } from "@/lib/cart";
import { track } from "@/lib/analytics";
import { setPriceView } from "@/lib/decant-size";
import { DECANT_SIZES, decantPrice, trackDecant, type DecantMl } from "@/lib/decants";
import {
  comboAcceptsSize,
  comboBrl,
  comboPriceLine,
  comboSaving,
  comboSizesLabel,
  comboSubtitle,
  comboTitle,
  comboUnitPrice,
  type DecantCombo,
} from "@/lib/decant-combos";
import { useDecantCombos, useDecantCombosLoaded } from "@/lib/use-promotions";
import { useDecantSettings } from "@/lib/use-decant-settings";
import { brl } from "@/lib/format";
import { cn } from "@/lib/utils";
import { StepBar } from "@/components/orium/StepProgress";
import { PopCard, PopIcon } from "@/components/orium/PopCard";
import { ConfettiBurst } from "@/lib/celebration";
import { navigatingFromLayer } from "@/hooks/use-back-to-close";

/** Combo em destaque (o que mais economiza) + números reais a partir dos preços de decant. */
export function useFeaturedCombo() {
  const combos = useDecantCombos();
  const loaded = useDecantCombosLoaded();
  const settings = useDecantSettings();
  const featured = useMemo(() => {
    if (!combos.length || settings === undefined) return null;
    const rows = combos.map((c) => {
      const sizes = (c.decant_sizes.length ? c.decant_sizes : DECANT_SIZES) as DecantMl[];
      // referência honesta: o MENOR preço normal entre os tamanhos que entram no combo
      const regular = Math.min(...sizes.map((ml) => decantPrice(null, settings, ml)));
      return { combo: c, regular, saving: comboSaving(c, regular) };
    });
    return rows.filter((r) => r.saving > 0).sort((a, b) => b.saving - a.saving)[0] ?? null;
  }, [combos, settings]);
  // pronto = já sabemos se existe combo (ou se não existe), então a Home decide uma vez só
  return { ready: loaded && settings !== undefined, featured };
}

export type FeaturedCombo = NonNullable<ReturnType<typeof useFeaturedCombo>["featured"]>;

const firstSize = (c: DecantCombo): DecantMl => ((c.decant_sizes[0] as DecantMl | undefined) ?? 5);

/** Contagem regressiva real até o fim do combo (só existe se o admin definiu uma data de fim). */
function useCountdown(endsAt: string | null) {
  const [now, setNow] = useState<number | null>(null); // só no navegador: evita diferença com o servidor
  useEffect(() => {
    if (!endsAt) return;
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [endsAt]);
  if (!endsAt || now == null) return null;
  const ms = new Date(endsAt).getTime() - now;
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const s = Math.floor(ms / 1000);
  return { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Faixa escura "Acaba em" com dias · horas · min · seg em blocos — urgência de verdade, sem inventar prazo. */
export function ComboCountdown({ endsAt, className }: { endsAt: string | null; className?: string }) {
  const left = useCountdown(endsAt);
  if (!left) return null;
  const parts = [
    ...(left.d > 0 ? [{ v: String(left.d), l: left.d === 1 ? "dia" : "dias" }] : []),
    { v: pad(left.h), l: "horas" },
    { v: pad(left.m), l: "min" },
    { v: pad(left.s), l: "seg" },
  ];
  return (
    <div className={cn("mt-5 flex items-center justify-between gap-3 rounded-[18px] bg-[#15130F] py-2.5 pr-2 pl-3.5", className)} role="timer" aria-live="off">
      <span className="text-[13px] leading-tight font-bold text-[#FFD599]">
        Acaba
        <br />
        em
      </span>
      <div className="flex min-w-0 items-center gap-1">
        {parts.map((p, i) => (
          <span key={p.l} className="flex items-center gap-1">
            {i > 0 ? <span className="text-[15px] font-bold text-[#FFD599]/40">:</span> : null}
            <span className="flex min-w-[40px] flex-col items-center rounded-[11px] bg-[#FFD599]/[0.12] px-1.5 py-1.5 min-[400px]:min-w-[46px]">
              <span className="text-[19px] leading-none font-extrabold text-[#FFD599] tabular-nums">{p.v}</span>
              <span className="mt-1 text-[9.5px] leading-none font-semibold tracking-[0.04em] text-[#FFD599]/70 uppercase">{p.l}</span>
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Cartão da Home — dourado, o único da página: ocupa o lugar do atalho "Decants"
 * enquanto a promoção está no ar (um só aviso de decant, não dois).
 * Só tipografia: preço gigante, quanto economiza e o que é preciso fazer. Tudo sai dos dados reais.
 */
export function DecantComboCard({
  featured,
  onExplore,
  fromPrice,
  style,
}: {
  featured: FeaturedCombo;
  onExplore: () => void;
  /** menor preço de decant, para o atalho secundário */
  fromPrice: number | null;
  style?: React.CSSProperties;
}) {
  const { combo, regular, saving } = featured;
  const eyebrow = combo.name.trim() || "Promoção da semana";
  const priceText = comboBrl(combo.combo_price);
  const normalTotal = money2(regular * combo.quantity);
  const pct = Math.round((saving / (regular * combo.quantity)) * 100);
  const size = firstSize(combo);

  const pick = () => {
    setPriceView(size);
    trackDecant("decant_size_selected", { variant: `DECANT_${size}`, details: { source: "home_combo" } });
    track("discovery_clicked", { meta: { card: "combo_decants" } });
    onExplore();
  };
  const all = () => {
    setPriceView(2);
    trackDecant("decant_size_selected", { variant: "DECANT_2", details: { source: "home_atalho" } });
    onExplore();
  };

  return (
    <div
      data-label="Combo de decants"
      style={style}
      onClick={pick}
      className="home-card group relative flex cursor-pointer flex-col overflow-hidden rounded-[28px] bg-[#FFD599] px-6 pt-6 pb-5 text-left text-[#15130F] tab:rounded-[32px]"
    >
      <span className="inline-flex items-center gap-2 self-start rounded-full bg-[#15130F] px-3.5 py-1.5 text-[12.5px] font-semibold tracking-[0.01em] whitespace-nowrap text-[#FFD599]">
        <span className="size-1.5 rounded-full bg-[#FFD599]" aria-hidden />
        {eyebrow}
      </span>

      <p className="mt-6 text-[26px] leading-none font-bold tracking-[-0.03em]">Leve {combo.quantity} decants</p>
      <p className="mt-1 flex items-baseline gap-2.5 leading-none">
        <span className="text-[22px] font-semibold tracking-[-0.02em]">por</span>
        <span className="text-[78px] font-extrabold tracking-[-0.025em] tabular-nums min-[400px]:text-[88px]">
          {priceText.replace(/\s/g, "\u00a0")}
        </span>
      </p>
      <p className="mt-1 text-[15.5px] text-[#15130F]/70 tabular-nums">
        em vez de <span className="line-through decoration-2">{comboBrl(normalTotal)}</span> · {comboBrl(comboUnitPrice(combo))} cada
      </p>

      <ComboCountdown endsAt={combo.ends_at} />

      {/* como funciona, em uma linha: três decants, qualquer perfume */}
      <div className="mt-5 flex flex-wrap items-center gap-x-1.5 gap-y-2" aria-hidden>
        {Array.from({ length: Math.min(combo.quantity, 5) }).map((_, i) => (
          <span key={i} className="flex items-center gap-1.5">
            {i > 0 ? <span className="text-[15px] font-bold text-[#15130F]/45">+</span> : null}
            <span className="rounded-full border-[1.5px] border-[#15130F]/80 px-3 py-1 text-[13.5px] font-bold">
              {size} ml
            </span>
          </span>
        ))}
      </div>
      <p className="mt-2 text-[14.5px] leading-snug text-[#15130F]/72">{comboSubtitle(combo)}</p>

      <div className="mt-5 flex items-center justify-between gap-3 rounded-[18px] bg-[#15130F] px-4 py-3 text-[#FFD599]">
        <span className="text-[15px] leading-tight font-bold">
          Você economiza
          <br />
          <span className="text-[22px] tracking-[-0.02em] tabular-nums">{comboBrl(saving)}</span>
        </span>
        <span className="rounded-full bg-[#FFD599] px-3.5 py-2 text-[18px] leading-none font-extrabold text-[#15130F] tabular-nums">
          {pct}% OFF
        </span>
      </div>

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          pick();
        }}
        aria-label={`${comboTitle(combo)} ${comboPriceLine(combo)}. Montar meu combo`}
        className="press mt-4 inline-flex h-[58px] w-full items-center justify-center gap-2 rounded-full bg-[#15130F] px-6 text-[17px] font-bold text-white transition-transform duration-[var(--motion-fast)] ease-[var(--ease-orium)] group-hover:scale-[1.015]"
      >
        Montar meu combo <ArrowRight className="size-[18px]" strokeWidth={2.4} />
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          all();
        }}
        className="press mt-1 inline-flex min-h-[44px] items-center justify-center px-3 text-[14px] font-semibold text-[#15130F]/75 underline decoration-[#15130F]/30 underline-offset-4"
      >
        Todos os decants{fromPrice != null ? ` · de ${brl(fromPrice)}` : ""}
      </button>
    </div>
  );
}

const money2 = (v: number) => Number(v.toFixed(2));

/**
 * Quanto custa ADICIONAR `qty` unidades de um decant do combo, considerando as `inProgress`
 * que já estão na Sacola esperando para fechar um conjunto (mesmo preço unitário).
 */
export function comboAddTotal(combo: Pick<DecantCombo, "quantity" | "combo_price">, unit: number, qty: number, inProgress = 0) {
  const q = combo.quantity;
  const sets = Math.floor((inProgress + qty) / q);
  const rest = inProgress + qty - sets * q;
  const withCombo = sets * Number(combo.combo_price) + rest * unit - (sets > 0 ? inProgress * unit : 0);
  const normal = qty * unit;
  return money2(Math.min(normal, Math.max(0, withCombo)));
}

/**
 * Na Sacola: mostra quanto falta para fechar o combo — e, quando fecha,
 * quanto o cliente está economizando. Só aparece se houver decant elegível.
 */
export function DecantComboBag() {
  const cart = useCart();
  const { featured } = useFeaturedCombo();
  const another = useBuildAnotherCombo();
  if (!featured) return null;
  const { combo } = featured;
  const progress = cart.comboProgress.find((p) => p.combo.id === combo.id);
  if (!progress || progress.eligible === 0) return null;

  const done = progress.sets > 0 && progress.inProgress === 0;
  const saved = cart.comboApplied.find((a) => a.combo.id === combo.id)?.saved ?? 0;
  const filled = done ? combo.quantity : progress.inProgress;
  const missing = progress.missing;

  return (
    <div
      className={cn(
        "my-4 rounded-[20px] p-4",
        saved > 0 ? "bg-[#221C14] ring-1 ring-[#FFD599]/60 ring-inset" : "bg-[#1A1A1A]",
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <p className={cn("text-[15px] font-bold", saved > 0 ? "text-[#FFD599]" : "text-white")}>
          {saved > 0 ? (
            <span className="inline-flex items-center gap-1.5">
              <Check className="size-4" strokeWidth={2.6} />
              {progress.sets > 1 ? `${progress.sets} combos aplicados` : "Combo aplicado"}
            </span>
          ) : (
            <>
              {comboTitle(combo)} <span className="text-[#FFD599]">{comboPriceLine(combo)}</span>
            </>
          )}
        </p>
        <span className="shrink-0 text-[13px] font-semibold text-[#A9A9A9] tabular-nums">
          {filled}/{combo.quantity}
        </span>
      </div>
      <StepBar value={filled} total={combo.quantity} className="mt-3" />
      <p className="mt-2.5 text-[13px] leading-snug text-[#A9A9A9]">
        {saved > 0 ? (
          <>
            Você economiza <span className="font-semibold text-white tabular-nums">{comboBrl(saved)}</span>
            {done ? "" : (
              <>
                {" · "}
                {missing === 1 ? "falta 1 decant" : `faltam ${missing} decants`} para o próximo
              </>
            )}
          </>
        ) : (
          <>
            {missing === 1 ? "Falta 1 decant" : `Faltam ${missing} decants`} para fechar o combo. Pode misturar os perfumes.
          </>
        )}
      </p>
      {done ? (
        <button
          type="button"
          onClick={() => another(true)}
          className="press mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-full bg-[#FFD599] text-[14px] font-bold text-[#15130F]"
        >
          Montar outro combo <ArrowRight className="size-4" strokeWidth={2.4} />
        </button>
      ) : null}
    </div>
  );
}

/**
 * Leva o cliente de volta ao catálogo com o tamanho do combo já escolhido.
 * `fromLayer`: chamado de dentro da Sacola (fecha a camada sem desfazer a navegação).
 */
export function useBuildAnotherCombo() {
  const cart = useCart();
  const navigate = useNavigate();
  const { featured } = useFeaturedCombo();
  return useCallback(
    (fromLayer = false) => {
      const size = featured ? firstSize(featured.combo) : 5;
      setPriceView(size);
      track("discovery_clicked", { meta: { card: "combo_outro" } });
      const scroll = () => document.getElementById("catalogo")?.scrollIntoView({ behavior: "smooth", block: "start" });
      if (fromLayer) {
        navigatingFromLayer();
        cart.setOpen(false);
      }
      if (window.location.pathname === "/") {
        window.setTimeout(scroll, fromLayer ? 320 : 0);
      } else {
        void navigate({ to: "/", replace: fromLayer }).then(() => window.setTimeout(scroll, 380));
      }
    },
    [cart, navigate, featured],
  );
}

/**
 * A comemoração: quando o cliente FECHA um combo (o 3º decant entra na Sacola),
 * sobe um aviso com confete, a economia real e o convite para montar outro.
 * Só reage a combos fechados agora — nunca ao abrir o app com a Sacola já cheia.
 */
export function DecantComboCelebration() {
  const cart = useCart();
  const { featured } = useFeaturedCombo();
  const another = useBuildAnotherCombo();
  const sets = featured ? (cart.comboApplied.find((a) => a.combo.id === featured.combo.id)?.sets ?? 0) : 0;
  const saved = featured ? (cart.comboApplied.find((a) => a.combo.id === featured.combo.id)?.saved ?? 0) : 0;
  const prev = useRef<number | null>(null);
  const armedAt = useRef(0);
  const [show, setShow] = useState<{ n: number; saved: number } | null>(null);

  useEffect(() => {
    if (!featured) return;
    const now = Date.now();
    if (prev.current == null) {
      // primeira leitura (Sacola restaurada / combo carregado): só registra
      prev.current = sets;
      armedAt.current = now + 1200;
      return;
    }
    if (sets > prev.current && now > armedAt.current) setShow({ n: sets, saved });
    prev.current = sets;
  }, [sets, saved, featured]);

  if (!show || !featured) return null;
  const { combo } = featured;
  return (
    <PopCard
      key={show.n}
      z={70}
      eyebrow={`${comboTitle(combo)} ${comboPriceLine(combo)}`}
      title={show.n > 1 ? `${show.n}º combo fechado!` : "Combo fechado!"}
      text={
        <>
          Você economizou <span className="font-bold text-white tabular-nums">{comboBrl(show.saved)}</span>. Quer montar outro?
        </>
      }
      media={
        <span className="relative block">
          <PopIcon>
            <Sparkles className="check-pop size-6" strokeWidth={2.2} />
          </PopIcon>
          <ConfettiBurst active className="-inset-16 overflow-visible" />
        </span>
      }
      primary={{ label: "Montar outro combo", onClick: () => another(cart.open) }}
      secondary={{ label: "Ver Sacola", onClick: () => cart.setOpen(true) }}
      onDismiss={() => setShow(null)}
    />
  );
}

/** O tamanho entra no combo em destaque? (para marcar a opção no seletor) */
export function useComboForSize() {
  const { featured } = useFeaturedCombo();
  return (ml: number) => (featured && comboAcceptsSize(featured.combo, ml) ? featured.combo : null);
}

/** Etiqueta dourada que pousa na borda de cima da opção de tamanho. */
export function ComboTag({ combo, className }: { combo: DecantCombo; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "pointer-events-none absolute -top-2 left-1/2 z-10 -translate-x-1/2 rounded-full bg-gold px-2 py-[3px] text-[9.5px] leading-none font-extrabold tracking-[0.02em] whitespace-nowrap text-gold-foreground",
        className,
      )}
    >
      {combo.quantity} por {comboBrl(combo.combo_price)}
    </span>
  );
}

/**
 * Faixa de promoção no bloco de compra do decant: mostra a vantagem e o progresso
 * ("Na Sacola: 1 de 3") — o combo se forma com perfumes variados, um a um.
 * Se o tamanho escolhido não entra no combo, convida a trocar com um toque.
 */
export function DecantComboPromo({
  ml,
  onPick,
  className,
}: {
  ml: number;
  onPick?: (ml: DecantMl) => void;
  className?: string;
}) {
  const cart = useCart();
  const { featured } = useFeaturedCombo();
  if (!featured) return null;
  const { combo, regular, saving } = featured;
  const inside = comboAcceptsSize(combo, ml);
  const progress = cart.comboProgress.find((p) => p.combo.id === combo.id);
  const have = progress?.inProgress ?? 0;
  const closedBefore = (progress?.sets ?? 0) > 0 && have === 0;
  const first = firstSize(combo);
  const savedNow = cart.comboApplied.find((a) => a.combo.id === combo.id)?.saved ?? 0;
  const shown = closedBefore ? combo.quantity : have;

  return (
    <div className={cn("rounded-2xl border border-gold/45 bg-gold/[0.10] px-4 py-3.5", closedBefore && inside && "border-gold bg-gold/[0.16]", className)}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-[15px] leading-tight font-extrabold text-gold">
          {closedBefore && inside ? (
            <span className="inline-flex items-center gap-1.5">
              <Check className="check-pop size-4" strokeWidth={2.8} /> Combo fechado
            </span>
          ) : (
            <>
              {comboTitle(combo)} {comboPriceLine(combo)}
            </>
          )}
        </p>
        {inside ? (
          <span className="shrink-0 text-[13px] font-semibold text-[#D0D0D0] tabular-nums">
            {shown}/{combo.quantity}
          </span>
        ) : null}
      </div>
      {inside ? <StepBar value={shown} total={combo.quantity} className="mt-3" /> : null}
      <p className="mt-2.5 text-[12.5px] leading-snug text-[#D0D0D0] tabular-nums">
        {!inside ? (
          <>Vale para decants de {comboSizesLabel(combo.decant_sizes).replace(" ml", "\u00a0ml")}.</>
        ) : have > 0 ? (
          <>
            Na Sacola: <span className="font-semibold text-white">{have} de {combo.quantity}</span>. Falta
            {combo.quantity - have === 1 ? "" : "m"} <span className="font-semibold text-white">{combo.quantity - have}</span> para fechar.
          </>
        ) : closedBefore ? (
          <>
            Você já economiza <span className="font-semibold text-white">{comboBrl(savedNow)}</span>. Este decant começa
            um novo combo: mais {combo.quantity} por {comboBrl(combo.combo_price)}.
          </>
        ) : (
          <>
            {comboBrl(comboUnitPrice(combo))} cada, em vez de {comboBrl(regular)} · economize{" "}
            <span className="font-semibold text-white">{comboBrl(saving)}</span>. Misture os perfumes que quiser.
          </>
        )}
      </p>

      {!inside && onPick ? (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onPick(first);
          }}
          className="press mt-3 flex h-11 w-full items-center justify-center rounded-full bg-gold text-[14px] font-bold text-gold-foreground"
        >
          Usar {first} ml e entrar no combo
        </button>
      ) : null}
    </div>
  );
}

/** Uma linha discreta sob o botão de decant: lembra do combo quando este tamanho entra nele. */
export function DecantComboHint({ ml, className }: { ml: number; className?: string }) {
  const { featured } = useFeaturedCombo();
  if (!featured) return null;
  const { combo } = featured;
  if (combo.decant_sizes.length > 0 && !combo.decant_sizes.includes(ml)) return null;
  return (
    <p className={cn("flex items-center justify-center gap-1.5 text-center text-[12px] leading-tight font-semibold text-gold", className)}>
      <span className="size-1.5 shrink-0 rounded-full bg-gold" aria-hidden />
      {comboTitle(combo)} {comboPriceLine(combo)}
    </p>
  );
}
