/**
 * "Conheça a fragrância": principais acordes, descrição da Orium e pirâmide
 * olfativa. Tudo vem do banco (enriquecido em background) — nunca de pesquisa
 * externa durante a visita. Animações entram uma única vez, com Intersection
 * Observer, e respeitam prefers-reduced-motion.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Reveal, useRevealOnce } from "@/components/orium/Reveal";


type NoteRow = {
  note_label: string;
  pyramid_level: string;
  position: number;
  olfactory_notes: { canonical_name: string; category: string; image_url: string | null; description: string | null } | null;
};

const CATEGORIES = [
  "citrico",
  "floral",
  "amadeirado",
  "especiado",
  "doce",
  "gourmand",
  "ambarado",
  "almiscarado",
  "aromatico",
  "aquatico",
  "frutado",
  "couro",
] as const;

const strip = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

/** Família visual do acorde a partir do próprio nome (só tons, nada de dados). */
function accordCategory(name: string) {
  const k = strip(name);
  if (/citr|limao|bergamot|laranja|toranja/.test(k)) return "citrico";
  if (/floral|rosa|jasmim|iris|violeta|lirio|gardenia|tuberosa|flor|ylang|neroli|osmanto|peonia/.test(k)) return "floral";
  if (/amadeir|madeira|cedro|sandalo|oud|vetiver|patchouli/.test(k)) return "amadeirado";
  if (/especi|pimenta|canela|cardamomo|acafrao|cravo|tabaco/.test(k)) return "especiado";
  if (/baunilha|doce|caramelo|mel|coco|amendoa|tonka|praline|acucar|toffee/.test(k)) return "doce";
  if (/gourmand|cafe|cacau|chocolate/.test(k)) return "gourmand";
  if (/ambar|incenso|resina|balsam|benjoim|mirra|ladano|labdano/.test(k)) return "ambarado";
  if (/almiscar|musk|atalcado|talco|powder|po$/.test(k)) return "almiscarado";
  if (/aromat|lavanda|herbal|hortela|salvia|alecrim/.test(k)) return "aromatico";
  if (/aquat|marinh|fresc|ozon|salin/.test(k)) return "aquatico";
  if (/frut|abacaxi|maca|framboesa|damasco|pessego|groselha|cassis|amora|morango|tamara|ameixa|lichia/.test(k)) return "frutado";
  if (/couro|leather/.test(k)) return "couro";
  return "outros";
}

const tone = (category: string) =>
  ({ ["--tone" as string]: `var(--note-${(CATEGORIES as readonly string[]).includes(category) ? category : "outros"})` });

/** Família visual da nota: usa a do catálogo canônico e, na falta, o nome. */
function noteCategory(category: string | null | undefined, label: string) {
  const c = category ? strip(category) : "";
  if ((CATEGORIES as readonly string[]).includes(c)) return c;
  return accordCategory(label);
}

/** Reveal compartilhado: entra uma única vez, quando a seção aparece na tela. */
const Block = Reveal;


const LEVELS: Array<{ key: "TOP" | "HEART" | "BASE"; label: string }> = [
  { key: "TOP", label: "Notas de saída" },
  { key: "HEART", label: "Notas de coração" },
  { key: "BASE", label: "Notas de fundo" },
];

export function FragranceStory({
  productId,
  descriptionOverride = null,
}: {
  productId: string;
  /** Texto escrito à mão pela Orium: quando existe, tem prioridade sobre a descrição importada. */
  descriptionOverride?: string | null;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["fragrance", productId],
    queryFn: async () => {
      const [details, accords, notes] = await Promise.all([
        supabase
          .from("fragrance_details")
          .select(
            "description, olfactory_family, status, source_primary, source_secondary, verified, locked",
          )
          .eq("product_id", productId)
          .maybeSingle(),
        supabase
          .from("fragrance_accords")
          .select("accord_name, intensity, position")
          .eq("product_id", productId)
          .order("position"),
        supabase
          .from("fragrance_notes")
          .select("note_label, pyramid_level, position, olfactory_notes(canonical_name, category, image_url, description)")
          .eq("product_id", productId)
          .order("position"),
      ]);
      return {
        details: details.data,
        accords: accords.data ?? [],
        notes: (notes.data ?? []) as unknown as NoteRow[],
      };
    },
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) return <FragranceSkeleton />;

  const d = data?.details;
  // Só mostramos ao cliente o que foi confirmado: dados em revisão ficam escondidos.
  const trusted = !!d && (d.verified || d.locked || d.status === "completo" || d.status === "parcial");
  const accords = trusted ? (data?.accords ?? []) : [];
  const notes = trusted ? (data?.notes ?? []) : [];
  const description = descriptionOverride?.trim() || (trusted ? (d?.description ?? null) : null);
  const family = trusted ? (d?.olfactory_family ?? null) : null;

  if (!accords.length && !notes.length && !description) {
    return (
      <section className="mt-10 rounded-3xl border border-border/70 bg-card p-6 text-center">
        <h2 className="display text-lg">Conheça a fragrância</h2>
        <p className="mt-2 text-sm text-muted-foreground">Informações olfativas em atualização.</p>
      </section>
    );
  }


  const maxIntensity = Math.max(1, ...accords.map((a) => Number(a.intensity ?? 0)));

  return (
    <section className="mt-12">
      <Block>
        <p className="text-[11px] font-medium tracking-[0.16em] text-muted-foreground uppercase">Conheça a fragrância</p>
        {family ? <p className="mt-1 text-sm text-muted-foreground">Família {family}</p> : null}
      </Block>

      {accords.length > 0 ? (
        <Block delay={60} className="mt-4">
          <h2 className="display text-xl">Principais acordes</h2>
          <AccordBars
            accords={accords.map((a) => ({ name: a.accord_name, value: Number(a.intensity ?? 0.7) / maxIntensity }))}
          />
        </Block>
      ) : null}

      {description ? (
        <Block delay={80} className="mt-10">
          <h2 className="display text-xl">Sobre esta fragrância</h2>
          <Description text={description} />
        </Block>
      ) : null}

      {notes.length > 0 ? (
        <div className="mt-10">
          <Block>
            <h2 className="display text-xl">Pirâmide olfativa</h2>
            <p className="mt-1 text-sm text-muted-foreground">Como a fragrância evolui na pele, do primeiro toque ao fim do dia.</p>
          </Block>
          <Pyramid notes={notes} />
        </div>
      ) : null}
    </section>
  );
}

function AccordBars({ accords }: { accords: Array<{ name: string; value: number }> }) {
  const { ref, seen } = useRevealOnce<HTMLUListElement>();
  return (
    <ul ref={ref} className="mt-4 space-y-3">
      {accords.map((a, i) => {
        const pct = Math.round(Math.max(0.28, Math.min(1, a.value)) * 100);
        return (
          <li
            key={a.name}
            style={{ ...tone(accordCategory(a.name)), ["--delay" as string]: `${i * 45}ms` }}
            className={`reveal ${seen ? "is-in" : ""}`}
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm font-medium first-letter:uppercase">{a.name}</span>
            </div>
            <div className="accord-track mt-1.5 h-1.5 overflow-hidden rounded-full">
              <div
                className="accord-fill h-full rounded-full"
                style={{ width: seen ? `${pct}%` : 0, ["--delay" as string]: `${i * 45 + 60}ms` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}


function Description({ text }: { text: string }) {
  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const [open, setOpen] = useState(false);
  const long = paragraphs.length > 1;
  const visible = open || !long ? paragraphs : paragraphs.slice(0, 1);

  return (
    <div className="mt-3">
      <div className="space-y-3 text-[15px] leading-relaxed text-muted-foreground">
        {visible.map((p, i) => (
          <p key={i} className={i > 0 ? "value-in" : undefined}>
            {p}
          </p>
        ))}
      </div>
      {long ? (
        <button
          onClick={() => setOpen((v) => !v)}
          className="press mt-3 inline-flex min-h-11 items-center gap-1 text-sm font-medium"
        >
          {open ? "Ler menos" : "Ler mais"}
          <ChevronDown className={`size-4 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      ) : null}
    </div>
  );
}

function Pyramid({ notes }: { notes: NoteRow[] }) {
  return (
    <div className="mt-5 space-y-4">
      {LEVELS.map((level, li) => {
        const list = notes
          .filter((n) => n.pyramid_level === level.key)
          .sort((a, b) => a.position - b.position);
        if (!list.length) return null;
        return (
          <Block key={level.key} delay={li * 120}>
            <div className="relative rounded-3xl border border-border/70 bg-card p-4 shadow-soft">
              <h3 className="text-sm font-semibold">{level.label}</h3>
              <div className="mt-3 flex flex-wrap justify-center gap-2.5">
                {list.map((n, i) => (
                  // grupos de 4: entram em pequenas ondas, sem nota por nota lenta
                  <NoteCard key={`${n.note_label}-${i}`} note={n} delay={80 + Math.floor(i / 4) * 60} />
                ))}

              </div>
            </div>
          </Block>
        );
      })}
    </div>
  );
}

function NoteCard({ note, delay }: { note: NoteRow; delay: number }) {
  const info = note.olfactory_notes;
  const label = info?.canonical_name ?? note.note_label;
  const [open, setOpen] = useState(false);
  const { ref, seen } = useRevealOnce<HTMLButtonElement>();

  return (
    <button
      ref={ref}
      type="button"
      onClick={() => setOpen((v) => !v)}
      style={{ ...tone(noteCategory(info?.category, label)), ["--delay" as string]: `${delay}ms` }}
      className={`note-chip press reveal ${seen ? "is-in" : ""} flex w-[104px] shrink-0 flex-col items-center gap-2 rounded-2xl p-3 text-center`}
      aria-label={label}
    >

      {info?.image_url ? (
        <img
          src={info.image_url}
          alt={label}
          loading="lazy"
          width={56}
          height={56}
          className="size-14 rounded-full object-cover"
        />
      ) : (
        <span className="note-orb size-14 rounded-full" aria-hidden="true" />
      )}
      <span className="text-[12px] leading-tight font-medium">{label}</span>
      {open && info?.description ? (
        <span className="value-in text-[11px] leading-snug text-muted-foreground">{info.description}</span>
      ) : null}
    </button>
  );
}

function FragranceSkeleton() {
  return (
    <section className="mt-12 space-y-6">
      <div className="space-y-3">
        <div className="h-5 w-40 skeleton" />
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="space-y-1.5">
            <div className="h-3 w-24 skeleton" />
            <div className="h-2 w-full skeleton rounded-full" />
          </div>
        ))}
      </div>
      <div className="space-y-2">
        <div className="h-5 w-48 skeleton" />
        <div className="h-3 w-full skeleton" />
        <div className="h-3 w-11/12 skeleton" />
      </div>
      <div className="h-28 skeleton r-card" />
    </section>
  );
}
