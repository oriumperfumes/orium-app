import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, ShieldCheck, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { SEGMENT_LABEL, type BrandSegment } from "@/lib/catalog/brand-segment";
import { applySegmentCleanup, fixWrongBrand, simulateSegmentCleanup } from "@/lib/catalog-eligibility.functions";

type Sim = Awaited<ReturnType<typeof simulateSegmentCleanup>>;

export const SEGMENT_NAME: Record<BrandSegment, string> = { ...SEGMENT_LABEL, UNKNOWN: "Desconhecido" };

export const segmentTone = (s: string) =>
  s === "ARABIC"
    ? "bg-primary/15 text-primary"
    : s === "DESIGNER"
      ? "bg-destructive/10 text-destructive"
      : s === "NICHE"
        ? "bg-accent text-accent-foreground"
        : "bg-muted text-muted-foreground";

/** Simular / aplicar limpeza Designer/Nicho. Desconhecidas nunca são ocultadas em massa. */
export function BrandSegmentPanel() {
  const qc = useQueryClient();
  const simulate = useServerFn(simulateSegmentCleanup);
  const apply = useServerFn(applySegmentCleanup);
  const fix = useServerFn(fixWrongBrand);
  const [sim, setSim] = useState<Sim | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [showList, setShowList] = useState(false);

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ["admin-brands"] });
    setSim(await simulate());
  };

  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    try {
      toast.success(await fn());
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível concluir.");
    } finally {
      setBusy(false);
    }
  };

  const stats: [string, number][] = sim
    ? [
        ["Marcas Designer", sim.designerBrands],
        ["Perfumes Designer", sim.designerPerfumes],
        ["Marcas Nicho", sim.nicheBrands],
        ["Perfumes Nicho", sim.nichePerfumes],
        ["Serão ocultados", sim.toHide],
        ["Duvidosos (marca desconhecida)", sim.doubtful],
      ]
    : [];

  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <ShieldCheck className="size-4 text-primary" /> Catálogo focado em perfumaria árabe
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Perfumes de marcas Designer e Nicho ficam guardados, mas não aparecem para o cliente. Body splash e
            cosméticos não são afetados.
          </p>
        </div>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() =>
            void (async () => {
              setBusy(true);
              try {
                setSim(await simulate());
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Não foi possível simular.");
              } finally {
                setBusy(false);
              }
            })()
          }
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />} Simular limpeza Designer/Nicho
        </Button>
      </div>

      {sim ? (
        <div className="mt-4 space-y-4">
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {stats.map(([k, v]) => (
              <div key={k} className="rounded-xl bg-muted/40 p-3">
                <dt className="text-xs text-muted-foreground">{k}</dt>
                <dd className="mt-1 text-lg font-semibold tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setShowList((v) => !v)}>
              {showList ? "Esconder lista" : "Revisar"}
            </Button>
            <Button disabled={busy || sim.changes.length === 0} onClick={() => setConfirm(true)}>
              Aplicar ({sim.changes.length} marca{sim.changes.length === 1 ? "" : "s"})
            </Button>
          </div>

          {showList ? (
            <div className="space-y-4">
              <div>
                <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Mudanças de segmento</h3>
                {sim.changes.length === 0 ? (
                  <p className="mt-2 text-sm text-muted-foreground">Nenhuma marca muda de segmento.</p>
                ) : (
                  <ul className="mt-2 divide-y divide-border rounded-xl border border-border">
                    {sim.changes.map((c) => (
                      <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm">
                        <span className="min-w-0 truncate font-medium">{c.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {SEGMENT_NAME[c.current]} → <strong className="text-foreground">{SEGMENT_NAME[c.proposed]}</strong> ·{" "}
                          {c.publicPerfumes} público{c.publicPerfumes === 1 ? "" : "s"}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  Marcas desconhecidas com perfumes (decisão sua)
                </h3>
                <ul className="mt-2 divide-y divide-border rounded-xl border border-border">
                  {sim.unknown.map((u) => (
                    <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm">
                      <span className="min-w-0">
                        <span className="font-medium">{u.name}</span>{" "}
                        <span className="text-xs text-muted-foreground">
                          {u.perfumes} perfume{u.perfumes === 1 ? "" : "s"} · {u.publicPerfumes} público
                          {u.publicPerfumes === 1 ? "" : "s"}
                        </span>
                        {u.suggestion ? (
                          <span className="block text-xs text-muted-foreground">
                            Parece a linha “{u.suggestion.line}” da marca {u.suggestion.targetBrand}.
                          </span>
                        ) : null}
                      </span>
                      {u.suggestion ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              const r = await fix({ data: { brandId: u.id, targetName: u.suggestion!.targetBrand } });
                              return `Produtos movidos para ${r.to}.`;
                            })
                          }
                        >
                          Corrigir para {u.suggestion.targetBrand}
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-muted-foreground">
                  Marcas desconhecidas nunca são ocultadas automaticamente. Classifique-as na lista abaixo.
                </p>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Aplicar classificação?</AlertDialogTitle>
            <AlertDialogDescription>
              {sim?.changes.length ?? 0} marcas mudam de segmento e cerca de {sim?.toHide ?? 0} perfumes saem do
              catálogo público. Nada é apagado; mudar o segmento da marca depois devolve os perfumes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                void run(async () => {
                  const r = await apply();
                  return `${r.changed} marcas classificadas · ${r.hidden} perfumes ocultados.`;
                })
              }
            >
              Aplicar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
