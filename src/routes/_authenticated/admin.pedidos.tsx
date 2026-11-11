import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useServerFn } from "@tanstack/react-start";
import {
  MessageCircle,
  Plus,
  Search,
  Check,
  Copy,
  Trash2,
  RotateCcw,
  X,
  ClipboardList,
  SlidersHorizontal,
  Pencil,
  LayoutGrid,
  List,
  LayoutDashboard,
  HandCoins,
  ShoppingCart,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AdminShell } from "@/components/orium/AdminShell";
import { OrderBoard, OrderCard, type CardDeps, type Quick } from "@/components/orium/admin/orders/OrderBoard";
import { OrderPanel } from "@/components/orium/admin/orders/OrderPanel";
import { OrderComposer } from "@/components/orium/admin/orders/OrderComposer";
import { burst, type Stage } from "@/components/orium/admin/orders/model";
import { OrdersDashboard, JOURNEY, buyByOrder, journeyOf } from "@/components/orium/admin/orders/OrdersDashboard";
import { PurchasesView } from "@/components/orium/admin/orders/PurchasesView";
import { dueInfo } from "@/components/orium/admin/orders/controls";
import { purchaseBoard } from "@/lib/orders-control.functions";
import { imgVariant } from "@/lib/product-img";
import { cn } from "@/lib/utils";
import { AdminConfirm, AdminEmpty, AdminMore, type AdminAction } from "@/components/orium/admin/AdminUI";
import { brl, whatsappLink } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import { OrderEditSheet } from "@/components/orium/OrderEditSheet";
import { DELIVERY_FILTERS, deliveryRank, deliveryState, todayBR } from "@/lib/delivery";
import { OrderRestockSheet } from "@/components/orium/admin/OrderRestockSheet";
import { PAY_FILTERS, paymentInfo } from "@/components/orium/admin/OrderPayment";
import {
  cancelOrder,
  confirmOrder,
  duplicateOrder,
  purgeOrder,
  restoreOrder,
  setOrderPayment,
  setOrderStatus,
  trashOrder,
} from "@/lib/orders.functions";

export const Route = createFileRoute("/_authenticated/admin/pedidos")({
  head: () => ({
    meta: [{ title: "Pedidos — Orium Admin" }, { name: "robots", content: "noindex" }],
  }),
  // Permite abrir um pedido específico por link (ex.: a partir da ficha do cliente).
  validateSearch: (search: Record<string, unknown>): { pedido?: string; tab?: string; novo?: boolean; busca?: string } => {
    const p = search['pedido'];
    const n = search['novo'];
    const t = search['tab'];
    const b = search['busca'];
    return {
      ...(typeof p === "string" && p ? { pedido: p } : {}),
      ...(typeof b === "string" && b ? { busca: b } : {}),
      ...(typeof t === "string" && t ? { tab: t } : {}),
      ...(n === true || n === "1" || n === 1 ? { novo: true } : {}),
    };
  },
  component: AdminOrders,
});

type View = "painel" | "quadro" | "lista" | "compras";
const VIEWS: Array<{ key: View; label: string; icon: LucideIcon }> = [
  { key: "painel", label: "Painel", icon: LayoutDashboard },
  { key: "quadro", label: "Quadro", icon: LayoutGrid },
  { key: "lista", label: "Lista", icon: List },
  { key: "compras", label: "Compras", icon: ShoppingCart },
];

/** Quatro filtros na tela; o resto fica dentro de "Filtros". */
// Pedido feito = pago, aguardando entrega (prioridade). Pendente = só enviado ao WhatsApp.
const MAIN_TABS = [
  { key: "todos", label: "Todos" },
  { key: "pedido feito", label: "Pedido feito" },
  { key: "pendente", label: "Pendentes" },
  { key: "entregue", label: "Entregues" },
  { key: "pg_due", label: "A receber" },
] as const;

/** Prioridade operacional: pago aguardando entrega → pendente → entregue → resto. */
const statusRank = (o: any) =>
  o.status === "pedido feito" || (o.status === "pendente" && o.is_confirmed)
    ? 0
    : o.status === "pendente"
      ? 1
      : o.status === "entregue"
        ? 2
        : 3;

const EXTRA_TABS = [
  ...DELIVERY_FILTERS.map((f) => ({ key: f.key, label: f.label })),
  ...PAY_FILTERS.filter((f) => f.key !== "pg_due").map((f) => ({ key: f.key, label: f.label })),
  { key: "aguardando", label: "Aguardando confirmação" },
  { key: "confirmados", label: "Confirmados" },
  { key: "cancelado", label: "Cancelados" },
  { key: "lixeira", label: "Lixeira" },
  ...JOURNEY.map((j) => ({ key: `j_${j.key}`, label: j.title })),
] as const;

function AdminOrders() {
  const qc = useQueryClient();
  const { role } = useAuth();
  const navigate = useNavigate();
  const { pedido, tab: tabParam, novo, busca } = Route.useSearch();
  const [tab, setTab] = useState<string>(tabParam ?? "todos");
  // quadro por padrão; filtro vindo por link (ex.: "A receber" no Início) abre a lista
  // Hoje (alertas) por padrão; filtro vindo por link (ex.: "A receber" no Início) abre a lista
  const [view, setView] = useState<View>(() => {
    if (tabParam) return "lista";
    try {
      const v = localStorage.getItem("orium:orders-view") as View | null;
      return v && VIEWS.some((x) => x.key === v) ? v : "painel";
    } catch {
      return "painel";
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("orium:orders-view", view);
    } catch {
      /* sem armazenamento: tudo bem */
    }
  }, [view]);
  useEffect(() => {
    if (tabParam) {
      setTab(tabParam);
      setView("lista");
    }
  }, [tabParam]);
  const [search, setSearch] = useState(busca ?? "");
  useEffect(() => {
    if (busca) setSearch(busca);
  }, [busca]);
  const [newOpen, setNewOpen] = useState(!!novo);
  useEffect(() => {
    if (novo) setNewOpen(true);
  }, [novo]);
  const [detailId, setDetailId] = useState<string | null>(pedido ?? null);
  /** cartão/botão de onde a janela nasce (animação de abrir e fechar) */
  const [originEl, setOriginEl] = useState<HTMLElement | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<{ id: string; name: string; trash: boolean } | null>(null);

  useEffect(() => {
    if (pedido) setDetailId(pedido);
  }, [pedido]);

  const confirm = useServerFn(confirmOrder);
  const cancel = useServerFn(cancelOrder);
  const trash = useServerFn(trashOrder);
  const restore = useServerFn(restoreOrder);
  const purge = useServerFn(purgeOrder);
  const duplicate = useServerFn(duplicateOrder);
  const status = useServerFn(setOrderStatus);
  const pay = useServerFn(setOrderPayment);
  const [deliverAsk, setDeliverAsk] = useState<any | null>(null);
  /** Entregar: se ainda houver saldo, avisa antes (não bloqueia). */
  const deliver = (o: any, at?: { x: number; y: number }) => {
    if (paymentInfo(o).due > 0) return setDeliverAsk(o);
    void celebrate(() => status({ data: { orderId: o.id, status: "entregue" } }), "Pedido entregue.", at, o.id);
  };
  /** Muda a etapa na tela na hora (o cartão já voa para a coluna); devolve como desfazer. */
  const optimistic = (orderId: string, next: string) => {
    const key = ["orders-central"] as const;
    const previous = qc.getQueryData<any>(key);
    qc.setQueryData<any>(key, (old: any) =>
      old ? { ...old, orders: old.orders.map((x: any) => (x.id === orderId ? { ...x, status: next } : x)) } : old,
    );
    return () => previous && qc.setQueryData(key, previous);
  };
  /** Ação de entrega: roda, avisa e solta a comemoração onde o clique/soltura aconteceu. */
  const celebrate = async (fn: () => Promise<any>, ok: string, at?: { x: number; y: number }, orderId?: string) => {
    const undo = orderId ? optimistic(orderId, "entregue") : null;
    if (orderId) burst(at?.x ?? window.innerWidth / 2, at?.y ?? window.innerHeight / 2);
    try {
      const res = await fn();
      toast.success(ok);
      (res?.warnings ?? []).forEach((w: string) => toast.warning(w));
      if (!orderId) burst(at?.x ?? window.innerWidth / 2, at?.y ?? window.innerHeight / 2);
      refresh();
    } catch (e: any) {
      undo?.();
      toast.error(e?.message ?? "Não foi possível concluir a ação.");
    }
  };

  const [restockId, setRestockId] = useState<string | null>(null);
  const [sort, setSort] = useState<"recentes" | "antigos" | "valor" | "entrega">("recentes");

  const { data, isPending } = useQuery({
    queryKey: ["orders-central"],
    queryFn: async () => {
      const [orders, items, sources, restock] = await Promise.all([
        supabase.from("catalog_orders").select("*").order("created_at", { ascending: false }).limit(400),
        supabase.from("catalog_order_items").select("*"),
        supabase.from("restock_item_sources").select("order_id, order_item_id, restock_item_id, quantity"),
        supabase.from("restock_items").select("id, status"),
      ]);
      const productIds = [...new Set((items.data ?? []).map((i: any) => i.product_id).filter(Boolean))];
      const products = productIds.length
        ? await supabase.from("products").select("id, image_url, brand").in("id", productIds)
        : { data: [] as any[] };
      return {
        orders: orders.data ?? [],
        items: items.data ?? [],
        sources: sources.data ?? [],
        restock: restock.data ?? [],
        products: products.data ?? [],
      };
    },
  });


  const loadPurchases = useServerFn(purchaseBoard);
  const purchases = useQuery({
    queryKey: ["purchase-board"],
    queryFn: () => loadPurchases(),
    staleTime: 20_000,
    refetchInterval: 90_000,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["purchase-board"] });
    qc.invalidateQueries({ queryKey: ["orders-central"] });
    qc.invalidateQueries({ queryKey: ["admin-restock"] });
    qc.invalidateQueries({ queryKey: ["active-orders"] });
    qc.invalidateQueries({ queryKey: ["payment-summary"] });
    qc.invalidateQueries({ queryKey: ["order-events"] });
  };

  const itemsByOrder = useMemo(() => {
    const map = new Map<string, any[]>();
    (data?.items ?? []).forEach((i: any) => {
      map.set(i.order_id, [...(map.get(i.order_id) ?? []), i]);
    });
    return map;
  }, [data]);

  /** Foto e marca do catálogo, para os itens aparecerem na lista. */
  const productInfo = useMemo(() => {
    const map = new Map<string, { image: string | null; brand: string | null }>();
    (data?.products ?? []).forEach((p: any) => map.set(p.id, { image: p.image_url, brand: p.brand }));
    return map;
  }, [data]);
  const imageOf = (l: any) => l.image_snapshot ?? (l.product_id ? productInfo.get(l.product_id)?.image : null);

  const linkedOrders = useMemo(
    () => new Set((data?.sources ?? []).map((s: any) => s.order_id)),
    [data],
  );

  /** Reposição do pedido: não enviada, parcial ou enviada. */
  const restockState = useMemo(() => {
    const sentByOrder = new Map<string, Set<string>>();
    (data?.sources ?? []).forEach((s: any) => {
      const set = sentByOrder.get(s.order_id) ?? new Set<string>();
      set.add(s.order_item_id);
      sentByOrder.set(s.order_id, set);
    });
    const map = new Map<string, "nao" | "parcial" | "enviada">();
    (data?.orders ?? []).forEach((o: any) => {
      const lines = (data?.items ?? []).filter((i: any) => i.order_id === o.id);
      const sent = sentByOrder.get(o.id)?.size ?? 0;
      map.set(o.id, sent === 0 ? "nao" : sent >= lines.length ? "enviada" : "parcial");
    });
    return map;
  }, [data]);

  const orderedOrders = useMemo(() => {
    const bought = new Set(
      (data?.restock ?? []).filter((r: any) => r.status !== "a comprar").map((r: any) => r.id),
    );
    return new Set(
      (data?.sources ?? []).filter((s: any) => bought.has(s.restock_item_id)).map((s: any) => s.order_id),
    );
  }, [data]);


  const counts = useMemo(() => {
    const live = (data?.orders ?? []).filter((o: any) => !o.deleted_at);
    return {
      todos: live.length,
      aguardando: live.filter((o: any) => !o.is_confirmed && o.status !== "cancelado").length,
      confirmados: live.filter((o: any) => o.is_confirmed && o.status !== "cancelado").length,
      pendente: live.filter((o: any) => o.status === "pendente").length,
      "pedido feito": live.filter((o: any) => o.status === "pedido feito").length,
      entregue: live.filter((o: any) => o.status === "entregue").length,
      cancelado: live.filter((o: any) => o.status === "cancelado").length,
      lixeira: (data?.orders ?? []).filter((o: any) => o.deleted_at).length,
      ...Object.fromEntries(PAY_FILTERS.map((f) => [f.key, live.filter(f.test).length])),
      ...Object.fromEntries(DELIVERY_FILTERS.map((f) => [f.key, live.filter(f.test).length])),
    } as Record<string, number>;
  }, [data]);

  const buyMap = useMemo(() => buyByOrder(purchases.data?.items), [purchases.data]);
  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    const digits = q.replace(/\D/g, "");
    const filtered = (data?.orders ?? []).filter((o: any) => {
      if (tab === "lixeira") {
        if (!o.deleted_at) return false;
      } else if (o.deleted_at) return false;

      if (tab === "aguardando" && (o.is_confirmed || o.status === "cancelado")) return false;
      if (tab === "confirmados" && (!o.is_confirmed || o.status === "cancelado")) return false;
      if (["pendente", "pedido feito", "entregue", "cancelado"].includes(tab) && o.status !== tab) return false;
      const pf = PAY_FILTERS.find((f) => f.key === tab);
      if (pf && !pf.test(o)) return false;
      if (tab.startsWith("j_")) {
        if (journeyOf(o, buyMap) !== tab.slice(2)) return false;
        if (tab === "j_entregue" && String(o.updated_at ?? o.created_at).slice(0, 7) !== todayBR().slice(0, 7)) return false;
      }
      const df = DELIVERY_FILTERS.find((f) => f.key === tab);
      if (df && !df.test(o)) return false;

      if (!q) return true;
      // Busca única: número do pedido, cliente, telefone ou nome do perfume.
      const haystack = [o.customer_name ?? "", o.order_number ?? "", o.customer_phone ?? ""]
        .join(" ")
        .toLowerCase();
      if (haystack.includes(q)) return true;
      if (digits.length >= 3 && (o.customer_phone ?? "").replace(/\D/g, "").includes(digits)) return true;
      const lines = itemsByOrder.get(o.id) ?? [];
      return lines.some((l: any) => (l.product_name_snapshot ?? "").toLowerCase().includes(q));
    });

    const value = (o: any) => Number(o.final_total ?? o.grand_total ?? o.sales_total ?? 0);
    const time = (o: any) => new Date(o.created_at).getTime();
    if (sort === "entrega")
      return [...filtered].sort(
        (a: any, b: any) =>
          deliveryRank(a) - deliveryRank(b) ||
          (a.expected_delivery_date ?? "9").localeCompare(b.expected_delivery_date ?? "9") ||
          (a.expected_delivery_time ?? "99").localeCompare(b.expected_delivery_time ?? "99") ||
          statusRank(a) - statusRank(b),
      );
    return [...filtered].sort((a: any, b: any) =>
      statusRank(a) - statusRank(b) ||
      (sort === "valor" ? value(b) - value(a) : sort === "antigos" ? time(a) - time(b) : time(b) - time(a)),
    );
  }, [data, tab, search, sort, itemsByOrder, buyMap]);


  const [confirming, setConfirming] = useState<string | null>(null);

  /**
   * Confirmação otimista: o cartão muda de estado na hora e a reposição é
   * sincronizada no servidor em seguida. Se falhar, volta ao estado anterior.
   */
  const confirmNow = async (orderId: string) => {
    if (confirming) return;
    setConfirming(orderId);
    const key = ["orders-central"] as const;
    const previous = qc.getQueryData<any>(key);
    qc.setQueryData<any>(key, (old: any) =>
      old
        ? {
            ...old,
            orders: old.orders.map((o: any) =>
              o.id === orderId
                ? {
                    ...o,
                    is_confirmed: true,
                    confirmed_at: new Date().toISOString(),
                    canceled_at: null,
                    status: o.status === "cancelado" ? "pendente" : o.status,
                  }
                : o,
            ),
          }
        : old,
    );
    try {
      const res: any = await confirm({ data: { orderId } });
      toast.success("Pedido confirmado.");
      if (res?.created > 0) toast.success(`${res.created} itens na reposição.`);
      else if (res?.alreadyConfirmed) toast.info("Já está na reposição.");
      (res?.warnings ?? []).forEach((w: string) => toast.warning(w));
      qc.invalidateQueries({ queryKey: ["orders-central"] });
      qc.invalidateQueries({ queryKey: ["admin-restock"] });
    } catch (e: any) {
      if (previous) qc.setQueryData(key, previous);
      toast.error(e?.message ?? "Não foi possível confirmar o pedido.");
    } finally {
      setConfirming(null);
    }
  };

  const run = async (fn: () => Promise<any>, ok: string) => {
    try {
      const res = await fn();
      toast.success(ok);
      if (res?.created > 0) toast.success(`${res.created} itens na reposição.`);
      (res?.warnings ?? []).forEach((w: string) => toast.warning(w));
      refresh();
      return res;
    } catch (e: any) {
      toast.error(e?.message ?? "Não foi possível concluir a ação.");
    }
  };

  /** Ações secundárias do pedido — todas dentro do "⋯". */
  const moreActions = (o: any): AdminAction[] => {
    const wa = whatsappLink(o.customer_phone);
    if (o.deleted_at) {
      const items: AdminAction[] = [
        {
          label: "Restaurar",
          icon: <RotateCcw className="size-4" />,
          onSelect: () => run(() => restore({ data: { orderId: o.id } }), "Pedido restaurado."),
        },
      ];
      if (role === "owner")
        items.push({
          label: "Excluir definitivamente",
          icon: <Trash2 className="size-4" />,
          danger: true,
          separated: true,
          onSelect: () => setToDelete({ id: o.id, name: o.customer_name ?? "Cliente", trash: false }),
        });
      return items;
    }

    const items: AdminAction[] = [
      { label: "Ver pedido", onSelect: () => setDetailId(o.id) },
      {
        label: "Editar pedido",
        icon: <Pencil className="size-4" />,
        // fecha o pedido aberto antes: a edição nunca fica por baixo
        onSelect: () => {
          setDetailId(null);
          setEditId(o.id);
        },
      },
    ];
    if (!o.is_confirmed)
      items.push({ label: "Confirmar pedido", icon: <Check className="size-4" />, onSelect: () => confirmNow(o.id) });
    ["pendente", "pedido feito", "entregue"]
      .filter((s) => s !== o.status)
      .forEach((s) =>
        items.push({
          label: `Marcar como ${s}`,
          onSelect: () =>
            s === "entregue" ? deliver(o) : run(() => status({ data: { orderId: o.id, status: s } }), "Status atualizado."),
        }),
      );
    items.push({
      label: "Duplicar",
      icon: <Copy className="size-4" />,
      separated: true,
      onSelect: () => run(() => duplicate({ data: { orderId: o.id } }), "Pedido duplicado."),
    });
    if (wa) items.push({ label: "Abrir WhatsApp", icon: <MessageCircle className="size-4" />, href: wa });
    if (o.status !== "cancelado")
      items.push({
        label: "Enviar para reposição",
        icon: <ClipboardList className="size-4" />,
        onSelect: () => setRestockId(o.id),
      });

    if (o.is_confirmed)
      items.push({
        label: "Ver na reposição",
        icon: <ClipboardList className="size-4" />,
        onSelect: () => navigate({ to: "/admin/reposicao", search: { pedido: o.id } }),
      });
    if (o.status !== "cancelado")
      items.push({
        label: "Cancelar pedido",
        icon: <X className="size-4" />,
        danger: true,
        separated: true,
        onSelect: () => run(() => cancel({ data: { orderId: o.id } }), "Pedido cancelado."),
      });
    items.push({
      label: "Excluir pedido",
      icon: <Trash2 className="size-4" />,
      danger: true,
      onSelect: () => setToDelete({ id: o.id, name: o.customer_name ?? "Cliente", trash: true }),
    });
    return items;
  };

  const activeExtra = EXTRA_TABS.find((t) => t.key === tab);

  /** Próxima ação do pedido (botão do cartão e do painel). */
  const quickOf = (o: any): Quick => {
    if (o.deleted_at || o.status === "cancelado") return null;
    if (!o.is_confirmed) return { label: "Confirmar", run: () => confirmNow(o.id) };
    const rest = restockState.get(o.id) ?? "nao";
    if (o.status === "pendente")
      return { label: "Mover p/ Pagos", run: () => moveTo(o, "pago") };
    if (o.status === "pedido feito" && rest === "nao" && !(itemsByOrder.get(o.id) ?? []).length) return null;
    if (o.status === "pedido feito") return { label: "Entregar", run: (at) => deliver(o, at) };
    return null;
  };

  /** Arrastou no quadro: muda a etapa (entregar pergunta do saldo, como sempre). */
  const moveTo = (o: any, to: Stage, at?: { x: number; y: number }) => {
    if (to === "entregue") return deliver(o, at);
    const next = to === "pago" ? "pedido feito" : "pendente";
    const undo = optimistic(o.id, next);
    status({ data: { orderId: o.id, status: next } })
      .then(() => {
        toast.success(to === "pago" ? "Movido para Pagos." : "Voltou para Novos.");
        refresh();
      })
      .catch((e: any) => {
        undo();
        toast.error(e?.message ?? "Não foi possível mover o pedido.");
      });
  };

  const deps: CardDeps = {
    linesOf: (o) => itemsByOrder.get(o.id) ?? [],
    imageOf: (l) => {
      const src = imageOf(l);
      return src ? (imgVariant(src, "thumb") ?? src) : null;
    },
    quickOf,
    moreOf: moreActions,
    onOpen: (o, from) => {
      setOriginEl(from ?? null);
      setDetailId(o.id);
    },
    busyId: confirming,
  };

  const live = (data?.orders ?? []).filter((o: any) => !o.deleted_at && o.status !== "cancelado");
  const stats = {
    toDeliver: live.filter((o: any) => o.status === "pedido feito").length,
    unpaid: live.filter((o: any) => o.status === "pendente").length,
    due: live.filter((o: any) => o.status !== "entregue" || paymentInfo(o).due > 0).reduce((s: number, o: any) => s + paymentInfo(o).due, 0),
    month: live
      .filter((o: any) => String(o.created_at).slice(0, 7) === new Date().toISOString().slice(0, 7))
      .reduce((s: number, o: any) => s + Number(o.final_total ?? o.grand_total ?? o.sales_total ?? 0), 0),
  };
  const searching = search.trim().length > 0;
  const boardMode = view === "quadro" && !searching;
  const listMode = view === "lista" || (view === "quadro" && searching);
  const live2 = (data?.orders ?? []).filter((o: any) => !o.deleted_at && o.status !== "cancelado");
  const alerts =
    live2.filter((o: any) => o.status !== "entregue" && ["late", "today"].includes(deliveryState(o))).length +
    live2.filter((o: any) => ["late", "today"].includes(dueInfo(o).state) || (o.status === "entregue" && paymentInfo(o).due > 0)).length +
    (purchases.data?.items ?? []).filter((p) => p.status === "a comprar" && p.plannedDate && p.plannedDate <= todayBR()).length;
  const toBuyCount = (purchases.data?.items ?? []).filter((p) => p.status === "a comprar").length;
  const receivedNow = (o: any, at?: { x: number; y: number }) =>
    void celebrate(() => pay({ data: { orderId: o.id, mode: "paid", origin: "cobranca" } }), "Pagamento recebido. Tudo certo!", at);
  const detailOrder = (data?.orders ?? []).find((o: any) => o.id === detailId) ?? null;

  return (
    <AdminShell
      title="Pedidos"
      wide
      action={
        <button
          type="button"
          onClick={(e) => {
            setOriginEl(e.currentTarget);
            setNewOpen(true);
          }}
          className="press inline-flex h-[54px] items-center gap-2 rounded-full bg-[#FFD599] pr-7 pl-6 text-[15px] font-bold text-[#15130F] transition-colors hover:bg-[#FFDDAA]"
        >
          <Plus className="size-[18px]" strokeWidth={2.6} /> Novo pedido
        </button>
      }
    >
      {/* abas: Hoje (alertas) · Quadro · Lista · Compras */}
      <nav aria-label="Pedidos" className="grid grid-cols-4 gap-1.5 sm:flex sm:gap-2">
        {VIEWS.map((v) => {
          const on = view === v.key;
          const badge = v.key === "painel" ? alerts : v.key === "compras" ? toBuyCount : 0;
          return (
            <button
              key={v.key}
              type="button"
              aria-pressed={on}
              onClick={() => setView(v.key)}
              className={cn(
                "press relative flex h-[60px] shrink-0 flex-col items-center justify-center gap-1 rounded-[20px] text-[12.5px] font-bold transition-colors duration-200 sm:h-[52px] sm:flex-row sm:gap-2 sm:rounded-full sm:pr-5 sm:pl-4 sm:text-[15px]",
                on ? "bg-white text-[#15130F]" : "bg-[#1A1A1A] text-[#A9A9A9] hover:text-white",
              )}
            >
              <v.icon className="size-[18px]" strokeWidth={2.2} />
              {v.label}
              {badge > 0 ? (
                <span
                  key={badge}
                  className={cn(
                    "ord-bump grid h-[22px] min-w-[22px] place-items-center rounded-full px-1.5 text-[11.5px] font-bold tabular-nums max-sm:absolute max-sm:top-1.5 max-sm:right-1.5 max-sm:h-[19px] max-sm:min-w-[19px] max-sm:text-[10.5px]",
                    v.key === "painel" ? "bg-[#FF9A8A] text-[#15130F]" : "bg-[#FFD599] text-[#15130F]",
                  )}
                >
                  {badge}
                </span>
              ) : null}
            </button>
          );
        })}
      </nav>

      {view === "quadro" || view === "lista" ? (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
            <Stat i={0} hero label="Para entregar" value={String(stats.toDeliver)} hint="pagos, esperando" onClick={() => { setView("quadro"); setSearch(""); }} />
            <Stat i={1} label="Novos" value={String(stats.unpaid)} hint="aguardando pagamento" onClick={() => { setView("lista"); setTab("pendente"); }} />
            <Stat i={2} label="A receber" value={brl(stats.due)} hint="saldo em aberto" onClick={() => { setView("lista"); setTab("pg_due"); }} />
            <Stat i={3} label="Este mês" value={brl(stats.month)} hint="em pedidos" />
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2.5">
        <label className="flex h-[52px] min-w-0 flex-1 basis-[280px] items-center gap-3 rounded-full bg-[#1A1A1A] px-5 focus-within:ring-2 focus-within:ring-[#FFD599]/50">
          <Search className="size-[18px] shrink-0 text-[#8C8C8C]" strokeWidth={2.2} />
          <input data-slot="input-group-control"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cliente, telefone, perfume ou nº do pedido"
            className="h-full min-w-0 flex-1 bg-transparent text-[15.5px] outline-none placeholder:text-[#6F6F6F]"
          />
          {search ? (
            <button type="button" onClick={() => setSearch("")} aria-label="Limpar" className="press grid size-8 place-items-center rounded-full bg-[#2E2E2E]">
              <X className="size-4" />
            </button>
          ) : null}
        </label>
          </div>
      {listMode ? (
        <div className="mt-3 flex items-center gap-2">
          <div className="-mx-1 flex min-w-0 flex-1 gap-1.5 overflow-x-auto px-1 pb-1">
            {MAIN_TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={cn(
                  "press h-10 shrink-0 rounded-full px-4 text-[14px] font-semibold transition-colors",
                  tab === t.key ? "bg-white text-[#15130F]" : "bg-[#1A1A1A] text-[#A9A9A9] hover:text-white",
                )}
              >
                {t.label}
                {counts[t.key] ? <span className="ml-1.5 tabular-nums opacity-60">{counts[t.key]}</span> : null}
              </button>
            ))}
            {activeExtra ? (
              <button type="button" onClick={() => setTab("todos")} className="press h-10 shrink-0 rounded-full bg-white px-4 text-[14px] font-semibold text-[#15130F]">
                {activeExtra.label} <X className="ml-1 inline size-3.5" />
              </button>
            ) : null}
          </div>
          <AdminMore
            label="Filtros e ordem"
            actions={[
              ...EXTRA_TABS.map((t) => ({ label: t.label, onSelect: () => setTab(t.key) })),
              { label: "Mais recentes", separated: true, onSelect: () => setSort("recentes") },
              { label: "Mais antigos", onSelect: () => setSort("antigos") },
              { label: "Maior valor", onSelect: () => setSort("valor") },
              { label: "Data de entrega", onSelect: () => setSort("entrega") },
            ]}
            trigger={
              <button type="button" className="press grid size-10 shrink-0 place-items-center rounded-full bg-[#1A1A1A] text-[#A9A9A9] hover:text-white" aria-label="Filtros">
                <SlidersHorizontal className="size-4" strokeWidth={2} />
              </button>
            }
          />
        </div>
      ) : null}
        </>
      ) : null}

      <div className="mt-4">
        {isPending ? (
          <div className="grid gap-4 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="space-y-2.5 rounded-[28px] bg-[#141414] p-3.5">
                {[0, 1, 2].map((j) => (
                  <div key={j} className="admin-skeleton h-[188px] rounded-[22px]" />
                ))}
              </div>
            ))}
          </div>
        ) : view === "painel" ? (
          <OrdersDashboard
            orders={data?.orders ?? []}
            linesOf={deps.linesOf}
            imageOf={deps.imageOf}
            purchases={purchases.data?.items}
            onOpen={(o, el) => deps.onOpen(o, el)}
            onDeliver={(o, at) => deliver(o, at)}
            onReceived={receivedNow}
            onGoPurchases={() => setView("compras")}
            onJourney={(j) => {
              setSearch("");
              setTab(`j_${j}`);
              setView("lista");
            }}
            onBoard={() => setView("quadro")}
          />
        ) : view === "compras" ? (
          <PurchasesView
            items={purchases.data?.items}
            loading={purchases.isPending}
            onChanged={refresh}
            onOpenOrder={(id) => {
              setOriginEl(null);
              setDetailId(id);
            }}
          />
        ) : boardMode ? (
          <OrderBoard
            orders={data?.orders ?? []}
            deps={deps}
            onMove={moveTo}
            onShowAllDone={() => {
              setView("lista");
              setTab("entregue");
            }}
          />
        ) : list.length === 0 ? (
          <AdminEmpty>{searching ? `Nenhum pedido com “${search.trim()}”.` : "Nenhum pedido por aqui."}</AdminEmpty>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 wide:grid-cols-4">
            {list.map((o: any, i: number) => (
              <OrderCard key={o.id} o={o} i={i} deps={deps} />
            ))}
          </div>
        )}
      </div>

      <OrderComposer
        open={newOpen}
        originEl={originEl}
        onClose={() => {
          setNewOpen(false);
          setOriginEl(null);
          refresh();
        }}
        onCreated={(id) => {
          setNewOpen(false);
          refresh();
          setTimeout(() => {
            setOriginEl(document.querySelector<HTMLElement>(`[data-order-id="${id}"]`));
            setDetailId(id);
          }, 520);
        }}
      />

      <OrderPanel
        order={detailOrder}
        lines={detailId ? (itemsByOrder.get(detailId) ?? []) : []}
        imageOf={imageOf}
        brandOf={(l: any) => (l.product_id ? (productInfo.get(l.product_id)?.brand ?? null) : null)}
        restock={detailId ? (restockState.get(detailId) ?? "nao") : "nao"}
        inRestock={detailId ? linkedOrders.has(detailId) : false}
        alreadyBought={detailId ? orderedOrders.has(detailId) : false}
        quick={detailOrder ? quickOf(detailOrder) : null}
        busy={confirming === detailId}
        onClose={() => {
          setDetailId(null);
          setOriginEl(null);
        }}
        onEdit={(id) => {
          setDetailId(null);
          setEditId(id);
        }}
        onChanged={refresh}
        more={moreActions}
        originEl={originEl}
      />

      <OrderRestockSheet
        orderId={restockId}
        orderNumber={(data?.orders ?? []).find((o: any) => o.id === restockId)?.order_number}
        onClose={() => setRestockId(null)}
      />


      <OrderEditSheet
        open={!!editId}
        role={role}
        order={(data?.orders ?? []).find((o: any) => o.id === editId) ?? null}
        lines={editId ? (itemsByOrder.get(editId) ?? []) : []}
        onClose={() => setEditId(null)}
        onSaved={refresh}
      />

      {deliverAsk && typeof document !== "undefined" ? createPortal(
        <div className="admin-theme adm-fade fixed inset-0 z-[70] flex items-end justify-center bg-black/65 sm:items-center" onClick={() => setDeliverAsk(null)}>
          <div
            role="alertdialog"
            aria-label="Ainda falta receber"
            onClick={(e) => e.stopPropagation()}
            className="ord-sheet-up w-full max-w-[440px] rounded-t-[32px] border border-white/[0.07] bg-[#141414] p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-white sm:rounded-[32px] sm:pb-5"
          >
            <span className="grid size-12 place-items-center rounded-full bg-[#2A2418] text-[#FFD599]">
              <HandCoins className="size-6" />
            </span>
            <p className="mt-4 text-[22px] leading-tight font-bold tracking-[-0.03em]">
              {(deliverAsk.customer_name ?? "Cliente").split(" ")[0]} ainda deve {brl(paymentInfo(deliverAsk).due)}
            </p>
            <p className="mt-1 text-[14px] text-[#A9A9A9]">
              Pagou {brl(paymentInfo(deliverAsk).paid)} de {brl(paymentInfo(deliverAsk).total)}. Recebeu o resto na entrega?
            </p>
            <div className="mt-5 grid gap-2">
              <button
                type="button"
                onClick={async () => {
                  const o = deliverAsk;
                  setDeliverAsk(null);
                  await celebrate(async () => {
                    await pay({ data: { orderId: o.id, mode: "paid", origin: "entrega" } });
                    return status({ data: { orderId: o.id, status: "entregue" } });
                  }, "Restante recebido e pedido entregue.", undefined, o.id);
                }}
                className="press flex h-[56px] items-center justify-center gap-2 rounded-full bg-[#FFD599] text-[15px] font-bold text-[#15130F] hover:bg-[#FFDDAA]"
              >
                <Check className="size-5" strokeWidth={2.6} /> Recebi tudo e entreguei
              </button>
              <button
                type="button"
                onClick={() => {
                  const o = deliverAsk;
                  setDeliverAsk(null);
                  void celebrate(() => status({ data: { orderId: o.id, status: "entregue" } }), "Entregue. O saldo continua em “Cobrar”.", undefined, o.id);
                }}
                className="press h-12 rounded-full bg-[#1F1F1F] text-[14px] font-bold text-[#FF9A8A] hover:bg-[#262626]"
              >
                Entregar sem receber (fica devendo)
              </button>
              <button type="button" onClick={() => setDeliverAsk(null)} className="press h-11 rounded-full text-[14px] font-semibold text-[#A9A9A9] hover:text-white">
                Voltar
              </button>
            </div>
          </div>
        </div>,
        document.body,
      ) : null}

      <AdminConfirm
        open={!!toDelete}
        onOpenChange={(v) => !v && setToDelete(null)}
        title={toDelete?.trash ? "Excluir pedido" : "Excluir definitivamente"}
        description={
          toDelete?.trash
            ? "O pedido vai para a lixeira e pode ser restaurado."
            : "Essa ação não pode ser desfeita."
        }
        confirmLabel="Excluir"
        danger
        onConfirm={() => {
          const target = toDelete!;
          run(
            () =>
              target.trash
                ? trash({ data: { orderId: target.id } })
                : purge({ data: { orderId: target.id } }),
            target.trash ? "Pedido na lixeira." : "Pedido excluído.",
          );
        }}
      />
    </AdminShell>
  );
}

function Stat({ label, value, hint, hero, i, onClick }: { label: string; value: string; hint: string; hero?: boolean; i: number; onClick?: () => void }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      {...(onClick ? { type: "button" as const, onClick } : {})}
      className={cn(
        "adm-rise flex min-h-[112px] flex-col justify-between p-4 text-left lg:min-h-[124px] lg:p-5",
        hero ? "dash-hero" : "dash-card",
        onClick && "press transition-colors",
        onClick && !hero && "hover:bg-[#1F1F1F]",
      )}
      style={{ ["--i" as string]: i }}
    >
      <span className={cn("text-[14px] font-semibold", hero ? "text-[#15130F]/70" : "text-[#A9A9A9]")}>{label}</span>
      <span>
        <span className="block truncate text-[clamp(1.5rem,5vw,2.1rem)] leading-none font-bold tracking-[-0.04em] tabular-nums">{value}</span>
        <span className={cn("mt-1 block truncate text-[12.5px]", hero ? "text-[#15130F]/60" : "text-[#8C8C8C]")}>{hint}</span>
      </span>
    </Tag>
  );
}
