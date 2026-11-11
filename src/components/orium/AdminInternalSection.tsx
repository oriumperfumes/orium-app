import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronRight } from "lucide-react";
import { getAdminCatalogInsight } from "@/lib/admin-insight.functions";
import { AdminInsightSheet, ProfitBar } from "@/components/orium/AdminCatalogChip";
import { useAuth } from "@/lib/auth";
import { useAdminInsightView } from "@/lib/use-admin-insight-view";
import { brl } from "@/lib/format";

/**
 * Informações internas na página do perfume. O backend confere a role antes de
 * devolver custo/fornecedor/margem — cliente comum nunca recebe esses dados e
 * a seção simplesmente não existe para ele.
 */
export function AdminInternalSection({ productId, name }: { productId: string; name: string }) {
  const { isStaff: staff } = useAuth();
  const { visible } = useAdminInsightView();
  const isStaff = staff && visible;
  const load = useServerFn(getAdminCatalogInsight);
  const [open, setOpen] = useState(false);

  const { data } = useQuery({
    queryKey: ["admin-insight-one", productId],
    enabled: isStaff && !!productId,
    staleTime: 60_000,
    retry: false,
    queryFn: () => load({ data: { productIds: [productId] } }).catch(() => []),
  });

  const insight = data?.[0] ?? null;
  if (!isStaff || !insight) return null;

  const loss = insight.margin != null && insight.margin < 0;

  return (
    <section className="mt-6">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Ver custos e fornecedores"
        className="press block w-full rounded-[22px] border border-white/[0.07] bg-[#171717] p-5 text-left"
      >
        <span className="flex items-center justify-between">
          <span className="text-[12px] font-semibold text-[#8C8C8C]">Só a equipe vê</span>
          <span className="inline-flex items-center gap-0.5 text-[13px] font-bold text-[#FFD599]">
            Detalhes <ChevronRight className="size-4" strokeWidth={2.4} />
          </span>
        </span>
        <span className="mt-3 block text-[13px] text-[#A9A9A9]">Lucro por frasco</span>
        <span
          className={`block text-[32px] leading-tight font-bold tracking-[-0.03em] tabular-nums ${loss ? "text-[#FF9A8A]" : "text-[#FFD599]"}`}
        >
          {insight.margin != null ? `${loss ? "–" : "+"}${brl(Math.abs(insight.margin))}` : "—"}
        </span>
        <ProfitBar insight={insight} />
        <span className="mt-4 flex items-center justify-between border-t border-white/[0.06] pt-3.5 text-[13px]">
          <span className="text-[#8C8C8C]">Fornecedor</span>
          <span className="min-w-0 truncate pl-3 font-semibold text-white">
            {insight.bestSupplier ?? "Sem oferta"}
            {insight.offers.length > 1 ? <span className="font-normal text-[#8C8C8C]"> +{insight.offers.length - 1}</span> : null}
          </span>
        </span>
      </button>
      <AdminInsightSheet insight={insight} name={name} open={open} onOpenChange={setOpen} />
    </section>
  );
}
