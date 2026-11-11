import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Play, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getEnrichmentProgress, runEnrichment } from "@/lib/fragrance.functions";

type Mode = "not-found" | "partial" | "descriptions" | "missing-url" | "all";

type Live = {
  mode: Mode;
  processed: number;
  verified: number;
  notFound: number;
  temporaryFailure: number;
  review: number;
  descriptions: number;
  requests: number;
  cacheHits: number;
  remaining: number;
  startedAt: number;
};

/** Busca e enriquecimento Fragrantica (V3): progresso real, sem previsão inventada. */
export function FragranticaEnginePanel() {
  const progressFn = useServerFn(getEnrichmentProgress);
  const runFn = useServerFn(runEnrichment);
  const qc = useQueryClient();
  const stop = useRef(false);
  const [live, setLive] = useState<Live | null>(null);

  const { data } = useQuery({
    queryKey: ["enrichment-progress"],
    queryFn: () => progressFn(),
    refetchInterval: 30000,
  });

  async function start(mode: Mode, force = false) {
    if (live) return;
    stop.current = false;
    const state: Live = {
      mode,
      processed: 0,
      verified: 0,
      notFound: 0,
      temporaryFailure: 0,
      review: 0,
      descriptions: 0,
      requests: 0,
      cacheHits: 0,
      remaining: 0,
      startedAt: Date.now(),
    };
    setLive({ ...state });
    try {
      for (let round = 0; round < 200; round++) {
        const r = await runFn({ data: { mode, limit: 30, force } });
        state.processed += r.processed;
        state.verified += r.verified;
        state.notFound += r.notFound;
        state.temporaryFailure += r.temporaryFailure;
        state.review += r.review + r.candidates;
        state.descriptions += r.descriptionsWritten;
        state.requests += r.requests;
        state.cacheHits += r.cacheHits;
        state.remaining = r.remaining;
        setLive({ ...state });
        if (!r.processed || !r.remaining || stop.current) break;
      }
      toast.success(
        `${state.processed} perfumes processados · ${state.verified} identificados · ${state.descriptions} descrições geradas.`,
      );
    } catch {
      toast.error("A execução foi interrompida. O progresso já feito ficou salvo.");
    } finally {
      setLive(null);
      void qc.invalidateQueries({ queryKey: ["enrichment-progress"] });
      void qc.invalidateQueries({ queryKey: ["fragrance-status"] });
      void qc.invalidateQueries({ queryKey: ["admin-products"] });
    }
  }

  if (!data) return null;

  const elapsed = live ? Math.max(1, Math.round((Date.now() - live.startedAt) / 1000)) : 0;
  const perMin = live && elapsed > 20 ? Math.round((live.processed / elapsed) * 60) : null;

  const cards: Array<[string, number | string]> = [
    ["Perfumes", data.total],
    ["Identificados", data.verified],
    ["Precisam revisão", data.review + data.candidates],
    ["Não encontrados", data.notFound],
    ["Falhas temporárias", data.temporaryFailure],
    ["Com descrição", data.withDescription],
    ["Sem descrição", data.withoutDescription],
    ["Completos", data.complete],
  ];

  const actions: Array<[Mode, string, number]> = [
    ["not-found", "Reprocessar não encontrados", data.queue.notFound],
    ["partial", "Reprocessar parciais", data.queue.partial],
    ["descriptions", "Gerar descrições faltantes", data.queue.descriptions],
    ["all", "Continuar de onde parou", data.queue.all],
  ];

  return (
    <section className="rounded-2xl border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium text-muted-foreground">Busca e descrições Fragrantica</h2>
        <p className="text-[11px] text-muted-foreground">{data.search.attempts} buscas recentes</p>
      </div>

      {data.alerts.length ? (
        <ul className="mt-3 space-y-1 rounded-xl bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
          {data.alerts.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      ) : null}

      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {cards.map(([label, value]) => (
          <div key={label} className="rounded-xl bg-muted/40 p-3">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="mt-0.5 text-lg font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>

      <p className="mt-3 text-xs text-muted-foreground">
        Acertos na busca {data.search.matchRate}% · reaproveitamento {data.search.cacheHitRate}% · tempo médio por busca{" "}
        {(data.search.avgDurationMs / 1000).toFixed(1)}s
      </p>

      {live ? (
        <div className="mt-4 rounded-xl bg-muted/40 p-3 text-xs">
          <p className="flex items-center gap-2 font-medium">
            <Loader2 className="size-4 animate-spin" /> Em processamento — {live.processed} feitos, {live.remaining} na fila
          </p>
          <p className="mt-1 text-muted-foreground">
            {live.verified} identificados · {live.descriptions} descrições · {live.review} para revisão ·{" "}
            {live.temporaryFailure} falhas temporárias
          </p>
          <p className="mt-1 text-muted-foreground">
            {Math.floor(elapsed / 60)}min {elapsed % 60}s decorridos
            {perMin ? ` · ${perMin} perfumes por minuto` : ""}
            {" · "}
            {live.cacheHits} resolvidos sem nova consulta
          </p>
          <Button variant="outline" className="mt-3 h-10 rounded-xl" onClick={() => (stop.current = true)}>
            <Square className="mr-1.5 size-4" /> Parar após o lote atual
          </Button>
        </div>
      ) : null}

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {actions.map(([mode, label, count]) => (
          <Button
            key={mode}
            variant={mode === "all" ? "default" : "outline"}
            className="h-11 justify-between rounded-xl"
            disabled={!!live || count === 0}
            onClick={() => void start(mode)}
          >
            <span className="truncate">{label}</span>
            <span className="tabular-nums opacity-70">{count}</span>
          </Button>
        ))}
      </div>

      <Button
        variant="ghost"
        className="mt-2 h-10 w-full rounded-xl text-xs"
        disabled={!!live}
        onClick={() => {
          if (window.confirm("Reprocessar todos os perfumes, inclusive os já completos? Pode levar bastante tempo.")) {
            void start("all", true);
          }
        }}
      >
        Reprocessar tudo (com confirmação)
      </Button>

      <p className="mt-2 text-[11px] text-muted-foreground">
        Cada execução continua de onde parou: perfumes completos não são refeitos, falhas de rede voltam para a fila e
        correções manuais nunca são sobrescritas.
      </p>
    </section>
  );
}
