/**
 * Página do perfume — "Como ele evolui na pele" e "Como ele cheira" (Figma).
 *
 * Tudo vem do banco (pirâmide e acordes confirmados pela equipe). Sem dado
 * confirmado, a seção simplesmente não aparece — nada é inventado.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useRevealOnce } from "@/components/orium/Reveal";
import { cn } from "@/lib/utils";

type NoteRow = {
  note_label: string;
  pyramid_level: string;
  position: number;
  olfactory_notes: { canonical_name: string } | null;
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
    when: "Nos primeiros 15 minutos",
    title: "Saída",
    about: "O primeiro impacto, logo ao borrifar. É a parte mais viva do perfume e some mais rápido.",
  },
  {
    key: "HEART",
    stop: "30 min",
    when: "Depois de 30 minutos",
    title: "Coração",
    about: "A alma da fragrância: é o que você e quem está perto mais sentem ao longo do dia.",
  },
  {
    key: "BASE",
    stop: "3 h ou mais",
    when: "Depois de 3 horas",
    title: "Fundo",
    about: "O rastro final. Fica na pele e na roupa até o fim do dia — às vezes até o dia seguinte.",
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
          .select("note_label, pyramid_level, position, olfactory_notes(canonical_name)")
          .eq("product_id", productId)
          .order("position"),
      ]);
      return {
        details: details.data,
        accords: accords.data ?? [],
        notes: (notes.data ?? []) as unknown as NoteRow[],
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
      {notes.length ? <SkinTimeline notes={notes} /> : null}
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

function SkinTimeline({ notes }: { notes: NoteRow[] }) {
  // cada nota aparece uma única vez: na primeira fase em que surge (sem
  // duplicatas de grafia, como "Lavanda" e "lavanda francesa" → nome canônico)
  const used = new Set<string>();
  const stages = STAGES.map((s) => {
    const list: string[] = [];
    for (const n of notes.filter((x) => x.pyramid_level === s.key).sort((a, b) => a.position - b.position)) {
      const name = (n.olfactory_notes?.canonical_name ?? n.note_label ?? "").trim();
      const key = strip(name);
      if (!name || used.has(key)) continue;
      used.add(key);
      list.push(name);
      if (list.length === 5) break;
    }
    return { ...s, notes: list };
  }).filter((s) => s.notes.length);
  const [at, setAt] = useState(0);
  const { ref, seen } = useRevealOnce<HTMLElement>();
  if (!stages.length) return null;
  const stage = stages[Math.min(at, stages.length - 1)]!;
  const progress = stages.length > 1 ? (at / (stages.length - 1)) * 100 : 0;

  return (
    <section
      ref={ref}
      aria-label="Como ele evolui na pele"
      className={cn("pd-reveal mt-10 rounded-[24px] bg-[#1A1A1A] p-5 pb-6 lg:p-8", seen && "is-in")}
    >
      <h2 className="text-[18px] font-bold tracking-[-0.01em] text-white">Como ele evolui na pele</h2>
      <p className="mt-1 text-[13px] text-[#A9A9A9]">Toque no tempo para ver o que você sente.</p>

      {/* linha do tempo */}
      <div className="relative mt-6" role="tablist" aria-label="Tempo na pele">
        <div aria-hidden className="absolute top-[11px] right-[11px] left-[11px] h-[2px] rounded-full bg-white/15">
          <div
            className="h-full rounded-full bg-[#FFD599] transition-[width] duration-500 ease-[var(--ease-orium)]"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="relative flex justify-between">
          {stages.map((s, i) => {
            const on = i === at;
            const passed = i <= at;
            return (
              <button
                key={s.key}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setAt(i)}
                className={cn(
                  "press flex flex-col gap-2",
                  i === 0 ? "items-start" : i === stages.length - 1 ? "items-end" : "items-center",
                )}
              >
                <span
                  className={cn(
                    "grid size-[24px] place-items-center rounded-full border-2 transition-all duration-300 ease-[var(--ease-orium)]",
                    on
                      ? "scale-110 border-[#FFD599] bg-[#FFD599]"
                      : passed
                        ? "border-[#FFD599] bg-[#1A1A1A]"
                        : "border-white/30 bg-[#1A1A1A]",
                  )}
                />
                <span className={cn("text-[13px] transition-colors", on ? "font-bold text-white" : "font-medium text-[#8C8C8C]")}>
                  {s.stop}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* o que se sente nesse momento */}
      <div key={stage.key} className="pd-stage mt-6" role="tabpanel">
        <p className="text-[11px] font-bold tracking-[0.1em] text-[#FFD599] uppercase">{stage.when}</p>
        <h3 className="mt-1 text-[30px] leading-tight font-bold tracking-[-0.025em] text-white">{stage.title}</h3>
        <ul className="mt-3 space-y-2">
          {stage.notes.map((n, i) => (
            <li
              key={n}
              className="pd-note flex items-center gap-3 text-[18px] font-semibold text-white first-letter:uppercase"
              style={{ "--i": i } as React.CSSProperties}
            >
              <span aria-hidden className="h-[2px] w-3.5 shrink-0 rounded-full bg-[#FFD599]" />
              <span className="first-letter:uppercase">{n}</span>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-[14px] leading-relaxed text-[#A9A9A9]">{stage.about}</p>
      </div>
    </section>
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
                      k < lvl.dots ? "bg-[#FFD599]" : "bg-white/15",
                    )}
                    style={{ "--k": k } as React.CSSProperties}
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
