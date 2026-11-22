/**
 * ADMIN → CLIENTES.
 * Números no topo que também filtram, busca na hora, todos os filtros à vista e
 * uma lista que se lê de relance: quem é, o que está acontecendo (carrinho,
 * esperando perfume, favoritos), última compra e quanto já gastou.
 * A ficha abre no mesmo painel de Produtos e Pedidos (CustomerSheet).
 */
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import {
  BellRing,
  Eraser,
  Heart,
  MessageCircle,
  RefreshCw,
  Search,
  ShoppingCart,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { AdminShell } from "@/components/orium/AdminShell";
import { AnimatedMetric } from "@/components/orium/AnimatedMetric";
import { Bars, CustomerSheet, initialsOf, whatsLink } from "@/components/orium/CustomerSheet";
import { CrmCleanupSheet } from "@/components/orium/CrmCleanupSheet";
import { AdminMore } from "@/components/orium/admin/AdminUI";
import { StatusDot } from "@/components/orium/admin/PanelKit";
import {
  PxCard,
  PxCardBody,
  PxCardHead,
  PxKpi,
  PxKpiRow,
  PxNote,
  PxSecondary,
  pxInputClass,
} from "@/components/orium/admin/PricingUI";
import { brl, productTitle } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  crmCustomers,
  crmOverview,
  crmMarkAbandoned,
  type CrmCustomerRow,
} from "@/lib/crm.functions";

export const Route = createFileRoute("/_authenticated/admin/clientes")({
  head: () => ({
    meta: [{ title: "Clientes — Orium Admin" }, { name: "robots", content: "noindex" }],
  }),
  // `?cliente=<id>` abre direto a ficha (vem dos interesses da Negociação).
  validateSearch: (search: Record<string, unknown>): { cliente?: string } => {
    const id = typeof search["cliente"] === "string" ? search["cliente"] : "";
    return id ? { cliente: id } : {};
  },
  component: AdminCustomers,
});

const FILTERS = [
  { id: "todos", label: "Todos" },
  { id: "com-pedidos", label: "Compraram" },
  { id: "abandonados", label: "Carrinho abandonado" },
  { id: "aguardando", label: "Esperando perfume" },
  { id: "favoritos", label: "Com favoritos" },
  { id: "comprou-decant", label: "Compraram decants" },
  { id: "comprou-frasco", label: "Compraram frascos" },
  { id: "inativos", label: "Sem comprar há 60 dias" },
  { id: "sem-pedidos", label: "Sem pedidos" },
  { id: "arquivados", label: "Arquivados" },
] as const;

const PAGE = 40;

/** "agora", "há 3 h", "há 5 dias", "12 mar" */
function ago(v: string | null) {
  if (!v) return null;
  const t = new Date(v).getTime();
  const min = Math.round((Date.now() - t) / 60_000);
  if (min < 2) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.round(h / 24);
  if (d < 30) return `há ${d} ${d === 1 ? "dia" : "dias"}`;
  return new Date(v).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

function AdminCustomers() {
  const [term, setTerm] = useState("");
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<string>("todos");
  const [limit, setLimit] = useState(PAGE);
  const { cliente } = Route.useSearch();
  const navigate = Route.useNavigate();
  const [open, setOpen] = useState<{ id: string; el: HTMLElement | null } | null>(
    cliente ? { id: cliente, el: null } : null,
  );
  const [cleanup, setCleanup] = useState(false);
  const fromLink = useRef<string | null>(cliente ?? null);

  // ficha vinda de outro lugar do Admin (ex.: interesses da Negociação)
  useEffect(() => {
    if (cliente && fromLink.current !== cliente) {
      fromLink.current = cliente;
      setOpen({ id: cliente, el: null });
    }
  }, [cliente]);

  // busca na hora (sem botão), com um respiro para não pesquisar a cada letra
  useEffect(() => {
    const t = setTimeout(() => setQ(term.trim()), 280);
    return () => clearTimeout(t);
  }, [term]);
  useEffect(() => setLimit(PAGE), [q, filter]);

  const closeSheet = () => {
    setOpen(null);
    if (cliente) {
      fromLink.current = null;
      void navigate({ search: {}, replace: true });
    }
  };

  const list = useServerFn(crmCustomers);
  const overviewFn = useServerFn(crmOverview);
  const markAbandoned = useServerFn(crmMarkAbandoned);

  const overview = useQuery({
    queryKey: ["crm-overview"],
    queryFn: () => overviewFn(),
    staleTime: 30_000,
  });
  const customers = useQuery({
    queryKey: ["crm-customers", q, filter, limit],
    queryFn: () => list({ data: { q: q || null, filter, limit, offset: 0 } }),
    staleTime: 15_000,
    placeholderData: (prev) => prev,
  });

  const stats = overview.data;
  const rows = customers.data?.rows ?? [];
  const total = customers.data?.total ?? 0;
  const metric = (v: number | undefined) => <AnimatedMetric value={overview.isError ? null : v} />;
  const toggle = (id: string) => setFilter((f) => (f === id ? "todos" : id));

  return (
    <AdminShell
      title="Clientes"
      action={
        <AdminMore
          label="Mais ações"
          actions={[
            {
              label: "Atualizar carrinhos abandonados",
              icon: <RefreshCw className="size-4" />,
              onSelect: async () => {
                const r = await markAbandoned({ data: { minutes: 45 } });
                toast.success(`${r.marked} carrinho(s) marcado(s) como abandonado.`);
                void overview.refetch();
                void customers.refetch();
              },
            },
            {
              label: "Limpeza de dados de teste",
              icon: <Eraser className="size-4" />,
              onSelect: () => setCleanup(true),
            },
          ]}
        />
      }
    >
      <div className="space-y-5 lg:space-y-6">
        <PxKpiRow>
          <PxKpi
            hero
            i={0}
            label="Clientes"
            icon={<Users className="size-[18px]" strokeWidth={2.2} />}
            loading={overview.isLoading}
            value={metric(stats?.customers)}
            foot="Fichas com nome ou contato"
            onClick={() => setFilter("todos")}
            ariaLabel="Ver todos os clientes"
          />
          <PxKpi
            i={1}
            label="Carrinho abandonado"
            icon={<ShoppingCart className="size-[18px]" strokeWidth={2.2} />}
            loading={overview.isLoading}
            value={metric(stats?.abandoned_carts)}
            foot={filter === "abandonados" ? "Filtrando a lista" : "Toque para ver quem"}
            onClick={() => toggle("abandonados")}
            ariaLabel="Filtrar carrinhos abandonados"
          />
          <PxKpi
            i={2}
            label="Esperando perfume"
            icon={<BellRing className="size-[18px]" strokeWidth={2.2} />}
            loading={overview.isLoading}
            value={metric(stats?.waiting_subscriptions)}
            foot={filter === "aguardando" ? "Filtrando a lista" : "Avisos de estoque ativos"}
            onClick={() => toggle("aguardando")}
            ariaLabel="Filtrar quem espera perfume"
          />
          <PxKpi
            i={3}
            label="Favoritos"
            icon={<Heart className="size-[18px]" strokeWidth={2.2} />}
            loading={overview.isLoading}
            value={metric(stats?.favorites)}
            foot={filter === "favoritos" ? "Filtrando a lista" : "Perfumes salvos por clientes"}
            onClick={() => toggle("favoritos")}
            ariaLabel="Filtrar quem tem favoritos"
          />
        </PxKpiRow>

        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-4 size-[18px] -translate-y-1/2 text-[#8C8C8C]" />
          <input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && setQ(term.trim())}
            placeholder="Procurar por nome, WhatsApp ou e-mail"
            aria-label="Procurar cliente"
            className={cn(pxInputClass, "h-[52px] pr-11 pl-11")}
          />
          {term ? (
            <button
              type="button"
              aria-label="Limpar busca"
              onClick={() => setTerm("")}
              className="press absolute top-1/2 right-2 grid size-9 -translate-y-1/2 place-items-center rounded-full text-[#A9A9A9]"
            >
              <X className="size-4" />
            </button>
          ) : null}
        </div>

        <div
          className="adm-scroll -mx-1 flex gap-2 overflow-x-auto px-1 pb-1"
          role="group"
          aria-label="Filtrar clientes"
        >
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={cn(
                "press inline-flex h-11 shrink-0 items-center rounded-full px-4 text-[14px] font-bold transition-colors",
                filter === f.id
                  ? "bg-white text-[#15130F]"
                  : "bg-[#1A1A1A] text-[#A9A9A9] hover:text-white",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        <section
          className="dash-card adm-rise overflow-hidden"
          style={{ ["--i" as string]: 4 }}
          aria-busy={customers.isFetching}
        >
          <div className="flex items-center justify-between gap-3 px-5 pt-5 pb-3 lg:px-6">
            <h2 className="text-[17px] font-bold tracking-[-0.01em]">
              {customers.isLoading
                ? "Carregando clientes"
                : `${total} ${total === 1 ? "cliente" : "clientes"}`}
            </h2>
            {customers.isFetching && !customers.isLoading ? (
              <span className="text-[12.5px] text-[#8C8C8C]">Atualizando…</span>
            ) : null}
          </div>

          <div className="hidden grid-cols-[44px_minmax(0,1.5fr)_minmax(0,1.3fr)_120px_84px_120px_44px] gap-x-4 border-y border-white/[0.06] px-6 py-2.5 text-[12px] font-semibold text-[#6F6F6F] lg:grid">
            <span className="col-span-2">Cliente</span>
            <span>O que está acontecendo</span>
            <span>Última compra</span>
            <span className="text-right">Pedidos</span>
            <span className="text-right">Total gasto</span>
            <span />
          </div>

          {customers.isLoading ? (
            <div className="space-y-2 p-3">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="admin-skeleton h-[68px] rounded-[18px]" />
              ))}
            </div>
          ) : customers.isError ? (
            <div className="p-5 pt-2">
              <PxNote tone="danger">Não conseguimos carregar os clientes agora.</PxNote>
            </div>
          ) : rows.length === 0 ? (
            <div className="px-5 pt-2 pb-8 text-center lg:px-6">
              <p className="text-[15px] font-semibold">Nenhum cliente com esse filtro</p>
              <p className="mt-1 text-[14px] text-[#8C8C8C]">
                Tente outra busca ou volte para Todos.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-white/[0.05] lg:divide-white/[0.04]">
              {rows.map((c) => (
                <CustomerRow key={c.id} c={c} onOpen={(el) => setOpen({ id: c.id, el })} />
              ))}
            </ul>
          )}

          {rows.length < total && !customers.isLoading ? (
            <div className="border-t border-white/[0.06] p-3">
              <PxSecondary className="w-full" onClick={() => setLimit((l) => l + PAGE)}>
                Mostrar mais {Math.min(PAGE, total - rows.length)} de {total - rows.length}
              </PxSecondary>
            </div>
          ) : null}
        </section>

        {stats?.waiting_products?.length ? (
          <PxCard i={5}>
            <PxCardHead
              title="Perfumes mais esperados"
              sub="Quantos clientes pediram aviso quando o perfume voltar."
              icon={<BellRing className="size-[18px]" strokeWidth={2.2} />}
            />
            <PxCardBody>
              <Bars
                rows={stats.waiting_products.map((p) => ({
                  label: `${productTitle(p.name)}${p.in_stock ? " · já voltou" : ""}`,
                  value: p.people,
                  display: `${p.people} ${p.people === 1 ? "cliente" : "clientes"}`,
                }))}
              />
            </PxCardBody>
          </PxCard>
        ) : null}
      </div>

      <CustomerSheet id={open?.id ?? null} originEl={open?.el ?? null} onClose={closeSheet} />

      <CrmCleanupSheet
        open={cleanup}
        onClose={() => setCleanup(false)}
        onDone={() => {
          setOpen(null);
          void overview.refetch();
          void customers.refetch();
        }}
      />
    </AdminShell>
  );
}

/** Uma linha: quem é, o que está acontecendo, última compra, pedidos e total. */
function CustomerRow({
  c,
  onOpen,
}: {
  c: CrmCustomerRow;
  onOpen: (el: HTMLElement | null) => void;
}) {
  const link = whatsLink(c.phone);
  const spent = Number(c.total_spent);
  const signals = [
    c.active_cart_items > 0 ? (
      <StatusDot key="cart" tone="gold">
        Carrinho aberto · {c.active_cart_items}
      </StatusDot>
    ) : null,
    c.abandoned_count > 0 ? (
      <StatusDot key="ab" tone="coral">
        Carrinho abandonado
      </StatusDot>
    ) : null,
    c.waiting_count > 0 ? (
      <StatusDot key="wait" tone="warn">
        Esperando {c.waiting_count}
      </StatusDot>
    ) : null,
    c.favorites_count > 0 ? (
      <StatusDot key="fav" tone="off">
        {c.favorites_count} {c.favorites_count === 1 ? "favorito" : "favoritos"}
      </StatusDot>
    ) : null,
  ].filter(Boolean);

  return (
    <li className="group relative">
      <button
        type="button"
        onClick={(e) => onOpen(e.currentTarget.closest("li"))}
        className="press grid w-full grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-x-3.5 gap-y-1.5 px-4 py-3.5 text-left transition-colors hover:bg-white/[0.025] lg:grid-cols-[44px_minmax(0,1.5fr)_minmax(0,1.3fr)_120px_84px_120px_44px] lg:gap-x-4 lg:px-6"
      >
        <span
          className={cn(
            "grid size-11 place-items-center rounded-full text-[15px] font-bold",
            spent > 0 ? "bg-[#2A2418] text-[#FFD599]" : "bg-[#232323] text-[#A9A9A9]",
          )}
          aria-hidden
        >
          {initialsOf(c.name)}
        </span>
        <span className="min-w-0 lg:col-span-1">
          <span className="block truncate text-[15.5px] font-bold text-white">
            {c.name ?? "Cliente sem nome"}
          </span>
          <span className="mt-0.5 block truncate text-[13px] text-[#8C8C8C]">
            {c.phone ?? c.email ?? "sem contato"}
          </span>
        </span>

        {/* celular: total à direita; sinais e datas na linha de baixo */}
        <span className="text-right lg:hidden">
          <span className="block text-[15px] font-bold tabular-nums">{brl(spent)}</span>
          <span className="block text-[12px] text-[#8C8C8C]">
            {c.orders_count} {c.orders_count === 1 ? "pedido" : "pedidos"}
          </span>
        </span>
        {signals.length ? (
          <span className="col-start-2 col-end-4 flex min-w-0 flex-wrap gap-x-3 gap-y-1 lg:hidden">
            {signals}
          </span>
        ) : null}

        <span className="hidden min-w-0 flex-wrap gap-x-3 gap-y-1 lg:flex">
          {signals.length ? (
            signals
          ) : (
            <span className="text-[13px] text-[#6F6F6F]">
              {ago(c.last_activity_at) ? `Visto ${ago(c.last_activity_at)}` : "—"}
            </span>
          )}
        </span>
        <span className="hidden text-[13.5px] text-[#A9A9A9] lg:block">
          {ago(c.last_order_at) ?? "Nunca comprou"}
        </span>
        <span className="hidden text-right text-[14px] font-semibold tabular-nums lg:block">
          {c.orders_count}
        </span>
        <span
          className={cn(
            "hidden text-right text-[15px] font-bold tabular-nums lg:block",
            spent > 0 ? "text-white" : "text-[#6F6F6F]",
          )}
        >
          {brl(spent)}
        </span>
        <span className="hidden lg:block" />
      </button>
      {link ? (
        <a
          href={link}
          target="_blank"
          rel="noreferrer"
          aria-label={`Abrir WhatsApp de ${c.name ?? "cliente"}`}
          title="Abrir WhatsApp"
          className="press absolute top-1/2 right-5 hidden size-10 -translate-y-1/2 place-items-center rounded-full bg-[#1F1F1F] text-[#7FCF9F] transition-colors hover:bg-[#263026] lg:grid"
        >
          <MessageCircle className="size-[18px]" strokeWidth={2.2} />
        </a>
      ) : null}
    </li>
  );
}
