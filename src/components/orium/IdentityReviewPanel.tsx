import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Check, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { brl } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import {
  applyIdentitySuggestion,
  auditCatalogIdentity,
  getIdentityMetrics,
  keepCurrentIdentity,
  normalizeCatalogNames,
  reidentifyCatalog,
} from "@/lib/identity.functions";

/** Revisão de identidade e produtos parecidos — vive dentro da central de Produtos. */
export function IdentityReviewPanel() {
  const qc = useQueryClient();
  const { session } = useAuth();

  const applySuggestion = useServerFn(applyIdentitySuggestion);
  const keepIdentity = useServerFn(keepCurrentIdentity);

  const { data: identity } = useQuery({
    queryKey: ["admin-identity-review"],
    queryFn: async () => {
      const { data } = await supabase
        .from("product_identity_suggestions")
        .select("*")
        .eq("status", "pending")
        .order("confidence", { ascending: false })
        .limit(200);
      return data ?? [];
    },
  });

  const decideIdentity = async (id: string, action: "apply" | "keep") => {
    try {
      if (action === "apply") await applySuggestion({ data: { suggestionId: id } });
      else await keepIdentity({ data: { suggestionId: id } });
      toast.success(action === "apply" ? "Marca e nome atualizados." : "Mantivemos como estava.");
      qc.invalidateQueries({ queryKey: ["admin-identity-review"] });
      qc.invalidateQueries({ queryKey: ["maintenance-data"] });
    } catch {
      toast.error("Não foi possível salvar agora.");
    }
  };

  const { data } = useQuery({
    queryKey: ["admin-review"],
    queryFn: async () => {
      const matches =
        (
          await supabase
            .from("product_matches")
            .select("*")
            .eq("status", "pending")
            .order("match_score", { ascending: false })
        ).data ?? [];
      const ids = matches.flatMap((m) => [m.supplier_product_a, m.supplier_product_b]);
      const offers = ids.length
        ? ((await supabase.from("supplier_products").select("*").in("id", ids)).data ?? [])
        : [];
      const suppliers = (await supabase.from("suppliers").select("id, name")).data ?? [];
      return { matches, offers, suppliers };
    },
  });

  const decide = async (id: string, status: "approved" | "rejected") => {
    const { error } = await supabase
      .from("product_matches")
      .update({ status, reviewed_by: session?.user.id ?? null })
      .eq("id", id);
    if (error) toast.error(error.message);
    else {
      toast.success(status === "approved" ? "Produtos unificados." : "Match descartado.");
      qc.invalidateQueries({ queryKey: ["admin-review"] });
    }
  };

  const offer = (id: string) => data?.offers.find((o) => o.id === id);
  const supplierName = (sid?: string | null) => data?.suppliers.find((s) => s.id === sid)?.name ?? "—";

  return (
    <div className="space-y-6">
      <IdentityAudit />


      <section className="space-y-4">
        <h2 className="text-sm font-semibold">Marca e nome para conferir</h2>
        {(identity ?? []).length === 0 && (
          <p className="rounded-2xl border bg-card p-5 text-sm text-muted-foreground">
            Nenhum perfume esperando conferência de marca.
          </p>
        )}
        {(identity ?? []).map((s) => (
          <div key={s.id} className="rounded-2xl border bg-card p-5 shadow-soft">
            <p className="text-xs text-muted-foreground">
              Confiança {Math.round(Number(s.confidence) * 100)}% · {s.source}
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl bg-muted/50 p-4">
                <p className="text-xs text-muted-foreground">Como está hoje</p>
                <p className="mt-1 text-sm font-medium">{s.current_name}</p>
                <p className="mt-1 text-xs text-muted-foreground">Marca: {s.current_brand ?? "—"}</p>
              </div>
              <div className="rounded-xl bg-muted/50 p-4">
                <p className="text-xs text-muted-foreground">Sugestão</p>
                <p className="mt-1 text-sm font-medium">{s.suggested_name ?? "—"}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Marca: {s.suggested_brand ?? "—"}
                  {s.suggested_flanker ? ` · versão ${s.suggested_flanker}` : ""}
                </p>
              </div>
            </div>
            {s.supplier_title && (
              <p className="mt-3 text-xs text-muted-foreground">Fornecedor enviou: {s.supplier_title}</p>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              <Button size="sm" className="rounded-full" onClick={() => decideIdentity(s.id, "apply")}>
                <Check className="size-4" /> Confirmar sugestão
              </Button>
              <Button size="sm" variant="outline" className="rounded-full" onClick={() => decideIdentity(s.id, "keep")}>
                <X className="size-4" /> Manter como está
              </Button>
              <Button asChild size="sm" variant="ghost" className="rounded-full">
                <Link to="/admin/produtos/$id" params={{ id: s.product_id }}>
                  Escrever eu mesmo
                </Link>
              </Button>
            </div>
          </div>
        ))}
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-semibold">Produtos parecidos entre fornecedores</h2>
        {(data?.matches ?? []).map((m) => {
          const a = offer(m.supplier_product_a);
          const b = offer(m.supplier_product_b);
          return (
            <div key={m.id} className="rounded-2xl border bg-card p-5 shadow-soft">
              <p className="text-xs text-muted-foreground">Semelhança {Math.round(Number(m.match_score) * 100)}%</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {[a, b].map((o, i) => (
                  <div key={i} className="rounded-xl bg-muted/50 p-4">
                    <p className="text-xs text-muted-foreground">{supplierName(o?.supplier_id)}</p>
                    <p className="mt-1 text-sm font-medium">{o?.supplier_product_name}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{brl(o?.price)}</p>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex gap-2">
                <Button size="sm" className="rounded-full" onClick={() => decide(m.id, "approved")}>
                  <Check className="size-4" /> É o mesmo produto
                </Button>
                <Button size="sm" variant="outline" className="rounded-full" onClick={() => decide(m.id, "rejected")}>
                  <X className="size-4" /> São diferentes
                </Button>
              </div>
            </div>
          );
        })}
        {(data?.matches ?? []).length === 0 && (
          <p className="rounded-2xl border bg-card p-5 text-sm text-muted-foreground">
            Nada para comparar no momento.
          </p>
        )}
      </section>
    </div>
  );
}

/** Auditoria geral de identidade: nomes, marcas, apelidos e números do catálogo. */
function IdentityAudit() {
  const qc = useQueryClient();
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<string | null>(null);

  const audit = useServerFn(auditCatalogIdentity);
  const normalize = useServerFn(normalizeCatalogNames);
  const reidentify = useServerFn(reidentifyCatalog);
  const metricsFn = useServerFn(getIdentityMetrics);

  const { data: metrics } = useQuery({
    queryKey: ["identity-metrics"],
    queryFn: () => metricsFn({ data: undefined as never }),
  });

  const run = async () => {
    setRunning(true);
    try {
      const before = await audit({ data: undefined as never });
      setLog("Normalizando nomes, linhas e apelidos…");
      let cursor = 0;
      let renamed = 0;
      let conflicts = 0;
      for (let i = 0; i < 40; i++) {
        const r = await normalize({ data: { cursor } });
        cursor = r.cursor;
        renamed += r.renamed;
        conflicts += r.conflicts;
        setLog(r.message);
        if (r.done) break;
      }
      setLog("Procurando marca dos produtos sem marca…");
      for (let i = 0; i < 30; i++) {
        const r = await reidentify({ data: { cursor: 0 } });
        setLog(r.message);
        if (r.done) break;
      }
      const after = await metricsFn({ data: undefined as never });
      setLog(
        `${before.antes.total} produtos analisados · ${renamed} nomes corrigidos · ${conflicts} conflitos de marca · ` +
          `perfumes sem marca ${before.antes.semMarcaPerfume} → ${after.semMarcaPerfume} · ` +
          `cosméticos sem marca ${before.antes.semMarcaCosmetico} → ${after.semMarcaCosmetico} · ` +
          `${after.aguardandoRevisao} aguardando revisão`,
      );
      toast.success("Auditoria de identidade concluída.");
      qc.invalidateQueries();
    } catch {
      toast.error("Não foi possível concluir a auditoria agora.");
    } finally {
      setRunning(false);
    }
  };

  return (
    <section className="rounded-2xl border bg-card p-5 shadow-soft">
      <h2 className="text-sm font-semibold">Revisar identidades do catálogo</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Corrige nomes, linhas e marcas, cria apelidos de busca e monta a fila de conferência. Produtos confirmados por
        você não são alterados.
      </p>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Metric label="Produtos" value={metrics?.total} />
        <Metric label="Perfumes sem marca" value={metrics?.semMarcaPerfume} />
        <Metric label="Cosméticos sem marca" value={metrics?.semMarcaCosmetico} />
        <Metric label="Aguardando revisão" value={metrics?.aguardandoRevisao} />
        <Metric label="Sugestões abertas" value={metrics?.nomesSuspeitos} />
        <Metric label="Buscas sem resultado" value={metrics?.buscasSemResultado} />
      </div>
      <Button className="press mt-4 h-11 rounded-full px-6" disabled={running} onClick={run}>
        {running ? "Revisando…" : "Revisar identidades do catálogo"}
      </Button>
      {log ? <p className="mt-3 text-xs text-muted-foreground">{log}</p> : null}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="rounded-xl bg-muted/50 p-3">
      <p className="text-lg font-semibold">{value ?? "—"}</p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}
