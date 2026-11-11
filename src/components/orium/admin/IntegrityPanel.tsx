import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Check, X, Clock, Scissors, Undo2, FlaskConical, ShieldCheck, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { getEligibilityHealth } from "@/lib/catalog-eligibility.functions";
import {
  getIdentityHealthV3,
  listIdentityLogV3,
  listIdentityReviewV3,
  resolveIdentityReviewV3,
  runIdentityAuditV3,
  splitProductV3Fn,
  undoMergeV3Fn,
  type ReviewProduct,
} from "@/lib/identity-v3.functions";

const KINDS = [
  { id: "POSSIBLE_DUPLICATE_CANONICAL", label: "Possíveis duplicados" },
  { id: "CANONICAL_INCONSISTENCY", label: "Merges suspeitos" },
  { id: "UNMATCHED_OFFER", label: "Ofertas sem vínculo" },
  { id: "MISSING_BRAND", label: "Sem marca" },
] as const;

const brl = (n: number | null | undefined) => (n == null ? "—" : Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));

export function IntegrityPanel({ initialKind }: { initialKind?: string | undefined }) {
  const qc = useQueryClient();
  const health = useQuery({ queryKey: ["identity-health"], queryFn: useServerFn(getIdentityHealthV3) });
  const elig = useQuery({ queryKey: ["eligibility-health"], queryFn: useServerFn(getEligibilityHealth) });
  const runFn = useServerFn(runIdentityAuditV3);
  const [report, setReport] = useState<any>(null);
  const [kind, setKind] = useState<string>(initialKind ?? "POSSIBLE_DUPLICATE_CANONICAL");
  const [confirmApply, setConfirmApply] = useState(false);

  const run = useMutation({
    mutationFn: (mode: "dry_run" | "audit" | "apply") => runFn({ data: { mode } }),
    onSuccess: (r, mode) => {
      setReport({ ...r.report, mode, applied: r.applied });
      setConfirmApply(false);
      toast.success(mode === "dry_run" ? "Simulação pronta — nada foi alterado." : mode === "audit" ? "Auditoria concluída e fila atualizada." : `${r.applied ?? 0} vínculos aplicados.`);
      qc.invalidateQueries({ queryKey: ["identity-health"] });
      qc.invalidateQueries({ queryKey: ["identity-review"] });
      qc.invalidateQueries({ queryKey: ["identity-log"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha na auditoria."),
  });

  const h = health.data;
  const cards = [
    ["Produtos canônicos", h?.products],
    ["Ofertas de fornecedor", h?.offers],
    ["Ofertas sem vínculo", h?.unlinked],
    ["Possíveis duplicados", h?.duplicates],
    ["Merges suspeitos", h?.inconsistencies],
    ["Sem marca", h?.missingBrand],
    ["Vínculos persistentes", h?.mappings],
    ["Pares já revisados", h?.negatives],
    ["Identidades travadas", h?.locks],
    ["Perfumes Designer ocultos", elig.data?.designer],
    ["Perfumes Nicho ocultos", elig.data?.niche],
    ["Perfumes com marca em revisão", elig.data?.review],
    ["Marcas desconhecidas", elig.data?.unknownBrands],
  ] as const;

  return (
      <div className="space-y-6">
        <section className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {cards.map(([label, v]) => (
            <div key={label} className="rounded-xl border border-border bg-card p-3">
              <div className="text-xs text-muted-foreground">{label}</div>
              <div className="mt-1 text-xl font-semibold tabular-nums">{v == null ? "…" : v.toLocaleString("pt-BR")}</div>
            </div>
          ))}
        </section>

        <section className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={run.isPending} onClick={() => run.mutate("dry_run")}>
            <FlaskConical className="size-4" /> Simular limpeza
          </Button>
          <Button variant="outline" disabled={run.isPending} onClick={() => run.mutate("audit")}>
            <ShieldCheck className="size-4" /> Executar auditoria
          </Button>
          {run.isPending && <span className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Analisando o catálogo…</span>}
        </section>

        {report && (
          <section className="rounded-xl border border-border bg-card p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-semibold">Auditoria {report.engineVersion} {report.mode === "dry_run" && <span className="text-sm font-normal text-muted-foreground">· simulação, nada foi alterado</span>}</h2>
              <span className="text-xs text-muted-foreground">{report.analyzed.products} produtos · {report.analyzed.offers} ofertas</span>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
              {[
                ["Vínculos seguros", report.safeAutoLinks],
                ["Vínculos para revisar", report.reviewLinks],
                ["Possíveis duplicados", report.probableDuplicates],
                ["Merges suspeitos", report.suspiciousMerges],
                ["Ofertas sem vínculo", report.unlinkedOffers],
                ["Sem produto correspondente", report.newCanonicalCandidates],
                ["Sem marca", report.missingBrand],
                ["Marcas corrigíveis", report.correctableBrands],
                ["Parecidos mas diferentes (ignorados)", report.ignoredClosePairs],
              ].map(([l, v]) => (
                <div key={l as string} className="flex justify-between gap-2 border-b border-border/50 py-1"><dt className="text-muted-foreground">{l}</dt><dd className="tabular-nums font-medium">{v}</dd></div>
              ))}
            </dl>
            {report.samples.autoLinks.length > 0 && (
              <details className="mt-3 text-sm">
                <summary className="cursor-pointer text-muted-foreground">Prévia dos vínculos seguros ({report.samples.autoLinks.length} de {report.safeAutoLinks})</summary>
                <ul className="mt-2 space-y-1">
                  {report.samples.autoLinks.map((l: any, i: number) => (
                    <li key={i} className="flex flex-wrap gap-1"><span className="text-muted-foreground">{l.offer}</span> → <span>{l.product}</span></li>
                  ))}
                </ul>
              </details>
            )}
            {report.safeAutoLinks > 0 && report.mode !== "apply" && (
              <div className="mt-4 flex flex-wrap items-center gap-2">
                {!confirmApply ? (
                  <Button onClick={() => setConfirmApply(true)}>Aplicar {Math.min(report.safeAutoLinks, 50)} vínculos de alta confiança</Button>
                ) : (
                  <>
                    <span className="text-sm">Vincula ofertas a produtos já existentes. Nenhum produto é mesclado ou apagado, e fica registrado.</span>
                    <Button disabled={run.isPending} onClick={() => run.mutate("apply")}>Confirmar</Button>
                    <Button variant="ghost" onClick={() => setConfirmApply(false)}>Cancelar</Button>
                  </>
                )}
              </div>
            )}
          </section>
        )}

        <section className="space-y-3">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {KINDS.map((k) => (
              <button
                key={k.id}
                onClick={() => setKind(k.id)}
                className={cn("shrink-0 rounded-full border px-3 py-1.5 text-sm", kind === k.id ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground")}
              >
                {k.label}
              </button>
            ))}
          </div>
          <ReviewList kind={kind} />
        </section>

        <MergeLog />
      </div>
  );
}

function ReviewList({ kind }: { kind: string }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listIdentityReviewV3);
  const resolveFn = useServerFn(resolveIdentityReviewV3);
  const q = useQuery({ queryKey: ["identity-review", kind], queryFn: () => listFn({ data: { kind } }) });
  const resolve = useMutation({
    mutationFn: (v: { id: string; decision: "same" | "different" | "later"; keep?: "a" | "b"; brand?: string }) => resolveFn({ data: v }),
    onSuccess: () => {
      toast.success("Decisão registrada.");
      qc.invalidateQueries({ queryKey: ["identity-review"] });
      qc.invalidateQueries({ queryKey: ["identity-health"] });
      qc.invalidateQueries({ queryKey: ["identity-log"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não foi possível salvar."),
  });

  if (q.isLoading) return <div className="rounded-xl border border-border p-6 text-sm text-muted-foreground">Carregando…</div>;
  const items = q.data ?? [];
  if (!items.length) return <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">Nada pendente aqui. Execute a auditoria para atualizar a fila.</div>;

  return (
    <div className="space-y-3">
      {items.map((it) => (
        <article key={it.id} className="rounded-xl border border-border bg-card p-3 sm:p-4">
          {it.kind === "POSSIBLE_DUPLICATE_CANONICAL" && (
            <>
              <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-start">
                <ProductSide p={it.a} />
                <div className="self-center text-center text-xs font-semibold text-muted-foreground">VS</div>
                <ProductSide p={it.b} />
              </div>
              <Reasons reasons={it.reasons} rec={it.recommendation} />
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => resolve.mutate({ id: it.id, decision: "different" })}><X className="size-4" /> Produtos diferentes</Button>
                <Button size="sm" onClick={() => resolve.mutate({ id: it.id, decision: "same", keep: (it.a?.offers.length ?? 0) >= (it.b?.offers.length ?? 0) ? "a" : "b" })}><Check className="size-4" /> Mesmo produto</Button>
                <Button size="sm" variant="ghost" onClick={() => resolve.mutate({ id: it.id, decision: "later" })}><Clock className="size-4" /> Revisar depois</Button>
              </div>
            </>
          )}
          {it.kind === "CANONICAL_INCONSISTENCY" && <Inconsistency item={it} onResolve={(d) => resolve.mutate({ id: it.id, decision: d })} />}
          {it.kind === "UNMATCHED_OFFER" && (
            <>
              <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr]">
                <div className="rounded-lg bg-muted/40 p-3 text-sm">
                  <div className="text-xs text-muted-foreground">Oferta · {it.offer?.supplier}</div>
                  <div className="font-medium">{it.offer?.supplier_product_name}</div>
                  <div className="text-muted-foreground">{brl(it.offer?.price)}</div>
                </div>
                <div className="self-center text-center text-xs font-semibold text-muted-foreground">→</div>
                <ProductSide p={it.a} />
              </div>
              <Reasons reasons={it.reasons} rec="REVIEW" />
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" onClick={() => resolve.mutate({ id: it.id, decision: "same" })}><Check className="size-4" /> É este produto</Button>
                <Button size="sm" variant="outline" onClick={() => resolve.mutate({ id: it.id, decision: "different" })}><X className="size-4" /> Não é</Button>
                <Button size="sm" variant="ghost" onClick={() => resolve.mutate({ id: it.id, decision: "later" })}><Clock className="size-4" /> Depois</Button>
              </div>
            </>
          )}
          {it.kind === "MISSING_BRAND" && <MissingBrand item={it} onSave={(brand) => resolve.mutate({ id: it.id, decision: "same", brand })} onLater={() => resolve.mutate({ id: it.id, decision: "later" })} />}
        </article>
      ))}
    </div>
  );
}

function ProductSide({ p }: { p: ReviewProduct | null }) {
  if (!p) return <div className="rounded-lg bg-muted/40 p-3 text-sm text-muted-foreground">Produto não existe mais</div>;
  return (
    <div className="flex min-w-0 gap-3 rounded-lg bg-muted/40 p-3">
      {p.image ? <img src={p.image} alt="" className="size-16 shrink-0 rounded-md bg-background object-contain" loading="lazy" /> : <div className="size-16 shrink-0 rounded-md bg-background" />}
      <div className="min-w-0 text-sm">
        <div className="truncate font-medium">{p.name}</div>
        <div className="text-muted-foreground">{p.brand ?? "Sem marca"}{p.concentration ? ` · ${p.concentration}` : ""}{p.volume ? ` · ${p.volume}ml` : ""}</div>
        <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
          {p.offers.slice(0, 3).map((o) => <li key={o.id} className="truncate">{o.supplier} · {brl(o.price)}</li>)}
          {p.offers.length === 0 && <li>Sem ofertas de fornecedor</li>}
        </ul>
      </div>
    </div>
  );
}

function Reasons({ reasons, rec }: { reasons: Array<{ label: string; ok: boolean | null; hard?: boolean }>; rec: string }) {
  const recText = rec === "SAME" ? "Parece o MESMO PRODUTO" : rec === "DIFFERENT" ? "PRODUTOS DIFERENTES" : "Precisa da sua decisão";
  return (
    <div className="mt-3 text-sm">
      <ul className="flex flex-wrap gap-1.5">
        {reasons.map((r, i) => (
          <li key={i} className={cn("rounded-md px-2 py-0.5 text-xs", r.ok === true ? "bg-primary/10 text-foreground" : r.ok === false ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground")}>{r.label}</li>
        ))}
      </ul>
      <div className="mt-2 font-medium">Recomendação: {recText}</div>
    </div>
  );
}

function Inconsistency({ item, onResolve }: { item: any; onResolve: (d: "same" | "later") => void }) {
  const qc = useQueryClient();
  const splitFn = useServerFn(splitProductV3Fn);
  const conflictIds = new Set<string>((item.details?.conflicts ?? []).map((c: any) => c.offerId));
  const [sel, setSel] = useState<Set<string>>(new Set(conflictIds));
  const [name, setName] = useState("");
  const split = useMutation({
    mutationFn: () => splitFn({ data: { productId: item.a.id, offerIds: [...sel], name, reviewId: item.id } }),
    onSuccess: () => {
      toast.success("Produto separado. Eles não voltam a ser mesclados.");
      qc.invalidateQueries({ queryKey: ["identity-review"] });
      qc.invalidateQueries({ queryKey: ["identity-health"] });
      qc.invalidateQueries({ queryKey: ["identity-log"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao separar."),
  });
  if (!item.a) return null;
  return (
    <div className="space-y-3">
      <ProductSide p={item.a} />
      <Reasons reasons={item.reasons} rec="REVIEW" />
      <div className="text-sm">
        <div className="mb-1 text-xs text-muted-foreground">Ofertas deste produto — marque as que são OUTRO perfume:</div>
        <ul className="space-y-1">
          {item.a.offers.map((o: any) => (
            <li key={o.id}>
              <label className="flex items-start gap-2">
                <input type="checkbox" className="mt-1" checked={sel.has(o.id)} onChange={(e) => { const n = new Set(sel); e.target.checked ? n.add(o.id) : n.delete(o.id); setSel(n); }} />
                <span className={cn("min-w-0", conflictIds.has(o.id) && "text-destructive")}>{o.title} <span className="text-muted-foreground">· {o.supplier} · {brl(o.price)}</span></span>
              </label>
            </li>
          ))}
        </ul>
      </div>
      <div className="flex flex-wrap gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome do perfume separado (ex.: Yara Elixir)" className="min-w-0 flex-1 sm:max-w-xs" />
        <Button size="sm" disabled={!name.trim() || !sel.size || split.isPending} onClick={() => split.mutate()}><Scissors className="size-4" /> Separar</Button>
        <Button size="sm" variant="outline" onClick={() => onResolve("same")}><Check className="size-4" /> Está correto</Button>
        <Button size="sm" variant="ghost" onClick={() => onResolve("later")}><Clock className="size-4" /> Depois</Button>
      </div>
    </div>
  );
}

function MissingBrand({ item, onSave, onLater }: { item: any; onSave: (b: string) => void; onLater: () => void }) {
  const [brand, setBrand] = useState<string>(item.details?.suggestedBrand ?? "");
  return (
    <div className="space-y-3">
      <ProductSide p={item.a} />
      <div className="flex flex-wrap gap-2">
        <Input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Marca" className="min-w-0 flex-1 sm:max-w-xs" />
        <Button size="sm" disabled={!brand.trim()} onClick={() => onSave(brand)}><Check className="size-4" /> Salvar marca</Button>
        <Button size="sm" variant="ghost" onClick={onLater}><Clock className="size-4" /> Depois</Button>
      </div>
    </div>
  );
}

function MergeLog() {
  const qc = useQueryClient();
  const logFn = useServerFn(listIdentityLogV3);
  const undoFn = useServerFn(undoMergeV3Fn);
  const q = useQuery({ queryKey: ["identity-log"], queryFn: () => logFn() });
  const undo = useMutation({
    mutationFn: (logId: string) => undoFn({ data: { logId } }),
    onSuccess: () => {
      toast.success("Mesclagem desfeita.");
      qc.invalidateQueries({ queryKey: ["identity-log"] });
      qc.invalidateQueries({ queryKey: ["identity-health"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao desfazer."),
  });
  const LABEL: Record<string, string> = { merge: "Mesclou", split: "Separou", link: "Vinculou", undo: "Desfez", unlink: "Desvinculou" };
  const rows = q.data ?? [];
  if (!rows.length) return null;
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <h2 className="mb-2 font-semibold">Histórico de alterações</h2>
      <ul className="divide-y divide-border text-sm">
        {rows.map((l) => (
          <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <div className="min-w-0">
              <span className="font-medium">{LABEL[l.action] ?? l.action}</span>{" "}
              <span className="text-muted-foreground">{l.dropName ? `"${l.dropName}" · ` : ""}{l.links && l.links > 1 ? `${l.links} ofertas · ` : ""}{l.reason}</span>
              <div className="text-xs text-muted-foreground">{new Date(l.created_at).toLocaleString("pt-BR")}{l.reverted_at ? " · desfeito" : ""}</div>
            </div>
            {l.action === "merge" && !l.reverted_at && (
              <Button size="sm" variant="outline" disabled={undo.isPending} onClick={() => undo.mutate(l.id)}><Undo2 className="size-4" /> Desfazer</Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
