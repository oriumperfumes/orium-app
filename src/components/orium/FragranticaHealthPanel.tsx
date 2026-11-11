import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getFragranticaImportHealth, reprocessFragranticaV2 } from "@/lib/fragrance.functions";

type Scope = "partial" | "accords-without-pyramid" | "all";

/** Painel "Saúde da importação Fragrantica" com métricas reais e reprocessamento. */
export function FragranticaHealthPanel() {
  const health = useServerFn(getFragranticaImportHealth);
  const reprocess = useServerFn(reprocessFragranticaV2);
  const qc = useQueryClient();
  const [running, setRunning] = useState<Scope | null>(null);

  const { data } = useQuery({
    queryKey: ["fragrantica-health"],
    queryFn: () => health(),
    refetchInterval: 30000,
  });

  const run = useMutation({
    mutationFn: async (scope: Scope) => {
      setRunning(scope);
      return reprocess({ data: { scope, limit: 5 } });
    },
    onSuccess: (r) => {
      toast.success(
        r.processed
          ? `${r.processed} perfumes reprocessados · ${r.remaining} na fila.`
          : "Nenhum perfume elegível encontrado (é preciso ter link do Fragrantica salvo).",
      );
      void qc.invalidateQueries({ queryKey: ["fragrantica-health"] });
      void qc.invalidateQueries({ queryKey: ["fragrance-status"] });
    },
    onError: () => toast.error("Não foi possível reprocessar agora. Tente novamente."),
    onSettled: () => setRunning(null),
  });

  if (!data) return null;

  const c = data.catalog;
  const r = data.recent;
  const cards: Array<[string, number | string]> = [
    ["Perfumes", c.perfumes],
    ["Com acordes", c.withAccords],
    ["Com pirâmide", c.withPyramid],
    ["Acordes sem pirâmide", c.accordsWithoutPyramid],
    ["Sem nenhum dado", c.withoutAnything],
    ["Lidos pelo leitor atual", c.currentParser],
  ];

  return (
    <section className="rounded-2xl border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium text-muted-foreground">Saúde da importação Fragrantica</h2>
        <p className="text-[11px] text-muted-foreground">leitor {data.parserVersion}</p>
      </div>

      {data.alerts.length ? (
        <ul className="mt-3 space-y-1 rounded-xl bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
          {data.alerts.map((a) => (
            <li key={a} className="break-words">
              {a}
            </li>
          ))}
        </ul>
      ) : null}

      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {cards.map(([label, value]) => (
          <div key={label} className="rounded-xl bg-muted/40 p-3">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="mt-0.5 text-lg font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-4 space-y-1 text-xs text-muted-foreground">
        <p>
          Últimas {r.total} leituras: {r.complete} completas · {r.partial} parciais · {r.reviewRequired} para revisão ·{" "}
          {r.failed} sem leitura · {r.blocked} bloqueadas
        </p>
        <p>
          Completude média {r.avgCompleteness}% · pirâmide em {r.pyramidRate}% das páginas · tempo médio{" "}
          {(r.avgDurationMs / 1000).toFixed(1)}s
        </p>
        {r.byStrategy.length ? (
          <p className="break-words">
            Caminhos usados: {r.byStrategy.map((s) => `${s.strategy} (${s.count})`).join(" · ")}
          </p>
        ) : null}
        {r.topIssues.length ? (
          <ul className="space-y-0.5">
            {r.topIssues.map((i) => (
              <li key={i.issue} className="break-words">
                {i.count}× {i.issue}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        {([
          ["accords-without-pyramid", "Reprocessar acordes sem pirâmide"],
          ["partial", "Reprocessar parciais"],
          ["all", "Reimportação completa (V2)"],
        ] as Array<[Scope, string]>).map(([scope, label]) => (
          <Button
            key={scope}
            variant={scope === "all" ? "default" : "outline"}
            className="h-11 flex-1 rounded-xl"
            disabled={!!running}
            onClick={() => run.mutate(scope)}
          >
            <RefreshCw className={`mr-1.5 size-4 ${running === scope ? "animate-spin" : ""}`} />
            {label}
          </Button>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Cada rodada processa 5 perfumes com pausa entre leituras, para respeitar o limite da fonte. Perfumes confirmados
        manualmente nunca são alterados.
      </p>
    </section>
  );
}
