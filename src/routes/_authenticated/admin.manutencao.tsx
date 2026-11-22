import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ShieldCheck, Tags, PackageSearch } from "lucide-react";
import { AdminShell } from "@/components/orium/AdminShell";
import { BrandsManager } from "@/components/orium/BrandsManager";
import { IntegrityPanel } from "@/components/orium/admin/IntegrityPanel";
import { getEligibilityHealth } from "@/lib/catalog-eligibility.functions";
import { getIdentityHealthV3 } from "@/lib/identity-v3.functions";
import { cn } from "@/lib/utils";

type Tab = "integridade" | "marcas";
type Search = { tab?: Tab | undefined; fila?: string | undefined };

export const Route = createFileRoute("/_authenticated/admin/manutencao")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    tab: s["tab"] === "marcas" ? "marcas" : s["tab"] === "integridade" ? "integridade" : undefined,
    fila: typeof s["fila"] === "string" ? s["fila"] : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Manutenção do catálogo · Admin Orium" },
      { name: "description", content: "Integridade e marcas do catálogo da Orium em uma única central." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Page,
});

function Page() {
  const { tab = "integridade", fila } = Route.useSearch();
  const navigate = useNavigate({ from: "/admin/manutencao" });
  const health = useQuery({ queryKey: ["identity-health"], queryFn: useServerFn(getIdentityHealthV3) });
  const elig = useQuery({ queryKey: ["eligibility-health"], queryFn: useServerFn(getEligibilityHealth) });
  const h = health.data;
  const e = elig.data;

  // Cada fila conta uma vez; nenhum número é somado de duas fontes para o mesmo erro.
  const integrity = h ? (h.duplicates ?? 0) + (h.inconsistencies ?? 0) + (h.unlinked ?? 0) : null;
  const go = (t: Tab, f?: string) => navigate({ search: { tab: t, fila: f }, replace: true });

  const indicators = [
    { label: "Produtos sem marca", value: h?.missingBrand, icon: PackageSearch, onClick: () => go("integridade", "MISSING_BRAND") },
    { label: "Problemas de integridade", value: integrity, icon: ShieldCheck, onClick: () => go("integridade", "POSSIBLE_DUPLICATE_CANONICAL") },
    { label: "Marcas para corrigir", value: e ? (e.unknownBrands ?? 0) : null, icon: Tags, onClick: () => go("marcas") },
  ];

  return (
    <AdminShell title="Manutenção">
      <div className="w-full space-y-5 pb-24">
        <section aria-label="Saúde do catálogo" className="space-y-2">
          <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Saúde do catálogo</h2>
          <div className="grid grid-cols-3 gap-2">
            {indicators.map(({ label, value, icon: Icon, onClick }) => (
              <button
                key={label}
                onClick={onClick}
                className="min-h-[44px] rounded-xl border border-border bg-card p-3 text-left transition-colors duration-[var(--motion-fast)] ease-[var(--ease-orium)] hover:border-primary/50 active:scale-[0.98]"
              >
                <Icon className={cn("size-4", value ? "text-primary" : "text-muted-foreground")} />
                <div className="mt-2 text-xl font-semibold tabular-nums">{value == null ? "…" : value.toLocaleString("pt-BR")}</div>
                <div className="text-[11px] leading-tight text-muted-foreground">{label}</div>
              </button>
            ))}
          </div>
        </section>

        <div role="tablist" className="inline-flex w-full rounded-full border border-border bg-card p-1 sm:w-auto">
          {(["integridade", "marcas"] as const).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => go(t)}
              className={cn(
                "min-h-[40px] flex-1 rounded-full px-5 text-sm font-medium transition-colors duration-[var(--motion-fast)] sm:flex-none",
                tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t === "integridade" ? "Integridade" : "Marcas"}
            </button>
          ))}
        </div>

        <div key={tab + (fila ?? "")} className="animate-in fade-in slide-in-from-bottom-1 duration-200">
          {tab === "integridade" ? <IntegrityPanel initialKind={fila} /> : <BrandsManager />}
        </div>
      </div>
    </AdminShell>
  );
}
