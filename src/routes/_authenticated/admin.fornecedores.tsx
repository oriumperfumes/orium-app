import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Activity, ExternalLink, Plus, RefreshCw, Search, Unlock } from "lucide-react";
import { AddSupplierDialog } from "@/components/orium/admin/suppliers/AddSupplierDialog";
import { OfferThumb } from "@/components/orium/admin/suppliers/OfferThumb";
import { SupplierManageSheet } from "@/components/orium/admin/suppliers/SupplierManageSheet";
import { OfferComparison } from "@/components/orium/admin/suppliers/OfferComparison";
import { HubSettingsCard } from "@/components/orium/admin/suppliers/HubSettingsCard";
import { AdminActionBar, AdminPrimaryAction, AdminSecondaryAction } from "@/components/orium/admin/AdminUI";
import { Input } from "@/components/ui/input";
import { PRIORITY_LABEL, SUPPLY_MODE_LABEL, type SupplyMode } from "@/lib/supplier-lead";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AdminShell } from "@/components/orium/AdminShell";
import { AdminStatus, AdminTechDetails } from "@/components/orium/admin/AdminUI";
const HUB_TABS = ["Visão geral", "Sincronização", "Comparação"] as const;
import { Button } from "@/components/ui/button";
import { relativeTime, dateBR } from "@/lib/format";
import { syncSupplier, resetSupplierSync, testSupplierConnection } from "@/lib/sync.functions";

export const Route = createFileRoute("/_authenticated/admin/fornecedores")({
  head: () => ({
    meta: [{ title: "Fornecedores — Orium Admin" }, { name: "robots", content: "noindex" }],
  }),
  component: AdminSuppliers,
});

function AdminSuppliers() {
  const qc = useQueryClient();
  const run = useServerFn(syncSupplier);
  const reset = useServerFn(resetSupplierSync);
  const testConnection = useServerFn(testSupplierConnection);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<Record<string, string>>({});
  const [allBusy, setAllBusy] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [health, setHealth] = useState<Record<string, any>>({});
  const [tab, setTab] = useState<(typeof HUB_TABS)[number]>("Visão geral");
  const [adding, setAdding] = useState(false);
  const [managingId, setManagingId] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ["admin-suppliers"],
    queryFn: async () => {
      const [suppliers, runs, offers, categories, events] = await Promise.all([
        supabase.from("suppliers").select("*").order("name"),
        supabase.from("sync_runs").select("*").order("started_at", { ascending: false }).limit(20),
        supabase.from("supplier_products").select("id, supplier_id, price_anomaly, image_url, active"),
        supabase.from("supplier_categories").select("id, supplier_id, name"),
        supabase.from("supplier_sync_events").select("*").order("occurred_at", { ascending: false }).limit(120),
      ]);
      return {
        suppliers: suppliers.data ?? [],
        runs: runs.data ?? [],
        offers: offers.data ?? [],
        categories: categories.data ?? [],
        events: events.data ?? [],
      };
    },
  });

  const sync = async (supplierId: string) => {
    setBusy(supplierId);
    let cursor = 0;
    let totals = { created: 0, updated: 0, unchanged: 0, anomalies: 0 };
    try {
      for (let round = 0; round < 80; round++) {
        const result = await run({ data: { supplierId, cursor } });
        if (result.status === "erro" || result.status === "bloqueado" || result.status === "sem-integracao") {
          toast.warning(result.message ?? "Sincronização não concluída.");
          break;
        }
        totals = {
          created: totals.created + result.created,
          updated: totals.updated + result.updated,
          unchanged: totals.unchanged + result.unchanged,
          anomalies: totals.anomalies + result.anomalies,
        };
        setProgress((p) => ({
          ...p,
          [supplierId]: `${totals.created + totals.updated + totals.unchanged} itens conferidos…`,
        }));
        if (result.nextCursor === null) {
          toast.success(
            `${totals.created} novos · ${totals.updated} atualizados · ${totals.unchanged} sem mudança${
              totals.anomalies ? ` · ${totals.anomalies} preços em revisão` : ""
            }`,
          );
          break;
        }
        cursor = result.nextCursor;
        if (result.throttled) {
          setProgress((p) => ({ ...p, [supplierId]: "A loja pediu para ir mais devagar. Aguardando…" }));
          await new Promise((r) => setTimeout(r, 30_000));
        }
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao sincronizar.");
    } finally {
      setBusy(null);
      setProgress((p) => ({ ...p, [supplierId]: "" }));
      qc.invalidateQueries();
    }
  };

  const test = async (supplierId: string) => {
    setTesting(supplierId);
    try {
      const result = await testConnection({ data: { supplierId } });
      setHealth((current) => ({ ...current, [supplierId]: result }));
      if (result.ok) toast.success(`${result.productsDetected} produtos e ${result.pricesDetected} preços localizados.`);
      else toast.error(`${result.code ?? "FALHA"}: ${result.message}`);
      qc.invalidateQueries({ queryKey: ["admin-suppliers"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao testar a conexão.");
    } finally {
      setTesting(null);
    }
  };

  const unlock = async (supplierId: string) => {
    await reset({ data: { supplierId } });
    toast.success("Bloqueio liberado.");
    qc.invalidateQueries();
  };

  const syncAll = async () => {
    setAllBusy(true);
    try {
      for (const s of data?.suppliers ?? []) {
        if (!s.active) continue;
        await sync(s.id);
      }
    } finally {
      setAllBusy(false);
    }
  };

  const statusLabel = (s: { sync_status: string | null; id: string }) => {
    if (busy === s.id) return "Sincronizando…";
    switch (s.sync_status) {
      case "sincronizando":
        return "Sincronizando…";
      case "ok":
      case "sucesso":
        return "Sincronizado";
      case "parcial":
      case "atencao":
        return "Parcial";
      case "erro":
      case "sem-integracao":
        return "Erro";
      default:
        return "Pronto";
    }
  };

  return (
    <AdminShell title="Fornecedores">
      <div className="mb-5 grid grid-cols-3 gap-1 rounded-full border border-border/60 p-1">
        {HUB_TABS.map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)} className={`h-10 truncate rounded-full px-2 text-xs sm:text-sm ${tab === t ? "bg-primary font-medium text-primary-foreground" : "text-muted-foreground"}`}>{t}</button>
        ))}
      </div>
      <AddSupplierDialog open={adding} onOpenChange={setAdding} onCreated={(id) => setManagingId(id)} />
      <SupplierManageSheet onSync={sync} syncing={!!busy} supplier={(data?.suppliers ?? []).find((s) => s.id === managingId) ?? null} onOpenChange={(v) => !v && setManagingId(null)} />

      {tab === "Visão geral" ? (
        <div className="space-y-4">
          <AdminActionBar
            primary={<AdminPrimaryAction icon={<Plus />} onClick={() => setAdding(true)}>Adicionar fornecedor</AdminPrimaryAction>}
            secondary={<AdminSecondaryAction icon={<RefreshCw className={allBusy ? "animate-spin" : ""} />} disabled={allBusy || busy !== null} onClick={syncAll}>{allBusy ? "Sincronizando todos" : "Sincronizar todos"}</AdminSecondaryAction>}
          />
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {(data?.suppliers ?? []).map((s: any) => (
              <div key={s.id} className="flex min-w-0 flex-col gap-3 rounded-2xl border border-border/60 bg-card p-4 shadow-soft">
                <div className="flex min-w-0 items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{s.name}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {[s.platform === "kyte" ? "Kyte" : null, SUPPLY_MODE_LABEL[s.supply_mode as SupplyMode], [s.city, s.state].filter(Boolean).join("/")].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] ${s.priority === "preferred" ? "border-primary/50 text-primary" : "border-border/60 text-muted-foreground"}`}>{PRIORITY_LABEL[s.priority] ?? s.priority}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {s.auto_sync ? "Sincronização ativa" : "Sincronização pausada"} · {statusLabel(s)} {relativeTime(s.last_successful_sync_at)}
                  {s.last_catalog_size ? ` · ${s.last_catalog_size} produtos` : ""}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <AdminSecondaryAction onClick={() => setManagingId(s.id)}>Gerenciar</AdminSecondaryAction>
                  <AdminSecondaryAction icon={<RefreshCw className={busy === s.id ? "animate-spin" : ""} />} disabled={busy === s.id || allBusy} onClick={() => sync(s.id)}>{busy === s.id ? "Lendo…" : "Sincronizar"}</AdminSecondaryAction>
                </div>
                {busy === s.id && progress[s.id] ? <p className="text-xs text-muted-foreground">{progress[s.id]}</p> : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {tab === "Comparação" ? (<><HubSettingsCard /><ComparisonTab /></>) : null}

      {tab === "Sincronização" ? (<>
      <div className="mb-4 flex justify-end">
        <Button
          className="w-full rounded-full sm:w-auto"
          disabled={allBusy || busy !== null}
          onClick={syncAll}
        >
          <RefreshCw className={allBusy ? "size-4 animate-spin" : "size-4"} />
          {allBusy ? "Sincronizando todos" : "Sincronizar todos"}
        </Button>
      </div>
      <div className="space-y-3">
        {(data?.suppliers ?? []).map((s) => {
          const own = (data?.offers ?? []).filter((o) => o.supplier_id === s.id);
          const flagged = own.filter((o) => o.price_anomaly).length;
          const withImage = own.filter((o) => o.image_url).length;
          const coverage = own.length ? Math.round((withImage / own.length) * 100) : 0;
          const cats = (data?.categories ?? []).filter((c) => c.supplier_id === s.id).length;
          const isKl = s.slug === "kl";
          const runDetails = (data?.runs ?? []).find((r) => r.supplier_id === s.id);
          const stats = s.ingestion_stats as Record<string, any> | null;
          const healthResult = health[s.id] ?? s.last_health_check;
          const events = (data?.events ?? []).filter((e) => e.supplier_id === s.id).slice(0, 30);
          return (
            <div key={s.id} className="rounded-2xl border bg-card p-5 shadow-soft">
              <div className="flex flex-wrap items-start justify-between gap-3">

                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <p className="truncate font-medium">{s.name}</p>
                    <AdminStatus status={statusLabel(s).toLowerCase()} />
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Sincronizado {relativeTime(s.last_successful_sync_at)}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {isKl ? (
                    <Button size="sm" variant="outline" className="rounded-full" disabled={testing === s.id || busy === s.id} onClick={() => test(s.id)}>
                      <Activity className={testing === s.id ? "size-4 animate-pulse" : "size-4"} />
                      {testing === s.id ? "Testando" : "Testar conexão"}
                    </Button>
                  ) : null}
                  {s.sync_locked_at && busy !== s.id ? (
                    <Button size="sm" variant="ghost" className="rounded-full" onClick={() => unlock(s.id)}>
                      <Unlock className="size-4" />
                      Liberar
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    className="rounded-full"
                    disabled={busy === s.id || allBusy}
                    onClick={() => sync(s.id)}
                  >
                    <RefreshCw className={busy === s.id ? "size-4 animate-spin" : "size-4"} />
                    {busy === s.id ? "Sincronizando" : "Sincronizar agora"}
                  </Button>
                </div>
              </div>
              {busy === s.id && progress[s.id] ? (
                <p className="mt-3 text-xs text-muted-foreground">{progress[s.id]}</p>
              ) : null}
              {isKl && healthResult ? (
                <div className="mt-3 grid grid-cols-2 gap-2 rounded-lg border border-border/60 bg-muted/20 p-3 text-xs sm:grid-cols-4">
                  <p><span className="block text-muted-foreground">Fonte</span>{healthResult.sourceAccessible ? "Acessível" : "Indisponível"}</p>
                  <p><span className="block text-muted-foreground">Catálogo</span>{healthResult.catalogDetected ? "Identificado" : "Não identificado"}</p>
                  <p><span className="block text-muted-foreground">Produtos</span>{healthResult.productsDetected ?? 0}</p>
                  <p><span className="block text-muted-foreground">Preços</span>{healthResult.pricesDetected ?? 0}</p>
                  {!healthResult.ok ? <p className="col-span-2 break-words text-destructive sm:col-span-4">{healthResult.code}: {healthResult.message}</p> : null}
                </div>
              ) : null}

              {/* Diagnóstico só quando pedido. */}
              <div className="mt-3">
                <AdminTechDetails label="Ver detalhes">
                  <div className="space-y-1">
                    <p>Última tentativa {relativeTime(s.last_sync_at)}</p>
                    <p>Etapa {s.sync_stage ?? "—"}{s.sync_error_code ? ` · ${s.sync_error_code}` : ""}</p>
                    {s.circuit_open_until && Date.parse(s.circuit_open_until) > Date.now() ? <p className="text-warning">Tentativas automáticas pausadas até {dateBR(s.circuit_open_until)}</p> : null}
                    <p>
                      {own.length} produtos
                      {flagged ? ` · ${flagged} preços em revisão` : ""}
                    </p>
                    <p>
                      Fotos {coverage}% ({own.length - withImage} sem foto)
                      {cats ? ` · ${cats} categorias` : ""}
                    </p>
                    {s.sync_message ? <p>{s.sync_message}</p> : null}
                    {isKl && stats ? (
                      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 border-t border-border/60 pt-3 sm:grid-cols-3">
                        <p>Brutos: {stats["raw"] ?? 0}</p><p>Parseados: {stats["parsed"] ?? 0}</p><p>Únicos: {stats["total"] ?? 0}</p>
                        <p>Associados: {stats["matched"] ?? 0}</p><p>Criados: {stats["created"] ?? 0}</p><p>Revisão: {stats["review"] ?? 0}</p>
                        <p>Ignorados: {stats["ignored"] ?? 0}</p><p>Erros: {stats["errors"] ?? 0}</p><p>Páginas: {stats["pages"] ?? 0}</p>
                      </div>
                    ) : null}
                    {isKl && runDetails ? <p>Execução: {runDetails.raw_products ?? 0} brutos · {runDetails.unique_products ?? 0} únicos · {runDetails.matched_products ?? 0} associados · {runDetails.review_products ?? 0} revisão</p> : null}
                    {runDetails && (runDetails as any).eligible_count != null ? <p>Catálogo: {runDetails.raw_products ?? 0} coletados · {(runDetails as any).eligible_count ?? 0} elegíveis · {(runDetails as any).hidden_segment_count ?? 0} Designer/Nicho fora do catálogo · {(runDetails as any).brand_review_count ?? 0} marca em revisão</p> : null}
                    {isKl && events.length ? (
                      <div className="mt-3 space-y-1 border-t border-border/60 pt-3 font-mono text-[11px]">
                        {events.map((e) => <p key={e.id} className={e.level === "error" ? "break-words text-destructive" : "break-words"}>{new Date(e.occurred_at).toLocaleTimeString("pt-BR")} · {e.stage}{e.code ? ` · ${e.code}` : ""} · {e.message}</p>)}
                      </div>
                    ) : null}
                    {s.website ? (
                      <a
                        href={s.website}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 hover:text-foreground"
                      >
                        {s.website} <ExternalLink className="size-3" />
                      </a>
                    ) : null}
                  </div>
                </AdminTechDetails>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-6 space-y-3">
        <AdminTechDetails label="Diagnóstico dos fornecedores">
          <div className="space-y-4 text-sm text-foreground">
            <SupplierHealth suppliers={(data?.suppliers ?? []).map((s) => ({ id: s.id, name: s.name }))} />
            <NewArrivalsAudit />
          </div>
        </AdminTechDetails>
      </div>

      <h2 className="mt-8 mb-3 text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
        Histórico
      </h2>
      <div className="overflow-hidden rounded-2xl border border-border/60 bg-card">
        {(data?.runs ?? []).map((r) => (
          <div
            key={r.id}
            className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3 text-sm last:border-b-0"
          >
            <span className="text-muted-foreground">
              {data?.suppliers.find((s) => s.id === r.supplier_id)?.name} · {dateBR(r.started_at)}
            </span>
            <span className="text-muted-foreground">
              {r.catalog_incomplete ? "catálogo incompleto" : r.status} · {r.stage ?? "—"}{r.error_code ? ` · ${r.error_code}` : ""} · {r.products_processed} itens ·{" "}
              {r.products_new ?? 0} novos · {r.products_updated ?? 0} atualizados ·{" "}
              {r.products_without_image ?? 0} sem foto · {r.duration_ms ?? 0}ms
            </span>
          </div>
        ))}
        {(data?.runs ?? []).length === 0 && (
          <p className="p-6 text-sm text-muted-foreground">Nenhuma sincronização registrada.</p>
        )}
      </div>
      </>) : null}
    </AdminShell>
  );
}

/**
 * Conferência das NOVIDADES: mostra de onde veio cada chegada — fornecedor,
 * data detectada pela Orium e data informada pelo fornecedor (quando existe).
 */
function NewArrivalsAudit() {
  const { data } = useQuery({
    queryKey: ["admin-new-arrivals"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("new_arrivals_audit", { p_limit: 40 });
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <>
      <h2 className="mt-10 mb-3 text-sm font-medium text-muted-foreground">Novidades detectadas</h2>
      <div className="overflow-hidden rounded-2xl border bg-card shadow-soft">
        {(data ?? []).map((row, i) => (
          <div key={`${row.product_id}-${i}`} className="border-b px-4 py-3 text-sm last:border-b-0">
            <p className="font-medium">
              {row.brand ? `${row.brand} · ` : ""}
              {row.product_name}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {row.supplier_name} · detectado em {dateBR(row.first_seen_at)} ({row.first_seen_source}) ·{" "}
              {row.supplier_added_at ? `informado pelo fornecedor em ${dateBR(row.supplier_added_at)}` : "sem data do fornecedor"}{" "}
              · {row.in_stock ? "disponível" : "indisponível"}
            </p>
          </div>
        ))}
        {(data ?? []).length === 0 && (
          <p className="p-6 text-sm text-muted-foreground">Nenhuma novidade registrada ainda.</p>
        )}
      </div>
    </>
  );
}

/**
 * Saúde da importação por fornecedor: mostra quantos produtos foram coletados
 * e onde eles param — sem vínculo, sem preço, indisponíveis ou fora do catálogo.
 */
function SupplierHealth({ suppliers }: { suppliers: { id: string; name: string }[] }) {
  const { data, isLoading } = useQuery({
    queryKey: ["admin-supplier-health", suppliers.map((s) => s.id).join(",")],
    enabled: suppliers.length > 0,
    queryFn: async () => {
      const rows = [];
      for (const s of suppliers) {
        const base = () => supabase.from("supplier_products").select("id", { count: "exact", head: true }).eq("supplier_id", s.id);
        const [total, unlinked, noPrice, out, notEligible] = await Promise.all([
          base(),
          base().is("product_id", null),
          base().is("price", null),
          base().eq("in_stock", false),
          base().eq("catalog_eligible", false),
        ]);
        rows.push({
          id: s.id,
          name: s.name,
          total: total.count ?? 0,
          unlinked: unlinked.count ?? 0,
          noPrice: noPrice.count ?? 0,
          out: out.count ?? 0,
          notEligible: notEligible.count ?? 0,
        });
      }
      return rows;
    },
  });

  return (
    <>
      <h2 className="mt-10 mb-3 text-sm font-medium text-muted-foreground">Saúde da importação</h2>
      <div className="overflow-hidden rounded-2xl border bg-card shadow-soft">
        {isLoading && <p className="p-6 text-sm text-muted-foreground">Carregando…</p>}
        {(data ?? []).map((r) => (
          <div key={r.id} className="border-b px-4 py-3 text-sm last:border-b-0">
            <p className="font-medium">{r.name}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {r.total} produtos coletados · {r.unlinked} sem vínculo · {r.noPrice} sem preço · {r.out} indisponíveis ·{" "}
              {r.notEligible} fora do catálogo
            </p>
          </div>
        ))}
      </div>
    </>
  );
}

/** Busca um perfume do catálogo e mostra as ofertas de todos os fornecedores. */
function ComparisonTab() {
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const { data } = useQuery({
    queryKey: ["hub-compare-search", q],
    enabled: q.trim().length >= 2,
    queryFn: async () => {
      const { data } = await supabase.from("products").select("id, canonical_name, brand, volume_ml, image_url").ilike("canonical_name", `%${q.trim()}%`).limit(12);
      return data ?? [];
    },
  });
  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="h-11 pl-9" placeholder="Buscar perfume para comparar" value={q} onChange={(e) => { setQ(e.target.value); setPicked(null); }} />
      </div>
      {!picked && data?.length ? (
        <ul className="divide-y divide-border/60 rounded-2xl border border-border/60">
          {data.map((p) => (
            <li key={p.id}><button type="button" className="flex w-full min-w-0 items-center gap-3 px-4 py-2.5 text-left text-sm" onClick={() => setPicked(p.id)}><OfferThumb src={p.image_url} alt={p.canonical_name} size={40} /><span className="min-w-0 truncate">{p.canonical_name}{p.brand ? ` · ${p.brand}` : ""}{p.volume_ml ? ` · ${p.volume_ml}ml` : ""}</span></button></li>
          ))}
        </ul>
      ) : null}
      {picked ? <OfferComparison productId={picked} /> : null}
      <p className="text-xs text-muted-foreground">O mais barato nem sempre é a melhor compra: frete, prazo e disponibilidade confirmada contam. Frete desconhecido aparece como “a consultar”.</p>
    </div>
  );
}
