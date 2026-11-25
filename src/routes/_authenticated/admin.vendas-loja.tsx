/**
 * ADMIN → VENDAS
 *
 * Um só lugar para tudo o que a loja vendeu: pedidos do site, do WhatsApp e
 * encomendas (Pedidos), balcão — frascos e decants, por voz ou catálogo — e
 * peças da Negociação. A lista vem do banco (`sales_ledger`, só leitura);
 * cada venda continua sendo gravada e editada no lugar dela:
 *   • balcão → store_sale_commit (aqui mesmo: falar, catálogo, mostruário)
 *   • WhatsApp/encomenda → Novo pedido (abre aqui, grava em Pedidos)
 *   • Negociação → painel da peça (Admin → Negociação, cartão "Venda e pagamento")
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronRight,
  Eye,
  Gem,
  Globe,
  MessageCircle,
  Mic,
  NotebookPen,
  Pencil,
  Plus,
  Receipt,
  ShoppingBag,
  Store,
  Trash2,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { AdminShell } from "@/components/orium/AdminShell";
import { AdminConfirm, AdminMore } from "@/components/orium/admin/AdminUI";
import { GoldButton, PanelHeader, PanelTabs, SoftButton } from "@/components/orium/admin/PanelKit";
import { AnimatedNumber } from "@/components/orium/admin/motion";
import { PhotoStack, SidePanel, burst } from "@/components/orium/admin/orders/model";
import { OrderComposer } from "@/components/orium/admin/orders/OrderComposer";
import { useCopilot } from "@/components/orium/copilot/CopilotPanel";
import { SaleComposer } from "@/components/orium/admin/store-sales/SaleComposer";
import { ShowcaseSale } from "@/components/orium/admin/store-sales/ShowcaseSale";
import { SaleDetailSheet } from "@/components/orium/admin/store-sales/SaleDetailSheet";
import { SaleEditSheet } from "@/components/orium/admin/store-sales/SaleEditSheet";
import { brl } from "@/lib/format";
import { cn } from "@/lib/utils";
import { negotiationPhoto } from "@/lib/negotiation";
import { storeSaleDelete } from "@/lib/store-sales.functions";
import { salesLedger } from "@/lib/sales-ledger.functions";
import {
  CHANNEL,
  dailyTotals,
  groupByDay,
  matches,
  payLabel,
  payState,
  saleKind,
  saleTitle,
  summarize,
  type LedgerChannel,
  type LedgerFilter,
  type LedgerSale,
  type UnregisteredPiece,
} from "@/lib/sales-ledger";

type Registrar = "voz" | "manual" | "mostruario" | "pedido";
const REGISTRAR: Registrar[] = ["voz", "manual", "mostruario", "pedido"];

export const Route = createFileRoute("/_authenticated/admin/vendas-loja")({
  head: () => ({
    meta: [
      { title: "Vendas — Orium Admin" },
      {
        name: "description",
        content:
          "Todas as vendas da Orium Perfumes num só lugar: site, WhatsApp, balcão e Negociação.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  validateSearch: (search: Record<string, unknown>): { registrar?: Registrar } =>
    REGISTRAR.includes(search["registrar"] as Registrar)
      ? { registrar: search["registrar"] as Registrar }
      : {},
  component: SalesPage,
});

type Composer = "manual" | "showcase" | "order";
const PERIODS = [
  { key: 7, label: "7 dias" },
  { key: 30, label: "30 dias" },
  { key: 90, label: "90 dias" },
] as const;
type Period = (typeof PERIODS)[number]["key"];

const CHANNEL_ICON: Record<LedgerChannel, ReactNode> = {
  balcao: <Store className="size-3.5" />,
  whatsapp: <MessageCircle className="size-3.5" />,
  site: <Globe className="size-3.5" />,
  manual: <NotebookPen className="size-3.5" />,
  negociacao: <Gem className="size-3.5" />,
};

const hour = (iso: string) =>
  new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

/** Foto de um item, venha de onde vier (a Negociação guarda só o caminho). */
const photoOf = (s: LedgerSale, url: string | null) =>
  s.source === "negotiation" ? negotiationPhoto(url, "card") : url;
const isPiece = (s: LedgerSale) => s.channel === "negociacao";

/* ── barras do período ──────────────────────────────────────────── */

function DayBars({ sales, days }: { sales: LedgerSale[]; days: number }) {
  const bars = useMemo(() => dailyTotals(sales, Math.min(days, 30)), [sales, days]);
  const max = Math.max(1, ...bars.map((d) => d.total));
  return (
    <div className="sale-bars mt-4 flex h-[72px] items-end gap-[4px]" aria-hidden>
      {bars.map((d, i) => (
        <span
          key={d.start}
          className="group relative flex h-full flex-1 flex-col justify-end"
          title={`${new Date(d.start).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit" })}: ${brl(d.total)}`}
        >
          <span
            className={cn(
              "sale-bar block w-full rounded-[5px]",
              d.today
                ? "bg-[#FFD599]"
                : d.total
                  ? "bg-[#3A3A3A] group-hover:bg-[#555]"
                  : "bg-[#232323]",
            )}
            style={{ height: `${Math.max(6, (d.total / max) * 100)}%`, ["--i" as string]: i }}
          />
        </span>
      ))}
    </div>
  );
}

/* ── uma linha do livro ─────────────────────────────────────────── */

const TONE = {
  ok: "text-[#7FCF9F]",
  gold: "text-[#FFD599]",
  coral: "text-[#FF9A8A]",
  off: "text-[#8C8C8C]",
} as const;

function LedgerRow({
  sale,
  index,
  leaving,
  onOpen,
  onEdit,
  onDelete,
}: {
  sale: LedgerSale;
  index: number;
  leaving: boolean;
  onOpen: (el: HTMLElement) => void;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const first = sale.items[0];
  const img = photoOf(sale, first?.image_url ?? null);
  const pay = payState(sale);
  const method = payLabel(sale.payment_method);
  const open = () => ref.current && onOpen(ref.current);
  const where =
    sale.source === "order"
      ? "Abrir pedido"
      : sale.source === "negotiation"
        ? "Abrir na Negociação"
        : "Ver venda";

  return (
    <div
      ref={ref}
      className={cn(
        "sale-row pk-in group flex min-w-0 items-center gap-2 rounded-[24px] bg-[#1A1A1A] p-2 transition-[background-color,opacity,transform] duration-200 hover:bg-[#1F1F1F]",
        leaving && "pointer-events-none -translate-y-1 scale-[0.97] opacity-0",
        !sale.counted && "opacity-70",
      )}
      style={{ ["--i" as string]: index }}
    >
      <button
        type="button"
        onClick={open}
        className="press flex min-w-0 flex-1 items-center gap-3.5 p-1.5 text-left"
        aria-label={`${saleTitle(sale)}, ${brl(sale.total)}, ${CHANNEL[sale.channel].label}`}
      >
        {sale.items.length > 1 ? (
          <span className="w-[60px] shrink-0">
            <PhotoStack
              images={sale.items.map((i) => photoOf(sale, i.image_url))}
              more={0}
              size={40}
            />
          </span>
        ) : (
          <span
            className={cn(
              "relative grid size-[60px] shrink-0 place-items-center overflow-hidden rounded-[18px]",
              isPiece(sale) ? "bg-[#232323]" : "bg-white",
            )}
          >
            {img ? (
              <img
                src={img}
                alt=""
                loading="lazy"
                className={cn("size-full", isPiece(sale) ? "object-cover" : "object-contain p-1.5")}
              />
            ) : (
              <ShoppingBag className="size-5 text-[#8C8C8C]" />
            )}
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5 text-[12.5px] font-medium text-[#8C8C8C]">
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#232323] px-2 py-px text-[11.5px] font-bold text-[#D9D9D9]">
              {CHANNEL_ICON[sale.channel]} {CHANNEL[sale.channel].short}
            </span>
            <span className="tabular-nums">{hour(sale.sold_at)}</span>
            {method ? <span className="truncate">· {method}</span> : null}
          </span>
          <span className="mt-1 block truncate text-[15.5px] leading-snug font-bold tracking-[-0.01em]">
            {saleTitle(sale)}
          </span>
          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12.5px] text-[#A9A9A9]">
            <span className="truncate">{saleKind(sale)}</span>
            {sale.customer_name ? <span className="truncate">· {sale.customer_name}</span> : null}
          </span>
        </span>
        <span className="shrink-0 text-right">
          <span
            className={cn(
              "block text-[16px] font-bold tabular-nums",
              !sale.counted && "text-[#A9A9A9]",
            )}
          >
            {brl(sale.total)}
          </span>
          <span className={cn("block text-[12px] font-semibold tabular-nums", TONE[pay.tone])}>
            {pay.label === "Falta" ? `Falta ${brl(sale.due)}` : pay.label}
          </span>
        </span>
      </button>
      <AdminMore
        label={`Ações da venda ${saleTitle(sale)}`}
        actions={[
          {
            label: where,
            icon:
              sale.source === "store" ? (
                <Eye className="size-4" />
              ) : (
                <ArrowRight className="size-4" />
              ),
            onSelect: open,
          },
          ...(onEdit
            ? [{ label: "Editar venda", icon: <Pencil className="size-4" />, onSelect: onEdit }]
            : []),
          ...(onDelete
            ? [
                {
                  label: "Excluir venda",
                  icon: <Trash2 className="size-4" />,
                  danger: true,
                  separated: true,
                  onSelect: onDelete,
                },
              ]
            : []),
        ]}
      />
    </div>
  );
}

/* ── peças vendidas sem registro (Negociação) ───────────────────── */

function Unregistered({
  pieces,
  onPick,
}: {
  pieces: UnregisteredPiece[];
  onPick: (id: string) => void;
}) {
  const [all, setAll] = useState(false);
  if (!pieces.length) return null;
  const shown = all ? pieces : pieces.slice(0, 4);
  return (
    <section
      className="mt-6 rounded-[28px] bg-[#1A1A1A] p-5"
      aria-label="Peças vendidas sem registro"
    >
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[#FFD599]/12 text-[#FFD599]">
          <AlertCircle className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[16.5px] font-bold tracking-[-0.01em]">
            {pieces.length}{" "}
            {pieces.length === 1 ? "peça marcada como vendida" : "peças marcadas como vendidas"} sem
            valor
          </h2>
          <p className="mt-0.5 text-[13.5px] leading-snug text-[#8C8C8C]">
            Estão como “Vendido” na Negociação, mas sem por quanto e para quem. Toque para registrar
            — entram aqui nas vendas.
          </p>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {shown.map((p) => {
          const img = negotiationPhoto(p.image_url, "card");
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onPick(p.id)}
              className="press flex min-w-0 items-center gap-2.5 rounded-[18px] bg-[#232323] p-2 pr-3 text-left hover:bg-[#2A2A2A]"
            >
              <span className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-[12px] bg-[#2A2A2A]">
                {img ? (
                  <img src={img} alt="" loading="lazy" className="size-full object-cover" />
                ) : (
                  <Gem className="size-4 text-[#8C8C8C]" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-bold">{p.name}</span>
                <span className="block truncate text-[12px] font-semibold text-[#FFD599]">
                  Registrar venda
                </span>
              </span>
            </button>
          );
        })}
      </div>
      {pieces.length > 4 ? (
        <button
          type="button"
          onClick={() => setAll((v) => !v)}
          className="press mt-3 text-[13.5px] font-semibold text-[#A9A9A9] hover:text-white"
        >
          {all ? "Mostrar menos" : `Ver todas (${pieces.length})`}
        </button>
      ) : null}
    </section>
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
    <div
      className="admin-theme fixed inset-0 z-[60] grid place-items-center p-5"
      role="dialog"
      aria-modal
      aria-label="Venda registrada"
    >
      <div
        className="sale-ok-back absolute inset-0 bg-black/75 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="sale-ok relative w-full max-w-[380px] overflow-hidden rounded-[32px] bg-[#141414] p-7 text-center text-white ring-1 ring-white/[0.08]">
        <span
          ref={ring}
          className="sale-ok-check relative mx-auto grid size-[76px] place-items-center rounded-full bg-[#FFD599] text-[#15130F]"
        >
          <Check className="size-9" strokeWidth={3} />
        </span>
        <p className="relative mt-5 text-[14px] font-semibold text-[#A9A9A9]">
          {showcase ? "Peça do mostruário vendida" : "Venda registrada"}
        </p>
        <p className="relative mt-1 text-[44px] leading-none font-bold tracking-[-0.05em] tabular-nums">
          <AnimatedNumber value={total} format={(n) => brl(n)} duration={900} />
        </p>
        <p className="relative mt-3 text-[14px] leading-snug text-[#8C8C8C]">
          {showcase
            ? "Entrou nas vendas e saiu da vitrine da Negociação."
            : "Estoque, faturamento e lucro já foram atualizados."}
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

function SalesPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { registrar } = Route.useSearch();
  const copilot = useCopilot();
  const [composer, setComposer] = useState<Composer | null>(
    registrar === "manual"
      ? "manual"
      : registrar === "mostruario"
        ? "showcase"
        : registrar === "pedido"
          ? "order"
          : null,
  );
  const [composerOrigin, setComposerOrigin] = useState<HTMLElement | null>(null);
  const [detail, setDetail] = useState<{ id: string; el: HTMLElement | null } | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<LedgerSale | null>(null);
  const [leavingId, setLeavingId] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ id: string; total: number; showcase: boolean } | null>(
    null,
  );
  const [filter, setFilter] = useState<LedgerFilter>("all");
  const [period, setPeriod] = useState<Period>(30);

  useEffect(() => {
    if (registrar === "voz") copilot.listen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const range = useMemo(() => {
    const to = new Date();
    const from = new Date(to.getFullYear(), to.getMonth(), to.getDate() - (period - 1));
    return { from: from.toISOString(), to: new Date(to.getTime() + 60_000).toISOString() };
  }, [period]);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["sales-ledger", period],
    queryFn: () => salesLedger({ data: range }),
    staleTime: 30_000,
  });

  const sales = data?.sales ?? [];
  const sum = useMemo(() => summarize(sales), [sales]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: sales.length, due: 0 };
    for (const s of sales) {
      c[s.channel] = (c[s.channel] ?? 0) + 1;
      if (matches(s, "due")) c.due! += 1;
    }
    return c;
  }, [sales]);
  const shown = useMemo(() => sales.filter((s) => matches(s, filter)), [sales, filter]);
  const groups = useMemo(() => groupByDay(shown), [shown]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["sales-ledger"] });
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
    toast.success("Alterações salvas", {
      description: "Estoque e financeiro foram reconciliados.",
    });
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

  const openPiece = (id: string, sell = false) =>
    void navigate({
      to: "/admin/negociacao",
      search: { item: id, ...(sell ? { vender: true } : {}) },
    });

  const openSale = (s: LedgerSale, el: HTMLElement) => {
    if (s.source === "store") return setDetail({ id: s.id, el });
    if (s.source === "order")
      return void navigate({ to: "/admin/pedidos", search: { pedido: s.id } });
    return openPiece(s.id);
  };

  const launches: Array<{
    key: string;
    title: string;
    hint: string;
    icon: ReactNode;
    onClick: (el: HTMLElement) => void;
    tone?: "white" | "gold";
  }> = [
    {
      key: "voice",
      title: "Falar a venda",
      hint: "Balcão: diga o que vendeu, o Copilot monta e você confirma.",
      icon: <Mic className="size-[22px]" strokeWidth={2.2} />,
      onClick: () => copilot.listen(),
      tone: "white",
    },
    {
      key: "manual",
      title: "Balcão",
      hint: "Frascos e decants vendidos na loja, com o preço de hoje.",
      icon: <Store className="size-[22px]" strokeWidth={2.2} />,
      onClick: (el) => open("manual", el),
    },
    {
      key: "order",
      title: "WhatsApp ou encomenda",
      hint: "Vira um pedido: entrega, pagamento e compra no fornecedor.",
      icon: <MessageCircle className="size-[22px]" strokeWidth={2.2} />,
      onClick: (el) => open("order", el),
    },
    {
      key: "showcase",
      title: "Peça da Negociação",
      hint: "Vendeu uma peça do mostruário? Diga por quanto.",
      icon: <Gem className="size-[22px]" strokeWidth={2.2} />,
      onClick: (el) => open("showcase", el),
      tone: "gold",
    },
  ];

  const tabs: Array<{ key: LedgerFilter; label: string }> = [
    { key: "all", label: "Todas" },
    { key: "balcao", label: "Balcão" },
    { key: "whatsapp", label: "WhatsApp" },
    { key: "site", label: "Site" },
    { key: "manual", label: "Encomendas" },
    { key: "negociacao", label: "Negociação" },
    { key: "due", label: "A receber" },
  ];
  const visibleTabs = tabs.filter(
    (t) => t.key === "all" || t.key === filter || (counts[t.key] ?? 0) > 0,
  );
  const periodLabel = PERIODS.find((p) => p.key === period)!.label;
  const margin = sum.period.total ? Math.round((sum.period.profit / sum.period.total) * 100) : 0;

  return (
    <AdminShell
      title="Vendas"
      description="Tudo o que a loja vendeu num só lugar: balcão, WhatsApp, site e Negociação."
      action={
        <GoldButton
          icon={<Plus className="size-[18px]" strokeWidth={2.6} />}
          className="h-12"
          onClick={(e) => open("manual", e.currentTarget)}
        >
          Nova venda
        </GoldButton>
      }
    >
      {/* 1 · números */}
      <section className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4" aria-label="Resumo">
        <div
          className="dash-hero adm-rise col-span-2 flex min-h-[176px] flex-col p-5 lg:row-span-2 lg:min-h-0"
          style={{ ["--i" as string]: 0 }}
        >
          <div className="flex items-start justify-between gap-2">
            <span className="text-[15px] font-semibold opacity-75">Vendido hoje</span>
            <span className="dash-ico">
              <Receipt className="size-[18px]" strokeWidth={2.2} />
            </span>
          </div>
          <p className="mt-auto pt-6 text-[46px] leading-none font-bold tracking-[-0.05em] tabular-nums lg:text-[56px]">
            {isLoading ? "—" : <AnimatedNumber value={sum.today.total} format={(n) => brl(n)} />}
          </p>
          <p className="mt-2 flex flex-wrap items-center gap-x-3 text-[14px] font-semibold opacity-70">
            <span>
              {sum.today.count} {sum.today.count === 1 ? "venda" : "vendas"}
            </span>
            {sum.yesterday > 0 ? (
              <span className="inline-flex items-center gap-0.5">
                <ArrowUpRight
                  className={cn("size-4", sum.today.total < sum.yesterday && "rotate-90")}
                />
                ontem {brl(sum.yesterday)}
              </span>
            ) : null}
          </p>
        </div>

        <div
          className="dash-card adm-rise col-span-2 flex flex-col p-5"
          style={{ ["--i" as string]: 1 }}
        >
          <div className="flex items-start justify-between gap-2">
            <span className="text-[15px] text-[#A9A9A9]">Últimos {periodLabel}</span>
            <span className="text-[13px] font-semibold text-[#8C8C8C] tabular-nums">
              {sum.period.count} vendas
            </span>
          </div>
          <p className="mt-2 text-[30px] leading-none font-bold tracking-[-0.045em] tabular-nums">
            {isLoading ? "—" : <AnimatedNumber value={sum.period.total} format={(n) => brl(n)} />}
          </p>
          <DayBars sales={sales} days={period} />
        </div>

        <button
          type="button"
          onClick={() => setFilter("due")}
          className="dash-card adm-rise press flex min-h-[112px] flex-col p-5 text-left"
          style={{ ["--i" as string]: 2 }}
          aria-label="Ver vendas com valor a receber"
        >
          <span className="flex items-center justify-between gap-2 text-[14px] text-[#A9A9A9]">
            A receber <Wallet className="size-4 text-[#FFD599]" />
          </span>
          <span
            className={cn(
              "mt-auto truncate text-[24px] leading-none font-bold tracking-[-0.04em] tabular-nums",
              (data?.receivable.total ?? 0) > 0 && "text-[#FFD599]",
            )}
          >
            {isLoading ? (
              "—"
            ) : (
              <AnimatedNumber value={data?.receivable.total ?? 0} format={(n) => brl(n)} />
            )}
          </span>
          <span className="mt-1 text-[12.5px] font-semibold text-[#8C8C8C]">
            {data?.receivable.count
              ? `${data.receivable.count} ${data.receivable.count === 1 ? "venda" : "vendas"} com saldo`
              : "nada pendente"}
          </span>
        </button>
        <div
          className="dash-card adm-rise flex min-h-[112px] flex-col p-5"
          style={{ ["--i" as string]: 3 }}
        >
          <span className="text-[14px] text-[#A9A9A9]">Ticket médio</span>
          <span className="mt-auto truncate text-[24px] leading-none font-bold tracking-[-0.04em] tabular-nums">
            {isLoading ? "—" : <AnimatedNumber value={sum.period.ticket} format={(n) => brl(n)} />}
          </span>
          <span className="mt-1 truncate text-[12.5px] font-semibold text-[#8C8C8C]">
            {sum.period.withProfit ? (
              <>
                lucro <span className="text-[#7FCF9F]">{brl(sum.period.profit)}</span> · {margin}%
              </>
            ) : (
              "por venda"
            )}
          </span>
        </div>
      </section>

      {/* de onde vieram as vendas */}
      {sum.byChannel.length ? (
        <section className="mt-3 rounded-[24px] bg-[#1A1A1A] p-4" aria-label="Vendas por canal">
          <div className="flex h-2.5 overflow-hidden rounded-full bg-[#232323]">
            {sum.byChannel.map((c, i) => (
              <span
                key={c.channel}
                className={cn(
                  "h-full",
                  ["bg-[#FFD599]", "bg-[#D9D9D9]", "bg-[#8C8C8C]", "bg-[#5A5A5A]", "bg-[#3A3A3A]"][
                    i
                  ] ?? "bg-[#3A3A3A]",
                )}
                style={{ width: `${Math.max(2, c.share * 100)}%` }}
              />
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {sum.byChannel.map((c, i) => (
              <button
                key={c.channel}
                type="button"
                onClick={() => setFilter(filter === c.channel ? "all" : c.channel)}
                aria-pressed={filter === c.channel}
                className={cn(
                  "press inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[13px] font-semibold",
                  filter === c.channel
                    ? "bg-white text-[#15130F]"
                    : "bg-[#232323] text-[#D9D9D9] hover:bg-[#2A2A2A]",
                )}
              >
                <span
                  className={cn(
                    "size-2 rounded-full",
                    [
                      "bg-[#FFD599]",
                      "bg-[#D9D9D9]",
                      "bg-[#8C8C8C]",
                      "bg-[#5A5A5A]",
                      "bg-[#3A3A3A]",
                    ][i],
                  )}
                />
                {CHANNEL[c.channel].label}
                <span className="tabular-nums opacity-70">{brl(c.total)}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <Unregistered pieces={data?.unregistered ?? []} onPick={(id) => openPiece(id, true)} />

      {/* 2 · registrar */}
      <section className="mt-8" aria-label="Registrar venda">
        <h2 className="text-[20px] font-bold tracking-[-0.02em]">Registrar venda</h2>
        <p className="mt-0.5 text-[14px] text-[#8C8C8C]">
          Escolha como foi. Tudo aparece aqui embaixo.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:gap-4">
          {launches.map((l, i) => (
            <button
              key={l.key}
              type="button"
              onClick={(e) => l.onClick(e.currentTarget)}
              className={cn(
                "sale-launch adm-rise press group relative flex min-w-0 items-center gap-4 overflow-hidden rounded-[26px] p-4 text-left lg:flex-col lg:items-start lg:p-5",
                l.tone === "white"
                  ? "sale-launch-voice bg-white text-[#15130F]"
                  : "bg-[#1A1A1A] hover:bg-[#202020]",
              )}
              style={{ ["--i" as string]: i + 4 }}
            >
              <span
                className={cn(
                  "relative grid size-12 shrink-0 place-items-center rounded-full transition-transform duration-300 ease-[var(--ease-orium)] group-hover:scale-110",
                  l.tone === "white"
                    ? "bg-[#15130F] text-[#FFD599]"
                    : l.tone === "gold"
                      ? "bg-[#FFD599] text-[#15130F]"
                      : "bg-[#2A2A2A] text-white",
                )}
              >
                {l.tone === "white" ? (
                  <span className="sale-launch-pulse absolute inset-0 rounded-full" aria-hidden />
                ) : null}
                {l.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[16.5px] font-bold tracking-[-0.015em]">{l.title}</span>
                <span
                  className={cn(
                    "mt-0.5 block text-[13.5px] leading-snug",
                    l.tone === "white" ? "text-[#15130F]/65" : "text-[#8C8C8C]",
                  )}
                >
                  {l.hint}
                </span>
              </span>
              <ChevronRight
                className={cn(
                  "size-5 shrink-0 lg:hidden",
                  l.tone === "white" ? "text-[#15130F]/40" : "text-[#5A5A5A]",
                )}
              />
            </button>
          ))}
        </div>
      </section>

      {/* 3 · livro de vendas */}
      <section className="mt-8" aria-label="Vendas">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-[20px] font-bold tracking-[-0.02em]">Todas as vendas</h2>
          <div
            className="flex gap-1 rounded-full bg-[#1A1A1A] p-1"
            role="group"
            aria-label="Período"
          >
            {PERIODS.map((p) => (
              <button
                key={p.key}
                type="button"
                aria-pressed={period === p.key}
                onClick={() => setPeriod(p.key)}
                className={cn(
                  "press h-9 rounded-full px-3.5 text-[13.5px] font-semibold",
                  period === p.key ? "bg-white text-[#15130F]" : "text-[#A9A9A9] hover:text-white",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <PanelTabs
          className="mt-3"
          value={filter}
          onChange={setFilter}
          tabs={visibleTabs.map((t) => ({
            key: t.key,
            label: t.label,
            badge: <TabCount n={counts[t.key] ?? 0} on={filter === t.key} />,
          }))}
        />

        <div key={`${filter}-${period}`} className="mt-5 space-y-7">
          {isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="admin-skeleton h-[84px] rounded-[24px]" />
              ))}
            </div>
          ) : isError ? (
            <div className="rounded-[28px] bg-[#1A1A1A] px-6 py-10 text-center">
              <p className="text-[16px] font-bold">Não consegui carregar as vendas</p>
              <p className="mt-1 text-[14px] text-[#8C8C8C]">
                {error instanceof Error ? error.message : "Tente de novo em instantes."}
              </p>
            </div>
          ) : groups.length === 0 ? (
            <div className="flex flex-col items-center rounded-[28px] bg-[#1A1A1A] px-6 py-14 text-center">
              <span className="grid size-14 place-items-center rounded-full bg-[#232323] text-[#FFD599]">
                {filter === "due" ? <Wallet className="size-6" /> : <Receipt className="size-6" />}
              </span>
              <p className="mt-4 text-[18px] font-bold">
                {filter === "all"
                  ? `Nenhuma venda nos últimos ${periodLabel}`
                  : filter === "due"
                    ? "Nada a receber neste período"
                    : "Nada com esse filtro"}
              </p>
              <p className="mt-1 max-w-[320px] text-[14.5px] text-[#8C8C8C]">
                Registre uma venda acima — ela aparece aqui na hora.
              </p>
            </div>
          ) : (
            groups.map((g) => (
              <div key={g.label} className="min-w-0">
                <div className="mb-2.5 flex items-baseline justify-between gap-3 px-1">
                  <h3 className="text-[15px] font-bold first-letter:uppercase">{g.label}</h3>
                  <span className="text-[13.5px] font-semibold text-[#8C8C8C] tabular-nums">
                    {g.list.length} · {brl(g.total)}
                  </span>
                </div>
                <div className="space-y-2">
                  {g.list.map((sale, i) => (
                    <LedgerRow
                      key={`${sale.source}-${sale.id}`}
                      sale={sale}
                      index={i}
                      leaving={leavingId === sale.id}
                      onOpen={(el) => openSale(sale, el)}
                      onEdit={sale.source === "store" ? () => setEditId(sale.id) : undefined}
                      onDelete={sale.source === "store" ? () => setDeleting(sale) : undefined}
                    />
                  ))}
                </div>
              </div>
            ))
          )}
          {sum.toConfirm && filter === "all" ? (
            <p className="px-1 text-[13px] text-[#8C8C8C]">
              {sum.toConfirm}{" "}
              {sum.toConfirm === 1
                ? "pedido ainda não confirmado aparece"
                : "pedidos ainda não confirmados aparecem"}{" "}
              esmaecido e não soma no total.
            </p>
          ) : null}
        </div>
      </section>

      {/* janelas */}
      <SidePanel
        open={composer === "manual"}
        onClose={() => setComposer(null)}
        label="Venda no balcão"
        originEl={composerOrigin}
      >
        <PanelHeader
          image={null}
          fallback={<Store className="size-5" />}
          title="Venda no balcão"
          subtitle="Frascos e decants vendidos na loja"
          onClose={() => setComposer(null)}
        />
        <SaleComposer mode="manual" onClose={() => setComposer(null)} onSaved={afterSave} />
      </SidePanel>

      <SidePanel
        open={composer === "showcase"}
        onClose={() => setComposer(null)}
        label="Peça da Negociação"
        originEl={composerOrigin}
      >
        <PanelHeader
          image={null}
          fallback={<Gem className="size-5 text-[#FFD599]" />}
          title="Peça da Negociação"
          subtitle="Vendi uma peça do mostruário"
          onClose={() => setComposer(null)}
        />
        <ShowcaseSale onClose={() => setComposer(null)} onSaved={afterSave} />
      </SidePanel>

      <OrderComposer
        open={composer === "order"}
        originEl={composerOrigin}
        onClose={() => {
          setComposer(null);
          refresh();
        }}
        onCreated={(id) => {
          setComposer(null);
          refresh();
          toast.success("Pedido criado", {
            description: "Já está nas vendas. Entrega e pagamento seguem em Pedidos.",
            action: {
              label: "Abrir pedido",
              onClick: () => void navigate({ to: "/admin/pedidos", search: { pedido: id } }),
            },
          });
        }}
      />

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
          window.setTimeout(() => {
            setLeavingId(null);
            refresh();
          }, 220);
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
            ? `O estoque volta como estava, receita e lucro são recalculados e a venda sai dos relatórios. ${deleting.ref ? `Venda ${deleting.ref} · ` : ""}${brl(deleting.total)}.`
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
  return (
    <span
      className={cn(
        "rounded-full px-1.5 text-[11.5px] font-bold tabular-nums",
        on ? "bg-[#15130F] text-[#FFD599]" : "bg-[#2A2A2A] text-[#A9A9A9]",
      )}
    >
      {n}
    </span>
  );
}
