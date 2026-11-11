import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AdminShell } from "@/components/orium/AdminShell";
import { ChipGroup } from "@/components/orium/ChipGroup";
import { supabase } from "@/integrations/supabase/client";
import { brl } from "@/lib/format";
import { liveOverview, liveSession, liveCoupons, liveSend, liveCreateCoupon, type LiveSessionRow } from "@/lib/live.functions";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Loader2, MessageCircle, Sparkles, HeartHandshake } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/aovivo")({
  head: () => ({ meta: [{ title: "Ao Vivo — Orium Admin" }, { name: "robots", content: "noindex" }] }),
  component: LivePage,
});

type Filter = "todos" | "alta" | "carrinho" | "checkout" | "identificados" | "anonimos";

const FILTERS = [
  { value: "todos" as Filter, label: "Todos" },
  { value: "alta" as Filter, label: "Alta intenção" },
  { value: "carrinho" as Filter, label: "Com carrinho" },
  { value: "checkout" as Filter, label: "No checkout" },
  { value: "identificados" as Filter, label: "Identificados" },
  { value: "anonimos" as Filter, label: "Anônimos" },
];

const shortId = (key: string) => `#${key.replace(/-/g, "").slice(-4).toUpperCase()}`;

function minutesAgo(iso: string) {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
}

function activityLabel(iso: string) {
  const m = minutesAgo(iso);
  return m < 2 ? "Ativo agora" : `Inativo há ${m} min`;
}

const INTENT_LABEL = { alta: "Alta intenção", media: "Média intenção", baixa: "Navegando" } as const;

function LivePage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>("todos");
  const [selected, setSelected] = useState<string | null>(null);

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

  const sessions = useMemo(() => {
    const rows = data?.sessions ?? [];
    return rows.filter((s) => {
      if (filter === "alta") return s.intent === "alta";
      if (filter === "carrinho") return s.cart_items > 0;
      if (filter === "checkout") return s.in_checkout;
      if (filter === "identificados") return s.identified;
      if (filter === "anonimos") return !s.identified;
      return true;
    });
  }, [data, filter]);

  return (
    <AdminShell title="Ao Vivo">
      {isError ? (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          Não foi possível carregar as sessões agora.
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Metric label="Visitantes ativos" value={data?.visitors ?? 0} loading={isPending} i={0} />
        <Metric label="Clientes identificados" value={data?.identified ?? 0} loading={isPending} i={1} />
        <Metric label="Carrinhos ativos" value={data?.carts ?? 0} loading={isPending} i={2} />
        <Metric label="Vendo produto" value={data?.viewingProduct ?? 0} loading={isPending} i={3} />
        <Metric label="No checkout" value={data?.inCheckout ?? 0} loading={isPending} i={4} />
      </div>

      <div className="mt-6 -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <ChipGroup value={filter} onChange={setFilter} options={FILTERS} label="Filtrar visitantes" />
      </div>

      <div className="mt-5 grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <div className="space-y-3">
          {isPending ? (
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="rounded-2xl bg-card p-4 shadow-soft">
                <div className="admin-skeleton h-4 w-32" />
                <div className="admin-skeleton mt-3 h-3 w-44" />
              </div>
            ))
          ) : sessions.length === 0 ? (
            <div className="rounded-2xl bg-card p-6 text-sm text-muted-foreground shadow-soft">
              Ninguém navegando com esse filtro no momento.
            </div>
          ) : (
            sessions.map((s, i) => (
              <VisitorCard
                key={s.session_key}
                s={s}
                active={selected === s.session_key}
                onOpen={() => setSelected(s.session_key)}
                i={i}
              />
            ))
          )}
        </div>

        <div className="min-w-0">
          {selected ? (
            <SessionPanel sessionKey={selected} onClose={() => setSelected(null)} />
          ) : (
            <div className="hidden rounded-2xl bg-card p-6 text-sm text-muted-foreground shadow-soft lg:block">
              Escolha um visitante para acompanhar a navegação e oferecer ajuda.
            </div>
          )}
        </div>
      </div>
    </AdminShell>
  );
}

function Metric({ label, value, loading, i }: { label: string; value: number; loading: boolean; i: number }) {
  return (
    <div
      style={{ "--i": i } as CSSProperties}
      className="admin-in min-w-0 rounded-2xl bg-card p-4 shadow-soft"
    >
      <p className="text-xs tracking-wide text-muted-foreground uppercase">{label}</p>
      {loading ? (
        <div className="admin-skeleton mt-3 h-7 w-14" />
      ) : (
        <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
      )}
    </div>
  );
}

function Tag({ children, tone }: { children: React.ReactNode; tone?: "hot" | "soft" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium",
        tone === "hot" ? "bg-foreground text-background" : "bg-surface-3 text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

function deviceName(d: string | null) {
  return d === "mobile" ? "Celular" : d === "tablet" ? "Tablet" : "Computador";
}

function VisitorCard({
  s,
  active,
  onOpen,
  i,
}: {
  s: LiveSessionRow;
  active: boolean;
  onOpen: () => void;
  i: number;
}) {
  const live = minutesAgo(s.last_activity_at) < 2;
  return (
    <button
      type="button"
      onClick={onOpen}
      style={{ "--i": i } as CSSProperties}
      className={cn(
        "admin-card admin-in w-full rounded-2xl bg-card p-4 text-left shadow-soft",
        active && "ring-2 ring-foreground/15",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium">
            {s.identified && s.display_name ? s.display_name : `Visitante ${shortId(s.session_key)}`}
            {s.multi_device ? ` — ${deviceName(s.device)}` : ""}
          </p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {[s.source, deviceName(s.device)].filter(Boolean).join(" · ")}
          </p>
        </div>
        <span className={cn("shrink-0 text-[11px]", live ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}>
          {live ? "● Ativo agora" : `Inativo há ${minutesAgo(s.last_activity_at)} min`}
        </span>
      </div>

      <p className="mt-3 text-sm">
        <span className="text-muted-foreground">Agora: </span>
        {s.in_checkout
          ? "Iniciando finalização"
          : s.current_product_name
            ? `Visualizando ${s.current_product_name}`
            : s.current_route?.startsWith("/negociacao")
              ? "Em negociação"
              : s.current_route?.startsWith("/carrinho")
                ? "No carrinho"
                : "Navegando no catálogo"}
      </p>
      {s.last_action && s.last_action !== `Visualizou ${s.current_product_name ?? ""}` ? (
        <p className="mt-0.5 truncate text-xs text-muted-foreground">Última ação: {s.last_action}</p>
      ) : null}

      {/* Só o essencial: intenção e carrinho. O resto fica na sessão. */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        <Tag>{INTENT_LABEL[s.intent]}</Tag>
        {s.in_checkout ? <Tag tone="hot">Checkout</Tag> : s.cart_items > 0 ? <Tag tone="hot">{`Carrinho · ${brl(s.cart_total)}`}</Tag> : null}
      </div>
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
  decant_selected: "Selecionou Decant",
  bottle_selected: "Selecionou Frasco",
  search: "Pesquisou",
  favorite_added: "Favoritou",
  favorite_removed: "Removeu dos favoritos",
  cart_item_added: "Adicionou ao carrinho",
  cart_opened: "Abriu o carrinho",
  checkout_started: "Iniciou finalização",
  whatsapp_checkout_clicked: "Abriu o WhatsApp",
  lead_identified: "Informou nome e WhatsApp",
  consultant_help_clicked: "Pediu ajuda",
  negotiation_interest: "Abriu negociação",
  order_created: "Criou pedido",
};

const hhmm = (iso: string) =>
  new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

const QUICK = [
  "Posso te ajudar a escolher?",
  "Está em dúvida entre Decant e Frasco?",
  "Quer experimentar antes? Temos Decants a partir de R$ 19,90.",
  "Posso te ajudar a encontrar uma fragrância parecida com o que você procura?",
];

function SessionPanel({ sessionKey, onClose }: { sessionKey: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [composing, setComposing] = useState<null | "mensagem" | "cupom">(null);
  const [message, setMessage] = useState("");
  const [coupon, setCoupon] = useState("");

  const { data, isPending } = useQuery({
    queryKey: ["live-session", sessionKey],
    queryFn: () => liveSession({ data: { sessionKey } }),
    refetchInterval: 20_000,
  });

  const { data: coupons } = useQuery({
    queryKey: ["live-coupons"],
    queryFn: () => liveCoupons(),
    enabled: composing === "cupom",
    staleTime: 60_000,
  });

  const send = useMutation({
    mutationFn: (input: { kind: "mensagem" | "cupom" | "ajuda" | "salvar_escolhas"; message?: string; couponCode?: string }) =>
      liveSend({ data: { sessionKey, ...input } }),
    onSuccess: async () => {
      // Aviso imediato no aparelho do visitante (canal exclusivo da sessão).
      const channel = supabase.channel(`orium-live-${sessionKey}`);
      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          void channel.send({ type: "broadcast", event: "interaction", payload: {} }).then(() => {
            void supabase.removeChannel(channel);
          });
        }
      });
      toast.success("Enviado. Aguarde a resposta antes de abordar novamente.");
      setComposing(null);
      setMessage("");
      setCoupon("");
      await qc.invalidateQueries({ queryKey: ["live-session", sessionKey] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não foi possível enviar."),
  });

  const createCoupon = useMutation({
    mutationFn: () => liveCreateCoupon({ data: { sessionKey, percent: 10, hours: 48 } }),
    onSuccess: (res) => {
      setCoupon(res.code);
      toast.success(`Cupom ${res.code} criado (${res.percent}% OFF, uso único).`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não foi possível criar o cupom."),
  });

  if (isPending) {
    return (
      <div className="rounded-2xl bg-card p-6 shadow-soft">
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!data) {
    return (
      <div className="rounded-2xl bg-card p-6 text-sm text-muted-foreground shadow-soft">
        Esta sessão já foi encerrada.
      </div>
    );
  }

  const s = data.session;
  const live = minutesAgo(s.last_activity_at) < 2;

  return (
    <div className="admin-in rounded-2xl bg-card p-5 shadow-soft">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs tracking-wide text-muted-foreground uppercase">
            {live ? "Ativo agora" : activityLabel(s.last_activity_at)}
          </p>
          <h2 className="mt-1 truncate text-xl font-semibold">
            {s.identified && s.display_name ? s.display_name : `Visitante ${shortId(s.session_key)}`}
          </h2>
          {s.identified && s.phone ? (
            <p className="text-sm text-muted-foreground">WhatsApp: {s.phone}</p>
          ) : (
            <p className="text-sm text-muted-foreground">Visitante anônimo</p>
          )}
        </div>
        <button type="button" onClick={onClose} className="press text-sm text-muted-foreground lg:hidden">
          Fechar
        </button>
      </div>

      <div className="mt-4 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-xl bg-surface-3 p-3">
          <p className="text-xs tracking-wide text-muted-foreground uppercase">Vendo agora</p>
          <p className="mt-1 text-sm">{s.current_product_name ?? "Catálogo"}</p>
          {s.current_variant ? (
            <p className="text-xs text-muted-foreground">
              Modo: {s.current_variant === "DECANT" ? `Decant${s.current_decant_ml ? ` ${s.current_decant_ml}ml` : ""}` : "Frasco"}
            </p>
          ) : null}
        </div>
        <div className="rounded-xl bg-surface-3 p-3">
          <p className="text-xs tracking-wide text-muted-foreground uppercase">Carrinho</p>
          {data.cart.length === 0 ? (
            <p className="mt-1 text-sm text-muted-foreground">Sem itens</p>
          ) : (
            <ul className="mt-1 space-y-0.5 text-sm">
              {data.cart.map((i, idx) => (
                <li key={idx} className="truncate">
                  {i.name ?? "Item"} · {i.variant === "DECANT" ? `${i.decant_ml}ml` : "Frasco"} ×{i.quantity}
                </li>
              ))}
            </ul>
          )}
          {s.cart_items > 0 ? <p className="mt-1 text-sm font-semibold">{brl(s.cart_total)}</p> : null}
        </div>
      </div>

      {data.favorites.length > 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Favoritos: {data.favorites.map((f) => f.name).join(", ")}
        </p>
      ) : null}

      <div className="mt-5 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setComposing(composing === "mensagem" ? null : "mensagem")}
          className="press inline-flex min-h-10 items-center gap-2 rounded-full bg-foreground px-4 text-[13px] font-medium text-background"
        >
          <MessageCircle className="size-4" strokeWidth={1.75} /> Enviar mensagem
        </button>
        <button
          type="button"
          onClick={() => setComposing(composing === "cupom" ? null : "cupom")}
          className="press inline-flex min-h-10 items-center gap-2 rounded-full bg-surface-3 px-4 text-[13px] font-medium"
        >
          <Sparkles className="size-4" strokeWidth={1.75} /> Enviar cupom
        </button>
        <button
          type="button"
          onClick={() => send.mutate({ kind: "ajuda" })}
          disabled={send.isPending}
          className="press inline-flex min-h-10 items-center gap-2 rounded-full bg-surface-3 px-4 text-[13px] font-medium disabled:opacity-60"
        >
          <HeartHandshake className="size-4" strokeWidth={1.75} /> Oferecer ajuda
        </button>
        {!s.identified ? (
          <button
            type="button"
            onClick={() => send.mutate({ kind: "salvar_escolhas" })}
            disabled={send.isPending}
            className="press inline-flex min-h-10 items-center rounded-full px-4 text-[13px] text-muted-foreground disabled:opacity-60"
          >
            Convidar a salvar escolhas
          </button>
        ) : null}
      </div>

      {s.declined_at ? (
        <p className="mt-3 text-xs text-muted-foreground">
          O visitante dispensou uma abordagem nesta visita — não vamos insistir.
        </p>
      ) : null}

      {composing === "mensagem" ? (
        <div className="mt-4 rounded-xl bg-surface-3 p-3">
          {s.current_product_name ? (
            <p className="text-xs text-muted-foreground">Está vendo: {s.current_product_name}</p>
          ) : null}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {[
              ...(s.current_product_name ? [`Ficou com alguma dúvida sobre o ${s.current_product_name}?`] : []),
              ...QUICK,
            ].map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => setMessage(q)}
                className="press rounded-full bg-card px-3 py-1 text-[12px] text-muted-foreground"
              >
                {q}
              </button>
            ))}
          </div>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={3}
            maxLength={240}
            placeholder="Escreva a mensagem que o visitante vai ver dentro da Orium."
            className="mt-3 w-full rounded-xl border border-border/60 bg-background p-3 text-sm"
          />
          <button
            type="button"
            onClick={() => send.mutate({ kind: "mensagem", message })}
            disabled={send.isPending || message.trim().length < 3}
            className="press mt-2 inline-flex min-h-10 items-center rounded-full bg-foreground px-4 text-[13px] font-medium text-background disabled:opacity-60"
          >
            Enviar
          </button>
        </div>
      ) : null}

      {composing === "cupom" ? (
        <div className="mt-4 rounded-xl bg-surface-3 p-3">
          <p className="text-xs text-muted-foreground">
            Só aparecem cupons realmente válidos. O desconto é validado no checkout.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {(coupons ?? []).map((c) => (
              <button
                key={c.code}
                type="button"
                onClick={() => setCoupon(c.code)}
                className={cn(
                  "press rounded-full px-3 py-1 text-[12px]",
                  coupon === c.code ? "bg-foreground text-background" : "bg-card text-muted-foreground",
                )}
              >
                {c.code} · {c.discountPercent}%
              </button>
            ))}
            <button
              type="button"
              onClick={() => createCoupon.mutate()}
              disabled={createCoupon.isPending}
              className="press rounded-full bg-card px-3 py-1 text-[12px] disabled:opacity-60"
            >
              Criar cupom desta sessão (10%, uso único)
            </button>
          </div>
          <button
            type="button"
            onClick={() => send.mutate({ kind: "cupom", couponCode: coupon })}
            disabled={send.isPending || !coupon}
            className="press mt-3 inline-flex min-h-10 items-center rounded-full bg-foreground px-4 text-[13px] font-medium text-background disabled:opacity-60"
          >
            Enviar cupom {coupon ? coupon : ""}
          </button>
        </div>
      ) : null}

      {data.interactions.length > 0 ? (
        <div className="mt-5">
          <h3 className="text-sm font-medium text-muted-foreground">Atendimento nesta visita</h3>
          <ul className="mt-2 space-y-1.5 text-sm">
            {data.interactions.map((it) => (
              <li key={it.id} className="text-muted-foreground">
                <span className="text-foreground">{hhmm(it.created_at)}</span>{" "}
                {it.kind === "cupom" ? `Cupom ${it.coupon_code} enviado` : it.message}
                {it.accepted_at ? " · aceito" : it.dismissed_at ? " · dispensado" : it.seen_at ? " · visto" : " · enviado"}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-5">
        <h3 className="text-sm font-medium text-muted-foreground">Contexto da visita</h3>
        <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
          <li>
            Origem: <span className="text-foreground">{data.session.source ?? "direto"}</span>
            {data.session.first_source && data.session.first_source !== data.session.source
              ? ` · primeira vez por ${data.session.first_source}`
              : ""}
          </li>
          <li>
            Aparelho:{" "}
            <span className="text-foreground">
              {[
                data.session.device === "mobile" ? "Celular" : data.session.device === "tablet" ? "Tablet" : "Computador",
                data.session.os,
                data.session.browser,
                data.session.standalone ? "app instalado" : null,
                data.session.viewport,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </li>
          {data.session.visitor_sessions && data.session.visitor_sessions > 1 ? (
            <li>
              Já visitou <span className="text-foreground">{data.session.visitor_sessions}x</span>
              {data.session.visitor_first_seen
                ? ` · desde ${new Date(data.session.visitor_first_seen).toLocaleDateString("pt-BR")}`
                : ""}
            </li>
          ) : (
            <li>Primeira visita</li>
          )}
          {data.session.last_query ? (
            <li>
              Última busca: <span className="text-foreground">"{data.session.last_query}"</span>
            </li>
          ) : null}
          <li>
            {[
              data.session.language,
              data.session.timezone,
              data.session.theme ? `tema ${data.session.theme}` : null,
              data.session.connection ? `rede ${data.session.connection}` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </li>
        </ul>
      </div>

      {data.interests.length > 0 ? (
        <div className="mt-5">
          <h3 className="text-sm font-medium text-muted-foreground">Onde prestou mais atenção</h3>
          <ul className="mt-2 space-y-1 text-sm">
            {data.interests.map((it) => (
              <li key={it.name} className="flex justify-between gap-3">
                <span className="min-w-0 truncate">{it.name}</span>
                <span className="shrink-0 text-muted-foreground">
                  {it.seconds > 0 ? `${it.seconds}s` : `${it.opens}x`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-5">
        <h3 className="text-sm font-medium text-muted-foreground">Histórico recente</h3>
        {data.timeline.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">Sem eventos nesta visita.</p>
        ) : (
          <ul className="mt-2 space-y-1.5 text-sm">
            {data.timeline.map((e) => (
              <li key={e.id} className="flex gap-2">
                <span className="shrink-0 tabular-nums text-muted-foreground">{hhmm(e.created_at)}</span>
                <span className="min-w-0">
                  {EVENT_LABEL[e.event] ?? e.event}
                  {e.product_name ? ` ${e.product_name}` : ""}
                  {e.query ? ` "${e.query}"` : ""}
                  {e.decant_ml ? ` · ${e.decant_ml}ml` : ""}
                  {e.seconds ? ` · ${e.seconds}s` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
