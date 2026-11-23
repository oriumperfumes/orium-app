/**
 * ADMIN → CLIENTES → CONVERSAS.
 * O WhatsApp da loja dentro do Admin, em tempo real: lista | conversa | cliente.
 * Ao lado de cada conversa: calor, perfil de compra, próxima ação e os perfumes
 * citados com preço final, custo e lucro. Mensagens saem por uma fila que a ponte
 * entrega; nada é enviado sem clique.
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCheck,
  Clock3,
  Link2,
  MessagesSquare,
  PanelRightOpen,
  Search,
  Send,
  Smartphone,
  UserPlus,
  WifiOff,
} from "lucide-react";
import { toast } from "sonner";
import { AdminShell } from "@/components/orium/AdminShell";
import { CustomerSheet } from "@/components/orium/CustomerSheet";
import { SidePanel } from "@/components/orium/admin/orders/model";
import { PanelHeader, PanelScroll } from "@/components/orium/admin/PanelKit";
import { pxInputClass } from "@/components/orium/admin/PricingUI";
import {
  Avatar,
  LeadReading,
  PerfumeQuoteCard,
  TempPill,
  ago,
  fmtPhone,
} from "@/components/orium/crm/shared";
import { supabase } from "@/integrations/supabase/client";
import { enrich, type Lead } from "@/lib/crm-intel";
import {
  crmCustomerSearch,
  crmLeads,
  crmPerfumeQuote,
  waInbox,
  waLinkCustomer,
  waSend,
  waThread,
  waUpdateContact,
  type WaBridge,
  type WaContact,
  type WaMessage,
} from "@/lib/crm-wa.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/admin/conversas")({
  validateSearch: (s: Record<string, unknown>) => ({
    jid: typeof s.jid === "string" ? s.jid : undefined,
  }),
  head: () => ({
    meta: [{ title: "Conversas — Orium Admin" }, { name: "robots", content: "noindex" }],
  }),
  component: ConversasPage,
});

type Filter = "todas" | "nao_lidas" | "responder" | "clientes" | "sem_ficha";
const FILTERS: Array<{ v: Filter; label: string; match: (c: WaContact) => boolean }> = [
  { v: "todas", label: "Todas", match: (c) => !c.archived },
  {
    v: "responder",
    label: "Esperando você",
    match: (c) => !c.archived && c.last_from_me === false,
  },
  { v: "nao_lidas", label: "Não lidas", match: (c) => c.unread > 0 },
  { v: "clientes", label: "Clientes", match: (c) => !!c.customer_id },
  { v: "sem_ficha", label: "Sem ficha", match: (c) => !c.customer_id && !c.archived },
];
const STAGES: Array<{ v: WaContact["stage"]; label: string }> = [
  { v: "novo", label: "Novo" },
  { v: "interessado", label: "Interessado" },
  { v: "negociando", label: "Negociando" },
  { v: "comprou", label: "Comprou" },
  { v: "perdido", label: "Perdido" },
];
const QUICK = [
  { label: "Saudação", text: "Oi! Aqui é da Orium Perfumes 😊 Como posso te ajudar?" },
  {
    label: "Retirada grátis",
    text: "A retirada na loja é grátis! Te aviso assim que estiver separado ✨",
  },
  { label: "Pix", text: "No Pix tem desconto! Quer que eu te mande a chave?" },
  {
    label: "Catálogo",
    text: "Dá uma olhada no nosso catálogo completo: https://oriumperfumes.com 🛍️",
  },
];

const contactName = (c: WaContact) =>
  c.customer?.name || c.push_name || fmtPhone(c.phone_normalized) || c.jid.split("@")[0];

function ConversasPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { jid: selected } = Route.useSearch();
  const [filter, setFilter] = useState<Filter>("todas");
  const [q, setQ] = useState("");
  const [insightOpen, setInsightOpen] = useState(false);

  const inbox = useQuery({
    queryKey: ["wa-inbox"],
    queryFn: () => waInbox(),
    refetchInterval: 45_000,
    staleTime: 5_000,
  });
  const leadsQ = useQuery({
    queryKey: ["crm-leads"],
    queryFn: () => crmLeads(),
    staleTime: 30_000,
  });
  const leadById = useMemo(
    () => new Map(enrich(leadsQ.data ?? []).map((l) => [l.id, l])),
    [leadsQ.data],
  );

  useEffect(() => {
    const ch = supabase
      .channel("orium-wa-admin")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "wa_contacts" },
        () => void qc.invalidateQueries({ queryKey: ["wa-inbox"] }),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "wa_bridge_state" },
        () => void qc.invalidateQueries({ queryKey: ["wa-inbox"] }),
      )
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "wa_messages" }, (p) => {
        void qc.invalidateQueries({ queryKey: ["wa-thread", (p.new as any)?.jid] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "wa_outbox" }, (p) => {
        void qc.invalidateQueries({ queryKey: ["wa-thread", (p.new as any)?.jid] });
      })
      .subscribe();
    return () => void supabase.removeChannel(ch);
  }, [qc]);

  const contacts = useMemo(() => inbox.data?.contacts ?? [], [inbox.data]);
  const bridge = inbox.data?.bridge;
  const list = useMemo(() => {
    const f = FILTERS.find((x) => x.v === filter)!;
    const term = q.trim().toLowerCase();
    const digits = term.replace(/\D/g, "");
    return contacts
      .filter(f.match)
      .filter(
        (c) =>
          !term ||
          contactName(c).toLowerCase().includes(term) ||
          (digits.length >= 3 && (c.phone_normalized ?? "").includes(digits)),
      )
      .sort(
        (a, b) =>
          Number(b.pinned) - Number(a.pinned) ||
          +new Date(b.last_message_at ?? 0) - +new Date(a.last_message_at ?? 0),
      );
  }, [contacts, filter, q]);
  const current = contacts.find((c) => c.jid === selected) ?? null;
  const lead = current?.customer_id ? (leadById.get(current.customer_id) ?? null) : null;
  const select = (jid: string | undefined) =>
    void navigate({ to: "/admin/conversas", search: { jid } as never, replace: true });

  return (
    <AdminShell title="Conversas">
      <div className="space-y-4">
        <BridgeBanner bridge={bridge} loading={inbox.isPending} />

        <div className="grid min-h-[calc(100dvh-260px)] gap-3 lg:h-[calc(100dvh-230px)] lg:min-h-[560px] lg:grid-cols-[340px_minmax(0,1fr)] lg:gap-4 xl:grid-cols-[320px_minmax(0,1fr)_350px] 2xl:grid-cols-[360px_minmax(0,1fr)_390px]">
          {/* Lista */}
          <section
            className={cn(
              "dash-card flex min-h-0 flex-col overflow-hidden",
              selected && "max-lg:hidden",
            )}
          >
            <div className="space-y-3 p-4 pb-3">
              <label className="relative block">
                <Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-[#6F6F6F]" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Buscar conversa"
                  className={cn(pxInputClass, "pl-11")}
                />
              </label>
              <div className="adm-scroll -mx-1 flex gap-1.5 overflow-x-auto px-1">
                {FILTERS.map((f) => {
                  const n = contacts.filter(f.match).length;
                  return (
                    <button
                      key={f.v}
                      type="button"
                      aria-pressed={filter === f.v}
                      onClick={() => setFilter(f.v)}
                      className={cn(
                        "press inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-bold",
                        filter === f.v
                          ? "bg-white text-[#15130F]"
                          : "bg-[#232323] text-[#A9A9A9] hover:text-white",
                      )}
                    >
                      {f.label}
                      <span
                        className={cn(
                          "tabular-nums",
                          filter === f.v
                            ? "text-[#15130F]/55"
                            : f.v === "responder" && n
                              ? "text-[#FFD599]"
                              : "text-[#6F6F6F]",
                        )}
                      >
                        {n}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="adm-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-2">
              {inbox.isPending ? (
                [0, 1, 2, 3, 4].map((i) => (
                  <div key={i} className="admin-skeleton mx-2 my-2 h-[64px] rounded-[18px]" />
                ))
              ) : list.length === 0 ? (
                <div className="grid h-full place-items-center p-6 text-center">
                  <div>
                    <MessagesSquare className="mx-auto size-6 text-[#6F6F6F]" />
                    <p className="mt-3 text-[14px] font-semibold">
                      {contacts.length ? "Nada nesse filtro" : "Nenhuma conversa ainda"}
                    </p>
                    <p className="mt-1 text-[13px] text-[#8C8C8C]">
                      {contacts.length
                        ? "Troque o filtro acima."
                        : "Conecte o WhatsApp para as conversas aparecerem aqui."}
                    </p>
                  </div>
                </div>
              ) : (
                list.map((c) => {
                  const l = c.customer_id ? leadById.get(c.customer_id) : undefined;
                  const active = c.jid === selected;
                  return (
                    <button
                      key={c.jid}
                      type="button"
                      onClick={() => select(c.jid)}
                      className={cn(
                        "press flex w-full min-w-0 items-center gap-3 rounded-[20px] p-2.5 text-left transition-colors",
                        active ? "bg-white/[0.08]" : "hover:bg-white/[0.04]",
                      )}
                    >
                      <Avatar
                        name={contactName(c)}
                        score={l?.score}
                        temp={l?.temp}
                        size={46}
                        gold={(l?.orders_count ?? 0) > 0}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2">
                          <p className="min-w-0 flex-1 truncate text-[14.5px] font-bold">
                            {contactName(c)}
                          </p>
                          <span
                            className={cn(
                              "shrink-0 text-[11.5px] tabular-nums",
                              c.unread ? "font-bold text-[#FFD599]" : "text-[#6F6F6F]",
                            )}
                          >
                            {ago(c.last_message_at)}
                          </span>
                        </div>
                        <div className="mt-0.5 flex items-center gap-2">
                          <p className="min-w-0 flex-1 truncate text-[13px] text-[#8C8C8C]">
                            {c.last_from_me ? "Você: " : ""}
                            {c.last_message_preview ?? ""}
                          </p>
                          {c.unread ? (
                            <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-[#FFD599] px-1.5 text-[11px] font-bold text-[#15130F] tabular-nums">
                              {c.unread}
                            </span>
                          ) : c.last_from_me === false ? (
                            <span
                              className="size-2 shrink-0 rounded-full bg-[#FFD599]"
                              title="Esperando sua resposta"
                            />
                          ) : null}
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </section>

          {/* Conversa */}
          <section
            className={cn(
              "dash-card flex min-h-[70dvh] flex-col overflow-hidden lg:min-h-0",
              !selected && "max-lg:hidden",
            )}
          >
            {current ? (
              <Thread
                key={current.jid}
                contact={current}
                lead={lead}
                onBack={() => select(undefined)}
                onInsight={() => setInsightOpen(true)}
                bridge={bridge}
              />
            ) : (
              <div className="grid h-full place-items-center p-8 text-center">
                <div>
                  <span className="dash-ico mx-auto">
                    <MessagesSquare className="size-[18px]" strokeWidth={2.2} />
                  </span>
                  <h2 className="mt-4 text-[19px] font-bold tracking-[-0.02em]">
                    Escolha uma conversa
                  </h2>
                  <p className="mx-auto mt-1.5 max-w-sm text-[14px] text-[#8C8C8C]">
                    Ao lado aparecem o calor do cliente, o que ele costuma comprar e o preço dos
                    perfumes citados.
                  </p>
                </div>
              </div>
            )}
          </section>

          {/* Cliente (telas largas) */}
          <aside className="adm-scroll hidden min-h-0 overflow-y-auto xl:block">
            {current ? <Insight contact={current} lead={lead} /> : null}
          </aside>
        </div>
      </div>

      <SidePanel
        open={insightOpen && !!current}
        onClose={() => setInsightOpen(false)}
        label="Cliente"
      >
        {current ? (
          <>
            <PanelHeader
              title={contactName(current)}
              subtitle={fmtPhone(current.phone_normalized)}
              onClose={() => setInsightOpen(false)}
            />
            <PanelScroll swapKey={current.jid}>
              <div className="px-5 pb-6 lg:px-6">
                <Insight contact={current} lead={lead} />
              </div>
            </PanelScroll>
          </>
        ) : null}
      </SidePanel>
    </AdminShell>
  );
}

function BridgeBanner({ bridge, loading }: { bridge?: WaBridge; loading: boolean }) {
  if (loading || !bridge) return null;
  const stale = !bridge.last_seen || Date.now() - new Date(bridge.last_seen).getTime() > 90_000;
  if (bridge.status === "online" && !stale) return null;
  if (bridge.status === "qr" && !stale && bridge.qr)
    return (
      <section className="dash-card adm-rise flex flex-col items-center gap-5 p-5 sm:flex-row lg:p-6">
        <img
          src={bridge.qr}
          alt="QR code para conectar o WhatsApp"
          className="size-[200px] shrink-0 rounded-[20px] bg-white p-2"
        />
        <div className="min-w-0">
          <h2 className="text-[19px] font-bold tracking-[-0.02em]">Conecte o WhatsApp da loja</h2>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-[14px] text-[#D4D4D4]">
            <li>No celular da loja, abra o WhatsApp.</li>
            <li>Toque em ⋮ ou Configurações → Aparelhos conectados → Conectar aparelho.</li>
            <li>Aponte a câmera para este código.</li>
          </ol>
          <p className="mt-2 text-[13px] text-[#8C8C8C]">
            O código se renova sozinho a cada poucos segundos.
          </p>
        </div>
      </section>
    );
  return (
    <section className="dash-card flex items-center gap-3 p-4">
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[#FF9A8A]/15 text-[#FF9A8A]">
        <WifiOff className="size-[18px]" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[14.5px] font-bold">
          {bridge.status === "connecting" && !stale
            ? "Conectando ao WhatsApp…"
            : "WhatsApp desconectado"}
        </p>
        <p className="text-[13px] text-[#8C8C8C]">
          {bridge.last_seen ? `Último sinal ${ago(bridge.last_seen)} atrás. ` : ""}
          As respostas ficam na fila e saem assim que a ponte voltar.
        </p>
      </div>
    </section>
  );
}

function Thread({
  contact,
  lead,
  onBack,
  onInsight,
  bridge,
}: {
  contact: WaContact;
  lead: Lead | null;
  onBack: () => void;
  onInsight: () => void;
  bridge?: WaBridge;
}) {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const thread = useQuery({
    queryKey: ["wa-thread", contact.jid],
    queryFn: () => waThread({ data: { jid: contact.jid } }),
    staleTime: 3_000,
  });

  useEffect(() => {
    if (contact.unread)
      void waUpdateContact({ data: { jid: contact.jid, unread: 0 } }).then(() =>
        qc.invalidateQueries({ queryKey: ["wa-inbox"] }),
      );
  }, [contact.jid, contact.unread, qc]);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [thread.data?.length]);

  // compositor recebe textos vindos do painel do cliente (mensagem pronta / preço)
  useEffect(() => {
    const on = (e: Event) => {
      const t = (e as CustomEvent<string>).detail;
      setText((cur) => (cur.trim() ? `${cur.trim()}\n${t}` : t));
      taRef.current?.focus();
    };
    window.addEventListener("orium-crm-compose", on);
    return () => window.removeEventListener("orium-crm-compose", on);
  }, []);

  const send = useMutation({
    mutationFn: (body: string) => waSend({ data: { jid: contact.jid, body } }),
    onMutate: async (body) => {
      setText("");
      const key = ["wa-thread", contact.jid];
      const prev = qc.getQueryData<WaMessage[]>(key);
      qc.setQueryData<WaMessage[]>(key, [
        ...(prev ?? []),
        {
          id: `tmp:${Date.now()}`,
          jid: contact.jid,
          from_me: true,
          body,
          kind: "text",
          ts: new Date().toISOString(),
          pending: "pending",
        },
      ]);
      return { prev };
    },
    onError: (e, body, ctx) => {
      qc.setQueryData(["wa-thread", contact.jid], ctx?.prev);
      setText(body);
      toast.error(e instanceof Error ? e.message : "Não foi possível enviar");
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: ["wa-thread", contact.jid] }),
  });
  const stage = useMutation({
    mutationFn: (s: WaContact["stage"]) =>
      waUpdateContact({ data: { jid: contact.jid, stage: s } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["wa-inbox"] }),
  });

  const submit = () => {
    const body = text.trim();
    if (body && !send.isPending) send.mutate(body);
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };
  const offline = bridge?.status !== "online";
  const msgs = thread.data ?? [];

  return (
    <>
      <header className="flex items-center gap-3 border-b border-white/[0.06] p-3 sm:p-4">
        <button
          type="button"
          onClick={onBack}
          aria-label="Voltar"
          className="press grid size-10 shrink-0 place-items-center rounded-full bg-[#232323] lg:hidden"
        >
          <ArrowLeft className="size-[18px]" />
        </button>
        <Avatar
          name={contactName(contact)}
          score={lead?.score}
          temp={lead?.temp}
          size={44}
          gold={(lead?.orders_count ?? 0) > 0}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[16px] font-bold">{contactName(contact)}</p>
          <p className="truncate text-[12.5px] text-[#8C8C8C]">
            {fmtPhone(contact.phone_normalized)}
            {contact.customer_id ? " · cliente" : " · sem ficha"}
          </p>
        </div>
        {lead ? <TempPill temp={lead.temp} score={lead.score} className="max-sm:hidden" /> : null}
        <button
          type="button"
          onClick={onInsight}
          aria-label="Ver cliente"
          className="press grid size-10 shrink-0 place-items-center rounded-full bg-[#232323] xl:hidden"
        >
          <PanelRightOpen className="size-[18px]" />
        </button>
      </header>

      <div className="adm-scroll flex gap-1.5 overflow-x-auto border-b border-white/[0.06] px-3 py-2.5 sm:px-4">
        {STAGES.map((s) => (
          <button
            key={s.v}
            type="button"
            aria-pressed={contact.stage === s.v}
            onClick={() => stage.mutate(s.v)}
            className={cn(
              "press h-8 shrink-0 rounded-full px-3 text-[12.5px] font-bold",
              contact.stage === s.v
                ? s.v === "comprou"
                  ? "bg-[#7FCF9F] text-[#15130F]"
                  : s.v === "perdido"
                    ? "bg-[#FF9A8A] text-[#15130F]"
                    : "bg-[#FFD599] text-[#15130F]"
                : "bg-[#1F1F1F] text-[#A9A9A9] hover:text-white",
            )}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="adm-scroll min-h-0 flex-1 space-y-1.5 overflow-y-auto bg-[#121212] px-3 py-4 sm:px-5">
        {thread.isPending ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className={cn("admin-skeleton h-12 w-2/3 rounded-[18px]", i % 2 && "ml-auto")}
              />
            ))}
          </div>
        ) : msgs.length === 0 ? (
          <p className="py-10 text-center text-[13.5px] text-[#8C8C8C]">
            Nenhuma mensagem ainda. Escreva a primeira abaixo.
          </p>
        ) : (
          msgs.map((m, i) => {
            const prev = msgs[i - 1];
            const newDay =
              !prev || new Date(prev.ts).toDateString() !== new Date(m.ts).toDateString();
            return (
              <div key={m.id}>
                {newDay ? (
                  <p className="my-3 text-center text-[11.5px] font-semibold text-[#6F6F6F]">
                    {new Date(m.ts).toLocaleDateString("pt-BR", {
                      weekday: "short",
                      day: "2-digit",
                      month: "short",
                    })}
                  </p>
                ) : null}
                <div className={cn("flex", m.from_me ? "justify-end" : "justify-start")}>
                  <div
                    className={cn(
                      "max-w-[82%] rounded-[20px] px-3.5 py-2 text-[14.5px] leading-snug whitespace-pre-wrap [overflow-wrap:anywhere]",
                      m.from_me
                        ? "rounded-br-[6px] bg-[#FFD599] text-[#15130F]"
                        : "rounded-bl-[6px] bg-[#232323] text-white",
                      m.pending === "failed" && "ring-2 ring-[#FF9A8A]",
                    )}
                  >
                    {m.body || (
                      <span className="italic opacity-70">
                        [
                        {m.kind === "image"
                          ? "foto"
                          : m.kind === "audio"
                            ? "áudio"
                            : m.kind === "video"
                              ? "vídeo"
                              : m.kind === "sticker"
                                ? "figurinha"
                                : "mídia"}
                        ]
                      </span>
                    )}
                    <span
                      className={cn(
                        "mt-0.5 flex items-center justify-end gap-1 text-[10.5px] tabular-nums",
                        m.from_me ? "text-[#15130F]/55" : "text-[#8C8C8C]",
                      )}
                    >
                      {new Date(m.ts).toLocaleTimeString("pt-BR", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      {m.from_me ? (
                        m.pending === "failed" ? (
                          <AlertTriangle
                            className="size-3 text-[#B3261E]"
                            aria-label={m.error ?? "Falhou"}
                          />
                        ) : m.pending ? (
                          <Clock3 className="size-3" aria-label="Na fila" />
                        ) : (
                          <CheckCheck className="size-3" aria-label="Enviada" />
                        )
                      ) : null}
                    </span>
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={endRef} />
      </div>

      <div className="border-t border-white/[0.06] p-3 sm:p-4">
        <div className="adm-scroll -mx-1 mb-2 flex gap-1.5 overflow-x-auto px-1">
          {QUICK.map((qr) => (
            <button
              key={qr.label}
              type="button"
              onClick={() => setText((t) => (t.trim() ? `${t.trim()} ${qr.text}` : qr.text))}
              className="press h-8 shrink-0 rounded-full bg-[#1F1F1F] px-3 text-[12.5px] font-semibold text-[#D4D4D4] hover:text-white"
            >
              {qr.label}
            </button>
          ))}
        </div>
        <div className="flex items-end gap-2">
          <textarea
            ref={taRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKey}
            rows={Math.min(5, Math.max(1, text.split("\n").length))}
            placeholder={
              offline ? "WhatsApp desconectado: a mensagem fica na fila" : "Escreva uma mensagem"
            }
            className="min-h-12 flex-1 resize-none rounded-[22px] bg-[#232323] px-4 py-3 text-[14.5px] leading-snug outline-none placeholder:text-[#6F6F6F] focus:ring-2 focus:ring-[#FFD599]/40"
          />
          <button
            type="button"
            onClick={submit}
            disabled={!text.trim()}
            aria-label="Enviar"
            className="press grid size-12 shrink-0 place-items-center rounded-full bg-[#FFD599] text-[#15130F] disabled:opacity-40"
          >
            <Send className="size-[18px]" />
          </button>
        </div>
      </div>
    </>
  );
}

const compose = (t: string) =>
  window.dispatchEvent(new CustomEvent("orium-crm-compose", { detail: t }));

function Insight({ contact, lead }: { contact: WaContact; lead: Lead | null }) {
  const [ficha, setFicha] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  const thread = useQuery({
    queryKey: ["wa-thread", contact.jid],
    queryFn: () => waThread({ data: { jid: contact.jid } }),
    staleTime: 3_000,
  });
  // o que o cliente escreveu por último decide quais perfumes cotar
  const inboundText = useMemo(
    () =>
      (thread.data ?? [])
        .filter((m) => !m.from_me && m.body)
        .slice(-8)
        .map((m) => m.body)
        .join("\n"),
    [thread.data],
  );
  const quotes = useQuery({
    queryKey: ["crm-quote", contact.jid, inboundText],
    queryFn: () => crmPerfumeQuote({ data: { text: inboundText } }),
    enabled: !!inboundText,
    staleTime: 60_000,
  });
  const manualQ = useQuery({
    queryKey: ["crm-quote-manual", manual],
    queryFn: () => crmPerfumeQuote({ data: { text: manual } }),
    enabled: manual.trim().length >= 3,
    staleTime: 60_000,
  });

  return (
    <div className="flex flex-col gap-3">
      {!contact.customer_id ? <LinkCustomer contact={contact} /> : null}

      {lead ? (
        <>
          <LeadReading lead={lead} compact onUseMessage={compose} />
          <button
            type="button"
            onClick={() => setFicha(lead.id)}
            className="press inline-flex h-10 w-full items-center justify-center rounded-full bg-[#1A1A1A] text-[13.5px] font-bold hover:bg-[#202020]"
          >
            Abrir ficha completa
          </button>
        </>
      ) : null}

      <section
        className={cn(
          "rounded-[24px] bg-[#141414] p-1",
          (quotes.data ?? []).length > 0 && "order-first",
        )}
      >
        <div className="flex items-baseline justify-between gap-2 px-3 pt-3 pb-2">
          <h3 className="text-[15px] font-bold">Perfumes citados</h3>
          {quotes.isFetching ? <span className="text-[12px] text-[#8C8C8C]">Lendo…</span> : null}
        </div>
        <div className="space-y-2">
          {(quotes.data ?? []).map((qt) => (
            <PerfumeQuoteCard key={qt.product_id} q={qt} onInsert={compose} />
          ))}
          {!quotes.isFetching && !(quotes.data ?? []).length ? (
            <p className="px-3 pb-3 text-[13px] text-[#8C8C8C]">
              Quando o cliente falar o nome de um perfume, o preço aparece aqui.
            </p>
          ) : null}
        </div>
        <div className="p-2">
          <label className="relative block">
            <Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-[#6F6F6F]" />
            <input
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              placeholder="Cotar outro perfume"
              className={cn(pxInputClass, "pl-11")}
            />
          </label>
          <div className="mt-2 space-y-2">
            {(manualQ.data ?? []).map((qt) => (
              <PerfumeQuoteCard key={`m-${qt.product_id}`} q={qt} onInsert={compose} />
            ))}
            {manual.trim().length >= 3 && !manualQ.isFetching && !(manualQ.data ?? []).length ? (
              <p className="px-2 text-[13px] text-[#8C8C8C]">Não achei esse perfume no catálogo.</p>
            ) : null}
          </div>
        </div>
      </section>

      <CustomerSheet id={ficha} onClose={() => setFicha(null)} />
    </div>
  );
}

function LinkCustomer({ contact }: { contact: WaContact }) {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [name, setName] = useState(contact.push_name ?? "");
  const found = useQuery({
    queryKey: ["crm-search", q],
    queryFn: () => crmCustomerSearch({ data: { q } }),
    enabled: q.trim().length >= 2,
  });
  const link = useMutation({
    mutationFn: (v: { customerId?: string; createName?: string }) =>
      waLinkCustomer({ data: { jid: contact.jid, ...v } }),
    onSuccess: () => {
      toast.success("Conversa ligada ao cliente");
      void qc.invalidateQueries({ queryKey: ["wa-inbox"] });
      void qc.invalidateQueries({ queryKey: ["crm-leads"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não foi possível ligar"),
  });
  return (
    <section className="rounded-[24px] bg-[#1A1A1A] p-4 sm:p-5">
      <div className="flex items-center gap-2">
        <Smartphone className="size-4 text-[#FFD599]" />
        <h3 className="text-[15px] font-bold">Número sem ficha</h3>
      </div>
      <p className="mt-1 text-[13px] text-[#8C8C8C]">
        Crie a ficha para o CRM juntar o que essa pessoa olha e compra no app.
      </p>
      <div className="mt-3 flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nome do cliente"
          className={cn(pxInputClass, "flex-1")}
        />
        <button
          type="button"
          disabled={!name.trim() || link.isPending}
          onClick={() => link.mutate({ createName: name })}
          className="press inline-flex h-12 shrink-0 items-center gap-1.5 rounded-full bg-[#FFD599] px-4 text-[13.5px] font-bold text-[#15130F] disabled:opacity-40"
        >
          <UserPlus className="size-4" /> Criar
        </button>
      </div>
      <label className="relative mt-3 block">
        <Link2 className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-[#6F6F6F]" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Ou ligar a um cliente existente"
          className={cn(pxInputClass, "pl-11")}
        />
      </label>
      {(found.data ?? []).length ? (
        <div className="mt-2 space-y-1">
          {found.data!.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => link.mutate({ customerId: c.id })}
              className="press flex w-full items-center gap-2.5 rounded-[16px] p-2 text-left hover:bg-white/[0.05]"
            >
              <Avatar name={c.name} size={34} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-bold">
                  {c.name ?? "Sem nome"}
                </span>
                <span className="block truncate text-[12px] text-[#8C8C8C]">
                  {fmtPhone(c.phone_normalized)}
                </span>
              </span>
              <Check className="size-4 text-[#6F6F6F]" />
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
