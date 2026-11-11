import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { Search, MessageCircle, SlidersHorizontal, Eraser, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";
import { AdminShell } from "@/components/orium/AdminShell";
import { AnimatedMetric } from "@/components/orium/AnimatedMetric";
import { CustomerSheet } from "@/components/orium/CustomerSheet";
import { CrmCleanupSheet } from "@/components/orium/CrmCleanupSheet";
import {
  AdminEmpty,
  AdminMore,
  AdminRowsSkeleton,
  AdminTechDetails,
} from "@/components/orium/admin/AdminUI";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { brl, productTitle } from "@/lib/format";
import { cn } from "@/lib/utils";
import { crmCustomers, crmOverview, crmMarkAbandoned, type CrmCustomerRow } from "@/lib/crm.functions";

export const Route = createFileRoute("/_authenticated/admin/clientes")({
  head: () => ({
    meta: [{ title: "Clientes — Orium Admin" }, { name: "robots", content: "noindex" }],
  }),
  // `?cliente=<id>` abre direto a ficha (vem dos interesses da Negociação).
  validateSearch: (search: Record<string, unknown>): { cliente?: string } => {
    const id = typeof search['cliente'] === "string" ? search['cliente'] : "";
    return id ? { cliente: id } : {};
  },
  component: AdminCustomers,
});

/** Quatro filtros na tela; os demais dentro de "Filtros". */
const MAIN_FILTERS = [
  { id: "todos", label: "Todos" },
  { id: "com-pedidos", label: "Compraram" },
  { id: "abandonados", label: "Carrinho abandonado" },
  { id: "aguardando", label: "Aguardando estoque" },
] as const;

const EXTRA_FILTERS = [
  { id: "favoritos", label: "Com favoritos" },
  { id: "comprou-decant", label: "Compraram decants" },
  { id: "comprou-frasco", label: "Compraram frascos" },
  { id: "inativos", label: "Sem comprar há 60 dias" },
  { id: "sem-pedidos", label: "Sem pedidos" },
  { id: "arquivados", label: "Arquivados" },
] as const;

const whats = (phone?: string | null) => {
  const d = (phone ?? "").replace(/\D/g, "");
  if (d.length < 10) return null;
  return `https://wa.me/${d.startsWith("55") ? d : `55${d}`}`;
};

function AdminCustomers() {
  const [term, setTerm] = useState("");
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<string>("todos");
  const { cliente } = Route.useSearch();
  const navigate = Route.useNavigate();
  const [openId, setOpenId] = useState<string | null>(cliente ?? null);
  const [cleanup, setCleanup] = useState(false);
  const fromLink = useRef<string | null>(cliente ?? null);

  // ficha vinda de outro lugar do Admin (ex.: interesses da Negociação)
  useEffect(() => {
    if (cliente && fromLink.current !== cliente) {
      fromLink.current = cliente;
      setOpenId(cliente);
    }
  }, [cliente]);

  const closeSheet = () => {
    setOpenId(null);
    if (cliente) {
      fromLink.current = null;
      void navigate({ search: {}, replace: true });
    }
  };

  const list = useServerFn(crmCustomers);
  const overviewFn = useServerFn(crmOverview);
  const markAbandoned = useServerFn(crmMarkAbandoned);

  const overview = useQuery({ queryKey: ["crm-overview"], queryFn: () => overviewFn(), staleTime: 30_000 });
  const customers = useQuery({
    queryKey: ["crm-customers", q, filter],
    queryFn: () => list({ data: { q: q || null, filter, limit: 40, offset: 0 } }),
    staleTime: 15_000,
  });

  const stats = overview.data;
  const activeExtra = EXTRA_FILTERS.find((f) => f.id === filter);

  return (
    <AdminShell
      title="Clientes"
      action={
        <AdminMore
          label="Mais ações"
          actions={[
            {
              label: "Atualizar carrinhos",
              icon: <RefreshCw className="size-4" />,
              onSelect: async () => {
                const r = await markAbandoned({ data: { minutes: 45 } });
                toast.success(`${r.marked} carrinho(s) marcado(s) como abandonado.`);
                void overview.refetch();
                void customers.refetch();
              },
            },
            { label: "Limpeza de dados de teste", icon: <Eraser className="size-4" />, onSelect: () => setCleanup(true) },
          ]}
        />
      }
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Clientes" value={stats?.customers} loading={overview.isLoading} error={overview.isError} />
        <Metric
          label="Carrinhos abandonados"
          value={stats?.abandoned_carts}
          loading={overview.isLoading}
          error={overview.isError}
        />
        <Metric
          label="Aguardando estoque"
          value={stats?.waiting_subscriptions}
          loading={overview.isLoading}
          error={overview.isError}
        />
        <Metric label="Favoritos" value={stats?.favorites} loading={overview.isLoading} error={overview.isError} />
      </div>

      <form
        className="mt-5 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setQ(term.trim());
        }}
      >
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Nome, WhatsApp ou e-mail"
            className="h-12 rounded-full pl-11 text-base"
          />
        </div>
        <Button type="submit" variant="outline" className="h-12 shrink-0 rounded-full px-5">
          Buscar
        </Button>
      </form>

      <div className="mt-4 flex items-center gap-2">
        <div className="-mx-1 flex min-w-0 flex-1 gap-1.5 overflow-x-auto px-1 pb-1">
          {MAIN_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={cn(
                "press shrink-0 rounded-full border px-3.5 py-2 text-xs transition-colors duration-150",
                filter === f.id
                  ? "border-transparent bg-foreground text-background"
                  : "border-border/60 text-muted-foreground hover:bg-accent",
              )}
            >
              {f.label}
            </button>
          ))}
          {activeExtra ? (
            <button
              type="button"
              onClick={() => setFilter("todos")}
              className="press shrink-0 rounded-full border border-transparent bg-foreground px-3.5 py-2 text-xs text-background"
            >
              {activeExtra.label} <X className="ml-1 inline size-3" />
            </button>
          ) : null}
        </div>
        <AdminMore
          label="Filtros"
          actions={EXTRA_FILTERS.map((f) => ({ label: f.label, onSelect: () => setFilter(f.id) }))}
          trigger={
            <button
              type="button"
              className="press grid size-10 shrink-0 place-items-center rounded-full border border-border/60 text-muted-foreground"
              aria-label="Filtros"
            >
              <SlidersHorizontal className="size-4" strokeWidth={1.75} />
            </button>
          }
        />
      </div>

      <div className="mt-4 space-y-2.5 lg:grid lg:grid-cols-2 lg:gap-3 lg:space-y-0">
        {customers.isLoading ? (
          <div className="lg:col-span-2">
            <AdminRowsSkeleton rows={5} height={96} />
          </div>
        ) : customers.isError ? (
          <div className="lg:col-span-2">
            <AdminEmpty>Não conseguimos carregar os clientes agora.</AdminEmpty>
          </div>
        ) : customers.data?.rows.length === 0 ? (
          <div className="lg:col-span-2">
            <AdminEmpty>Nenhum cliente com esses filtros.</AdminEmpty>
          </div>
        ) : (
          customers.data?.rows.map((c) => <CustomerCard key={c.id} customer={c} onOpen={() => setOpenId(c.id)} />)
        )}
      </div>

      {stats?.waiting_products?.length ? (
        <div className="mt-6">
          <AdminTechDetails label="Perfumes mais esperados">
            <ul className="space-y-1.5">
              {stats.waiting_products.map((p) => (
                <li key={p.product_id} className="flex min-w-0 items-center justify-between gap-3">
                  <span className="min-w-0 truncate">
                    {productTitle(p.name)}
                    {p.brand ? <span className="text-muted-foreground"> · {p.brand}</span> : null}
                  </span>
                  <span className="shrink-0">
                    {p.people} {p.people === 1 ? "cliente" : "clientes"}
                    {p.in_stock ? " · voltou" : ""}
                  </span>
                </li>
              ))}
            </ul>
          </AdminTechDetails>
        </div>
      ) : null}

      <CustomerSheet id={openId} onClose={closeSheet} />

      <CrmCleanupSheet
        open={cleanup}
        onClose={() => setCleanup(false)}
        onDone={() => {
          setOpenId(null);
          void overview.refetch();
          void customers.refetch();
        }}
      />
    </AdminShell>
  );
}

function Metric({
  label,
  value,
  loading,
  error,
}: {
  label: string;
  value: number | undefined;
  loading: boolean;
  error: boolean;
}) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card p-4">
      <p className="text-[11px] tracking-wide text-muted-foreground uppercase">{label}</p>
      {loading ? (
        <Skeleton className="mt-2 h-6 w-12" />
      ) : (
        <p className="mt-1 text-xl font-semibold tabular-nums">
          <AnimatedMetric value={error ? null : value} />
        </p>
      )}
    </div>
  );
}

/** Linha da lista: nome, contato, pedidos e total gasto. O resto é na ficha. */
function CustomerCard({ customer: c, onOpen }: { customer: CrmCustomerRow; onOpen: () => void }) {
  const link = whats(c.phone);
  return (
    <div className="admin-card rounded-2xl border border-border/60 bg-card p-4">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-base font-medium">{c.name ?? "Cliente sem nome"}</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{c.phone ?? c.email ?? "sem contato"}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-base font-semibold tabular-nums">{brl(Number(c.total_spent))}</p>
          <p className="text-[11px] text-muted-foreground">
            {c.orders_count} {c.orders_count === 1 ? "pedido" : "pedidos"}
          </p>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <Button size="sm" variant="outline" className="press min-w-0 flex-1 rounded-full" onClick={onOpen}>
          Ver cliente
        </Button>
        <AdminMore
          actions={[
            { label: "Ver cliente", onSelect: onOpen },
            ...(link ? [{ label: "Abrir WhatsApp", icon: <MessageCircle className="size-4" />, href: link }] : []),
          ]}
        />
      </div>
    </div>
  );
}
