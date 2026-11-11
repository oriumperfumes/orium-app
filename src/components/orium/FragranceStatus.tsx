import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/** Resumo do enriquecimento olfativo do catálogo (somente leitura). */
export function FragranceStatus() {
  const { data } = useQuery({
    queryKey: ["fragrance-status"],
    refetchInterval: 20000,
    queryFn: async () => {
      const [perfumes, details] = await Promise.all([
        supabase
          .from("products")
          .select("id")
          .eq("product_type", "PERFUME")
          .eq("active", true),
        supabase.from("fragrance_details").select("product_id, status, locked"),
      ]);
      const ids = new Set((perfumes.data ?? []).map((p) => p.id));
      const rows = (details.data ?? []).filter((d) => ids.has(d.product_id));
      const by = (s: string) => rows.filter((r) => r.status === s).length;
      const completos = by("completo");
      return {
        total: ids.size,
        completos,
        parciais: by("parcial"),
        revisar: by("revisar") + by("nao_encontrado"),
        sem: Math.max(0, ids.size - rows.length),
        confirmados: rows.filter((r) => r.locked).length,
        pct: ids.size ? Math.round((completos / ids.size) * 100) : 0,
      };
    },
  });

  if (!data) return null;

  const cards: Array<[string, number | string]> = [
    ["Perfumes no catálogo", data.total],
    ["Com dados completos", data.completos],
    ["Parciais", data.parciais],
    ["Sem dados ainda", data.sem],
    ["Precisam revisão", data.revisar],
    ["Confirmados pela equipe", data.confirmados],
  ];

  return (
    <section className="rounded-2xl border bg-card p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">Informações olfativas</h2>
        <p className="text-sm font-semibold tabular-nums">
          {data.completos} / {data.total} perfumes prontos ({data.pct}%)
        </p>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-foreground/70 transition-[width] duration-500"
          style={{ width: `${data.pct}%` }}
        />
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {cards.map(([label, value]) => (
          <div key={label} className="rounded-xl bg-muted/40 p-3">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="mt-0.5 text-lg font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
