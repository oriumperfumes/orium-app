/**
 * Página do perfume — "Como ele evolui na pele" e "Como ele cheira" (Figma).
 *
 * Tudo vem do banco (pirâmide e acordes confirmados pela equipe). Sem dado
 * confirmado, a seção simplesmente não aparece — nada é inventado.
 */
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Clock3, Moon, SprayCan, Sun } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useRevealOnce } from "@/components/orium/Reveal";
import { cn } from "@/lib/utils";
import { accordColor } from "@/lib/accord-color";

type NoteRow = {
  note_label: string;
  pyramid_level: string;
  position: number;
  olfactory_notes: { canonical_name: string; image_url: string | null } | null;
};

type Stage = {
  key: "TOP" | "HEART" | "BASE";
  stop: string;
  when: string;
  title: string;
  about: string;
};

const STAGES: Stage[] = [
  {
    key: "TOP",
    stop: "Borrifou",
    when: "0 a 15 min",
    title: "Saída",
    about: "O primeiro impacto: a parte mais viva, que some mais rápido.",
  },
  {
    key: "HEART",
    stop: "30 min",
    when: "30 min a 3 h",
    title: "Coração",
    about: "A alma do perfume: o que você e quem está perto mais sentem.",
  },
  {
    key: "BASE",
    stop: "3 h+",
    when: "3 h ou mais",
    title: "Fundo",
    about: "O rastro que fica na pele e na roupa até o fim do dia.",
  },
];

const strip = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

/** Adjetivo simples a partir do nome do acorde (para a frase de abertura). */
function accordMood(name: string): string | null {
  const k = strip(name);
  if (/baunilha|doce|caramelo|mel|coco|amendoa|tonka|praline|acucar|toffee/.test(k)) return "doce";
  if (/cafe|cacau|chocolate|gourmand/.test(k)) return "gourmand";
  if (/ambar|incenso|resina|balsam|benjoim|mirra|ladano|labdano|quente/.test(k)) return "quente";
  if (/especi|pimenta|canela|cardamomo|acafrao|cravo|tabaco/.test(k)) return "especiado";
  if (/amadeir|madeira|cedro|sandalo|oud|vetiver|patchouli/.test(k)) return "amadeirado";
  if (/floral|rosa|jasmim|iris|violeta|lirio|gardenia|tuberosa|flor|ylang|neroli|peonia/.test(k)) return "floral";
  if (/citr|limao|bergamot|laranja|toranja/.test(k)) return "cítrico";
  if (/aromat|lavanda|herbal|hortela|salvia|alecrim/.test(k)) return "aromático";
  if (/aquat|marinh|fresc|ozon|salin|verde/.test(k)) return "fresco";
  if (/frut|abacaxi|maca|framboesa|damasco|pessego|groselha|cassis|amora|morango|tamara|ameixa|lichia/.test(k)) return "frutado";
  if (/almiscar|musk|atalcado|talco|powder/.test(k)) return "suave";
  if (/couro|leather/.test(k)) return "marcante";
  return null;
}

const LEVEL = [
  { min: 0.85, dots: 4, label: "Muito forte" },
  { min: 0.6, dots: 3, label: "Forte" },
  { min: 0.4, dots: 2, label: "Médio" },
  { min: 0, dots: 1, label: "Leve" },
] as const;

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function ProductScent({ productId }: { productId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["product-scent", productId],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const [details, accords, notes] = await Promise.all([
        supabase
          .from("fragrance_details")
          .select("description, status, verified, locked")
          .eq("product_id", productId)
          .maybeSingle(),
        supabase
          .from("fragrance_accords")
          .select("accord_name, intensity, position")
          .eq("product_id", productId)
          .order("position"),
        supabase
          .from("fragrance_notes")
          .select("note_label, pyramid_level, position, olfactory_notes(canonical_name, image_url)")
          .eq("product_id", productId)
          .order("position"),
      ]);
      const rows = (notes.data ?? []) as unknown as NoteRow[];
      // notas sem foto na biblioteca: tenta a foto guardada pelo nome
      const missing = rows.filter((r) => !r.olfactory_notes?.image_url).map((r) => r.olfactory_notes?.canonical_name ?? r.note_label);
      const images = new Map<string, string>();
      if (missing.length) {
        const { data: assets } = await supabase
          .from("olfactory_note_assets")
          .select("canonical_note_name, image_url")
          .in("canonical_note_name", missing);
        for (const a of (assets ?? []) as Array<{ canonical_note_name: string; image_url: string | null }>)
          if (a.image_url) images.set(strip(a.canonical_note_name), a.image_url);
      }
      return {
        details: details.data,
        accords: accords.data ?? [],
        notes: rows,
        images,
      };
    },
  });

  if (isLoading) {
    return (
      <div className="mt-10 space-y-4">
        <div className="h-[300px] skeleton rounded-[24px]" />
        <div className="h-6 w-40 skeleton rounded-full" />
        <div className="h-40 skeleton rounded-[20px]" />
      </div>
    );
  }

  const d = data?.details;
  const trusted = !!d && (d.verified || d.locked || d.status === "completo" || d.status === "parcial");
  if (!trusted) return null;

  const notes = data?.notes ?? [];
  const accords = (data?.accords ?? []).filter((a) => a.accord_name);
  const description = d?.description?.trim() || null;

  return (
    // computador: evolução na pele e perfil do cheiro lado a lado
    <div className="lg:grid lg:grid-cols-2 lg:items-start lg:gap-12 wide:gap-16">
      {notes.length ? <SkinTimeline notes={notes} images={data?.images ?? new Map()} /> : null}
      {accords.length ? (
        <ScentProfile
          accords={accords.map((a) => ({ name: a.accord_name as string, intensity: Number(a.intensity ?? 0.6) }))}
          description={description}
        />
      ) : null}
    </div>
  );
}

/* ———————————————————— Como ele evolui na pele ———————————————————— */

const DWELL = 3600; // ms em cada fase no "passa sozinho"

function SkinTimeline({ notes, images }: { notes: NoteRow[]; images: Map<string, string> }) {
  // cada nota aparece uma única vez: na primeira fase em que surge (sem
  // duplicatas de grafia, como "Lavanda" e "lavanda francesa" → nome canônico)
  const used = new Set<string>();
  const stages = STAGES.map((s) => {
    const list: Array<{ name: string; img: string | null }> = [];
    for (const n of notes.filter((x) => x.pyramid_level === s.key).sort((a, b) => a.position - b.position)) {
      const name = (n.olfactory_notes?.canonical_name ?? n.note_label ?? "").trim();
      const k = strip(name);
      if (!name || used.has(k)) continue;
      used.add(k);
      list.push({ name, img: n.olfactory_notes?.image_url ?? images.get(k) ?? null });
      if (list.length === 6) break;
    }
    return { ...s, notes: list };
  }).filter((s) => s.notes.length);

  const [at, setAt] = useState(0);
  const [auto, setAuto] = useState(true);
  const { ref, seen } = useRevealOnce<HTMLElement>();

  // quando aparece na tela, passa pelas fases sozinho (como stories); um toque para
  useEffect(() => {
    if (!seen || !auto || stages.length < 2) return;
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    const t = setTimeout(() => {
      if (at >= stages.length - 1) setAuto(false);
      else setAt(at + 1);
    }, DWELL);
    return () => clearTimeout(t);
  }, [seen, auto, at, stages.length]);

  if (!stages.length) return null;
  const stage = stages[Math.min(at, stages.length - 1)]!;
  const pick = (i: number) => {
    setAuto(false);
    setAt(i);
  };

  return (
    <section
      ref={ref}
      aria-label="Como ele evolui na pele"
      className={cn("pd-reveal skin mt-10 overflow-hidden rounded-[28px] bg-[#1A1A1A] p-5 pb-6 lg:p-8", seen && "is-in")}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[20px] font-bold tracking-[-0.02em] text-white">Como ele evolui na pele</h2>
          <p className="mt-1 text-[13.5px] text-[#A9A9A9]">Do borrifo ao fim do dia.</p>
        </div>
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-[#232323] text-[#FFD599]" aria-hidden>
          <Clock3 className="size-5" />
        </span>
      </div>

      {/* linha do tempo: cada fase é um "story" que enche */}
      <div className="mt-6 grid gap-2" style={{ gridTemplateColumns: `repeat(${stages.length}, minmax(0, 1fr))` }} role="tablist" aria-label="Tempo na pele">
        {stages.map((s, i) => {
          const on = i === at;
          const passed = i < at;
          return (
            <button key={s.key} type="button" role="tab" aria-selected={on} onClick={() => pick(i)} className="press group flex flex-col gap-2 text-left">
              <span className="relative block h-1.5 overflow-hidden rounded-full bg-white/[0.12]">
                <span
                  key={`${s.key}-${on}-${auto}`}
                  className={cn(
                    "absolute inset-y-0 left-0 rounded-full bg-[#FFD599]",
                    passed ? "w-full" : on ? (auto && seen ? "skin-fill w-full" : "w-full") : "w-0",
                  )}
                  style={on && auto && seen ? ({ "--dwell": `${DWELL}ms` } as React.CSSProperties) : undefined}
                />
              </span>
              <span className="flex items-center gap-1.5">
                <span className={cn("grid size-6 place-items-center rounded-full transition-colors duration-300", on ? "bg-[#FFD599] text-[#15130F]" : "bg-[#232323] text-[#8C8C8C]")}>
                  {i === 0 ? <SprayCan className="size-3.5" /> : i === stages.length - 1 ? <Moon className="size-3.5" /> : <Sun className="size-3.5" />}
                </span>
                <span className={cn("truncate text-[13px] transition-colors", on ? "font-bold text-white" : "font-semibold text-[#8C8C8C] group-hover:text-white")}>
                  {s.stop}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {/* o que se sente nesse momento: as notas em foto */}
      <div key={stage.key} className="skin-stage mt-6" role="tabpanel">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-[30px] leading-none font-bold tracking-[-0.03em] text-white">{stage.title}</h3>
          <span className="text-[12px] font-bold tracking-[0.08em] text-[#FFD599] uppercase">{stage.when}</span>
        </div>
        <ul className={cn("mt-5 grid gap-x-3 gap-y-4", stage.notes.length <= 2 ? "grid-cols-2" : "grid-cols-3 sm:grid-cols-4 lg:grid-cols-3 xl:grid-cols-4")}>
          {stage.notes.map((n, i) => (
            <li key={n.name} className="skin-note flex flex-col items-center gap-2 text-center" style={{ "--i": i } as React.CSSProperties}>
              <NoteBubble name={n.name} img={n.img} />
              <span className="line-clamp-2 text-[14px] leading-tight font-semibold text-white first-letter:uppercase">{n.name}</span>
            </li>
          ))}
        </ul>
        <p className="mt-5 text-[14px] leading-snug text-[#A9A9A9]">{stage.about}</p>
      </div>
    </section>
  );
}

/** Foto redonda da nota (ou a inicial, quando ainda não há foto). */
function NoteBubble({ name, img }: { name: string; img: string | null }) {
  const [broken, setBroken] = useState(false);
  return (
    <span className="skin-bubble relative grid aspect-square w-full max-w-[96px] place-items-center overflow-hidden rounded-full bg-[#F2F1ED] ring-4 ring-[#232323]">
      {img && !broken ? (
        <img src={img} alt="" loading="lazy" className="size-full object-cover" onError={() => setBroken(true)} />
      ) : (
        <span className="text-[26px] font-bold text-[#15130F]">{name.charAt(0).toUpperCase()}</span>
      )}
    </span>
  );
}

/* ———————————————————— Como ele cheira ———————————————————— */

function ScentProfile({
  accords,
  description,
}: {
  accords: Array<{ name: string; intensity: number }>;
  description: string | null;
}) {
  const { ref, seen } = useRevealOnce<HTMLElement>();
  const [more, setMore] = useState(false);
  // acordes únicos (sem repetir a mesma palavra com outra grafia)
  const seenAcc = new Set<string>();
  const top = accords
    .filter((a) => {
      const k = strip(a.name);
      if (seenAcc.has(k)) return false;
      seenAcc.add(k);
      return true;
    })
    .slice(0, 6);
  const max = Math.max(0.01, ...top.map((a) => a.intensity));

  const stars = top.slice(0, 2).map((a) => a.name.toLowerCase());
  // o "clima" da frase nunca repete os acordes já citados em dourado
  const starWords = new Set(stars.flatMap((s) => strip(s).split(/\s+/)));
  const moods: string[] = [];
  for (const a of top) {
    const m = accordMood(a.name);
    if (!m || moods.includes(m) || starWords.has(strip(m))) continue;
    moods.push(m);
    if (moods.length === 2) break;
  }

  return (
    <section ref={ref} aria-label="Como ele cheira" className={cn("pd-reveal mt-10 lg:pt-2", seen && "is-in")}>
      <h2 className="text-[18px] font-bold tracking-[-0.01em] text-white">Como ele cheira</h2>
      <p className="mt-2 text-[24px] leading-[1.25] font-bold tracking-[-0.02em] text-white">
        {moods.length ? `${cap(moods.join(" e "))}, com ` : "Com "}
        <span className="text-[#FFD599]">{stars[0]}</span>
        {stars[1] ? (
          <>
            {" e "}
            <span className="text-[#FFD599]">{stars[1]}</span>
          </>
        ) : null}{" "}
        em destaque.
      </p>

      <ul className="mt-5">
        {top.map((a, i) => {
          const v = a.intensity / max;
          const lvl = LEVEL.find((l) => v >= l.min) ?? LEVEL[3];
          return (
            <li
              key={a.name}
              className="pd-row flex h-[52px] items-center gap-3 border-t border-white/[0.08]"
              style={{ "--i": i } as React.CSSProperties}
            >
              <span className="size-2.5 shrink-0 rounded-full" style={{ background: accordColor(a.name) }} aria-hidden />
              <span className="min-w-0 flex-1 truncate text-[16px] font-medium text-white first-letter:uppercase">{a.name}</span>
              <span className={cn("text-[13px] font-semibold", lvl.dots === 4 ? "text-[#FFD599]" : "text-[#A9A9A9]")}>
                {lvl.label}
              </span>
              <span className="flex gap-1" aria-hidden>
                {[0, 1, 2, 3].map((k) => (
                  <span
                    key={k}
                    className={cn(
                      "pd-dot h-[5px] w-3 rounded-full",
                      k < lvl.dots ? "" : "bg-white/15",
                    )}
                    style={{ "--k": k, ...(k < lvl.dots ? { background: accordColor(a.name) } : {}) } as React.CSSProperties}
                  />
                ))}
              </span>
            </li>
          );
        })}
      </ul>

      {description ? (
        <div className="mt-6">
          <p className={cn("text-[15px] leading-relaxed text-[#A9A9A9]", !more && "line-clamp-3")}>{description}</p>
          {description.length > 180 ? (
            <button
              type="button"
              onClick={() => setMore((v) => !v)}
              className="press mt-2 inline-flex items-center gap-1 text-[14px] font-bold text-[#FFD599]"
            >
              {more ? "Ler menos" : "Ler mais"}
              <ChevronDown className={cn("size-4 transition-transform duration-300", more && "rotate-180")} strokeWidth={2.4} />
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
