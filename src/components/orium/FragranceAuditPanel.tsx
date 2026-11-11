import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { getFragranceAuditStats, runFragranceAudit } from "@/lib/fragrance.functions";

const LABELS: Record<string, string> = {
  VERIFIED_FRAGRANTICA: "Conferidos na Fragrantica",
  MANUALLY_VERIFIED: "Confirmados pela equipe",
  REVIEW_REQUIRED: "Precisam revisão",
  NOT_FOUND: "Não encontrados",
  PENDING: "Ainda não conferidos",
};

/** Auditoria olfativa: conferência dos perfumes direto na Fragrantica Brasil. */
export function FragranceAuditPanel() {
  const stats = useServerFn(getFragranceAuditStats);
  const runAudit = useServerFn(runFragranceAudit);
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const stopRef = useRef(false);

  const { data, refetch } = useQuery({
    queryKey: ["fragrance-audit-stats"],
    queryFn: () => stats(),
    refetchInterval: running ? 5000 : 30000,
  });

  const go = async (onlyPending: boolean) => {
    setBusy(true);
    try {
      const r = await runAudit({ data: { limit: 10, onlyPending } });
      toast.success(`${r.processed} perfumes conferidos`, {
        description: `${r.verified} confirmados na Fragrantica · ${r.corrected} corrigidos · ${r.review} para revisão`,
      });
      await refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível conferir agora.");
    } finally {
      setBusy(false);
    }
  };

  /** Roda lote após lote até não sobrar nenhum perfume pendente. */
  const runAll = async () => {
    stopRef.current = false;
    setRunning(true);
    let done = 0;
    try {
      for (;;) {
        if (stopRef.current) break;
        const r = await runAudit({ data: { limit: 10, onlyPending: true, retryFailed: false } });
        done += r.processed;
        await refetch();
        if (r.processed === 0 || r.remaining === 0) break;
      }
      if (!stopRef.current) toast.success(`Auditoria concluída · ${done} perfumes processados`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "A auditoria parou. Toque novamente para continuar de onde ficou.");
    } finally {
      setRunning(false);
    }
  };

  if (!data) return null;
  const done = data.counts.VERIFIED_FRAGRANTICA + data.counts.MANUALLY_VERIFIED + data.counts.REVIEW_REQUIRED + data.counts.NOT_FOUND;
  const pending = data.counts.PENDING;
  const pct = data.total ? Math.round((done / data.total) * 100) : 0;

  return (
    <section className="rounded-2xl border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium text-muted-foreground">Auditoria na Fragrantica</h2>
        <p className="text-sm font-semibold tabular-nums">
          {done} / {data.total} processados ({pct}%) · {pending} restantes
        </p>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-foreground/70 transition-[width] duration-500" style={{ width: `${pct}%` }} />
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {Object.entries(LABELS).map(([key, label]) => (
          <div key={key} className="rounded-xl bg-muted/40 p-3">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="mt-0.5 text-lg font-semibold tabular-nums">
              {data.counts[key as keyof typeof data.counts]}
            </dd>
          </div>
        ))}
      </dl>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          onClick={runAll}
          disabled={running || busy || pending === 0}
          className="rounded-full bg-foreground px-4 py-2 text-xs font-medium text-background disabled:opacity-60"
        >
          {running ? `Conferindo… ${done}/${data.total}` : pending === 0 ? "Catálogo todo conferido" : "Conferir catálogo inteiro"}
        </button>
        {running ? (
          <button
            onClick={() => { stopRef.current = true; }}
            className="text-xs font-medium text-muted-foreground underline decoration-dotted hover:text-foreground"
          >
            Pausar
          </button>
        ) : (
          <>
            <button
              onClick={() => go(true)}
              disabled={busy || pending === 0}
              className="text-xs font-medium text-muted-foreground underline decoration-dotted hover:text-foreground disabled:opacity-60"
            >
              {busy ? "Conferindo…" : "Conferir próximos 10"}
            </button>
            <button
              onClick={() => go(false)}
              disabled={busy}
              className="text-xs font-medium text-muted-foreground underline decoration-dotted hover:text-foreground disabled:opacity-60"
            >
              Reconferir 10 já auditados
            </button>
          </>
        )}
      </div>


      {data.log.length ? (
        <div className="mt-4 border-t pt-3">
          <p className="text-xs text-muted-foreground">Últimas conferências</p>
          <ul className="mt-2 space-y-2">
            {data.log.slice(0, 8).map((l, i) => (
              <li key={`${l.product_id}-${i}`} className="text-xs">
                <span className="font-medium">{l.product_name}</span>{" "}
                <span className="text-muted-foreground">
                  · {LABELS[l.status] ?? l.status} · {l.match_confidence}%
                  {l.changed ? ` · ${(l.changes as unknown as string[] | null)?.length ?? 0} ajuste(s)` : " · sem mudanças"}
                </span>
                {l.fragrantica_url ? (
                  <a
                    href={l.fragrantica_url}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-1 break-all text-muted-foreground underline decoration-dotted"
                  >
                    fonte
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
