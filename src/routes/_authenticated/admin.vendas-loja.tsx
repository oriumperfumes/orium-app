/**
 * ADMIN → VENDAS DA LOJA
 *
 * Vendas presenciais: fale com o Copilot, lance do catálogo ou venda uma peça
 * do mostruário da Negociação. Somam na receita, no lucro bruto, no estoque e
 * nos mais vendidos — e nunca entram no funil digital.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, Check, Eye, Gem, Mic, Pencil, Plus, Receipt, ShoppingBag, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AdminShell } from "@/components/orium/AdminShell";
import { AdminConfirm, AdminMore } from "@/components/orium/admin/AdminUI";
import { GoldButton, PanelHeader, PanelTabs, SoftButton } from "@/components/orium/admin/PanelKit";
import { AnimatedNumber } from "@/components/orium/admin/motion";
import { PhotoStack, SidePanel, burst } from "@/components/orium/admin/orders/model";
import { useCopilot } from "@/components/orium/copilot/CopilotPanel";
import { SaleComposer } from "@/components/orium/admin/store-sales/SaleComposer";
import { ShowcaseSale } from "@/components/orium/admin/store-sales/ShowcaseSale";
import { SaleDetailSheet } from "@/components/orium/admin/store-sales/SaleDetailSheet";
import { SaleEditSheet } from "@/components/orium/admin/store-sales/SaleEditSheet";
import { PAYMENT_LABEL, isShowcaseImage } from "@/components/orium/admin/store-sales/parts";
import { brl } from "@/lib/format";
import { cn } from "@/lib/utils";
import { storeSaleDelete, storeSaleList, type StoreSaleListItem } from "@/lib/store-sales.functions";

export const Route = createFileRoute("/_authenticated/admin/vendas-loja")({
  head: () => ({
    meta: [
      { title: "Vendas da loja — Orium Admin" },
      { name: "description", content: "Registro de vendas presenciais da Orium Perfumes, por voz ou manual." },
      { name: "robots", content: "noindex" },
    ],
  }),
  validateSearch: (search: Record<string, unknown>): { registrar?: "voz" | "manual" | "mostruario" } =>
    search["registrar"] === "voz" || search["registrar"] === "manual" || search["registrar"] === "mostruario"
      ? { registrar: search["registrar"] as "voz" | "manual" | "mostruario" }
      : {},
  component: StoreSalesPage,
});

type Filter = "all" | "catalog" | "showcase" | "voice";
type Composer = "manual" | "showcase";

const hour = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

const dayLabel = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return "Hoje";
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Ontem";
  return d.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" });
};

const isShowcase = (s: StoreSaleListItem) => s.items.some((i) => isShowcaseImage(i.image_url));
const live = (s: StoreSaleListItem) => s.status !== "cancelada";

/* ── barras dos últimos 14 dias ─────────────────────────────────── */

function DayBars({ sales }: { sales: StoreSaleListItem[] }) {
  const days = useMemo(() => {
    const totals = new Map<string, number>();
    for (const s of sales) {
      if (!live(s)) continue;
      const k = dayKey(new Date(s.sold_at));
      totals.set(k, (totals.get(k) ?? 0) + Number(s.total));
    }
    const out: Array<{ key: string; label: string; total: number; today: boolean }> = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      out.push({
        key: dayKey(d),
        label: d.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", ""),
        total: totals.get(dayKey(d)) ?? 0,
        today: i === 0,
      });
    }
    return out;
  }, [sales]);
  const max = Math.max(1, ...days.map((d) => d.total));
  return (
    <div className="sale-bars mt-4 flex h-[72px] items-end gap-[5px]" aria-hidden>
      {days.map((d, i) => (
        <span key={d.key} className="group relative flex h-full flex-1 flex-col justify-end" title={`${d.label}: ${brl(d.total)}`}>
          <span
            className={cn("sale-bar block w-full rounded-[6px]", d.today ? "bg-[#FFD599]" : d.total ? "bg-[#3A3A3A] group-hover:bg-[#555]" : "bg-[#232323]")}
            style={{ height: `${Math.max(6, (d.total / max) * 100)}%`, ["--i" as string]: i }}
          />
        </span>
      ))}
    </div>
  );
}

/* ── um cartão de venda ──────────────────────────────────────────── */

function SaleRow({
  sale,
  index,
  onOpen,
  onEdit,
  onDelete,
  leaving,
}: {
  sale: StoreSaleListItem;
  index: number;
  onOpen: (el: HTMLElement) => void;
  onEdit: () => void;
  onDelete: () => void;
  leaving: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const first = sale.items[0];
  const showcase = isShowcase(sale);
  const units = sale.items.reduce((n, i) => n + i.quantity, 0);
  const cancelled = sale.status === "cancelada";
  const title =
    sale.items.length === 1
      ? `${first?.quantity && first.quantity > 1 ? `${first.quantity}× ` : ""}${first?.name ?? "Perfume"}`
      : `${first?.name ?? "Perfume"} + ${sale.items.length - 1}`;
  const kind = first ? (first.variant === "DECANT" ? `Decant ${first.decant_ml}ml` : showcase ? "Peça do mostruário" : "Frasco") : "";

  return (
    <div
      ref={ref}
      className={cn(
        "sale-row pk-in group flex min-w-0 items-center gap-2 rounded-[24px] bg-[#1A1A1A] p-2 pr-2 transition-[background-color,opacity,transform] duration-200 hover:bg-[#1F1F1F]",
        leaving && "pointer-events-none -translate-y-1 scale-[0.97] opacity-0",
        cancelled && "opacity-60",
      )}
      style={{ ["--i" as string]: index }}
    >
      <button type="button" onClick={() => ref.current && onOpen(ref.current)} className="press flex min-w-0 flex-1 items-center gap-3.5 p-1.5 text-left">
        {sale.items.length > 1 ? (
          <span className="w-[60px] shrink-0">
            <PhotoStack images={sale.items.map((i) => i.image_url)} more={0} size={40} />
          </span>
        ) : (
          <span className={cn("relative grid size-[60px] shrink-0 place-items-center overflow-hidden rounded-[18px]", showcase ? "bg-[#232323]" : "bg-white")}>
            {first?.image_url ? (
              <img src={first.image_url} alt="" loading="lazy" className={cn("size-full", showcase ? "object-cover" : "object-contain p-1.5")} />
            ) : (
              <ShoppingBag className="size-5 text-[#8C8C8C]" />
            )}
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5 text-[12.5px] font-medium text-[#8C8C8C]">
            <span className="tabular-nums">{hour(sale.sold_at)}</span>
            <span className="text-[#3A3A3A]">·</span>
            <span className="truncate">{sale.payment_method ? (PAYMENT_LABEL[sale.payment_method] ?? sale.payment_method) : "—"}</span>
            {sale.entry_method === "voice" ? <Mic className="size-3 shrink-0 text-[#FFD599]" strokeWidth={2.4} /> : null}
          </span>
          <span className="mt-0.5 block truncate text-[15.5px] leading-snug font-bold tracking-[-0.01em]">{title}</span>
          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12.5px] text-[#A9A9A9]">
            {showcase ? (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#FFD599]/12 px-2 py-px text-[11.5px] font-bold text-[#FFD599]">
                <Gem className="size-3" /> Mostruário
              </span>
            ) : (
              <span className="truncate">{sale.items.length > 1 ? `${units} itens` : kind}</span>
            )}
            {sale.customer_name ? <span className="truncate">· {sale.customer_name}</span> : null}
            {cancelled ? <span className="shrink-0 font-semibold text-[#FF9A8A]">· Cancelada</span> : null}
          </span>
        </span>
        <span className="shrink-0 text-right">
          <span className={cn("block text-[16px] font-bold tabular-nums", cancelled && "line-through")}>{brl(sale.total)}</span>
          {sale.cost_complete && !cancelled ? (
            <span className="block text-[12px] font-semibold text-[#7FCF9F] tabular-nums">+{brl(sale.gross_profit)}</span>
          ) : null}
        </span>
      </button>
      <AdminMore
        label={`Ações da venda ${sale.sale_number}`}
        actions={[
          { label: "Ver venda", icon: <Eye className="size-4" />, onSelect: () => ref.current && onOpen(ref.current) },
          { label: "Editar venda", icon: <Pencil className="size-4" />, onSelect: onEdit },
          { label: "Excluir venda", icon: <Trash2 className="size-4" />, danger: true, separated: true, onSelect: onDelete },
        ]}
      />
    </div>
  );
}

/* ── sucesso: celebração curta ───────────────────────────────────── */

function SaleSuccess({
  total,
  showcase,
  onAgain,
  onView,
  onClose,
}: {
  total: number;
  showcase: boolean;
  onAgain: () => void;
  onView: () => void;
  onClose: () => void;
}) {
  const ring = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const r = ring.current?.getBoundingClientRect();
    if (r) window.setTimeout(() => burst(r.left + r.width / 2, r.top + r.height / 2, 30), 260);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="admin-theme fixed inset-0 z-[60] grid place-items-center p-5" role="dialog" aria-modal aria-label="Venda registrada">
      <div className="sale-ok-back absolute inset-0 bg-black/75 backdrop-blur-sm" onClick={onClose} />
      <div className="sale-ok relative w-full max-w-[380px] overflow-hidden rounded-[32px] bg-[#141414] p-7 text-center text-white ring-1 ring-white/[0.08]">
        <div className="sale-ok-glow pointer-events-none absolute -top-24 left-1/2 size-64 -translate-x-1/2 rounded-full bg-[#FFD599]/25 blur-3xl" />
        <span ref={ring} className="sale-ok-check relative mx-auto grid size-[76px] place-items-center rounded-full bg-[#FFD599] text-[#15130F]">
          <Check className="size-9" strokeWidth={3} />
        </span>
        <p className="relative mt-5 text-[14px] font-semibold text-[#A9A9A9]">{showcase ? "Peça do mostruário vendida" : "Venda registrada"}</p>
        <p className="relative mt-1 text-[44px] leading-none font-bold tracking-[-0.05em] tabular-nums">
          <AnimatedNumber value={total} format={(n) => brl(n)} duration={900} />
        </p>
        <p className="relative mt-3 text-[14px] leading-snug text-[#8C8C8C]">
          {showcase ? "Entrou no faturamento e saiu da vitrine da Negociação." : "Estoque, faturamento e lucro já foram atualizados."}
        </p>
        <div className="relative mt-6 flex flex-col gap-2">
          <GoldButton icon={<Plus className="size-[18px]" strokeWidth={2.6} />} onClick={onAgain}>
            Registrar outra venda
          </GoldButton>
          <SoftButton icon={<Receipt />} onClick={onView}>
            Ver venda
          </SoftButton>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ── página ──────────────────────────────────────────────────────── */

function StoreSalesPage() {
  const queryClient = useQueryClient();
  const { registrar } = Route.useSearch();
  const [composer, setComposer] = useState<Composer | null>(
    registrar === "manual" ? "manual" : registrar === "mostruario" ? "showcase" : null,
  );
  const [composerOrigin, setComposerOrigin] = useState<HTMLElement | null>(null);
  const copilot = useCopilot();
  const [detail, setDetail] = useState<{ id: string; el: HTMLElement | null } | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<StoreSaleListItem | null>(null);
  const [leavingId, setLeavingId] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ id: string; total: number; showcase: boolean } | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

  const speakToCopilot = () => copilot.listen();

  useEffect(() => {
    if (registrar === "voz") speakToCopilot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const range = useMemo(() => {
    const to = new Date();
    const from = new Date(to);
    from.setDate(from.getDate() - 30);
    return { from: from.toISOString(), to: new Date(to.getTime() + 60_000).toISOString() };
  }, []);

  const { data, isLoading } = useQuery({
    queryKey: ["store-sales", range.from, range.to],
    queryFn: () => storeSaleList({ data: range }),
    staleTime: 30_000,
  });

  const sales = data?.sales ?? [];
  const counts: Record<Filter, number> = {
    all: sales.length,
    catalog: sales.filter((s) => !isShowcase(s)).length,
    showcase: sales.filter(isShowcase).length,
    voice: sales.filter((s) => s.entry_method === "voice").length,
  };
  const shown = useMemo(
    () =>
      sales.filter((s) =>
        filter === "catalog" ? !isShowcase(s) : filter === "showcase" ? isShowcase(s) : filter === "voice" ? s.entry_method === "voice" : true,
      ),
    [sales, filter],
  );

  const groups = useMemo(() => {
    const out = new Map<string, StoreSaleListItem[]>();
    for (const sale of shown) {
      const key = dayLabel(sale.sold_at);
      const list = out.get(key) ?? [];
      list.push(sale);
      out.set(key, list);
    }
    return Array.from(out.entries());
  }, [shown]);

  const ticket = data && data.period.count ? data.period.total / data.period.count : 0;
  const margin = data && data.period.total ? Math.round((data.period.profit / data.period.total) * 100) : 0;
  const yesterdayTotal = useMemo(() => {
    const y = new Date();
    y.setDate(y.getDate() - 1);
    return sales.filter((s) => live(s) && new Date(s.sold_at).toDateString() === y.toDateString()).reduce((n, s) => n + Number(s.total), 0);
  }, [sales]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["store-sales"] });
    void queryClient.invalidateQueries({ queryKey: ["admin-dashboard"] });
  };

  const afterSave = (saleId: string, total: number) => {
    const showcase = composer === "showcase";
    setComposer(null);
    window.setTimeout(() => setSuccess({ id: saleId, total, showcase }), 380);
    refresh();
    if (showcase) {
      void queryClient.invalidateQueries({ queryKey: ["negotiation-admin"] });
      void queryClient.invalidateQueries({ queryKey: ["negotiation-public"] });
    }
  };

  const afterEdit = (saleId: string) => {
    setEditId(null);
    toast.success("Alterações salvas", { description: "Estoque e financeiro foram reconciliados." });
    refresh();
    void queryClient.invalidateQueries({ queryKey: ["store-sale-detail", saleId] });
  };

  const remove = useMutation({
    mutationFn: (saleId: string) => storeSaleDelete({ data: { id: saleId } }),
    onSuccess: (_res, saleId) => {
      toast.success("Venda excluída", { description: "Estoque e financeiro foram revertidos." });
      setDeleting(null);
      setLeavingId(saleId);
      window.setTimeout(() => {
        setLeavingId(null);
        refresh();
      }, 220);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não consegui excluir a venda."),
  });

  const open = (kind: Composer, el?: HTMLElement | null) => {
    setComposerOrigin(el ?? null);
    setComposer(kind);
  };

  const launches = [
    {
      key: "voice" as const,
      title: "Falar a venda",
      hint: "Diga o que vendeu. O Copilot monta, você confirma.",
      icon: <Mic className="size-[22px]" strokeWidth={2.2} />,
      onClick: () => speakToCopilot(),
    },
    {
      key: "manual" as const,
      title: "Do catálogo",
      hint: "Frascos e decants, com o preço de hoje.",
      icon: <ShoppingBag className="size-[22px]" strokeWidth={2.2} />,
      onClick: (el: HTMLElement) => open("manual", el),
    },
    {
      key: "showcase" as const,
      title: "Peça do mostruário",
      hint: "Vendeu uma peça da Negociação? Diga por quanto.",
      icon: <Gem className="size-[22px]" strokeWidth={2.2} />,
      onClick: (el: HTMLElement) => open("showcase", el),
      badge: "Novo",
    },
  ];

  return (
    <AdminShell
      title="Vendas da loja"
      description="O que saiu do balcão: fale, escolha do catálogo ou venda uma peça do mostruário."
      action={
        <GoldButton icon={<Plus className="size-[18px]" strokeWidth={2.6} />} className="h-12" onClick={(e) => open("manual", e.currentTarget)}>
          Nova venda
        </GoldButton>
      }
    >
      {/* 1 · números */}
      <section className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4" aria-label="Resumo">
        <div className="dash-hero adm-rise col-span-2 flex min-h-[176px] flex-col p-5 lg:row-span-2 lg:min-h-0" style={{ ["--i" as string]: 0 }}>
          <div className="flex items-start justify-between gap-2">
            <span className="text-[15px] font-semibold opacity-75">Vendido hoje</span>
            <span className="dash-ico">
              <Receipt className="size-[18px]" strokeWidth={2.2} />
            </span>
          </div>
          <p className="mt-auto pt-6 text-[46px] leading-none font-bold tracking-[-0.05em] tabular-nums lg:text-[56px]">
            {isLoading ? "—" : <AnimatedNumber value={data?.today.total ?? 0} format={(n) => brl(n)} />}
          </p>
          <p className="mt-2 flex flex-wrap items-center gap-x-3 text-[14px] font-semibold opacity-70">
            <span>
              {data?.today.count ?? 0} {(data?.today.count ?? 0) === 1 ? "venda" : "vendas"}
            </span>
            {data && data.today.profit > 0 ? <span>lucro {brl(data.today.profit)}</span> : null}
            {data && yesterdayTotal > 0 ? (
              <span className="inline-flex items-center gap-0.5">
                <ArrowUpRight className={cn("size-4", (data.today.total ?? 0) < yesterdayTotal && "rotate-90")} />
                ontem {brl(yesterdayTotal)}
              </span>
            ) : null}
          </p>
        </div>

        <div className="dash-card adm-rise col-span-2 flex flex-col p-5" style={{ ["--i" as string]: 1 }}>
          <div className="flex items-start justify-between gap-2">
            <span className="text-[15px] text-[#A9A9A9]">Últimos 30 dias</span>
            <span className="text-[13px] font-semibold text-[#8C8C8C] tabular-nums">{data?.period.count ?? 0} vendas</span>
          </div>
          <p className="mt-2 text-[30px] leading-none font-bold tracking-[-0.045em] tabular-nums">
            {isLoading ? "—" : <AnimatedNumber value={data?.period.total ?? 0} format={(n) => brl(n)} />}
          </p>
          <DayBars sales={sales} />
        </div>

        <div className="dash-card adm-rise flex min-h-[112px] flex-col p-5" style={{ ["--i" as string]: 2 }}>
          <span className="text-[14px] text-[#A9A9A9]">Lucro bruto</span>
          <span className="mt-auto truncate text-[24px] leading-none font-bold tracking-[-0.04em] text-[#7FCF9F] tabular-nums">
            {isLoading ? "—" : <AnimatedNumber value={data?.period.profit ?? 0} format={(n) => brl(n)} />}
          </span>
          <span className="mt-1 text-[12.5px] font-semibold text-[#8C8C8C]">margem {margin}%</span>
        </div>
        <div className="dash-card adm-rise flex min-h-[112px] flex-col p-5" style={{ ["--i" as string]: 3 }}>
          <span className="text-[14px] text-[#A9A9A9]">Ticket médio</span>
          <span className="mt-auto truncate text-[24px] leading-none font-bold tracking-[-0.04em] tabular-nums">
            {isLoading ? "—" : <AnimatedNumber value={ticket} format={(n) => brl(n)} />}
          </span>
          <span className="mt-1 text-[12.5px] font-semibold text-[#8C8C8C]">por venda</span>
        </div>
      </section>

      {/* 2 · como foi a venda */}
      <section className="mt-8" aria-label="Registrar venda">
        <h2 className="text-[20px] font-bold tracking-[-0.02em]">Registrar venda</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-3 lg:gap-4">
          {launches.map((l, i) => (
            <button
              key={l.key}
              type="button"
              onClick={(e) => l.onClick(e.currentTarget)}
              className={cn(
                "sale-launch adm-rise press group relative flex min-w-0 items-center gap-4 overflow-hidden rounded-[26px] p-4 text-left sm:flex-col sm:items-start sm:p-5",
                l.key === "voice" ? "sale-launch-voice bg-white text-[#15130F]" : "bg-[#1A1A1A] hover:bg-[#202020]",
              )}
              style={{ ["--i" as string]: i + 4 }}
            >
              <span
                className={cn(
                  "relative grid size-12 shrink-0 place-items-center rounded-full transition-transform duration-300 ease-[var(--ease-orium)] group-hover:scale-110",
                  l.key === "voice" ? "bg-[#15130F] text-[#FFD599]" : l.key === "showcase" ? "bg-[#FFD599] text-[#15130F]" : "bg-[#2A2A2A] text-white",
                )}
              >
                {l.key === "voice" ? <span className="sale-launch-pulse absolute inset-0 rounded-full" aria-hidden /> : null}
                {l.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-[16.5px] font-bold tracking-[-0.015em]">
                  {l.title}
                  {l.badge ? <span className="rounded-full bg-[#FFD599] px-2 py-px text-[10.5px] font-bold tracking-wide text-[#15130F] uppercase">{l.badge}</span> : null}
                </span>
                <span className={cn("mt-0.5 block text-[13.5px] leading-snug", l.key === "voice" ? "text-[#15130F]/65" : "text-[#8C8C8C]")}>{l.hint}</span>
              </span>
            </button>
          ))}
        </div>
      </section>

      {/* 3 · histórico */}
      <section className="mt-8" aria-label="Vendas">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-[20px] font-bold tracking-[-0.02em]">Vendas</h2>
        </div>
        <PanelTabs
          className="mt-3"
          value={filter}
          onChange={setFilter}
          tabs={[
            { key: "all", label: "Todas", badge: <TabCount n={counts.all} on={filter === "all"} /> },
            { key: "catalog", label: "Catálogo", badge: <TabCount n={counts.catalog} on={filter === "catalog"} /> },
            { key: "showcase", label: "Mostruário", badge: <TabCount n={counts.showcase} on={filter === "showcase"} /> },
            { key: "voice", label: "Por voz", badge: <TabCount n={counts.voice} on={filter === "voice"} /> },
          ]}
        />

        <div key={filter} className="mt-5 space-y-7">
          {isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="admin-skeleton h-[84px] rounded-[24px]" />
              ))}
            </div>
          ) : groups.length === 0 ? (
            <div className="flex flex-col items-center rounded-[28px] bg-[#1A1A1A] px-6 py-14 text-center">
              <span className="grid size-14 place-items-center rounded-full bg-[#232323] text-[#FFD599]">
                {filter === "showcase" ? <Gem className="size-6" /> : <Receipt className="size-6" />}
              </span>
              <p className="mt-4 text-[18px] font-bold">{filter === "all" ? "Nenhuma venda nos últimos 30 dias" : "Nada com esse filtro"}</p>
              <p className="mt-1 max-w-[320px] text-[14.5px] text-[#8C8C8C]">
                {filter === "showcase" ? "Quando vender uma peça da Negociação, registre aqui e ela entra no faturamento." : "Registre a primeira venda falando ou escolhendo do catálogo."}
              </p>
              <GoldButton className="mt-5 h-12" icon={<Plus className="size-[18px]" strokeWidth={2.6} />} onClick={(e) => open(filter === "showcase" ? "showcase" : "manual", e.currentTarget)}>
                {filter === "showcase" ? "Vender peça do mostruário" : "Nova venda"}
              </GoldButton>
            </div>
          ) : (
            groups.map(([label, list]) => {
              const dayTotal = list.filter(live).reduce((n, s) => n + Number(s.total), 0);
              return (
                <div key={label} className="min-w-0">
                  <div className="mb-2.5 flex items-baseline justify-between gap-3 px-1">
                    <h3 className="text-[15px] font-bold first-letter:uppercase">{label}</h3>
                    <span className="text-[13.5px] font-semibold text-[#8C8C8C] tabular-nums">
                      {list.length} · {brl(dayTotal)}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {list.map((sale, i) => (
                      <SaleRow
                        key={sale.id}
                        sale={sale}
                        index={i}
                        leaving={leavingId === sale.id}
                        onOpen={(el) => setDetail({ id: sale.id, el })}
                        onEdit={() => setEditId(sale.id)}
                        onDelete={() => setDeleting(sale)}
                      />
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>

      {/* janelas */}
      <SidePanel open={composer === "manual"} onClose={() => setComposer(null)} label="Nova venda" originEl={composerOrigin}>
        <PanelHeader image={null} fallback={<ShoppingBag className="size-5" />} title="Nova venda" subtitle="Do catálogo · frascos e decants" onClose={() => setComposer(null)} />
        <SaleComposer mode="manual" onClose={() => setComposer(null)} onSaved={afterSave} />
      </SidePanel>

      <SidePanel open={composer === "showcase"} onClose={() => setComposer(null)} label="Venda do mostruário" originEl={composerOrigin}>
        <PanelHeader
          image={null}
          fallback={<Gem className="size-5 text-[#FFD599]" />}
          title="Peça do mostruário"
          subtitle="Vendi uma peça da Negociação"
          onClose={() => setComposer(null)}
        />
        <ShowcaseSale onClose={() => setComposer(null)} onSaved={afterSave} />
      </SidePanel>

      {success ? (
        <SaleSuccess
          total={success.total}
          showcase={success.showcase}
          onClose={() => setSuccess(null)}
          onAgain={() => {
            const kind = success.showcase ? "showcase" : "manual";
            setSuccess(null);
            open(kind);
          }}
          onView={() => {
            const id = success.id;
            setSuccess(null);
            setDetail({ id, el: null });
          }}
        />
      ) : null}

      <SaleDetailSheet
        id={detail?.id ?? null}
        originEl={detail?.el ?? null}
        onClose={() => setDetail(null)}
        onEdit={(saleId) => {
          setDetail(null);
          window.setTimeout(() => setEditId(saleId), 260);
        }}
        onDeleted={(saleId) => {
          setLeavingId(saleId);
          window.setTimeout(() => setLeavingId(null), 220);
        }}
      />

      <SaleEditSheet id={editId} onClose={() => setEditId(null)} onSaved={afterEdit} />

      <AdminConfirm
        open={!!deleting}
        onOpenChange={(o) => {
          if (!o) setDeleting(null);
        }}
        title="Excluir esta venda?"
        description={
          deleting
            ? `O estoque volta como estava, receita e lucro são recalculados e a venda sai dos relatórios. Venda ${deleting.sale_number} · ${brl(deleting.total)}.`
            : ""
        }
        confirmLabel="Excluir venda"
        danger
        onConfirm={() => {
          if (deleting && !remove.isPending) remove.mutate(deleting.id);
        }}
      />
    </AdminShell>
  );
}

function TabCount({ n, on }: { n: number; on: boolean }) {
  if (!n) return null;
  return <span className={cn("rounded-full px-1.5 text-[11.5px] font-bold tabular-nums", on ? "bg-[#15130F] text-[#FFD599]" : "bg-[#2A2A2A] text-[#A9A9A9]")}>{n}</span>;
}
