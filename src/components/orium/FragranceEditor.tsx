/**
 * Revisão manual das informações olfativas de um perfume (admin, mobile-first).
 *
 * Mostra o estado da pirâmide, permite corrigir descrição, acordes e as notas de
 * saída/coração/fundo (com busca na biblioteca canônica e miniatura da foto),
 * pesquisar de novo nas fontes mostrando uma comparação antes de aplicar, e
 * confirmar a informação para que a automação não sobrescreva.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronDown, ChevronUp, Lock, Plus, RefreshCw, Save, Search, Unlock, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { dateBR } from "@/lib/format";
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

const LEVEL_LABEL: Record<Level, string> = {
  TOP: "Notas de saída",
  HEART: "Notas de coração",
  BASE: "Notas de fundo",
};

const STATUS_LABEL: Record<string, string> = {
  completo: "Completa",
  parcial: "Parcial",
  revisar: "Precisa revisão",
  nao_encontrado: "Não encontrada",
  pendente: "Sem dados ainda",
  bloqueado: "Confirmada manualmente",
};

const key = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "");

export function FragranceEditor({
  productId,
  defaultOpen = false,
  allowCopyFromCatalog = false,
}: {
  productId: string;
  defaultOpen?: boolean;
  /** Mostra "Copiar de perfume do catálogo" (usado na área Negociação). */
  allowCopyFromCatalog?: boolean;
}) {
  const qc = useQueryClient();
  const research = useServerFn(auditFragranceFragrantica);
  const save = useServerFn(saveFragranceDetails);
  const lockFn = useServerFn(setFragranceLock);

  const [open, setOpen] = useState(defaultOpen);
  const [busy, setBusy] = useState(false);
  const [description, setDescription] = useState("");
  const [family, setFamily] = useState("");
  const [accords, setAccords] = useState<Accord[]>([]);
  const [notes, setNotes] = useState<Record<Level, string[]>>({ TOP: [], HEART: [], BASE: [] });
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

  useEffect(() => {
    if (!data) return;
    setDescription(data.details?.description ?? "");
    setFamily(data.details?.olfactory_family ?? "");
    setAccords(
      data.accords.map((a) => ({ name: a.accord_name, intensity: Number(a.intensity) || 0.7 })),
    );
    const at = (level: Level) =>
      data.notes.filter((n) => n.pyramid_level === level).map((n) => n.note_label);
    setNotes({ TOP: at("TOP"), HEART: at("HEART"), BASE: at("BASE") });
  }, [data]);

  const imageOf = useMemo(() => {
    const map = new Map<string, { url: string | null; source: string | null }>();
    for (const n of data?.library ?? []) map.set(key(n.canonical_name), { url: n.image_url, source: null });
    for (const a of data?.assets ?? []) {
      const k = key(a.canonical_note_name);
      map.set(k, { url: a.image_url ?? map.get(k)?.url ?? null, source: a.source_url ?? null });
    }
    return (label: string) => map.get(key(label)) ?? { url: null, source: null };
  }, [data]);

  const d = data?.details;
  const status = d?.locked ? "bloqueado" : (d?.status ?? "pendente");
  const gaps = [
    notes.TOP.length ? null : "Notas de saída ausentes",
    notes.HEART.length ? null : "Notas de coração ausentes",
    notes.BASE.length ? null : "Notas de fundo ausentes",
    accords.length ? null : "Sem acordes",
    description.trim().length > 20 ? null : "Sem descrição",
  ].filter(Boolean) as string[];

  const refetchAll = () => {
    qc.invalidateQueries({ queryKey: ["admin-fragrance", productId] });
    qc.invalidateQueries({ queryKey: ["fragrance", productId] });
    qc.invalidateQueries({ queryKey: ["pyramid-status"] });
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
    toast.success("Dados aplicados no formulário. Revise e salve.");
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
      toast.success(lock ? "Informação confirmada — a automação não sobrescreve." : "Alterações salvas.");
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
      toast.success(d?.locked ? "Atualização automática liberada." : "Informação travada.");
      refetchAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível alterar.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-6 w-full min-w-0 rounded-2xl border bg-card shadow-soft">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full min-w-0 items-center justify-between gap-3 p-4 text-left"
      >
        <span className="min-w-0">
          <span className="block text-sm font-medium">Informações olfativas</span>
          <span className="block truncate text-xs text-muted-foreground">
            {gaps.length
              ? `Pirâmide incompleta · ${gaps.length} ponto(s) a revisar`
              : `Pirâmide completa · ${STATUS_LABEL[status] ?? status}`}
          </span>
        </span>
        {open ? <ChevronUp className="size-4 shrink-0" /> : <ChevronDown className="size-4 shrink-0" />}
      </button>

      {!open ? null : isLoading ? (
        <div className="m-4 h-40 animate-pulse rounded-xl bg-muted" />
      ) : (
        <div className="min-w-0 space-y-5 border-t p-4">
          {/* status e fontes */}
          <div className="min-w-0 space-y-1 text-xs text-muted-foreground">
            {gaps.length ? (
              <ul className="list-inside list-disc">
                {gaps.map((g) => (
                  <li key={g}>{g}</li>
                ))}
              </ul>
            ) : (
              <p>Saída, coração, fundo, acordes e descrição preenchidos.</p>
            )}
            <p className="break-words">
              Fonte: {d?.source_primary ?? "—"}
              {d?.source_secondary ? ` · ${d.source_secondary}` : ""} · Confiança:{" "}
              {d ? confidenceLabel(Number(d.confidence)) : "—"} · Última pesquisa:{" "}
              {d?.enriched_at ? dateBR(d.enriched_at) : "—"}
            </p>
            {d?.source_primary_url ? (
              <a href={d.source_primary_url} target="_blank" rel="noreferrer" className="block break-all text-[11px] underline">
                {d.source_primary_url}
              </a>
            ) : null}
            {d?.source_secondary_url ? (
              <a href={d.source_secondary_url} target="_blank" rel="noreferrer" className="block break-all text-[11px] underline">
                {d.source_secondary_url}
              </a>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" className="h-9 rounded-full text-xs" disabled={busy} onClick={runResearch}>
              <RefreshCw className={`mr-1.5 size-3.5 ${busy ? "animate-spin" : ""}`} /> Pesquisar novamente
            </Button>
            <Button size="sm" variant="ghost" className="h-9 rounded-full text-xs" disabled={busy} onClick={toggleLock}>
              {d?.locked ? <Unlock className="mr-1.5 size-3.5" /> : <Lock className="mr-1.5 size-3.5" />}
              {d?.locked ? "Permitir atualização automática" : "Travar informação"}
            </Button>
          </div>

          {allowCopyFromCatalog ? (
            <CopyFromCatalog productId={productId} onCopied={refetchAll} />
          ) : null}

          <FragranticaImport
            productId={productId}
            locked={!!d?.locked}
            savedUrl={d?.fragrantica_url ?? null}
            lastImport={d?.audited_at ?? null}
            statusLabel={STATUS_LABEL[status] ?? status}
            onApplied={refetchAll}
          />

          {found ? (
            <ComparePanel
              found={found}
              current={{ description, accords, ...notes }}
              onApply={applyFound}
              onDismiss={() => setFound(null)}
            />
          ) : null}


          {/* família olfativa */}
          <div className="min-w-0 space-y-1.5">
            <p className="text-xs text-muted-foreground">Família olfativa</p>
            <Input
              value={family}
              onChange={(e) => setFamily(e.target.value)}
              placeholder="Ex.: Âmbar Baunilha"
              className="w-full min-w-0"
            />
          </div>

          {/* descrição */}
          <div className="min-w-0 space-y-1.5">
            <p className="text-xs text-muted-foreground">Sobre esta fragrância</p>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={5}
              className="w-full min-w-0"
            />
          </div>

          {/* acordes */}
          <AccordEditor accords={accords} onChange={setAccords} />

          {/* pirâmide */}
          {(["TOP", "HEART", "BASE"] as Level[]).map((level) => (
            <NoteBlock
              key={level}
              level={level}
              values={notes[level]}
              library={data?.library ?? []}
              imageOf={imageOf}
              onChange={(list) => setNotes((n) => ({ ...n, [level]: list }))}
            />
          ))}

          <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row-reverse">
            <Button className="h-11 w-full rounded-xl sm:w-auto" disabled={busy} onClick={() => runSave(true)}>
              <Save className="mr-1.5 size-4" /> Confirmar informações olfativas
            </Button>
            <Button
              variant="outline"
              className="h-11 w-full rounded-xl sm:w-auto"
              disabled={busy}
              onClick={() => runSave(false)}
            >
              Salvar sem confirmar
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

function confidenceLabel(v: number) {
  if (!v) return "—";
  if (v >= 0.8) return "Alta";
  if (v >= 0.6) return "Média";
  return "Baixa";
}

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
  const row = (label: string, now: string[], next: string[]) => (
    <div className="min-w-0 border-t py-2 first:border-t-0">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="break-words text-xs text-muted-foreground">Atual: {now.length ? now.join(", ") : "vazio"}</p>
      <p className="break-words text-xs">Encontrado: {next.length ? next.join(", ") : "vazio"}</p>
    </div>
  );

  return (
    <div className="min-w-0 rounded-xl border bg-muted/30 p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium">Resultado da pesquisa</p>
        <button onClick={onDismiss} aria-label="Fechar comparação">
          <X className="size-4 text-muted-foreground" />
        </button>
      </div>
      {!found.found ? (
        <p className="mt-2 text-xs text-muted-foreground">{found.reason || "Nada confiável encontrado."}</p>
      ) : (
        <>
          <p className="mt-1 break-words text-xs text-muted-foreground">
            {found.sourcePrimary ?? "fonte"} · confiança {confidenceLabel(found.confidence)}
            {found.conflict ? " · fontes divergentes" : ""}
          </p>
          <div className="mt-2">
            {row("Saída", current.TOP, found.top)}
            {row("Coração", current.HEART, found.heart)}
            {row("Fundo", current.BASE, found.base)}
            {row(
              "Acordes",
              current.accords.map((a) => a.name),
              found.accords.map((a) => a.name),
            )}
          </div>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <Button size="sm" className="h-10 w-full rounded-xl sm:w-auto" onClick={onApply}>
              Aplicar dados encontrados
            </Button>
            <Button size="sm" variant="outline" className="h-10 w-full rounded-xl sm:w-auto" onClick={onDismiss}>
              Manter atual
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function AccordEditor({ accords, onChange }: { accords: Accord[]; onChange: (a: Accord[]) => void }) {
  const [draft, setDraft] = useState("");
  const move = (i: number, dir: -1 | 1) => {
    const next = [...accords];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    const a = next[i]!;
    next[i] = next[j]!;
    next[j] = a;
    onChange(next);
  };

  return (
    <div className="min-w-0 space-y-2">
      <p className="text-xs text-muted-foreground">Principais acordes (intensidade relativa, não é porcentagem oficial)</p>
      <div className="space-y-2">
        {accords.map((a, i) => (
          <div key={`${a.name}-${i}`} className="min-w-0 rounded-xl border p-2.5">
            <div className="flex min-w-0 items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-sm">{a.name}</span>
              <button aria-label="Subir" onClick={() => move(i, -1)} className="p-1 text-muted-foreground">
                <ChevronUp className="size-4" />
              </button>
              <button aria-label="Descer" onClick={() => move(i, 1)} className="p-1 text-muted-foreground">
                <ChevronDown className="size-4" />
              </button>
              <button
                aria-label="Remover"
                onClick={() => onChange(accords.filter((_, x) => x !== i))}
                className="p-1 text-muted-foreground"
              >
                <X className="size-4" />
              </button>
            </div>
            <input
              type="range"
              min={20}
              max={100}
              value={Math.round(a.intensity * 100)}
              onChange={(e) =>
                onChange(accords.map((x, xi) => (xi === i ? { ...x, intensity: Number(e.target.value) / 100 } : x)))
              }
              className="mt-2 w-full"
            />
          </div>
        ))}
      </div>
      <div className="flex min-w-0 gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Novo acorde"
          className="h-10 min-w-0 flex-1 rounded-xl"
        />
        <Button
          variant="outline"
          className="h-10 shrink-0 rounded-xl"
          onClick={() => {
            const name = draft.trim();
            if (name.length < 2) return;
            onChange([...accords, { name, intensity: 0.7 }]);
            setDraft("");
          }}
        >
          <Plus className="size-4" />
        </Button>
      </div>
    </div>
  );
}

function NoteBlock({
  level,
  values,
  library,
  imageOf,
  onChange,
}: {
  level: Level;
  values: string[];
  library: NoteLib[];
  imageOf: (label: string) => { url: string | null; source: string | null };
  onChange: (list: string[]) => void;
}) {
  const [term, setTerm] = useState("");
  const [adding, setAdding] = useState(false);

  const matches = useMemo(() => {
    const t = key(term);
    if (t.length < 2) return [];
    return library.filter((n) => key(n.canonical_name).includes(t)).slice(0, 8);
  }, [term, library]);

  const add = (label: string) => {
    const name = label.trim();
    if (name.length < 2 || values.some((v) => key(v) === key(name))) return;
    onChange([...values, name]);
    setTerm("");
    setAdding(false);
  };

  const move = (i: number, dir: -1 | 1) => {
    const next = [...values];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    const a = next[i]!;
    next[i] = next[j]!;
    next[j] = a;
    onChange(next);
  };

  return (
    <div className="min-w-0 space-y-2">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{LEVEL_LABEL[level]}</p>
        <Button size="sm" variant="ghost" className="h-8 rounded-full text-xs" onClick={() => setAdding((v) => !v)}>
          <Plus className="mr-1 size-3.5" /> Adicionar nota
        </Button>
      </div>

      {adding ? (
        <div className="min-w-0 rounded-xl border p-2">
          <div className="flex min-w-0 items-center gap-2">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <Input
              autoFocus
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="Buscar na biblioteca (ex.: berg)"
              className="h-10 min-w-0 flex-1 rounded-xl"
              onKeyDown={(e) => {
                if (e.key === "Enter") add(matches[0]?.canonical_name ?? term);
              }}
            />
          </div>
          {matches.length ? (
            <div className="mt-2 space-y-1">
              {matches.map((m) => (
                <button
                  key={m.id}
                  onClick={() => add(m.canonical_name)}
                  className="flex w-full min-w-0 items-center gap-2 rounded-lg p-1.5 text-left hover:bg-muted"
                >
                  <span className="size-8 shrink-0 overflow-hidden rounded-md bg-muted">
                    {m.image_url ? (
                      <img src={m.image_url} alt="" className="size-full object-cover" loading="lazy" />
                    ) : null}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm">{m.canonical_name}</span>
                </button>
              ))}
            </div>
          ) : term.trim().length > 1 ? (
            <button onClick={() => add(term)} className="mt-2 w-full rounded-lg p-2 text-left text-xs text-muted-foreground hover:bg-muted">
              Criar nota “{term.trim()}”
            </button>
          ) : null}
        </div>
      ) : null}

      {values.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nenhuma nota registrada.</p>
      ) : (
        <div className="space-y-2">
          {values.map((label, i) => {
            const img = imageOf(label);
            return (
              <div key={`${label}-${i}`} className="flex min-w-0 items-center gap-2 rounded-xl border p-2">
                <span className="size-10 shrink-0 overflow-hidden rounded-lg bg-muted">
                  {img.url ? <img src={img.url} alt="" className="size-full object-cover" loading="lazy" /> : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{label}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {img.url ? (img.source ? "Fragrantica" : "biblioteca") : "sem foto"}
                  </span>
                </span>
                <button aria-label="Subir" onClick={() => move(i, -1)} className="p-1 text-muted-foreground">
                  <ChevronUp className="size-4" />
                </button>
                <button aria-label="Descer" onClick={() => move(i, 1)} className="p-1 text-muted-foreground">
                  <ChevronDown className="size-4" />
                </button>
                <button
                  aria-label="Remover"
                  onClick={() => onChange(values.filter((_, x) => x !== i))}
                  className="p-1 text-muted-foreground"
                >
                  <X className="size-4" />
                </button>
              </div>
            );
          })}
        </div>
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
    <div id="importar-fragrantica" className="min-w-0 space-y-3 rounded-xl border p-3">
      <div className="min-w-0 space-y-1">
        <p className="text-sm font-medium">Fragrantica</p>
        <p className="text-xs text-muted-foreground">
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
        <span className="text-xs text-muted-foreground">Link do Fragrantica</span>
        <Input
          value={url}
          inputMode="url"
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://www.fragrantica.com.br/perfume/..."
          className="mt-1 h-11 w-full min-w-0 rounded-xl text-base"
        />
      </label>

      {url.trim() && !valid ? <p className="text-xs text-destructive">Link do Fragrantica inválido.</p> : null}

      <label className="flex items-center gap-2 text-xs text-muted-foreground">
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

      <Button className="h-11 w-full rounded-xl" variant="outline" disabled={busy || !valid} onClick={runPreview}>
        <RefreshCw className={`mr-1.5 size-4 ${busy ? "animate-spin" : ""}`} />
        Analisar importação
      </Button>

      {busy && step ? <p className="text-xs text-muted-foreground">{step}</p> : null}

      {data ? (
        <div className="min-w-0 space-y-3 border-t pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-xs ${statusChip(data.status)}`}>
              {statusText[data.status]}
            </span>
            <span className="text-[11px] text-muted-foreground">
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
                className="text-[11px] text-muted-foreground underline"
              >
                {showDiag ? "Ocultar detalhes técnicos" : "Ver detalhes técnicos da recusa"}
              </button>
              {showDiag ? (
                <div className="mt-1 space-y-0.5 rounded-lg bg-muted/40 p-2 text-[11px] text-muted-foreground">
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
        <div className="min-w-0 space-y-2 rounded-xl border border-dashed p-3">
          <p className="text-sm font-medium">Importação assistida</p>
          <p className="text-xs text-muted-foreground">
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
          <Textarea
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            placeholder="Cole aqui o conteúdo copiado da página do perfume…"
            className="min-h-32 w-full min-w-0 rounded-xl text-base"
          />
          <Button
            className="h-11 w-full rounded-xl"
            variant="outline"
            disabled={busy || !valid || pasted.trim().length < 40}
            onClick={runPastePreview}
          >
            <RefreshCw className={`mr-1.5 size-4 ${busy ? "animate-spin" : ""}`} />
            Interpretar conteúdo colado
          </Button>
        </div>
      ) : (
        <button type="button" className="text-[11px] text-muted-foreground underline" onClick={() => setAssist(true)}>
          A leitura automática falhou? Usar importação assistida
        </button>
      )}

      {data?.ok ? (
        <div className="min-w-0 space-y-3 border-t pt-3">
          <div className="min-w-0 space-y-0.5">
            <p className="break-words text-sm font-medium">{data.perfumeName ?? "Perfume encontrado"}</p>
            <p className="break-words text-xs text-muted-foreground">
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
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {data.descriptionSource === "fonte"
                ? "Descrição (fiel ao conteúdo colado)"
                : "Descrição Orium (gerada)"}
            </p>
            <p className="break-words text-xs">{data.description}</p>
          </div>

          <button
            type="button"
            onClick={() => setShowReport((v) => !v)}
            className="text-[11px] text-muted-foreground underline"
          >
            {showReport ? "Ocultar relatório da leitura" : "Ver relatório da leitura"}
          </button>
          {showReport ? (
            <div className="min-w-0 space-y-1 rounded-lg bg-muted/40 p-2 text-[11px] text-muted-foreground">
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
                  className="size-4"
                />
                {label}
              </label>
            ))}
          </div>

          <div className="flex flex-col gap-2">
            <Button className="h-11 w-full rounded-xl" disabled={busy} onClick={() => runApply(true)}>
              <Save className="mr-1.5 size-4" /> Aplicar e confirmar informações
            </Button>
            <Button variant="outline" className="h-11 w-full rounded-xl" disabled={busy} onClick={() => runApply(false)}>
              {locked ? "Aplicar mesmo assim" : "Aplicar informações do Fragrantica"}
            </Button>
            <Button variant="ghost" className="h-10 w-full rounded-xl" disabled={busy} onClick={() => setData(null)}>
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
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">Atualmente na Orium</p>
      <div className="flex flex-wrap gap-1">
        {now.length ? (
          now.map((v, i) => (
            <span
              key={`${v}-${i}`}
              className={`rounded-full px-2 py-0.5 text-xs ${nextKeys.has(k(v)) ? "bg-muted" : "bg-destructive/10 text-destructive line-through"}`}
            >
              {v}
            </span>
          ))
        ) : (
          <span className="text-xs text-muted-foreground">vazio</span>
        )}
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">Encontrado no Fragrantica</p>
      <div className="flex flex-wrap gap-1">
        {next.length ? (
          next.map((v, i) => (
            <span
              key={`${v}-${i}`}
              className={`rounded-full px-2 py-0.5 text-xs ${nowKeys.has(k(v)) ? "bg-muted" : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"}`}
            >
              {v}
            </span>
          ))
        ) : (
          <span className="text-xs text-muted-foreground">vazio</span>
        )}
      </div>
      {reordered ? <p className="mt-0.5 text-[11px] text-muted-foreground">Ordem alterada.</p> : null}
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
    <div className="min-w-0 rounded-2xl border border-border/60 bg-surface-2 p-3">
      <p className="text-sm font-medium">Copiar de perfume do catálogo</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Busque pelo nome ou marca e copie família, acordes, pirâmide, notas e descrição. Preço,
        estoque, fornecedor, promoção e a foto deste item não são copiados.
      </p>

      <div className="mt-2.5 flex min-w-0 gap-2">
        <Input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void runSearch();
            }
          }}
          placeholder="Ex.: Club de Nuit, Lattafa"
          className="h-11 w-full min-w-0"
        />
        <Button
          type="button"
          variant="outline"
          className="press h-11 shrink-0 rounded-full px-4 text-xs"
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
              className="min-w-0 rounded-xl border border-border/60 bg-card p-2.5"
            >
              <p className="truncate text-sm font-medium">{it.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {[it.brand, it.concentration, it.volumeMl ? `${it.volumeMl}ml` : null, it.family]
                  .filter(Boolean)
                  .join(" · ") || "—"}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px]">
                  {it.accords} acordes · {it.notes} notas{it.hasDescription ? " · descrição" : ""}
                </span>
                <Button
                  type="button"
                  size="sm"
                  className="press ml-auto h-9 rounded-full px-3 text-xs"
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
        <p className="mt-3 text-xs text-muted-foreground">
          Nada encontrado. Tente outro nome ou use o link do Fragrantica abaixo.
        </p>
      ) : null}
    </div>
  );
}
