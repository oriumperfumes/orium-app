/**
 * ADMIN → AO VIVO.
 * Quem está na loja agora, o que está vendo e quem está perto de comprar.
 * Cada visitante abre no painel de Produtos/Pedidos para atender: mensagem,
 * cupom ou ajuda chegam na hora no aparelho da pessoa (canal da sessão).
 * Tudo em tempo real (live_sessions) e com dados reais de navegação.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Eye,
  HeartHandshake,
  MessageCircle,
  MonitorSmartphone,
  Radio,
  ShoppingBag,
  Sparkles,
  UserCheck,
} from "lucide-react";
import { toast } from "sonner";
import { AdminShell } from "@/components/orium/AdminShell";
import { SidePanel } from "@/components/orium/admin/orders/model";
import {
  GoldButton,
  MiniStat,
  PanelCard,
  PanelFooter,
  PanelHeader,
  PanelScroll,
  PanelTabs,
  Segmented,
  SoftButton,
  StatusDot,
  TextArea,
} from "@/components/orium/admin/PanelKit";
import { PxKpi, PxNote } from "@/components/orium/admin/PricingUI";
import { Bars } from "@/components/orium/CustomerSheet";
import { supabase } from "@/integrations/supabase/client";
import { brl } from "@/lib/format";
import {
  liveOverview,
  liveSession,
  liveCoupons,
  liveSend,
  liveCreateCoupon,
  type LiveSessionRow,
} from "@/lib/live.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/admin/aovivo")({
  head: () => ({
    meta: [{ title: "Ao vivo — Orium Admin" }, { name: "robots", content: "noindex" }],
  }),
  component: LivePage,
});

type Filter = "todos" | "alta" | "carrinho" | "checkout" | "identificados" | "anonimos";

const FILTERS: Array<{ value: Filter; label: string; match: (s: LiveSessionRow) => boolean }> = [
  { value: "todos", label: "Todos", match: () => true },
  { value: "alta", label: "Perto de comprar", match: (s) => s.intent === "alta" },
  { value: "carrinho", label: "Com carrinho", match: (s) => s.cart_items > 0 },
  { value: "checkout", label: "Finalizando", match: (s) => s.in_checkout },
  { value: "identificados", label: "Identificados", match: (s) => s.identified },
  { value: "anonimos", label: "Anônimos", match: (s) => !s.identified },
];

const INTENT = {
  alta: { label: "Perto de comprar", cls: "bg-[#FFD599] text-[#15130F]" },
  media: { label: "Interessado", cls: "bg-white/[0.08] text-white" },
  baixa: { label: "Navegando", cls: "bg-[#232323] text-[#A9A9A9]" },
} as const;

const shortId = (key: string) => `#${key.replace(/-/g, "").slice(-4).toUpperCase()}`;
const minutesAgo = (iso: string) =>
  Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
const isLive = (iso: string) => minutesAgo(iso) < 2;
const deviceName = (d: string | null) =>
  d === "mobile" ? "Celular" : d === "tablet" ? "Tablet" : "Computador";
const nameOf = (s: Pick<LiveSessionRow, "identified" | "display_name" | "session_key">) =>
  s.identified && s.display_name ? s.display_name : `Visitante ${shortId(s.session_key)}`;
const hhmm = (iso: string) =>
  new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

function doingNow(s: LiveSessionRow) {
  if (s.in_checkout) return "Finalizando o pedido";
  if (s.current_product_name) return `Vendo ${s.current_product_name}`;
  if (s.current_route?.startsWith("/negociacao")) return "Na Negociação";
  if (s.current_route?.startsWith("/carrinho")) return "Olhando a sacola";
  return "Navegando no catálogo";
}

function LivePage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>("todos");
  const [open, setOpen] = useState<{ key: string; el: HTMLElement | null } | null>(null);
  const [, tick] = useState(0);

  const { data, isPending, isError } = useQuery({
    queryKey: ["live-overview"],
    queryFn: () => liveOverview(),
    refetchInterval: 30_000,
    staleTime: 5_000,
  });

  // Tempo real: mudou uma sessão, o painel se atualiza sozinho.
  useEffect(() => {
    const channel = supabase
      .channel("orium-live-admin")
      .on("postgres_changes", { event: "*", schema: "public", table: "live_sessions" }, () => {
        void qc.invalidateQueries({ queryKey: ["live-overview"] });
        void qc.invalidateQueries({ queryKey: ["live-session"] });
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [qc]);
  // "há X min" anda sozinho
  useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), 30_000);
    return () => window.clearInterval(t);
  }, []);

  const all = data?.sessions ?? [];
  const sessions = useMemo(() => {
    const f = FILTERS.find((x) => x.value === filter)!;
    // quem está perto de comprar e ativo agora vem primeiro
    const rank = (s: LiveSessionRow) =>
      s.in_checkout
        ? 0
        : s.intent === "alta"
          ? 1
          : s.cart_items > 0
            ? 2
            : s.intent === "media"
              ? 3
              : 4;
    return all
      .filter(f.match)
      .sort(
        (a, b) =>
          rank(a) - rank(b) || +new Date(b.last_activity_at) - +new Date(a.last_activity_at),
      );
  }, [all, filter]);

  const kpis: Array<{ label: string; value: number; icon: ReactNode; foot: string }> = [
    {
      label: "Na loja agora",
      value: data?.visitors ?? 0,
      icon: <Radio className="size-[18px]" strokeWidth={2.2} />,
      foot: "Visitantes com a loja aberta",
    },
    {
      label: "Identificados",
      value: data?.identified ?? 0,
      icon: <UserCheck className="size-[18px]" strokeWidth={2.2} />,
      foot: "Com nome ou WhatsApp",
    },
    {
      label: "Com carrinho",
      value: data?.carts ?? 0,
      icon: <ShoppingBag className="size-[18px]" strokeWidth={2.2} />,
      foot: "Itens na sacola agora",
    },
    {
      label: "Vendo perfume",
      value: data?.viewingProduct ?? 0,
      icon: <Eye className="size-[18px]" strokeWidth={2.2} />,
      foot: "Com um perfume aberto",
    },
    {
      label: "Finalizando",
      value: data?.inCheckout ?? 0,
      icon: <Sparkles className="size-[18px]" strokeWidth={2.2} />,
      foot: "Na etapa do pedido",
    },
  ];

  return (
    <AdminShell title="Ao vivo">
      <div className="space-y-5 lg:space-y-6">
        {isError ? (
          <PxNote tone="danger">Não foi possível carregar quem está na loja agora.</PxNote>
        ) : null}

        <section className="grid grid-cols-2 gap-3 lg:gap-4 xl:grid-cols-5">
          {kpis.map((k, i) => (
            <PxKpi
              key={k.label}
              i={i}
              hero={i === 0}
              className={i === 0 ? "col-span-2 xl:col-span-1" : undefined}
              label={k.label}
              icon={k.icon}
              loading={isPending}
              value={
                i === 0 ? (
                  <span className="inline-flex items-center gap-3">
                    {k.value}
                    <span className="live-dot" aria-hidden />
                  </span>
                ) : (
                  k.value
                )
              }
              foot={k.foot}
            />
          ))}
        </section>

        <div
          className="adm-scroll -mx-1 flex gap-2 overflow-x-auto px-1 pb-1"
          role="group"
          aria-label="Filtrar visitantes"
        >
          {FILTERS.map((f) => {
            const n = all.filter(f.match).length;
            return (
              <button
                key={f.value}
                type="button"
                aria-pressed={filter === f.value}
                onClick={() => setFilter(f.value)}
                className={cn(
                  "press inline-flex h-11 shrink-0 items-center gap-2 rounded-full px-4 text-[14px] font-bold transition-colors",
                  filter === f.value
                    ? "bg-white text-[#15130F]"
                    : "bg-[#1A1A1A] text-[#A9A9A9] hover:text-white",
                )}
              >
                {f.label}
                <span
                  className={cn(
                    "tabular-nums",
                    filter === f.value ? "text-[#15130F]/55" : "text-[#6F6F6F]",
                  )}
                >
                  {n}
                </span>
              </button>
            );
          })}
        </div>

        {isPending ? (
          <div className="grid gap-3 md:grid-cols-2 lg:gap-4 xl:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="admin-skeleton h-[196px] rounded-[28px]" />
            ))}
          </div>
        ) : sessions.length === 0 ? (
          <section className="dash-card adm-rise p-8 text-center lg:p-12">
            <span className="dash-ico mx-auto">
              <Radio className="size-[18px]" strokeWidth={2.2} />
            </span>
            <h2 className="mt-4 text-[19px] font-bold tracking-[-0.02em]">
              {all.length ? "Ninguém com esse filtro agora" : "A loja está quieta agora"}
            </h2>
            <p className="mx-auto mt-1.5 max-w-sm text-[14.5px] text-[#A9A9A9]">
              {all.length
                ? "Volte para Todos para ver quem está navegando."
                : "Quando alguém abrir a loja, aparece aqui na hora."}
            </p>
          </section>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 lg:gap-4 xl:grid-cols-3">
            {sessions.map((s, i) => (
              <VisitorCard
                key={s.session_key}
                s={s}
                i={i}
                onOpen={(el) => setOpen({ key: s.session_key, el })}
              />
            ))}
          </div>
        )}
      </div>

      <SessionPanel
        sessionKey={open?.key ?? null}
        originEl={open?.el ?? null}
        onClose={() => setOpen(null)}
      />
    </AdminShell>
  );
}

function VisitorCard({
  s,
  i,
  onOpen,
}: {
  s: LiveSessionRow;
  i: number;
  onOpen: (el: HTMLElement | null) => void;
}) {
  const live = isLive(s.last_activity_at);
  const intent = INTENT[s.intent];
  return (
    <button
      type="button"
      onClick={(e) => onOpen(e.currentTarget)}
      style={{ ["--i" as string]: Math.min(i, 8) + 5 }}
      className={cn(
        "dash-card adm-rise press flex min-w-0 flex-col p-5 text-left transition-colors hover:bg-[#1F1F1F] lg:p-6",
        s.in_checkout && "ring-1 ring-[#FFD599]/40 ring-inset",
      )}
    >
      <span className="flex min-w-0 items-center gap-3">
        <span className="relative grid size-11 shrink-0 place-items-center rounded-full bg-[#232323] text-[#D4D4D4]">
          {s.identified ? (
            <span className="text-[15px] font-bold text-[#FFD599]">
              {(s.display_name ?? "?").trim()[0]?.toUpperCase()}
            </span>
          ) : (
            <MonitorSmartphone className="size-[18px]" strokeWidth={2} />
          )}
          {live ? (
            <span
              className="live-dot absolute -right-0.5 -bottom-0.5 ring-[3px] ring-[#1A1A1A]"
              aria-label="Ativo agora"
            />
          ) : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[16px] font-bold">
            {nameOf(s)}
            {s.multi_device ? (
              <span className="font-medium text-[#8C8C8C]"> · {deviceName(s.device)}</span>
            ) : null}
          </span>
          <span className="mt-0.5 block truncate text-[13px] text-[#8C8C8C]">
            {live ? "Ativo agora" : `Parado há ${minutesAgo(s.last_activity_at)} min`} ·{" "}
            {[s.source ?? "direto", deviceName(s.device)].join(" · ")}
          </span>
        </span>
      </span>

      <span className="mt-4 flex min-w-0 items-start gap-2.5 rounded-[18px] bg-[#232323] px-3.5 py-3">
        <Eye className="mt-0.5 size-4 shrink-0 text-[#8C8C8C]" strokeWidth={2.2} />
        <span className="min-w-0">
          <span className="block truncate text-[14px] font-semibold text-white">{doingNow(s)}</span>
          {s.last_action && s.last_action !== `Visualizou ${s.current_product_name ?? ""}` ? (
            <span className="mt-0.5 block truncate text-[12.5px] text-[#8C8C8C]">
              Antes: {s.last_action}
            </span>
          ) : null}
        </span>
      </span>

      <span className="mt-4 flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "inline-flex h-7 items-center rounded-full px-3 text-[12.5px] font-bold",
            intent.cls,
          )}
        >
          {intent.label}
        </span>
        {s.cart_items > 0 ? (
          <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-[#232323] px-3 text-[12.5px] font-bold text-white tabular-nums">
            <ShoppingBag className="size-3.5" strokeWidth={2.4} /> {brl(s.cart_total)}
          </span>
        ) : null}
        {s.favorites_count > 0 ? (
          <span className="inline-flex h-7 items-center rounded-full bg-[#232323] px-3 text-[12.5px] font-semibold text-[#A9A9A9]">
            {s.favorites_count} {s.favorites_count === 1 ? "favorito" : "favoritos"}
          </span>
        ) : null}
      </span>
    </button>
  );
}

const EVENT_LABEL: Record<string, string> = {
  session_started: "Entrou na Orium",
  product_view: "Abriu",
  card_clicked: "Tocou no card",
  product_open: "Abriu o perfume",
  product_dwell: "Ficou vendo",
  filters_applied: "Usou filtros",
  decant_selected: "Escolheu Decant",
  bottle_selected: "Escolheu Frasco",
  search: "Pesquisou",
  favorite_added: "Favoritou",
  favorite_removed: "Tirou dos favoritos",
  cart_item_added: "Pôs na sacola",
  cart_opened: "Abriu a sacola",
  checkout_started: "Começou a finalizar",
  whatsapp_checkout_clicked: "Foi para o WhatsApp",
  lead_identified: "Informou nome e WhatsApp",
  consultant_help_clicked: "Pediu ajuda",
  negotiation_interest: "Abriu negociação",
  order_created: "Criou pedido",
};
const HOT_EVENTS = new Set([
  "cart_item_added",
  "checkout_started",
  "whatsapp_checkout_clicked",
  "order_created",
  "lead_identified",
]);

const QUICK = [
  "Posso te ajudar a escolher?",
  "Está em dúvida entre Decant e Frasco?",
  "Quer experimentar antes? Temos Decants a partir de R$ 19,90.",
  "Quer que eu te indique algo parecido com o que você procura?",
];

type PanelTab = "atender" | "visita" | "historico";
type Action = "mensagem" | "cupom" | "ajuda";

function SessionPanel({
  sessionKey,
  originEl,
  onClose,
}: {
  sessionKey: string | null;
  originEl: HTMLElement | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [last, setLast] = useState(sessionKey);
  if (sessionKey && sessionKey !== last) setLast(sessionKey);
  const key = sessionKey ?? last;
  const [tab, setTab] = useState<PanelTab>("atender");
  const [action, setAction] = useState<Action>("mensagem");
  const [message, setMessage] = useState("");
  const [coupon, setCoupon] = useState("");

  useEffect(() => {
    if (!sessionKey) return;
    setTab("atender");
    setAction("mensagem");
    setMessage("");
    setCoupon("");
  }, [sessionKey]);

  const { data, isPending } = useQuery({
    queryKey: ["live-session", key],
    queryFn: () => liveSession({ data: { sessionKey: key! } }),
    enabled: !!key,
    refetchInterval: sessionKey ? 20_000 : false,
  });
  const { data: coupons } = useQuery({
    queryKey: ["live-coupons"],
    queryFn: () => liveCoupons(),
    enabled: !!sessionKey && action === "cupom",
    staleTime: 60_000,
  });

  const send = useMutation({
    mutationFn: (input: {
      kind: "mensagem" | "cupom" | "ajuda" | "salvar_escolhas";
      message?: string;
      couponCode?: string;
    }) => liveSend({ data: { sessionKey: key!, ...input } }),
    onSuccess: async () => {
      // Aviso imediato no aparelho do visitante (canal exclusivo da sessão).
      const channel = supabase.channel(`orium-live-${key}`);
      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          void channel.send({ type: "broadcast", event: "interaction", payload: {} }).then(() => {
            void supabase.removeChannel(channel);
          });
        }
      });
      toast.success("Enviado. Espere a resposta antes de abordar de novo.");
      setMessage("");
      setCoupon("");
      await qc.invalidateQueries({ queryKey: ["live-session", key] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não foi possível enviar."),
  });

  const createCoupon = useMutation({
    mutationFn: () => liveCreateCoupon({ data: { sessionKey: key!, percent: 10, hours: 48 } }),
    onSuccess: (res) => {
      setCoupon(res.code);
      toast.success(`Cupom ${res.code} criado (${res.percent}% OFF, uso único).`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não foi possível criar o cupom."),
  });

  const s = data?.session;
  const live = s ? isLive(s.last_activity_at) : false;
  const canSend =
    action === "mensagem" ? message.trim().length >= 3 : action === "cupom" ? !!coupon : true;

  return (
    <SidePanel
      open={!!sessionKey}
      onClose={onClose}
      label={s ? nameOf(s) : "Visitante"}
      originEl={originEl}
    >
      <PanelHeader
        image={null}
        fallback={
          s?.identified ? (
            <span className="text-[18px] font-bold text-[#FFD599]">
              {(s.display_name ?? "?").trim()[0]?.toUpperCase()}
            </span>
          ) : (
            <MonitorSmartphone className="size-6 text-[#D4D4D4]" strokeWidth={2} />
          )
        }
        title={s ? nameOf(s) : isPending ? "Carregando…" : "Visita encerrada"}
        subtitle={
          s ? (
            <span className="inline-flex items-center gap-2">
              {live ? <span className="live-dot" aria-hidden /> : null}
              {live ? "Ativo agora" : `Parado há ${minutesAgo(s.last_activity_at)} min`}
              {s.identified && s.phone ? ` · ${s.phone}` : s.identified ? "" : " · anônimo"}
            </span>
          ) : undefined
        }
        onClose={onClose}
      >
        {s && data ? (
          <>
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <MiniStat
                label="Na sacola"
                value={s.cart_items > 0 ? brl(s.cart_total) : "Vazia"}
                tone="gold"
              />
              <MiniStat label="Itens" value={String(s.cart_items)} />
              <MiniStat label="Favoritos" value={String(data.favorites.length)} />
              <MiniStat
                label="Visitas"
                value={String(s.visitor_sessions ?? 1)}
                onClick={() => setTab("visita")}
              />
            </div>
            <PanelTabs
              className="mt-4"
              value={tab}
              onChange={setTab}
              tabs={[
                { key: "atender", label: "Atender" },
                { key: "visita", label: "Visita" },
                {
                  key: "historico",
                  label: "O que fez",
                  badge: data.timeline.length ? (
                    <span className="text-[12px] font-bold opacity-60">{data.timeline.length}</span>
                  ) : undefined,
                },
              ]}
            />
          </>
        ) : null}
      </PanelHeader>

      <PanelScroll swapKey={`${key}-${tab}`}>
        {isPending ? (
          <div className="admin-skeleton h-40 rounded-[24px]" />
        ) : !s || !data ? (
          <PanelCard>
            <p className="text-[14px] text-[#A9A9A9]">Esta visita já terminou.</p>
          </PanelCard>
        ) : tab === "atender" ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <PanelCard title="Vendo agora" icon={<Eye />}>
                <p className="text-[15px] font-bold">{s.current_product_name ?? "Catálogo"}</p>
                {s.current_variant ? (
                  <p className="mt-1 text-[13px] text-[#8C8C8C]">
                    {s.current_variant === "DECANT"
                      ? `Decant${s.current_decant_ml ? ` ${s.current_decant_ml} ml` : ""}`
                      : "Frasco"}
                  </p>
                ) : null}
              </PanelCard>
              <PanelCard title="Sacola" icon={<ShoppingBag />}>
                {data.cart.length === 0 ? (
                  <p className="text-[14px] text-[#8C8C8C]">Sem itens</p>
                ) : (
                  <ul className="space-y-1 text-[13.5px]">
                    {data.cart.map((it, idx) => (
                      <li key={idx} className="truncate">
                        {it.quantity}× {it.name ?? "Item"}
                        <span className="text-[#8C8C8C]">
                          {it.variant === "DECANT" ? ` · ${it.decant_ml} ml` : " · frasco"}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </PanelCard>
            </div>

            {s.declined_at ? (
              <PxNote tone="warning">
                A pessoa dispensou uma abordagem nesta visita. Melhor não insistir.
              </PxNote>
            ) : null}

            <PanelCard
              title="Falar com a pessoa"
              hint="Aparece na hora, dentro da loja, no aparelho dela."
            >
              <Segmented
                full
                value={action}
                onChange={setAction}
                options={[
                  { value: "mensagem", label: "Mensagem" },
                  { value: "cupom", label: "Cupom" },
                  { value: "ajuda", label: "Ajuda" },
                ]}
              />
              <div className="mt-4">
                {action === "mensagem" ? (
                  <>
                    <div className="flex flex-wrap gap-1.5">
                      {[
                        ...(s.current_product_name
                          ? [`Ficou com alguma dúvida sobre o ${s.current_product_name}?`]
                          : []),
                        ...QUICK,
                      ].map((q) => (
                        <button
                          key={q}
                          type="button"
                          onClick={() => setMessage(q)}
                          className={cn(
                            "press rounded-full px-3 py-1.5 text-left text-[12.5px] font-semibold transition-colors",
                            message === q
                              ? "bg-white text-[#15130F]"
                              : "bg-[#232323] text-[#D4D4D4] hover:bg-[#2A2A2A]",
                          )}
                        >
                          {q}
                        </button>
                      ))}
                    </div>
                    <TextArea
                      className="mt-3 min-h-[96px]"
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      maxLength={240}
                      placeholder="Ou escreva a sua mensagem"
                    />
                  </>
                ) : action === "cupom" ? (
                  <>
                    <p className="text-[13px] text-[#8C8C8C]">
                      Só aparecem cupons válidos. O desconto é conferido no fechamento.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {(coupons ?? []).map((c) => (
                        <button
                          key={c.code}
                          type="button"
                          onClick={() => setCoupon(c.code)}
                          className={cn(
                            "press rounded-full px-3.5 py-2 text-[13px] font-bold transition-colors",
                            coupon === c.code
                              ? "bg-white text-[#15130F]"
                              : "bg-[#232323] text-[#D4D4D4] hover:bg-[#2A2A2A]",
                          )}
                        >
                          {c.code} · {c.discountPercent}%
                        </button>
                      ))}
                      <SoftButton
                        className="h-10 text-[13px]"
                        loading={createCoupon.isPending}
                        onClick={() => createCoupon.mutate()}
                      >
                        Criar cupom só para esta pessoa (10%)
                      </SoftButton>
                    </div>
                  </>
                ) : (
                  <p className="text-[14px] leading-snug text-[#D4D4D4]">
                    Mostra um convite para ela conversar com a Orium e receber ajuda para escolher.
                  </p>
                )}
              </div>
            </PanelCard>

            {!s.identified ? (
              <PanelCard tone="flat">
                <div className="flex items-center gap-3">
                  <p className="min-w-0 flex-1 text-[13.5px] text-[#A9A9A9]">
                    Anônimo. Convide a salvar as escolhas para virar cliente.
                  </p>
                  <SoftButton
                    className="h-10 shrink-0 text-[13px]"
                    disabled={send.isPending}
                    onClick={() => send.mutate({ kind: "salvar_escolhas" })}
                  >
                    Convidar
                  </SoftButton>
                </div>
              </PanelCard>
            ) : null}

            {data.interactions.length ? (
              <PanelCard title="Atendimento nesta visita">
                <ul className="space-y-2.5">
                  {data.interactions.map((it) => (
                    <li key={it.id} className="flex min-w-0 items-start gap-3">
                      <span className="w-11 shrink-0 text-[12.5px] text-[#8C8C8C] tabular-nums">
                        {hhmm(it.created_at)}
                      </span>
                      <span className="min-w-0 flex-1 text-[13.5px] text-[#E6E6E6]">
                        {it.kind === "cupom" ? `Cupom ${it.coupon_code}` : it.message}
                      </span>
                      <StatusDot
                        tone={
                          it.accepted_at
                            ? "ok"
                            : it.dismissed_at
                              ? "coral"
                              : it.seen_at
                                ? "gold"
                                : "off"
                        }
                      >
                        {it.accepted_at
                          ? "Aceito"
                          : it.dismissed_at
                            ? "Dispensado"
                            : it.seen_at
                              ? "Visto"
                              : "Enviado"}
                      </StatusDot>
                    </li>
                  ))}
                </ul>
              </PanelCard>
            ) : null}
          </>
        ) : tab === "visita" ? (
          <>
            <PanelCard title="De onde e como">
              <dl className="grid grid-cols-2 gap-2">
                {[
                  { k: "Chegou por", v: s.source ?? "direto" },
                  {
                    k: "Primeira vez por",
                    v: s.first_source && s.first_source !== s.source ? s.first_source : null,
                  },
                  {
                    k: "Aparelho",
                    v: [deviceName(s.device), s.standalone ? "app instalado" : null]
                      .filter(Boolean)
                      .join(" · "),
                  },
                  { k: "Sistema", v: [s.os, s.browser].filter(Boolean).join(" · ") || null },
                  {
                    k: "Visitas",
                    v:
                      s.visitor_sessions && s.visitor_sessions > 1
                        ? `${s.visitor_sessions}x${s.visitor_first_seen ? ` desde ${new Date(s.visitor_first_seen).toLocaleDateString("pt-BR")}` : ""}`
                        : "Primeira visita",
                  },
                  { k: "Última busca", v: s.last_query ? `"${s.last_query}"` : null },
                  {
                    k: "Idioma e fuso",
                    v: [s.language, s.timezone].filter(Boolean).join(" · ") || null,
                  },
                  {
                    k: "Rede e tema",
                    v:
                      [s.connection, s.theme ? `tema ${s.theme}` : null]
                        .filter(Boolean)
                        .join(" · ") || null,
                  },
                ]
                  .filter((f) => f.v)
                  .map((f) => (
                    <div key={f.k} className="min-w-0 rounded-[16px] bg-[#232323] px-3.5 py-2.5">
                      <dt className="truncate text-[11.5px] font-semibold text-[#8C8C8C]">{f.k}</dt>
                      <dd className="mt-0.5 truncate text-[14px] font-bold">{f.v}</dd>
                    </div>
                  ))}
              </dl>
            </PanelCard>
            {data.interests.length ? (
              <PanelCard
                title="Onde prestou mais atenção"
                hint="Tempo vendo cada perfume (ou quantas vezes abriu)."
              >
                <Bars
                  rows={data.interests.map((it) => ({
                    label: it.name,
                    value: it.seconds > 0 ? it.seconds : it.opens,
                    display: it.seconds > 0 ? `${it.seconds}s` : `${it.opens}x`,
                  }))}
                />
              </PanelCard>
            ) : null}
            {data.favorites.length ? (
              <PanelCard title="Favoritos">
                <div className="flex flex-wrap gap-1.5">
                  {data.favorites.map((f, i) => (
                    <span
                      key={`${f.name}-${i}`}
                      className="inline-flex h-8 items-center rounded-full bg-[#232323] px-3 text-[13px] font-semibold"
                    >
                      {f.name}
                    </span>
                  ))}
                </div>
              </PanelCard>
            ) : null}
          </>
        ) : (
          <PanelCard title="O que fez nesta visita">
            {data.timeline.length === 0 ? (
              <p className="text-[14px] text-[#8C8C8C]">Sem eventos nesta visita.</p>
            ) : (
              <ol className="relative space-y-3 before:absolute before:top-1 before:bottom-1 before:left-[51px] before:w-px before:bg-white/[0.08]">
                {data.timeline.map((e) => (
                  <li key={e.id} className="relative flex min-w-0 items-start gap-3">
                    <span className="w-11 shrink-0 pt-px text-[12.5px] text-[#8C8C8C] tabular-nums">
                      {hhmm(e.created_at)}
                    </span>
                    <span
                      className={cn(
                        "relative z-[1] mt-1.5 size-2 shrink-0 rounded-full",
                        HOT_EVENTS.has(e.event) ? "bg-[#FFD599]" : "bg-[#6F6F6F]",
                      )}
                      aria-hidden
                    />
                    <span
                      className={cn(
                        "min-w-0 text-[14px]",
                        HOT_EVENTS.has(e.event) ? "font-bold text-white" : "text-[#D4D4D4]",
                      )}
                    >
                      {EVENT_LABEL[e.event] ?? e.event}
                      {e.product_name ? ` ${e.product_name}` : ""}
                      {e.query ? ` "${e.query}"` : ""}
                      <span className="font-normal text-[#8C8C8C]">
                        {e.decant_ml ? ` · ${e.decant_ml} ml` : ""}
                        {e.seconds ? ` · ${e.seconds}s` : ""}
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </PanelCard>
        )}
      </PanelScroll>

      {s && tab === "atender" ? (
        <PanelFooter>
          <GoldButton
            className="flex-1"
            loading={send.isPending}
            disabled={!canSend}
            icon={
              action === "mensagem" ? (
                <MessageCircle className="size-[18px]" />
              ) : action === "cupom" ? (
                <Sparkles className="size-[18px]" />
              ) : (
                <HeartHandshake className="size-[18px]" />
              )
            }
            onClick={() =>
              action === "mensagem"
                ? send.mutate({ kind: "mensagem", message })
                : action === "cupom"
                  ? send.mutate({ kind: "cupom", couponCode: coupon })
                  : send.mutate({ kind: "ajuda" })
            }
          >
            {action === "mensagem"
              ? "Enviar mensagem"
              : action === "cupom"
                ? `Enviar cupom${coupon ? ` ${coupon}` : ""}`
                : "Oferecer ajuda"}
          </GoldButton>
        </PanelFooter>
      ) : null}
    </SidePanel>
  );
}
