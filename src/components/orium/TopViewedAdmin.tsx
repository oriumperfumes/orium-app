import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ChipGroup } from "@/components/orium/ChipGroup";

const PERIODS = [
  { key: 7, label: "7 dias" },
  { key: 30, label: "30 dias" },
  { key: 90, label: "90 dias" },
  { key: 0, label: "Total" },
];

/** Produtos mais acessados — números visíveis só para owner/admin (validado no banco). */
export function TopViewedAdmin() {
  const [days, setDays] = useState(30);
  const { data, isLoading } = useQuery({
    queryKey: ["admin-top-viewed", days],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_top_viewed", { p_days: days, p_limit: 20 });
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <section className="mt-10">
      <div className="mb-3 flex min-w-0 flex-wrap items-center gap-2">
        <h2 className="min-w-0 text-sm font-medium text-muted-foreground">Produtos mais acessados</h2>
        <ChipGroup
          label="Período"
          wrap
          className="ml-auto"
          value={days}
          onChange={setDays}
          options={PERIODS.map((p) => ({ value: p.key, label: p.label }))}
        />
      </div>


      <div className="overflow-hidden rounded-2xl border bg-card shadow-soft">
        {isLoading ? (
          <p className="p-5 text-sm text-muted-foreground">Carregando…</p>
        ) : !data?.length ? (
          <p className="p-5 text-sm text-muted-foreground">Nenhum acesso registrado nesse período.</p>
        ) : (
          <ul className="divide-y">
            {data.map((r, i) => (
              <li key={r.product_id} className="flex items-center gap-3 px-4 py-3">
                <span className="w-5 shrink-0 text-xs text-muted-foreground tabular-nums">{i + 1}.</span>
                <Link to="/perfume/$slug" params={{ slug: r.slug }} className="min-w-0 flex-1 truncate text-sm">
                  {r.canonical_name}
                  {r.brand ? <span className="text-muted-foreground"> · {r.brand}</span> : null}
                </Link>
                <span className="shrink-0 text-sm font-semibold tabular-nums">
                  {Number(r.views).toLocaleString("pt-BR")}
                  <span className="ml-1 text-xs font-normal text-muted-foreground">acessos</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
