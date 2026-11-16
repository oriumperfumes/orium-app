/**
 * ESTÚDIO OLFATIVO (admin) — pirâmide, acordes, texto e importação de um perfume.
 *
 * - Topo: o quanto está completo (saída, coração, fundo, acordes, texto), a
 *   fonte e a trava contra a automação.
 * - Pirâmide: três andares com as notas em foto. Tocar numa nota abre as ações
 *   (mover de andar, para o lado, tirar); no computador dá para arrastar.
 *   "+" procura na biblioteca de notas (com foto) ou cria uma nova.
 * - Acordes: barras coloridas — arrastar a barra muda a força.
 * - Texto: família olfativa e descrição, com a prévia do que a loja mostra.
 * - Importar: Fragrantica (link ou conteúdo colado), pesquisar de novo e
 *   copiar de outro perfume do catálogo.
 * Salvar fica preso embaixo e só aparece quando há mudança.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowDownWideNarrow,
  ChevronLeft,
  ChevronRight,
  Lock,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
  Unlock,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { dateBR } from "@/lib/format";
import { cn } from "@/lib/utils";
import { GoldButton, QuickChips, Segmented, SoftButton, TextArea, TextInput } from "@/components/orium/admin/PanelKit";
import { accordColor } from "@/lib/accord-color";
import {
  previewFragranceResearch,
  auditFragranceFragrantica,
  applyFragranticaLink,
  previewFragranticaLink,
  previewFragranticaPaste,
  applyFragranticaPaste,
  saveFragranceDetails,
  setFragranceLock,
  searchFragranceSource,
  copyFragranceFrom,
  type FragranceSourceItem,
} from "@/lib/fragrance.functions";

type NoteLib = { id: string; canonical_name: string; image_url: string | null };
type Level = "TOP" | "HEART" | "BASE";
type Accord = { name: string; intensity: number };
type Notes = Record<Level, string[]>;

const LEVELS: Array<{ key: Level; title: string; when: string; width: string }> = [
  { key: "TOP", title: "Saída", when: "Borrifou · primeiros 15 min", width: "lg:w-[74%]" },
  { key: "HEART", title: "Coração", when: "Depois de 30 min · o que mais se sente", width: "lg:w-[87%]" },
  { key: "BASE", title: "Fundo", when: "3 h ou mais · o rastro final", width: "lg:w-full" },
];
const LEVEL_LABEL: Record<Level, string> = { TOP: "Notas de saída", HEART: "Notas de coração", BASE: "Notas de fundo" };

const STATUS_LABEL: Record<string, string> = {
  completo: "Completa",
  parcial: "Parcial",
  revisar: "Precisa revisão",
  nao_encontrado: "Não encontrada",
  pendente: "Sem dados ainda",
  bloqueado: "Confirmada manualmente",
};

const FAMILIES = ["Amadeirado", "Floral", "Oriental", "Âmbar", "Cítrico", "Aromático", "Fougère", "Gourmand", "Chipre", "Aquático"];
const COMMON_ACCORDS = [
  "Doce", "Amadeirado", "Cítrico", "Floral", "Especiado Quente", "Âmbar", "Baunilha", "Frutado", "Aromático",
  "Atalcado", "Almiscarado", "Couro", "Oud", "Fresco", "Tropical", "Lavanda", "Rosa", "Avelã", "Caramelo", "Tabaco",
];

const key = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "");

export function FragranceEditor({
  productId,
  allowCopyFromCatalog = false,
}: {
  productId: string;
  /** mantido por compatibilidade: o estúdio já abre aberto */
  defaultOpen?: boolean;
  /** Mostra "Copiar de perfume do catálogo" (usado na Negociação e no cadastro manual). */
  allowCopyFromCatalog?: boolean;
}) {
  const qc = useQueryClient();
  const research = useServerFn(auditFragranceFragrantica);
  const save = useServerFn(saveFragranceDetails);
  const lockFn = useServerFn(setFragranceLock);

  const [tab, setTab] = useState<"piramide" | "acordes" | "texto" | "importar">("piramide");
  const [busy, setBusy] = useState(false);
  const [description, setDescription] = useState("");
  const [family, setFamily] = useState("");
  const [accords, setAccords] = useState<Accord[]>([]);
  const [notes, setNotes] = useState<Notes>({ TOP: [], HEART: [], BASE: [] });
  const [snapshot, setSnapshot] = useState("");
  const [found, setFound] = useState<Awaited<ReturnType<typeof previewFragranceResearch>> | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-fragrance", productId],
    queryFn: async () => {
      const [details, acc, nts, library, assets] = await Promise.all([
        supabase.from("fragrance_details").select("*").eq("product_id", productId).maybeSingle(),
        supabase.from("fragrance_accords").select("*").eq("product_id", productId).order("position"),
        supabase.from("fragrance_notes").select("*").eq("product_id", productId).order("position"),
        supabase.from("olfactory_notes").select("id, canonical_name, image_url").order("canonical_name"),
        supabase.from("olfactory_note_assets").select("canonical_note_name, image_url, source_url, status"),
      ]);
      return {
        details: details.data,
        accords: acc.data ?? [],
        notes: nts.data ?? [],
        library: (library.data ?? []) as NoteLib[],
        assets: assets.data ?? [],
      };
    },
  });

  const pack = (d: string, f: string, a: Accord[], n: Notes) => JSON.stringify({ d: d.trim(), f: f.trim(), a, n });

  useEffect(() => {
    if (!data) return;
    const d = data.details?.description ?? "";
    const f = data.details?.olfactory_family ?? "";
    const a = data.accords.map((x) => ({ name: x.accord_name, intensity: Number(x.intensity) || 0.7 }));
    const at = (level: Level) => data.notes.filter((n) => n.pyramid_level === level).map((n) => n.note_label);
    const n = { TOP: at("TOP"), HEART: at("HEART"), BASE: at("BASE") };
    setDescription(d);
    setFamily(f);
    setAccords(a);
    setNotes(n);
    setSnapshot(pack(d, f, a, n));
  }, [data]);

  const dirty = !!snapshot && pack(description, family, accords, notes) !== snapshot;

  const imageOf = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const n of data?.library ?? []) map.set(key(n.canonical_name), n.image_url);
    for (const a of data?.assets ?? []) {
      const k = key(a.canonical_note_name);
      map.set(k, a.image_url ?? map.get(k) ?? null);
    }
    return (label: string) => map.get(key(label)) ?? null;
  }, [data]);

  const d = data?.details;
  const status = d?.locked ? "bloqueado" : (d?.status ?? "pendente");
  const checks = [
    { ok: notes.TOP.length > 0, label: "Saída" },
    { ok: notes.HEART.length > 0, label: "Coração" },
    { ok: notes.BASE.length > 0, label: "Fundo" },
    { ok: accords.length > 0, label: "Acordes" },
    { ok: description.trim().length > 20, label: "Texto" },
  ];
  const done = checks.filter((c) => c.ok).length;

  const refetchAll = () => {
    void qc.invalidateQueries({ queryKey: ["admin-fragrance", productId] });
    void qc.invalidateQueries({ queryKey: ["fragrance", productId] });
    void qc.invalidateQueries({ queryKey: ["product-scent", productId] });
    void qc.invalidateQueries({ queryKey: ["pyramid-status"] });
  };

  const runResearch = async () => {
    setBusy(true);
    try {
      const a = await research({ data: { productId, apply: false, force: true } });
      const ok = a.status === "VERIFIED_FRAGRANTICA" && !!a.after;
      setFound({
        found: ok,
        reason: a.reason,
        confidence: a.confidence / 100,
        matchScore: a.confidence / 100,
        description: null,
        accords: a.after?.accords ?? [],
        top: a.after?.top ?? [],
        heart: a.after?.heart ?? [],
        base: a.after?.base ?? [],
        sourcePrimary: a.url ? "Fragrantica Brasil" : null,
        sourcePrimaryUrl: a.url,
        sourceSecondary: null,
        sourceSecondaryUrl: null,
        conflict: false,
      });
      setTab("importar");
      if (!ok) toast.info(a.reason || "A Fragrantica não confirmou este perfume.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível pesquisar agora.");
    } finally {
      setBusy(false);
    }
  };

  const applyFound = () => {
    if (!found?.found) return;
    if (found.description) setDescription(found.description);
    if (found.accords.length) setAccords(found.accords);
    setNotes((n) => ({
      TOP: found.top.length ? found.top : n.TOP,
      HEART: found.heart.length ? found.heart : n.HEART,
      BASE: found.base.length ? found.base : n.BASE,
    }));
    setFound(null);
    setTab("piramide");
    toast.success("Aplicado no estúdio. Confira e salve.");
  };

  const runSave = async (lock: boolean) => {
    setBusy(true);
    try {
      await save({
        data: {
          productId,
          description: description.trim() || null,
          olfactoryFamily: family.trim() || null,
          accords,
          top: notes.TOP,
          heart: notes.HEART,
          base: notes.BASE,
          lock,
        },
      });
      toast.success(lock ? "Salvo e travado: a automação não muda mais." : "Notas salvas.");
      setSnapshot(pack(description, family, accords, notes));
      refetchAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      setBusy(false);
    }
  };

  const toggleLock = async () => {
    setBusy(true);
    try {
      await lockFn({ data: { productId, locked: !d?.locked } });
      toast.success(d?.locked ? "A automação pode atualizar de novo." : "Travado: a automação não muda mais.");
      refetchAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível alterar.");
    } finally {
      setBusy(false);
    }
  };

  if (isLoading) return <div className="admin-skeleton h-72 rounded-[24px]" />;

  return (
    <section className="fs min-w-0 space-y-3 text-white">
      {/* ---------- como está ---------- */}
      <div className="rounded-[24px] bg-[#1A1A1A] p-4 sm:p-5">
        <div className="flex items-start gap-4">
          <CompletionRing done={done} total={checks.length} />
          <div className="min-w-0 flex-1">
            <p className="text-[17px] leading-tight font-bold">
              {done === checks.length ? "Pirâmide completa" : `Faltam ${checks.length - done} de ${checks.length}`}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {checks.map((c) => (
                <span
                  key={c.label}
                  className={cn(
                    "inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-semibold",
                    c.ok ? "bg-[#17251C] text-[#7FCF9F]" : "bg-[#232323] text-[#8C8C8C]",
                  )}
                >
                  <span className={cn("size-1.5 rounded-full", c.ok ? "bg-[#7FCF9F]" : "bg-[#555]")} /> {c.label}
                </span>
              ))}
            </div>
            <p className="mt-2.5 text-[12.5px] leading-snug text-[#8C8C8C]">
              {STATUS_LABEL[status] ?? status}
              {d?.source_primary ? ` · ${d.source_primary}` : ""}
              {d?.enriched_at ? ` · ${dateBR(d.enriched_at)}` : ""}
              {d?.source_primary_url ? (
                <>
                  {" · "}
                  <a href={d.source_primary_url} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-white">
                    ver fonte
                  </a>
                </>
              ) : null}
            </p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void toggleLock()}
            className={cn(
              "press inline-flex h-10 items-center gap-2 rounded-full px-4 text-[13.5px] font-semibold transition-colors disabled:opacity-50",
              d?.locked ? "bg-white text-[#15130F]" : "bg-[#232323] text-[#D4D4D4] hover:bg-[#2C2C2C]",
            )}
          >
            {d?.locked ? <Lock className="size-4" /> : <Unlock className="size-4" />}
            {d?.locked ? "Travado" : "Travar contra automação"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void runResearch()}
            className="press inline-flex h-10 items-center gap-2 rounded-full bg-[#232323] px-4 text-[13.5px] font-semibold text-[#D4D4D4] transition-colors hover:bg-[#2C2C2C] disabled:opacity-50"
          >
            <RefreshCw className={cn("size-4", busy && "animate-spin")} /> Pesquisar na Fragrantica
          </button>
        </div>
      </div>

      <Segmented
        full
        options={[
          { value: "piramide", label: "Pirâmide" },
          { value: "acordes", label: "Acordes" },
          { value: "texto", label: "Texto" },
          { value: "importar", label: "Importar" },
        ]}
        value={tab}
        onChange={setTab}
      />

      <div key={tab} className="ui-view-in space-y-3">
        {tab === "piramide" ? (
          <PyramidEditor notes={notes} onChange={setNotes} library={data?.library ?? []} imageOf={imageOf} />
        ) : null}
        {tab === "acordes" ? <AccordStudio accords={accords} onChange={setAccords} /> : null}
        {tab === "texto" ? (
          <div className="space-y-3 rounded-[24px] bg-[#1A1A1A] p-4 sm:p-5">
            <div>
              <p className="mb-2 text-[13px] font-semibold text-[#A9A9A9]">Família olfativa</p>
              <QuickChips options={FAMILIES} value={family} onPick={(v) => setFamily(family === v ? "" : v)} />
              <TextInput className="mt-2" value={family} onChange={(e) => setFamily(e.target.value)} placeholder="Ex.: Âmbar Baunilha" />
            </div>
            <div>
              <div className="mb-2 flex items-baseline justify-between">
                <p className="text-[13px] font-semibold text-[#A9A9A9]">Sobre esta fragrância</p>
                <span className={cn("text-[12px] tabular-nums", description.length > 600 ? "text-[#F2C46D]" : "text-[#6F6F6F]")}>{description.length}</span>
              </div>
              <TextArea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="min-h-[160px]"
                placeholder="Em poucas linhas: como ele abre, o que fica, em que ocasião brilha."
              />
              <p className="mt-1.5 text-[12.5px] text-[#6F6F6F]">Aparece em “Como ele cheira” na página do perfume. Até ~600 caracteres lê bem no celular.</p>
            </div>
          </div>
        ) : null}
        {tab === "importar" ? (
          <>
            {found ? (
              <ComparePanel found={found} current={{ description, accords, ...notes }} onApply={applyFound} onDismiss={() => setFound(null)} />
            ) : null}
            {allowCopyFromCatalog ? <CopyFromCatalog productId={productId} onCopied={refetchAll} /> : null}
            <FragranticaImport
              productId={productId}
              locked={!!d?.locked}
              savedUrl={d?.fragrantica_url ?? null}
              lastImport={d?.audited_at ?? null}
              statusLabel={STATUS_LABEL[status] ?? status}
              onApplied={refetchAll}
            />
          </>
        ) : null}
      </div>

      {/* salvar: preso embaixo, só com mudança */}
      {dirty ? (
        <div className="adm-pop sticky bottom-3 z-10 flex items-center gap-2 rounded-[24px] bg-[#232323] p-2 shadow-[0_18px_50px_-12px_rgba(0,0,0,0.85)] ring-1 ring-white/[0.08]">
          <span className="min-w-0 flex-1 truncate pl-3 text-[13.5px] font-semibold text-[#D4D4D4]">Mudanças não salvas</span>
          <SoftButton className="h-11 bg-[#2E2E2E] px-4 text-[14px]" disabled={busy} onClick={() => void runSave(false)}>
            Salvar
          </SoftButton>
          <GoldButton className="h-11 px-4 text-[14px]" icon={<Save className="size-4" />} loading={busy} onClick={() => void runSave(true)}>
            Salvar e travar
          </GoldButton>
        </div>
      ) : null}
    </section>
  );
}

/** Anel de "quanto está pronto" (5 partes). */
function CompletionRing({ done, total }: { done: number; total: number }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  return (
    <span className="relative grid size-[64px] shrink-0 place-items-center">
      <svg viewBox="0 0 64 64" className="absolute inset-0 -rotate-90">
        <circle cx="32" cy="32" r={r} fill="none" stroke="#2A2A2A" strokeWidth="6" />
        <circle
          cx="32"
          cy="32"
          r={r}
          fill="none"
          stroke={done === total ? "#7FCF9F" : "#FFD599"}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={`${(done / total) * c} ${c}`}
          className="fs-ring"
        />
      </svg>
      <span className="text-[17px] font-bold tabular-nums">
        {done}/{total}
      </span>
    </span>
  );
}

/* ———————————————————— pirâmide ———————————————————— */

function PyramidEditor({
  notes,
  onChange,
  library,
  imageOf,
}: {
  notes: Notes;
  onChange: (n: Notes) => void;
  library: NoteLib[];
  imageOf: (label: string) => string | null;
}) {
  const [sel, setSel] = useState<{ level: Level; i: number } | null>(null);
  const [adding, setAdding] = useState<Level | null>(null);
  const [dragOver, setDragOver] = useState<Level | null>(null);
  const drag = useRef<{ level: Level; i: number } | null>(null);
  const used = useMemo(() => new Set([...notes.TOP, ...notes.HEART, ...notes.BASE].map(key)), [notes]);

  const moveTo = (from: { level: Level; i: number }, to: Level, at?: number) => {
    const label = notes[from.level][from.i];
    if (!label) return;
    const next: Notes = { TOP: [...notes.TOP], HEART: [...notes.HEART], BASE: [...notes.BASE] };
    next[from.level].splice(from.i, 1);
    let pos = at ?? next[to].length;
    if (from.level === to && at != null && at > from.i) pos -= 1;
    next[to].splice(Math.max(0, Math.min(pos, next[to].length)), 0, label);
    onChange(next);
    setSel({ level: to, i: Math.max(0, Math.min(pos, next[to].length - 1)) });
  };
  const nudge = (dir: -1 | 1) => {
    if (!sel) return;
    const list = notes[sel.level];
    const j = sel.i + dir;
    if (j < 0 || j >= list.length) return;
    const next = [...list];
    [next[sel.i], next[j]] = [next[j]!, next[sel.i]!];
    onChange({ ...notes, [sel.level]: next });
    setSel({ level: sel.level, i: j });
  };
  const remove = () => {
    if (!sel) return;
    onChange({ ...notes, [sel.level]: notes[sel.level].filter((_, x) => x !== sel.i) });
    setSel(null);
  };
  const add = (level: Level, label: string) => {
    const name = label.trim();
    if (name.length < 2) return;
    if (used.has(key(name))) {
      toast.info(`${name} já está na pirâmide.`);
      return;
    }
    onChange({ ...notes, [level]: [...notes[level], name] });
  };

  return (
    <div className="space-y-2.5">
      {LEVELS.map((lv, li) => {
        const list = notes[lv.key];
        const selected = sel?.level === lv.key ? sel.i : null;
        return (
          <div
            key={lv.key}
            onDragOver={(e) => {
              if (!drag.current) return;
              e.preventDefault();
              setDragOver(lv.key);
            }}
            onDragLeave={() => setDragOver((v) => (v === lv.key ? null : v))}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(null);
              if (drag.current) moveTo(drag.current, lv.key);
              drag.current = null;
            }}
            className={cn(
              "fs-tier mx-auto rounded-[24px] bg-[#1A1A1A] p-4 transition-[box-shadow,background-color] duration-200",
              lv.width,
              dragOver === lv.key && "bg-[#1F1D18] shadow-[inset_0_0_0_2px_rgba(255,213,153,0.6)]",
            )}
          >
            <div className="flex items-center gap-3">
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[#FFD599] text-[13px] font-bold text-[#15130F]">{li + 1}</span>
              <div className="min-w-0 flex-1">
                <p className="text-[16px] leading-tight font-bold">{lv.title}</p>
                <p className="text-[12.5px] text-[#8C8C8C]">{lv.when}</p>
              </div>
              <span className="text-[13px] font-semibold text-[#6F6F6F] tabular-nums">{list.length}</span>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {list.map((label, i) => {
                const on = selected === i;
                const img = imageOf(label);
                return (
                  <button
                    key={`${label}-${i}`}
                    type="button"
                    draggable
                    onDragStart={(e) => {
                      drag.current = { level: lv.key, i };
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onDragEnd={() => {
                      drag.current = null;
                      setDragOver(null);
                    }}
                    onDragOver={(e) => drag.current && e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setDragOver(null);
                      if (drag.current) moveTo(drag.current, lv.key, i);
                      drag.current = null;
                    }}
                    onClick={() => setSel(on ? null : { level: lv.key, i })}
                    className={cn(
                      "fs-chip press inline-flex h-12 max-w-full cursor-grab items-center gap-2.5 rounded-full py-1 pr-4 pl-1 text-[14px] font-semibold transition-colors duration-200 active:cursor-grabbing",
                      on ? "bg-white text-[#15130F]" : "bg-[#232323] text-white hover:bg-[#2C2C2C]",
                    )}
                    style={{ ["--i" as string]: i }}
                  >
                    <NoteImg src={img} label={label} />
                    <span className="truncate">{label}</span>
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => {
                  setAdding(adding === lv.key ? null : lv.key);
                  setSel(null);
                }}
                className={cn(
                  "press inline-flex h-12 items-center gap-1.5 rounded-full border-2 border-dashed px-4 text-[14px] font-semibold transition-colors",
                  adding === lv.key ? "border-[#FFD599] text-[#FFD599]" : "border-white/[0.12] text-[#A9A9A9] hover:border-white/30 hover:text-white",
                )}
              >
                <Plus className="size-4" /> Nota
              </button>
            </div>

            {selected != null ? (
              <div className="adm-pop mt-3 flex flex-wrap items-center gap-1.5 rounded-[18px] bg-[#232323] p-1.5">
                <span className="px-2 text-[12.5px] font-semibold text-[#A9A9A9]">Mover para</span>
                {LEVELS.filter((x) => x.key !== lv.key).map((x) => (
                  <button
                    key={x.key}
                    type="button"
                    onClick={() => moveTo({ level: lv.key, i: selected }, x.key)}
                    className="press h-9 rounded-full bg-[#2E2E2E] px-3.5 text-[13px] font-semibold hover:bg-[#383838]"
                  >
                    {x.title}
                  </button>
                ))}
                <span className="ml-auto flex gap-1">
                  <IconBtn label="Para a esquerda" onClick={() => nudge(-1)} disabled={selected === 0}>
                    <ChevronLeft className="size-4" />
                  </IconBtn>
                  <IconBtn label="Para a direita" onClick={() => nudge(1)} disabled={selected === list.length - 1}>
                    <ChevronRight className="size-4" />
                  </IconBtn>
                  <IconBtn label="Tirar nota" danger onClick={remove}>
                    <Trash2 className="size-4" />
                  </IconBtn>
                </span>
              </div>
            ) : null}

            {adding === lv.key ? (
              <NotePicker library={library} used={used} onPick={(name) => add(lv.key, name)} onClose={() => setAdding(null)} />
            ) : null}

            {!list.length && adding !== lv.key ? (
              <p className="mt-2 text-[13px] text-[#6F6F6F]">Nenhuma nota ainda. Toque em “+ Nota” ou arraste uma de outro andar.</p>
            ) : null}
          </div>
        );
      })}
      <p className="px-1 text-[12.5px] text-[#6F6F6F]">Toque numa nota para mover de andar, mudar a ordem ou tirar. No computador, também dá para arrastar.</p>
    </div>
  );
}

function NoteImg({ src, label, size = 40 }: { src: string | null; label: string; size?: number }) {
  const [broken, setBroken] = useState(false);
  return (
    <span className="grid shrink-0 place-items-center overflow-hidden rounded-full bg-[#F2F1ED] text-[13px] font-bold text-[#15130F]" style={{ width: size, height: size }}>
      {src && !broken ? <img src={src} alt="" loading="lazy" className="size-full object-cover" onError={() => setBroken(true)} /> : label.charAt(0).toUpperCase()}
    </span>
  );
}

function IconBtn({ label, onClick, disabled, danger, children }: { label: string; onClick: () => void; disabled?: boolean; danger?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "press grid size-9 place-items-center rounded-full transition-colors disabled:opacity-30",
        danger ? "bg-[#2A1A18] text-[#FF9A8A] hover:bg-[#341F1C]" : "bg-[#2E2E2E] text-white hover:bg-[#383838]",
      )}
    >
      {children}
    </button>
  );
}

/** Procura na biblioteca (com foto) ou cria uma nota nova. */
function NotePicker({
  library,
  used,
  onPick,
  onClose,
}: {
  library: NoteLib[];
  used: Set<string>;
  onPick: (name: string) => void;
  onClose: () => void;
}) {
  const [term, setTerm] = useState("");
  const t = key(term);
  const matches = useMemo(() => {
    if (t.length < 2) return [];
    return library
      .filter((n) => key(n.canonical_name).includes(t))
      .sort((a, b) => Number(key(b.canonical_name).startsWith(t)) - Number(key(a.canonical_name).startsWith(t)) || Number(!!b.image_url) - Number(!!a.image_url))
      .slice(0, 12);
  }, [t, library]);
  const exact = library.some((n) => key(n.canonical_name) === t);
  const pick = (name: string) => {
    onPick(name);
    setTerm("");
  };
  return (
    <div className="adm-pop mt-3 rounded-[20px] bg-[#232323] p-2">
      <div className="flex items-center gap-2 px-2">
        <Search className="size-4 shrink-0 text-[#8C8C8C]" />
        <input
          autoFocus
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            if (e.key === "Enter") {
              e.preventDefault();
              pick(matches[0]?.canonical_name ?? term);
            }
          }}
          placeholder="Procurar nota (ex.: berg, baun, oud)"
          className="pk-field h-11 min-w-0 flex-1 bg-transparent text-[16px] text-white outline-none placeholder:text-[#6F6F6F]"
        />
        <button type="button" aria-label="Fechar" onClick={onClose} className="press grid size-8 place-items-center rounded-full text-[#8C8C8C] hover:bg-white/[0.06] hover:text-white">
          <X className="size-4" />
        </button>
      </div>
      {matches.length ? (
        <div className="mt-1 grid grid-cols-3 gap-1.5 p-1 sm:grid-cols-4">
          {matches.map((m) => {
            const already = used.has(key(m.canonical_name));
            return (
              <button
                key={m.id}
                type="button"
                disabled={already}
                onClick={() => pick(m.canonical_name)}
                className="press flex flex-col items-center gap-1.5 rounded-[16px] p-2 text-center transition-colors hover:bg-white/[0.06] disabled:opacity-35"
              >
                <NoteImg src={m.image_url} label={m.canonical_name} size={52} />
                <span className="line-clamp-2 text-[12.5px] leading-tight font-semibold">{m.canonical_name}</span>
              </button>
            );
          })}
        </div>
      ) : null}
      {term.trim().length > 1 && !exact ? (
        <button
          type="button"
          onClick={() => pick(term)}
          className="press mt-1 flex h-11 w-full items-center gap-2 rounded-[14px] px-3 text-left text-[14px] font-semibold text-[#FFD599] hover:bg-white/[0.05]"
        >
          <Plus className="size-4" /> Criar nota “{term.trim()}”
        </button>
      ) : null}
      {t.length < 2 ? <p className="px-3 py-2 text-[12.5px] text-[#6F6F6F]">Digite 2 letras. Notas com foto aparecem primeiro.</p> : null}
    </div>
  );
}

/* ———————————————————— acordes ———————————————————— */

function AccordStudio({ accords, onChange }: { accords: Accord[]; onChange: (a: Accord[]) => void }) {
  const [draft, setDraft] = useState("");
  const set = (i: number, patch: Partial<Accord>) => onChange(accords.map((a, x) => (x === i ? { ...a, ...patch } : a)));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= accords.length) return;
    const next = [...accords];
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next);
  };
  const add = (name: string) => {
    const n = name.trim();
    if (n.length < 2 || accords.some((a) => key(a.name) === key(n))) return;
    onChange([...accords, { name: n, intensity: 0.6 }]);
    setDraft("");
  };
  const suggestions = COMMON_ACCORDS.filter((s) => !accords.some((a) => key(a.name) === key(s)) && (!draft || key(s).includes(key(draft)))).slice(0, 8);

  return (
    <div className="space-y-3 rounded-[24px] bg-[#1A1A1A] p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[16px] font-bold">Principais acordes</p>
          <p className="text-[12.5px] text-[#8C8C8C]">Arraste a barra para mudar a força. A ordem é a da loja.</p>
        </div>
        {accords.length > 1 ? (
          <button
            type="button"
            onClick={() => onChange([...accords].sort((a, b) => b.intensity - a.intensity))}
            className="press inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-[#232323] px-3 text-[12.5px] font-semibold text-[#D4D4D4] hover:bg-[#2C2C2C]"
          >
            <ArrowDownWideNarrow className="size-4" /> Mais fortes primeiro
          </button>
        ) : null}
      </div>

      <ul className="space-y-2">
        {accords.map((a, i) => (
          <li key={`${a.name}-${i}`} className="fs-acc group rounded-[18px] bg-[#232323] p-3" style={{ ["--i" as string]: i }}>
            <div className="flex items-center gap-2">
              <span className="size-3 shrink-0 rounded-full" style={{ background: accordColor(a.name) }} />
              <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{a.name}</span>
              <span className="text-[12.5px] font-semibold text-[#8C8C8C] tabular-nums">{strength(a.intensity)}</span>
              <span className="flex gap-0.5 opacity-100 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100">
                <IconBtn label="Subir" onClick={() => move(i, -1)} disabled={i === 0}>
                  <ChevronLeft className="size-4 rotate-90" />
                </IconBtn>
                <IconBtn label="Descer" onClick={() => move(i, 1)} disabled={i === accords.length - 1}>
                  <ChevronRight className="size-4 rotate-90" />
                </IconBtn>
                <IconBtn label="Tirar acorde" danger onClick={() => onChange(accords.filter((_, x) => x !== i))}>
                  <Trash2 className="size-4" />
                </IconBtn>
              </span>
            </div>
            <StrengthBar value={a.intensity} color={accordColor(a.name)} onChange={(v) => set(i, { intensity: v })} label={a.name} />
          </li>
        ))}
      </ul>

      <div className="rounded-[18px] border border-dashed border-white/[0.12] p-3">
        <div className="flex gap-2">
          <TextInput
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add(draft);
              }
            }}
            placeholder="Novo acorde"
            className="h-11"
          />
          <SoftButton className="h-11 w-11 shrink-0 px-0" aria-label="Adicionar acorde" icon={<Plus />} onClick={() => add(draft)} />
        </div>
        {suggestions.length ? (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => add(s)}
                className="press inline-flex h-8 items-center gap-1.5 rounded-full bg-[#232323] px-3 text-[12.5px] font-semibold text-[#A9A9A9] hover:bg-[#2C2C2C] hover:text-white"
              >
                <span className="size-2 rounded-full" style={{ background: accordColor(s) }} />
                {s}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

const strength = (v: number) => (v >= 0.85 ? "Muito forte" : v >= 0.6 ? "Forte" : v >= 0.4 ? "Médio" : "Leve");

/** Barra de força: tocar/arrastar em qualquer ponto define o valor (20%–100%). */
function StrengthBar({ value, color, onChange, label }: { value: number; color: string; onChange: (v: number) => void; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const from = (clientX: number) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const v = Math.max(0.2, Math.min(1, (clientX - r.left) / r.width));
    onChange(Math.round(v * 20) / 20);
  };
  return (
    <div
      ref={ref}
      role="slider"
      tabIndex={0}
      aria-label={`Força de ${label}`}
      aria-valuemin={20}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        from(e.clientX);
      }}
      onPointerMove={(e) => e.buttons === 1 && from(e.clientX)}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight" || e.key === "ArrowUp") onChange(Math.min(1, Math.round((value + 0.05) * 20) / 20));
        if (e.key === "ArrowLeft" || e.key === "ArrowDown") onChange(Math.max(0.2, Math.round((value - 0.05) * 20) / 20));
      }}
      className="relative mt-3 h-7 cursor-pointer touch-none rounded-full bg-[#2E2E2E] outline-none focus-visible:ring-2 focus-visible:ring-[#FFD599]/60"
    >
      <div className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-150" style={{ width: `${value * 100}%`, background: color }} />
      <div
        className="absolute top-1/2 size-5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_2px_8px_rgba(0,0,0,0.5)] transition-[left] duration-150"
        style={{ left: `calc(${value * 100}% - ${value * 14}px + 7px)` }}
      />
    </div>
  );
}

/* ———————————————————— importar ———————————————————— */

function confidenceLabel(v: number) {
  if (!v) return "—";
  if (v >= 0.8) return "Alta";
  if (v >= 0.6) return "Média";
  return "Baixa";
}

/** Resultado de "Pesquisar na Fragrantica": o que tem hoje × o que achou. */
function ComparePanel({
  found,
  current,
  onApply,
  onDismiss,
}: {
  found: NonNullable<Awaited<ReturnType<typeof previewFragranceResearch>>>;
  current: { description: string; accords: Accord[]; TOP: string[]; HEART: string[]; BASE: string[] };
  onApply: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="adm-pop rounded-[24px] bg-[#1A1A1A] p-4 ring-1 ring-[#FFD599]/25 sm:p-5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[16px] font-bold">Resultado da pesquisa</p>
          {found.found ? (
            <p className="mt-0.5 text-[12.5px] text-[#8C8C8C]">
              {found.sourcePrimary ?? "fonte"} · confiança {confidenceLabel(found.confidence)}
              {found.conflict ? " · fontes divergentes" : ""}
            </p>
          ) : null}
        </div>
        <button type="button" onClick={onDismiss} aria-label="Fechar" className="press grid size-9 place-items-center rounded-full bg-[#232323] text-[#A9A9A9] hover:text-white">
          <X className="size-4" />
        </button>
      </div>
      {!found.found ? (
        <p className="mt-3 text-[14px] text-[#A9A9A9]">{found.reason || "Nada confiável encontrado."}</p>
      ) : (
        <>
          <div className="mt-3 space-y-3">
            <DiffBlock label="Saída" now={current.TOP} next={found.top} />
            <DiffBlock label="Coração" now={current.HEART} next={found.heart} />
            <DiffBlock label="Fundo" now={current.BASE} next={found.base} />
            <DiffBlock label="Acordes" now={current.accords.map((a) => a.name)} next={found.accords.map((a) => a.name)} />
          </div>
          <div className="mt-4 flex gap-2">
            <SoftButton className="h-11 flex-1" onClick={onDismiss}>
              Manter o atual
            </SoftButton>
            <GoldButton className="h-11 flex-[1.4]" onClick={onApply}>
              Usar o que achou
            </GoldButton>
          </div>
        </>
      )}
    </div>
  );
}

/* --------- Importação pelo link exato do Fragrantica Brasil (admin) -------- */

type Preview = Awaited<ReturnType<typeof previewFragranticaLink>>;

function FragranticaImport({
  productId,
  locked,
  savedUrl,
  lastImport,
  statusLabel,
  onApplied,
}: {
  productId: string;
  locked: boolean;
  savedUrl: string | null;
  lastImport: string | null;
  statusLabel: string;
  onApplied: () => void;
}) {
  const preview = useServerFn(previewFragranticaLink);
  const apply = useServerFn(applyFragranticaLink);
  const previewPaste = useServerFn(previewFragranticaPaste);
  const applyPaste = useServerFn(applyFragranticaPaste);

  const [url, setUrl] = useState(savedUrl ?? "");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [data, setData] = useState<Preview | null>(null);
  const [forceFetch, setForceFetch] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [showDiag, setShowDiag] = useState(false);
  const [assist, setAssist] = useState(false);
  const [pasted, setPasted] = useState("");
  const [sections, setSections] = useState({ accords: true, pyramid: true, family: true, description: true });

  useEffect(() => {
    setUrl(savedUrl ?? "");
  }, [savedUrl]);

  const valid = /^https:\/\/(www\.|beta\.)?fragrantica\.com\.br\/perfume\/.+\.html/i.test(url.trim());

  const runPreview = async () => {
    if (!valid) {
      toast.error("Link do Fragrantica inválido.");
      return;
    }
    setBusy(true);
    setStep("Lendo a página no Fragrantica…");
    try {
      const r = await preview({ data: { productId, url: url.trim(), force: forceFetch } });
      setStep("Conferindo acordes e notas…");
      if (!r.ok) {
        setData(r);
        if (r.blocked) {
          setAssist(true);
          toast.error("O Fragrantica recusou a leitura automática. Use a importação assistida logo abaixo.");
        } else {
          toast.error(r.error ?? "Não foi possível importar esta página do Fragrantica. Tente novamente.");
        }
        return;
      }
      setData(r);
      if (r.status === "COMPLETE") toast.success("Leitura completa: acordes e notas encontrados.");
      else if (r.status === "REVIEW_REQUIRED") toast.warning("Leitura com divergência entre partes da página — revise antes de aplicar.");
      else toast.warning("Leitura parcial: parte das informações não veio da página.");
    } catch {
      toast.error("Não foi possível importar esta página do Fragrantica. Tente novamente.");
    } finally {
      setBusy(false);
      setStep(null);
    }
  };

  /** Interpreta o conteúdo que o Admin copiou da página (nenhuma nova leitura da fonte). */
  const runPastePreview = async () => {
    if (!valid) {
      toast.error("Cole primeiro o link do perfume no Fragrantica.");
      return;
    }
    if (pasted.trim().length < 40) {
      toast.error("Cole o conteúdo da página: Principais Acordes e a pirâmide olfativa.");
      return;
    }
    setBusy(true);
    setStep("Interpretando o conteúdo colado…");
    try {
      const r = await previewPaste({ data: { productId, url: url.trim(), content: pasted } });
      setData(r);
      if (!r.ok) {
        toast.error(r.error ?? "O conteúdo colado não trouxe acordes nem notas.");
        return;
      }
      if (r.status === "COMPLETE") toast.success("Conteúdo interpretado: acordes e pirâmide reconhecidos.");
      else toast.warning("Conteúdo interpretado em parte — confira antes de aplicar.");
    } catch {
      toast.error("Não foi possível interpretar o conteúdo colado.");
    } finally {
      setBusy(false);
      setStep(null);
    }
  };

  const assisted = data?.importMethod === "MANUAL_ASSISTED";

  const runApply = async (confirm: boolean) => {
    setBusy(true);
    setStep("Gravando acordes, notas e descrição…");
    try {
      const r = assisted
        ? await applyPaste({
            data: {
              productId,
              url: url.trim(),
              content: pasted,
              sections,
              confirm,
              force: locked,
              forceQuality: true,
            },
          })
        : await apply({
            data: {
              productId,
              url: url.trim(),
              sections,
              confirm,
              force: locked,
              forceQuality: true,
              forceFetch,
            },
          });
      if (!r.ok) {
        toast.error(r.error ?? "Não foi possível salvar a importação.");
        return;
      }
      const suffix = r.status === "COMPLETE" ? "" : " (leitura parcial — falta informação na fonte)";
      toast.success(
        confirm
          ? `Informações aplicadas e confirmadas${suffix}.`
          : `Aplicado: ${r.applied.join(", ") || "nada selecionado"}${suffix}.`,
      );
      setData(null);
      onApplied();
    } catch {
      toast.error("Não foi possível salvar a importação.");
    } finally {
      setBusy(false);
      setStep(null);
    }
  };

  const statusChip = (s: Preview["status"]) =>
    s === "COMPLETE"
      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
      : s === "FAILED"
        ? "bg-destructive/10 text-destructive"
        : "bg-amber-500/15 text-amber-700 dark:text-amber-400";

  const statusText: Record<Preview["status"], string> = {
    COMPLETE: "Completo",
    PARTIAL: "Parcial",
    REVIEW_REQUIRED: "Precisa revisão",
    FAILED: "Não conseguiu ler",
  };

  return (
    <div id="importar-fragrantica" className="min-w-0 space-y-3 rounded-[24px] bg-[#1A1A1A] p-4 sm:p-5">
      <div className="min-w-0 space-y-1">
        <p className="text-[16px] font-bold">Importar da Fragrantica</p>
        <p className="text-xs text-[#8C8C8C]">
          Status: <span className="text-foreground">{savedUrl ? "Vinculado" : "Não vinculado"}</span> · Última
          importação: {lastImport ? dateBR(lastImport) : "—"} · Status olfativo:{" "}
          <span className="text-foreground">{statusLabel}</span>
        </p>
        {savedUrl ? (
          <a href={savedUrl} target="_blank" rel="noreferrer" className="block break-all text-[11px] underline">
            abrir página
          </a>
        ) : null}
      </div>

      <label className="block min-w-0">
        <span className="text-xs text-[#8C8C8C]">Link do Fragrantica</span>
        <TextInput
          value={url}
          inputMode="url"
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://www.fragrantica.com.br/perfume/..."
          className="mt-1.5"
        />
      </label>

      {url.trim() && !valid ? <p className="text-xs text-destructive">Link do Fragrantica inválido.</p> : null}

      <label className="flex items-center gap-2 text-xs text-[#8C8C8C]">
        <input
          type="checkbox"
          checked={forceFetch}
          onChange={(e) => setForceFetch(e.target.checked)}
          className="size-4"
        />
        Forçar releitura da página (ignorar a cópia guardada)
      </label>

      {locked ? (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          Este perfume possui informações confirmadas manualmente. Compare antes de aplicar.
        </p>
      ) : null}

      <Button className="h-12 w-full rounded-full bg-[#FFD599] text-[15px] font-bold text-[#15130F] hover:bg-[#FFDDAA]" disabled={busy || !valid} onClick={runPreview}>
        <RefreshCw className={`mr-1.5 size-4 ${busy ? "animate-spin" : ""}`} />
        Analisar importação
      </Button>

      {busy && step ? <p className="text-xs text-[#8C8C8C]">{step}</p> : null}

      {data ? (
        <div className="min-w-0 space-y-3 border-t pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-xs ${statusChip(data.status)}`}>
              {statusText[data.status]}
            </span>
            <span className="text-[11px] text-[#8C8C8C]">
              Completude {data.completeness}% · Confiança do nome {data.matchConfidence}% ·{" "}
              {data.structure === "PYRAMID" ? "pirâmide" : data.structure === "FLAT" ? "lista única" : "sem notas"}
            </span>
          </div>

          {data.issues.length ? (
            <ul className="space-y-0.5 rounded-lg bg-amber-500/10 p-2 text-[11px] text-amber-700 dark:text-amber-400">
              {data.issues.map((i) => (
                <li key={i} className="break-words">
                  {i}
                </li>
              ))}
            </ul>
          ) : null}

          {data.error ? <p className="break-words text-xs text-destructive">{data.error}</p> : null}

          {data.blocked && data.diagnostics ? (
            <div className="min-w-0">
              <button
                type="button"
                onClick={() => setShowDiag((v) => !v)}
                className="text-[11px] text-[#8C8C8C] underline"
              >
                {showDiag ? "Ocultar detalhes técnicos" : "Ver detalhes técnicos da recusa"}
              </button>
              {showDiag ? (
                <div className="mt-1 space-y-0.5 rounded-lg bg-muted/40 p-2 text-[11px] text-[#8C8C8C]">
                  <p>Endereço lido: {String(data.diagnostics.finalUrl ?? data.url)}</p>
                  <p>
                    Resposta {String(data.diagnostics.httpStatus ?? "—")} · tipo{" "}
                    {String(data.diagnostics.contentType ?? "—")} · {String(data.diagnostics.bytes ?? 0)} bytes
                  </p>
                  <p>
                    Tentativas {String(data.diagnostics.attempts ?? 0)} · redirecionado{" "}
                    {data.diagnostics.redirected ? "sim" : "não"} · verificação de robô{" "}
                    {data.diagnostics.challenge ? "sim" : "não"}
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* IMPORTAÇÃO ASSISTIDA — o Admin abre a página, copia e cola o conteúdo aqui. */}
      {assist || (data && !data.ok && data.blocked) ? (
        <div className="min-w-0 space-y-2 rounded-[20px] border border-dashed border-white/[0.14] p-4">
          <p className="text-sm font-medium">Importação assistida</p>
          <p className="text-xs text-[#8C8C8C]">
            O Fragrantica não permite a leitura automática deste servidor. Abra a página, selecione tudo (a parte com
            Principais Acordes e a pirâmide olfativa), copie e cole abaixo. A Orium interpreta o conteúdo colado — nada é
            buscado na fonte.
          </p>
          {valid ? (
            <a
              href={url.trim()}
              target="_blank"
              rel="noreferrer"
              className="inline-block text-xs underline"
            >
              Abrir a página do perfume no Fragrantica
            </a>
          ) : null}
          <TextArea
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            placeholder="Cole aqui o conteúdo copiado da página do perfume…"
            className="min-h-32"
          />
          <Button
            className="h-12 w-full rounded-full bg-[#232323] text-[15px] font-semibold text-white hover:bg-[#2C2C2C]"
            disabled={busy || !valid || pasted.trim().length < 40}
            onClick={runPastePreview}
          >
            <RefreshCw className={`mr-1.5 size-4 ${busy ? "animate-spin" : ""}`} />
            Interpretar conteúdo colado
          </Button>
        </div>
      ) : (
        <button type="button" className="text-[11px] text-[#8C8C8C] underline" onClick={() => setAssist(true)}>
          A leitura automática falhou? Usar importação assistida
        </button>
      )}

      {data?.ok ? (
        <div className="min-w-0 space-y-3 border-t pt-3">
          <div className="min-w-0 space-y-0.5">
            <p className="break-words text-sm font-medium">{data.perfumeName ?? "Perfume encontrado"}</p>
            <p className="break-words text-xs text-[#8C8C8C]">
              {[data.brand, data.gender, data.concentration, data.family].filter(Boolean).join(" · ") || "—"}
            </p>
            {data.identityWarning ? (
              <p className="break-words text-xs text-amber-600 dark:text-amber-400">
                Nome divergente — nada da identidade do produto será alterado. {data.identityWarning}
              </p>
            ) : null}
          </div>

          <DiffBlock
            label="Principais acordes"
            now={data.current.accords.map((a) => a.name)}
            next={data.accords.map((a) => a.name)}
          />
          {data.structure === "FLAT" ? (
            <DiffBlock label="Notas (lista única da fonte)" now={[]} next={data.flat} />
          ) : (
            <>
              <DiffBlock label="Notas de saída" now={data.current.top} next={data.top} />
              <DiffBlock label="Notas de coração" now={data.current.heart} next={data.heart} />
              <DiffBlock label="Notas de fundo" now={data.current.base} next={data.base} />
            </>
          )}

          <div className="min-w-0 space-y-1 rounded-lg bg-muted/40 p-2">
            <p className="text-[11px] uppercase tracking-wide text-[#8C8C8C]">
              {data.descriptionSource === "fonte"
                ? "Descrição (fiel ao conteúdo colado)"
                : "Descrição Orium (gerada)"}
            </p>
            <p className="break-words text-xs">{data.description}</p>
          </div>

          <button
            type="button"
            onClick={() => setShowReport((v) => !v)}
            className="text-[11px] text-[#8C8C8C] underline"
          >
            {showReport ? "Ocultar relatório da leitura" : "Ver relatório da leitura"}
          </button>
          {showReport ? (
            <div className="min-w-0 space-y-1 rounded-lg bg-muted/40 p-2 text-[11px] text-[#8C8C8C]">
              <p>
                Leitor {data.parserVersion} · caminho usado: {data.strategyUsed ?? "nenhum"} · {data.durationMs} ms
              </p>
              {data.strategies.map((s) => (
                <p key={s.id} className="break-words">
                  {s.id}. {s.label}: {s.ok ? `${s.notes} notas` : "nada"} — {s.detail}
                </p>
              ))}
              <p>
                Qualidade do que já existe: {data.quality.currentScore} · desta leitura: {data.quality.incomingScore}
              </p>
            </div>
          ) : null}

          {!data.quality.allow ? (
            <p className="break-words text-xs text-amber-600 dark:text-amber-400">{data.quality.reason}</p>
          ) : null}

          <div className="space-y-1.5">
            {([
              ["accords", "Principais acordes"],
              ["pyramid", "Notas olfativas"],
              ["family", "Família olfativa"],
              ["description", "Descrição Orium"],
            ] as Array<[keyof typeof sections, string]>).map(([k, label]) => (
              <label key={k} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={sections[k]}
                  onChange={(e) => setSections((s) => ({ ...s, [k]: e.target.checked }))}
                  className="size-4 accent-[#FFD599]"
                />
                {label}
              </label>
            ))}
          </div>

          <div className="flex flex-col gap-2">
            <Button className="h-12 w-full rounded-full bg-[#FFD599] text-[15px] font-bold text-[#15130F] hover:bg-[#FFDDAA]" disabled={busy} onClick={() => runApply(true)}>
              <Save className="mr-1.5 size-4" /> Aplicar e confirmar informações
            </Button>
            <Button className="h-12 w-full rounded-full bg-[#232323] text-[15px] font-semibold text-white hover:bg-[#2C2C2C]" disabled={busy} onClick={() => runApply(false)}>
              {locked ? "Aplicar mesmo assim" : "Aplicar informações do Fragrantica"}
            </Button>
            <Button variant="ghost" className="h-11 w-full rounded-full text-[#A9A9A9] hover:bg-white/[0.05] hover:text-white" disabled={busy} onClick={() => setData(null)}>
              Cancelar
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );

}

/** Comparação em uma coluna, destacando o que entra e o que sai. */
function DiffBlock({ label, now, next }: { label: string; now: string[]; next: string[] }) {
  const k = (s: string) => key(s);
  const nowKeys = new Set(now.map(k));
  const nextKeys = new Set(next.map(k));
  const reordered =
    now.map(k).join("|") !== next.map(k).join("|") &&
    now.length === next.length &&
    now.every((v) => nextKeys.has(k(v)));

  return (
    <div className="min-w-0">
      <p className="text-[13px] font-bold text-white">{label}</p>
      <p className="mt-1 text-[11.5px] text-[#8C8C8C]">Hoje</p>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {now.length ? (
          now.map((v, i) => (
            <span
              key={`${v}-${i}`}
              className={`rounded-full px-2.5 py-1 text-[12.5px] font-semibold ${nextKeys.has(k(v)) ? "bg-[#232323] text-[#D4D4D4]" : "bg-[#2A1A18] text-[#FF9A8A] line-through"}`}
            >
              {v}
            </span>
          ))
        ) : (
          <span className="text-xs text-[#8C8C8C]">vazio</span>
        )}
      </div>
      <p className="mt-1.5 text-[11.5px] text-[#8C8C8C]">Encontrado</p>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {next.length ? (
          next.map((v, i) => (
            <span
              key={`${v}-${i}`}
              className={`rounded-full px-2.5 py-1 text-[12.5px] font-semibold ${nowKeys.has(k(v)) ? "bg-[#232323] text-[#D4D4D4]" : "bg-[#17251C] text-[#7FCF9F]"}`}
            >
              {v}
            </span>
          ))
        ) : (
          <span className="text-xs text-[#8C8C8C]">vazio</span>
        )}
      </div>
      {reordered ? <p className="mt-0.5 text-[11px] text-[#8C8C8C]">Ordem alterada.</p> : null}
    </div>
  );
}


/**
 * Atalho: copiar a parte olfativa de um perfume que já existe no catálogo.
 * Traz família, acordes, pirâmide, notas (com as imagens da biblioteca),
 * descrição e a fonte Fragrantica. Nunca traz preço, estoque, fornecedor,
 * promoção nem a foto do item. Tudo continua editável depois.
 */
function CopyFromCatalog({ productId, onCopied }: { productId: string; onCopied: () => void }) {
  const search = useServerFn(searchFragranceSource);
  const copy = useServerFn(copyFragranceFrom);
  const [term, setTerm] = useState("");
  const [items, setItems] = useState<FragranceSourceItem[]>([]);
  const [busy, setBusy] = useState<null | "search" | string>(null);
  const [searched, setSearched] = useState(false);

  const runSearch = async () => {
    if (term.trim().length < 2) {
      toast.info("Escreva pelo menos duas letras do nome ou da marca.");
      return;
    }
    setBusy("search");
    try {
      const res = await search({ data: { q: term, excludeProductId: productId } });
      setItems(res.items);
      setSearched(true);
      if (!res.items.length) toast.info("Nenhum perfume com informações olfativas para esse termo.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível buscar agora.");
    } finally {
      setBusy(null);
    }
  };

  const runCopy = async (id: string, name: string) => {
    setBusy(id);
    try {
      const res = await copy({ data: { fromProductId: id, toProductId: productId } });
      toast.success(`Copiado de ${name}: ${res.accords} acordes e ${res.notes} notas. Revise e ajuste.`);
      setItems([]);
      setTerm("");
      setSearched(false);
      onCopied();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível copiar.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="min-w-0 rounded-[24px] bg-[#1A1A1A] p-4 sm:p-5">
      <p className="text-[16px] font-bold">Copiar de outro perfume</p>
      <p className="mt-1 text-xs text-[#8C8C8C]">
        Busque pelo nome ou marca e copie família, acordes, pirâmide, notas e descrição. Preço,
        estoque, fornecedor, promoção e a foto deste item não são copiados.
      </p>

      <div className="mt-2.5 flex min-w-0 gap-2">
        <TextInput
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void runSearch();
            }
          }}
          placeholder="Ex.: Club de Nuit, Lattafa"
          className="h-11"
        />
        <Button
          type="button"
          className="press h-11 shrink-0 rounded-full bg-[#232323] px-4 text-[13.5px] font-semibold text-white hover:bg-[#2C2C2C]"
          disabled={busy === "search"}
          onClick={() => void runSearch()}
        >
          <Search className={`mr-1.5 size-3.5 ${busy === "search" ? "animate-pulse" : ""}`} /> Buscar
        </Button>
      </div>

      {items.length ? (
        <ul className="mt-3 min-w-0 space-y-2">
          {items.map((it) => (
            <li
              key={it.id}
              className="min-w-0 rounded-[18px] bg-[#232323] p-3"
            >
              <p className="truncate text-sm font-medium">{it.name}</p>
              <p className="truncate text-xs text-[#8C8C8C]">
                {[it.brand, it.concentration, it.volumeMl ? `${it.volumeMl}ml` : null, it.family]
                  .filter(Boolean)
                  .join(" · ") || "—"}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-[#2E2E2E] px-2.5 py-0.5 text-[11.5px] text-[#D4D4D4]">
                  {it.accords} acordes · {it.notes} notas{it.hasDescription ? " · descrição" : ""}
                </span>
                <Button
                  type="button"
                  size="sm"
                  className="press ml-auto h-9 rounded-full bg-[#FFD599] px-4 text-[13px] font-bold text-[#15130F] hover:bg-[#FFDDAA]"
                  disabled={busy === it.id}
                  onClick={() => void runCopy(it.id, it.name)}
                >
                  {busy === it.id ? "Copiando…" : "Copiar"}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : searched ? (
        <p className="mt-3 text-xs text-[#8C8C8C]">
          Nada encontrado. Tente outro nome ou use o link do Fragrantica abaixo.
        </p>
      ) : null}
    </div>
  );
}
