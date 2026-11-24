/**
 * CRM → CONVERSAS.
 * O WhatsApp da loja dentro do CRM, em tempo real:
 * caixas | mensagens | conversa | assistente.
 * A conversa tem ajuda embutida: preço do perfume citado logo abaixo da mensagem,
 * botão "Resposta ideal" (IA focada em fechar a venda) e respostas rápidas.
 * O assistente ao lado diz quem é o cliente e o que fazer. Nada sai sem clique.
 */
import { useWaAvatars } from "@/lib/use-wa-avatars";
import { throttleByKey } from "@/lib/realtime-throttle";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { createPortal } from "react-dom";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Archive,
  ArrowLeft,
  ArrowUpDown,
  ArchiveRestore,
  ExternalLink,
  Mail,
  MessageCircle,
  Trash2,
  Check,
  CheckCheck,
  ChevronDown,
  Clock3,
  Copy,
  Flame,
  Inbox,
  Lightbulb,
  Link2,
  MailOpen,
  MessagesSquare,
  PanelRightClose,
  PanelRightOpen,
  PencilLine,
  RefreshCw,
  Search,
  SendHorizontal,
  Sparkles,
  Star,
  UserPlus,
  UserRound,
  UserX,
  Users,
  X,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { AdminShell } from "@/components/orium/AdminShell";
import { CustomerSheet, whatsLink } from "@/components/orium/CustomerSheet";
import { crmCustomerDelete } from "@/lib/crm.functions";
import { SidePanel } from "@/components/orium/admin/orders/model";
import { PanelHeader, PanelScroll } from "@/components/orium/admin/PanelKit";
import { pxInputClass } from "@/components/orium/admin/PricingUI";
import { WhatsMark } from "@/components/orium/crm/CrmShell";
import { MediaContent, isMediaKind } from "@/components/orium/crm/MediaBubble";
import { ReplyIdeal } from "@/components/orium/crm/ReplyIdeal";
import { Avatar, TEMP, ago, fmtPhone } from "@/components/orium/crm/shared";
import { onAdminSignal } from "@/lib/admin-signal";
import {
  TASKS,
  enrich,
  factsOf,
  interestsOf,
  messageOptions,
  taskOf,
  type Lead,
} from "@/lib/crm-intel";
import {
  crmCustomerSearch,
  crmLeads,
  crmPerfumeQuote,
  crmStaff,
  waInbox,
  waLinkCustomer,
  waSend,
  waThread,
  waAnalyze,
  waAssign,
  waDeleteContact,
  waInsight,
  waUpdateContact,
  type PerfumeQuote,
  type WaBridge,
  type WaContact,
  type WaMessage,
  type StaffMember,
} from "@/lib/crm-wa.functions";
import { brl } from "@/lib/format";
import { flat } from "@/lib/perfume-mentions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/admin/conversas")({
  validateSearch: (s: Record<string, unknown>) => ({
    jid: typeof s.jid === "string" ? s.jid : undefined,
  }),
  head: () => ({
    meta: [{ title: "Conversas — Orium CRM" }, { name: "robots", content: "noindex" }],
  }),
  component: ConversasPage,
});

type Box =
  | "minhas"
  | "fila"
  | "todas"
  | "responder"
  | "nao_lidas"
  | "fixadas"
  | "arquivadas"
  | "quentes"
  | "clientes"
  | "sem_ficha"
  | `etapa:${WaContact["stage"]}`;

const STAGES: Array<{ v: WaContact["stage"]; label: string; dot: string }> = [
  { v: "novo", label: "Novo", dot: "#A9A9A9" },
  { v: "interessado", label: "Interessado", dot: "#F2C46D" },
  { v: "negociando", label: "Negociando", dot: "#FFD599" },
  { v: "comprou", label: "Comprou", dot: "#7FCF9F" },
  { v: "perdido", label: "Perdido", dot: "#FF9A8A" },
];
const QUICK = [
  { label: "Saudação", text: "Oi! Aqui é da Orium Perfumes Como posso te ajudar?" },
  {
    label: "Retirada grátis",
    text: "A retirada na loja é grátis! Te aviso assim que estiver separado",
  },
  { label: "Chave Pix", text: "No Pix tem desconto! Quer que eu te mande a chave?" },
  {
    label: "Catálogo",
    text: "Dá uma olhada no nosso catálogo completo: https://oriumperfumes.com",
  },
  { label: "Separar", text: "Separo um pra você? Assim garante o seu" },
];

const HEAT: Record<string, { label: string; cls: string }> = {
  frio: { label: "Frio", cls: "bg-[#232323] text-[#A9A9A9]" },
  morno: { label: "Morno", cls: "bg-white/[0.08] text-white" },
  quente: { label: "Quente", cls: "bg-[#FFB86B] text-[#15130F]" },
  pronto: { label: "Pronto pra comprar", cls: "bg-[#7FCF9F] text-[#15130F]" },
};
const OBJ: Record<string, string> = {
  preco: "preço",
  vou_pensar: "vou pensar",
  confianca: "confiança",
  comparando: "comparando",
  entrega: "entrega",
  indeciso: "indeciso",
  sumiu: "sumiu",
};

/** Equipe que atende (quem sou eu + nomes), para todo o Conversas. */
type Team = {
  me: string | null;
  staff: StaffMember[];
  name: (id?: string | null) => string;
  first: (id?: string | null) => string;
};
const TeamContext = createContext<Team>({ me: null, staff: [], name: () => "", first: () => "" });
const TEAM_COLORS = ["#FFD599", "#7FCF9F", "#9DB7FF", "#FF9A8A", "#C9A7FF", "#F2C46D"];

function TeamAvatar({ id, size = 26 }: { id: string; size?: number }) {
  const team = useContext(TeamContext);
  const i = Math.max(
    0,
    team.staff.findIndex((s) => s.id === id),
  );
  const n = team.name(id);
  const ini = n
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <span
      title={n}
      className="grid shrink-0 place-items-center rounded-full font-black text-[#15130F]"
      style={{
        width: size,
        height: size,
        background: TEAM_COLORS[i % TEAM_COLORS.length],
        fontSize: Math.round(size * 0.38),
      }}
    >
      {ini || "?"}
    </span>
  );
}

const contactName = (c: WaContact) =>
  c.customer?.name ||
  c.saved_name ||
  c.push_name ||
  fmtPhone(c.phone_normalized) ||
  c.jid.split("@")[0];
const compose = (t: string) =>
  window.dispatchEvent(new CustomEvent("orium-crm-compose", { detail: t }));

/** Texto pronto com o preço de um perfume (só dados reais). */
function pricePitch(q: PerfumeQuote) {
  const f = q.frasco;
  if (!f) return `O ${q.name} eu consigo pra você! Vou confirmar o valor e já te passo`;
  const card = f.card && f.card !== f.pix ? ` ou ${brl(f.card)} no cartão` : "";
  return `O ${q.name}${q.volume_ml ? ` ${q.volume_ml}ml` : ""} sai por ${brl(f.pix)} no Pix${card}${f.promo ? ` Já com ${Math.round(f.promo)}% de desconto.` : ""}${q.ready ? " Tenho aqui pra retirar hoje." : ""} Separo um pra você?`;
}

/** Conversa + perfumes citados pelo cliente (mesma consulta usada no chat e no assistente). */
function useThread(jid: string) {
  return useQuery({
    queryKey: ["wa-thread", jid],
    queryFn: () => waThread({ data: { jid } }),
    staleTime: 10_000,
  });
}
function useQuotes(jid: string, msgs: WaMessage[] | undefined) {
  const inboundText = useMemo(
    () =>
      (msgs ?? [])
        .filter((m) => !m.from_me && m.body)
        .slice(-8)
        .map((m) => m.body)
        .join("\n"),
    [msgs],
  );
  return useQuery({
    queryKey: ["crm-quote", jid, inboundText],
    queryFn: () => crmPerfumeQuote({ data: { text: inboundText } }),
    enabled: !!inboundText,
    staleTime: 60_000,
    // mensagem nova chegou: mantém os perfumes na tela enquanto atualiza
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[1] === jid ? prev : undefined),
  });
}

function ConversasPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { jid: selected } = Route.useSearch();
  const [box, setBox] = useState<Box>("todas");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"recentes" | "quentes">("recentes");
  const [assistOpen, setAssistOpen] = useState(true);
  const [assistSheet, setAssistSheet] = useState(false);
  const [menu, setMenu] = useState<{ c: WaContact; x: number; y: number } | null>(null);
  const [menuFicha, setMenuFicha] = useState<string | null>(null);

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
  const staffQ = useQuery({
    queryKey: ["crm-staff"],
    queryFn: () => crmStaff(),
    staleTime: 10 * 60_000,
  });
  const team = useMemo<Team>(() => {
    const staff = staffQ.data?.staff ?? [];
    const name = (id?: string | null) =>
      staff.find((s) => s.id === id)?.name ?? (id ? "Equipe" : "");
    return {
      me: staffQ.data?.me ?? null,
      staff,
      name,
      first: (id) => name(id).split(/\s+/)[0] ?? "",
    };
  }, [staffQ.data]);
  const leadById = useMemo(
    () => new Map(enrich(leadsQ.data ?? []).map((l) => [l.id, l])),
    [leadsQ.data],
  );

  useEffect(() => {
    // eventos chegam em rajada (ex.: histórico ao conectar): recarrega no máximo 1x a cada 2 s
    const inboxBump = throttleByKey(
      () => void qc.invalidateQueries({ queryKey: ["wa-inbox"] }),
      2000,
    );
    const threadBump = throttleByKey(() => openThreads(), 1200);
    const insightBump = throttleByKey(() => openInsights(), 3000);
    // Sinal leve (sem dados): só a conversa aberta na tela busca de novo.
    const openThreads = () =>
      void qc.invalidateQueries({ queryKey: ["wa-thread"], refetchType: "active" });
    const openInsights = () => {
      void qc.invalidateQueries({ queryKey: ["wa-insight"], refetchType: "active" });
      void qc.invalidateQueries({ queryKey: ["crm-leads"] });
    };
    const off = onAdminSignal(
      ["wa_contacts", "wa_outbox", "wa_bridge_state", "wa_insights"],
      (ev) => {
        if (ev === "wa_contacts" || ev === "wa_bridge_state") inboxBump();
        if (ev === "wa_contacts" || ev === "wa_outbox") threadBump("aberta");
        if (ev === "wa_insights") insightBump("aberta");
      },
    );
    return () => {
      inboxBump.cancel();
      threadBump.cancel();
      insightBump.cancel();
      off();
    };
  }, [qc]);

  const avatars = useWaAvatars();
  const contacts = useMemo(
    () => (inbox.data?.contacts ?? []).map((c) => ({ ...c, avatar: avatars[c.jid] ?? null })),
    [inbox.data, avatars],
  );
  const bridge = inbox.data?.bridge;
  const leadOf = (c: WaContact) => (c.customer_id ? leadById.get(c.customer_id) : undefined);

  const matchBox = (c: WaContact, b: Box): boolean => {
    if (b === "arquivadas") return c.archived;
    if (c.archived) return false;
    if (b === "todas") return true;
    if (b === "minhas") return !!team.me && c.assigned_to === team.me;
    if (b === "fila") return !c.assigned_to;
    if (b === "responder") return c.last_from_me === false;
    if (b === "nao_lidas") return c.unread > 0;
    if (b === "fixadas") return c.pinned;
    if (b === "quentes") return leadOf(c)?.temp === "quente";
    if (b === "clientes") return !!c.customer_id;
    if (b === "sem_ficha") return !c.customer_id;
    return c.stage === b.slice(6);
  };
  const count = (b: Box) => contacts.filter((c) => matchBox(c, b)).length;

  const list = useMemo(() => {
    const term = q.trim().toLowerCase();
    const digits = term.replace(/\D/g, "");
    return contacts
      .filter((c) => matchBox(c, box))
      .filter(
        (c) =>
          !term ||
          contactName(c).toLowerCase().includes(term) ||
          (c.last_message_preview ?? "").toLowerCase().includes(term) ||
          (digits.length >= 3 && (c.phone_normalized ?? "").includes(digits)),
      )
      .sort((a, b) =>
        sort === "quentes"
          ? (leadOf(b)?.score ?? -1) - (leadOf(a)?.score ?? -1)
          : Number(b.pinned) - Number(a.pinned) ||
            +new Date(b.last_message_at ?? 0) - +new Date(a.last_message_at ?? 0),
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contacts, box, q, sort, leadById]);

  const current = contacts.find((c) => c.jid === selected) ?? null;
  const lead = current?.customer_id ? (leadById.get(current.customer_id) ?? null) : null;
  const select = (jid: string | undefined) =>
    void navigate({ to: "/admin/conversas", search: { jid } as never, replace: true });

  return (
    <TeamContext.Provider value={team}>
      <AdminShell title="Conversas" bare>
        <div className="flex min-h-[calc(100dvh-210px)] min-w-0 flex-1 lg:h-full lg:min-h-0">
          {/* 1. caixas */}
          <aside className="adm-scroll hidden w-[228px] shrink-0 overflow-y-auto border-r border-white/[0.06] px-3 py-5 min-[1700px]:block">
            <div className="px-2">
              <p className="text-[17px] font-bold tracking-[-0.02em]">Caixa de entrada</p>
              <p className="mt-0.5 truncate text-[12.5px] text-[#8C8C8C]">
                {bridge?.phone ? fmtPhone(bridge.phone) : "WhatsApp da loja"}
              </p>
            </div>
            <div className="mt-4 space-y-0.5">
              <BoxItem
                icon={<UserRound />}
                label="Minhas conversas"
                n={count("minhas")}
                active={box === "minhas"}
                onClick={() => setBox("minhas")}
              />
              <BoxItem
                icon={<UserPlus />}
                label="Sem atendente"
                n={count("fila")}
                hot
                active={box === "fila"}
                onClick={() => setBox("fila")}
              />
              <BoxItem
                icon={<Inbox />}
                label="Todas"
                n={count("todas")}
                active={box === "todas"}
                onClick={() => setBox("todas")}
              />
              <BoxItem
                icon={<MessagesSquare />}
                label="Esperando você"
                n={count("responder")}
                hot
                active={box === "responder"}
                onClick={() => setBox("responder")}
              />
              <BoxItem
                icon={<MailOpen />}
                label="Não lidas"
                n={count("nao_lidas")}
                active={box === "nao_lidas"}
                onClick={() => setBox("nao_lidas")}
              />
              <BoxItem
                icon={<Star />}
                label="Fixadas"
                n={count("fixadas")}
                active={box === "fixadas"}
                onClick={() => setBox("fixadas")}
              />
              <BoxItem
                icon={<Archive />}
                label="Arquivadas"
                n={count("arquivadas")}
                active={box === "arquivadas"}
                onClick={() => setBox("arquivadas")}
              />
            </div>
            <BoxGroup title="Etapas">
              {STAGES.map((s) => (
                <BoxItem
                  key={s.v}
                  icon={<span className="size-2.5 rounded-full" style={{ background: s.dot }} />}
                  label={s.label}
                  n={count(`etapa:${s.v}`)}
                  active={box === `etapa:${s.v}`}
                  onClick={() => setBox(`etapa:${s.v}`)}
                />
              ))}
            </BoxGroup>
            <BoxGroup title="Listas">
              <BoxItem
                icon={<Flame />}
                label="Quentes"
                n={count("quentes")}
                hot
                active={box === "quentes"}
                onClick={() => setBox("quentes")}
              />
              <BoxItem
                icon={<Users />}
                label="Clientes"
                n={count("clientes")}
                active={box === "clientes"}
                onClick={() => setBox("clientes")}
              />
              <BoxItem
                icon={<UserX />}
                label="Sem ficha"
                n={count("sem_ficha")}
                active={box === "sem_ficha"}
                onClick={() => setBox("sem_ficha")}
              />
            </BoxGroup>
          </aside>

          {/* 2. mensagens */}
          <section
            className={cn(
              "flex min-h-0 w-full flex-col border-white/[0.06] lg:w-[330px] lg:shrink-0 lg:border-r",
              selected && "max-lg:hidden",
            )}
          >
            <div className="space-y-3 px-4 pt-1 pb-3 lg:pt-5">
              <div className="flex items-center justify-between gap-3">
                <h1 className="text-[22px] font-bold tracking-[-0.03em]">Mensagens</h1>
                <button
                  type="button"
                  onClick={() => setSort((s) => (s === "recentes" ? "quentes" : "recentes"))}
                  className="press inline-flex h-9 items-center gap-1.5 rounded-full bg-[#1F1F1F] px-3 text-[12.5px] font-bold text-[#D4D4D4] hover:text-white"
                >
                  <ArrowUpDown className="size-3.5" />
                  {sort === "recentes" ? "Recentes" : "Mais quentes"}
                </button>
              </div>
              <label className="relative block">
                <Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-[#6F6F6F]" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Buscar nome ou mensagem"
                  className={cn(pxInputClass, "pl-11")}
                />
              </label>
              <div className="adm-scroll -mx-1 flex gap-1.5 overflow-x-auto px-1 min-[1700px]:hidden">
                {(
                  [
                    ["todas", "Todas"],
                    ["minhas", "Minhas"],
                    ["fila", "Sem atendente"],
                    ["responder", "Esperando você"],
                    ["nao_lidas", "Não lidas"],
                    ["quentes", "Quentes"],
                    ["sem_ficha", "Sem ficha"],
                    ["arquivadas", "Arquivadas"],
                  ] as Array<[Box, string]>
                ).map(([v, label]) => (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={box === v}
                    onClick={() => setBox(v)}
                    className={cn(
                      "press inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-bold",
                      box === v
                        ? "bg-white text-[#15130F]"
                        : "bg-[#1F1F1F] text-[#A9A9A9] hover:text-white",
                    )}
                  >
                    {label}
                    <span
                      className={cn(
                        "tabular-nums",
                        box === v ? "text-[#15130F]/55" : "text-[#6F6F6F]",
                      )}
                    >
                      {count(v)}
                    </span>
                  </button>
                ))}
              </div>
              <BridgeStrip bridge={bridge} loading={inbox.isPending} />
            </div>
            <div className="adm-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-3">
              {inbox.isPending ? (
                [0, 1, 2, 3, 4].map((i) => (
                  <div key={i} className="admin-skeleton mx-2 my-2 h-[72px] rounded-[20px]" />
                ))
              ) : list.length === 0 ? (
                <div className="grid h-full min-h-[240px] place-items-center p-6 text-center">
                  <div>
                    <MessagesSquare className="mx-auto size-6 text-[#6F6F6F]" />
                    <p className="mt-3 text-[14px] font-semibold">
                      {contacts.length ? "Nada nessa caixa" : "Nenhuma conversa ainda"}
                    </p>
                    <p className="mt-1 text-[13px] text-[#8C8C8C]">
                      {contacts.length
                        ? "Escolha outra caixa."
                        : "Conecte o WhatsApp para as conversas aparecerem aqui."}
                    </p>
                  </div>
                </div>
              ) : (
                list.map((c) => (
                  <ContactRow
                    key={c.jid}
                    c={c}
                    lead={leadOf(c)}
                    active={c.jid === selected}
                    onOpen={() => select(c.jid)}
                    onMenu={(x, y) => setMenu({ c, x, y })}
                  />
                ))
              )}
            </div>
          </section>

          {/* 3. conversa */}
          <section
            className={cn(
              "flex min-w-0 flex-1 flex-col max-lg:h-[calc(100dvh-218px)] max-lg:min-h-[420px] lg:min-h-0",
              !selected && "max-lg:hidden",
            )}
          >
            {bridge?.status === "qr" && bridge.qr && !current ? (
              <QrCard qr={bridge.qr} />
            ) : current ? (
              <Thread
                key={current.jid}
                contact={current}
                lead={lead}
                bridge={bridge}
                onBack={() => select(undefined)}
                assistOpen={assistOpen}
                onToggleAssist={() => {
                  if (window.matchMedia("(min-width: 1280px)").matches) setAssistOpen((v) => !v);
                  else setAssistSheet(true);
                }}
              />
            ) : (
              <div className="grid h-full place-items-center p-8 text-center">
                <div className="max-w-sm">
                  <span className="dash-ico mx-auto">
                    <MessagesSquare className="size-[18px]" strokeWidth={2.2} />
                  </span>
                  <h2 className="mt-4 text-[19px] font-bold tracking-[-0.02em]">
                    Escolha uma conversa
                  </h2>
                  <p className="mt-1.5 text-[14px] text-[#8C8C8C]">
                    Dentro da conversa você tem o preço dos perfumes citados e o botão Resposta
                    ideal para quando não souber o que responder.
                  </p>
                </div>
              </div>
            )}
          </section>

          {/* 4. assistente */}
          {current && assistOpen ? (
            <aside className="adm-scroll hidden w-[340px] shrink-0 overflow-y-auto border-l border-white/[0.06] p-4 xl:block 2xl:w-[364px]">
              <Assistant contact={current} lead={lead} onClose={() => setAssistOpen(false)} />
            </aside>
          ) : null}
        </div>

        {menu ? (
          <ContactMenu
            c={menu.c}
            x={menu.x}
            y={menu.y}
            onClose={() => setMenu(null)}
            onOpen={() => select(menu.c.jid)}
            onFicha={(id) => setMenuFicha(id)}
            onDeleted={(jid) => {
              if (jid === selected) select(undefined);
            }}
          />
        ) : null}
        <CustomerSheet id={menuFicha} onClose={() => setMenuFicha(null)} />

        <SidePanel
          open={assistSheet && !!current}
          onClose={() => setAssistSheet(false)}
          label="Assistente"
        >
          {current ? (
            <>
              <PanelHeader
                title="Assistente"
                subtitle={contactName(current)}
                onClose={() => setAssistSheet(false)}
              />
              <PanelScroll swapKey={current.jid}>
                <div className="px-5 pb-6 lg:px-6">
                  <Assistant contact={current} lead={lead} />
                </div>
              </PanelScroll>
            </>
          ) : null}
        </SidePanel>
      </AdminShell>
    </TeamContext.Provider>
  );
}

/* ───────────────────────── lista ───────────────────────── */

function BoxGroup({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="mt-5 border-t border-white/[0.06] pt-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-2 text-[13px] font-bold text-[#D4D4D4]"
      >
        <ChevronDown className={cn("size-4 transition-transform", !open && "-rotate-90")} />
        {title}
      </button>
      {open ? <div className="mt-2 space-y-0.5">{children}</div> : null}
    </div>
  );
}

function BoxItem({
  icon,
  label,
  n,
  active,
  hot,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  n: number;
  active: boolean;
  hot?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "press flex h-11 w-full items-center gap-3 rounded-[16px] px-3 text-left text-[14px] font-semibold transition-colors",
        active
          ? "bg-white/[0.09] text-white"
          : "text-[#A9A9A9] hover:bg-white/[0.04] hover:text-white",
      )}
    >
      <span className="grid size-5 shrink-0 place-items-center [&_svg]:size-[17px]">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {n ? (
        <span
          className={cn(
            "grid h-6 min-w-6 place-items-center rounded-full px-1.5 text-[11.5px] font-bold tabular-nums",
            hot ? "bg-[#FFD599] text-[#15130F]" : "border border-white/[0.1] text-[#D4D4D4]",
          )}
        >
          {n}
        </span>
      ) : null}
    </button>
  );
}

function ContactRow({
  c,
  lead,
  active,
  onOpen,
  onMenu,
}: {
  c: WaContact;
  lead?: Lead;
  active: boolean;
  onOpen: () => void;
  onMenu: (x: number, y: number) => void;
}) {
  // segurar o dedo (celular) abre o mesmo menu do botão direito
  const press = useRef<{ t: number; x: number; y: number; fired: boolean } | null>(null);
  const qc = useQueryClient();
  const pin = useMutation({
    mutationFn: () => waUpdateContact({ data: { jid: c.jid, pinned: !c.pinned } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["wa-inbox"] }),
  });
  const waiting = c.last_from_me === false;
  // passou o mouse / encostou: já começa a carregar a conversa
  const warm = () =>
    void qc.prefetchQuery({
      queryKey: ["wa-thread", c.jid],
      queryFn: () => waThread({ data: { jid: c.jid } }),
      staleTime: 15_000,
    });
  return (
    <div
      role="button"
      tabIndex={0}
      onMouseEnter={warm}
      onFocus={warm}
      onTouchStart={warm}
      onClick={() => {
        if (press.current?.fired) return;
        onOpen();
      }}
      onKeyDown={(e) =>
        e.key === "Enter" ? onOpen() : e.key === "ContextMenu" ? onMenu(80, 200) : undefined
      }
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu(e.clientX, e.clientY);
      }}
      onPointerDown={(e) => {
        if (e.pointerType === "mouse") return;
        const st = { x: e.clientX, y: e.clientY, fired: false, t: 0 };
        st.t = window.setTimeout(() => {
          st.fired = true;
          navigator.vibrate?.(10);
          onMenu(st.x, st.y);
        }, 480);
        press.current = st;
      }}
      onPointerMove={(e) => {
        const st = press.current;
        if (st && !st.fired && Math.hypot(e.clientX - st.x, e.clientY - st.y) > 10)
          window.clearTimeout(st.t);
      }}
      onPointerUp={() => {
        const st = press.current;
        if (st) window.clearTimeout(st.t);
        window.setTimeout(() => (press.current = null), 0);
      }}
      className={cn(
        "press group relative flex w-full min-w-0 cursor-pointer gap-3 rounded-[22px] p-3 text-left transition-colors",
        active ? "bg-[#FFD599]/[0.09] ring-1 ring-[#FFD599]/25" : "hover:bg-white/[0.04]",
      )}
    >
      <span className="relative shrink-0">
        <Avatar
          src={c.avatar ?? lead?.avatar}
          name={contactName(c)}
          score={lead?.score}
          temp={lead?.temp}
          size={46}
          gold={(lead?.orders_count ?? 0) > 0}
        />
        <span className="absolute -bottom-0.5 -left-0.5 grid size-[18px] place-items-center rounded-full bg-[#25D366] text-white ring-2 ring-[#141414]">
          <WhatsMark className="size-[11px]" />
        </span>
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-[14.5px] font-bold">{contactName(c)}</p>
          <span
            className={cn(
              "shrink-0 text-[11.5px] tabular-nums",
              c.unread ? "font-bold text-[#FFD599]" : "text-[#6F6F6F]",
            )}
          >
            {ago(c.last_message_at)}
          </span>
        </div>
        <div className="mt-0.5 flex items-end gap-2">
          <p className="line-clamp-2 min-w-0 flex-1 text-[13px] leading-snug text-[#8C8C8C]">
            {c.last_from_me ? <span className="text-[#6F6F6F]">Você: </span> : null}
            {c.last_message_preview ?? ""}
          </p>
          {c.unread ? (
            <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-[#FFD599] px-1.5 text-[11px] font-bold text-[#15130F] tabular-nums">
              {c.unread}
            </span>
          ) : (
            <button
              type="button"
              aria-label={c.pinned ? "Desafixar" : "Fixar"}
              onClick={(e) => {
                e.stopPropagation();
                pin.mutate();
              }}
              className={cn(
                "shrink-0 rounded-full p-0.5",
                c.pinned
                  ? "text-[#FFD599]"
                  : "text-[#4A4A4A] opacity-0 group-hover:opacity-100 hover:text-white",
              )}
            >
              <Star className="size-4" fill={c.pinned ? "currentColor" : "none"} />
            </button>
          )}
        </div>
        <ContactRowFoot c={c} waiting={waiting} />
      </div>
    </div>
  );
}

function BridgeStrip({ bridge, loading }: { bridge?: WaBridge; loading: boolean }) {
  if (loading || !bridge) return null;
  const stale = !bridge.last_seen || Date.now() - new Date(bridge.last_seen).getTime() > 150_000;
  if (bridge.status === "online" && !stale) return null;
  const label =
    bridge.status === "qr" && !stale
      ? "Escaneie o QR para conectar"
      : bridge.status === "connecting" && !stale
        ? "Conectando ao WhatsApp…"
        : "WhatsApp desconectado";
  return (
    <div className="flex items-center gap-2.5 rounded-[16px] bg-[#FF9A8A]/10 px-3 py-2.5 text-[12.5px] font-semibold text-[#FFB3A7]">
      <span className="size-2 shrink-0 rounded-full bg-[#FF9A8A]" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </div>
  );
}

function QrCard({ qr }: { qr: string }) {
  return (
    <div className="grid h-full place-items-center p-6">
      <div className="max-w-[420px] text-center">
        <img
          src={qr}
          alt="QR code para conectar o WhatsApp"
          className="mx-auto size-[240px] rounded-[26px] bg-white p-3"
        />
        <h2 className="mt-5 text-[21px] font-bold tracking-[-0.02em]">
          Conecte o WhatsApp da loja
        </h2>
        <ol className="mx-auto mt-3 max-w-[340px] space-y-1.5 text-left text-[14px] text-[#D4D4D4]">
          <li>1. No celular da loja, abra o WhatsApp.</li>
          <li>2. Toque em ⋮ ou Configurações → Aparelhos conectados → Conectar aparelho.</li>
          <li>3. Aponte a câmera para este código.</li>
        </ol>
        <p className="mt-3 text-[12.5px] text-[#8C8C8C]">
          O código se renova sozinho a cada poucos segundos.
        </p>
      </div>
    </div>
  );
}

/* ───────────────────────── conversa ───────────────────────── */

/** Quem está atendendo: assumir, transferir ou encerrar. */
function AssignPill({ contact, compact }: { contact: WaContact; compact?: boolean }) {
  const qc = useQueryClient();
  const team = useContext(TeamContext);
  const [open, setOpen] = useState(false);
  const assign = useMutation({
    mutationFn: (userId: string | null) => waAssign({ data: { jid: contact.jid, userId } }),
    onSuccess: (_d, userId) => {
      toast.success(
        userId
          ? userId === team.me
            ? "Você assumiu este atendimento"
            : `Transferido para ${team.first(userId)}`
          : "Atendimento encerrado",
      );
      void qc.invalidateQueries({ queryKey: ["wa-inbox"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não deu certo"),
  });
  const who = contact.assigned_to;
  const mine = !!who && who === team.me;
  if (!who)
    return (
      <button
        type="button"
        onClick={() => assign.mutate(team.me)}
        disabled={!team.me || assign.isPending}
        className="press inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-[#FFD599] px-4 text-[13px] font-bold text-[#15130F] disabled:opacity-50"
      >
        <UserPlus className="size-4" /> {compact ? "Assumir" : "Assumir atendimento"}
      </button>
    );
  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "press inline-flex h-10 items-center gap-2 rounded-full pr-3 pl-1.5 text-[13px] font-bold",
          mine ? "bg-[#7FCF9F]/15 text-[#7FCF9F]" : "bg-white/[0.07] text-[#E5E5E5]",
        )}
      >
        <TeamAvatar id={who} size={28} />
        <span className="2xl:hidden">{mine ? "Você" : team.first(who)}</span>
        <span className="max-2xl:hidden">
          {mine ? "Você está atendendo" : `${team.first(who)} está atendendo`}
        </span>
        <ChevronDown className="size-4 opacity-70" />
      </button>
      {open ? (
        <>
          <button
            type="button"
            aria-label="Fechar"
            className="fixed inset-0 z-20 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 z-30 mt-2 w-[230px] rounded-[20px] border border-white/[0.08] bg-[#1C1C1C] p-1.5 shadow-2xl">
            {!mine ? (
              <MenuItem
                icon={<UserPlus />}
                label="Assumir eu mesmo"
                onClick={() => (setOpen(false), assign.mutate(team.me))}
              />
            ) : null}
            <p className="px-3 pt-2 pb-1 text-[11.5px] font-semibold text-[#6F6F6F]">
              Transferir para
            </p>
            {team.staff
              .filter((s) => s.id !== who)
              .map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => (setOpen(false), assign.mutate(s.id))}
                  className="flex h-10 w-full items-center gap-2.5 rounded-[14px] px-2.5 text-left text-[13.5px] font-semibold hover:bg-white/[0.06]"
                >
                  <TeamAvatar id={s.id} size={26} />
                  {s.name}
                </button>
              ))}
            <div className="my-1 h-px bg-white/[0.06]" />
            <MenuItem
              icon={<X />}
              label="Encerrar atendimento"
              onClick={() => (setOpen(false), assign.mutate(null))}
            />
          </div>
        </>
      ) : null}
    </div>
  );
}

function Thread({
  contact,
  lead,
  bridge,
  onBack,
  assistOpen,
  onToggleAssist,
}: {
  contact: WaContact;
  lead: Lead | null;
  bridge?: WaBridge;
  onBack: () => void;
  assistOpen: boolean;
  onToggleAssist: () => void;
}) {
  const qc = useQueryClient();
  const team = useContext(TeamContext);
  const [text, setText] = useState("");
  const [quick, setQuick] = useState(false);
  const [stageOpen, setStageOpen] = useState(false);
  const [idealKey, setIdealKey] = useState(0);
  const endRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const thread = useThread(contact.jid);
  const quotes = useQuotes(contact.jid, thread.data);

  useEffect(() => {
    if (contact.unread)
      void waUpdateContact({ data: { jid: contact.jid, unread: 0 } }).then(() =>
        qc.invalidateQueries({ queryKey: ["wa-inbox"] }),
      );
  }, [contact.jid, contact.unread, qc]);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [thread.data?.length]);
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
      setIdealKey(0);
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
          sent_by: team.me,
        },
      ]);
      return { prev };
    },
    onError: (e, body, ctx) => {
      qc.setQueryData(["wa-thread", contact.jid], ctx?.prev);
      setText(body);
      toast.error(e instanceof Error ? e.message : "Não foi possível enviar");
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["wa-thread", contact.jid] });
      void qc.invalidateQueries({ queryKey: ["wa-inbox"] });
    },
  });
  const stage = useMutation({
    mutationFn: (s: WaContact["stage"]) =>
      waUpdateContact({ data: { jid: contact.jid, stage: s } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["wa-inbox"] }),
  });
  const takeOver = useMutation({
    mutationFn: () => waAssign({ data: { jid: contact.jid, userId: team.me } }),
    onSuccess: () => {
      toast.success("Você assumiu este atendimento");
      void qc.invalidateQueries({ queryKey: ["wa-inbox"] });
    },
  });

  const otherAgent = !!contact.assigned_to && contact.assigned_to !== team.me;
  const submit = (body = text.trim()) => {
    if (!body || send.isPending || otherAgent) return;
    send.mutate(body);
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };
  const offline = bridge?.status !== "online";
  const msgs = thread.data ?? [];
  const name = contactName(contact);
  const live = lead?.live?.active;
  const quoteList = quotes.data ?? [];
  const st = STAGES.find((s) => s.v === contact.stage) ?? STAGES[0];
  const waitingReply = contact.last_from_me === false;
  const quoteFor = (body: string | null) => {
    if (!body) return [];
    const f = ` ${flat(body)} `;
    return quoteList.filter((qt) => qt.term && f.includes(` ${qt.term} `));
  };

  return (
    <>
      <header className="flex items-center gap-2.5 border-b border-white/[0.06] px-3 py-3 sm:gap-3 sm:px-5">
        <button
          type="button"
          onClick={onBack}
          aria-label="Voltar"
          className="press grid size-10 shrink-0 place-items-center rounded-full bg-[#1F1F1F] lg:hidden"
        >
          <ArrowLeft className="size-[18px]" />
        </button>
        <span className="relative shrink-0">
          <Avatar
            src={contact.avatar ?? lead?.avatar}
            name={name}
            score={lead?.score}
            temp={lead?.temp}
            size={44}
            gold={(lead?.orders_count ?? 0) > 0}
          />
          {live ? (
            <span className="absolute right-0 bottom-0 size-3 rounded-full bg-[#7FCF9F] ring-2 ring-[#141414]" />
          ) : null}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[16px] font-bold">{name}</p>
          <p className="truncate text-[12.5px] text-[#8C8C8C]">
            {live ? (
              <span className="text-[#7FCF9F]">
                No app agora{lead?.live?.product ? ` · vendo ${lead.live.product}` : ""}
              </span>
            ) : (
              fmtPhone(contact.phone_normalized)
            )}
          </p>
        </div>
        <AssignPill contact={contact} compact />
        <div className="relative max-sm:hidden">
          <button
            type="button"
            onClick={() => setStageOpen((v) => !v)}
            aria-label={`Etapa: ${st.label}`}
            className="press inline-flex h-10 items-center gap-2 rounded-full bg-[#1F1F1F] px-3.5 text-[13px] font-bold text-[#D4D4D4] hover:text-white"
          >
            <span className="size-2 rounded-full" style={{ background: st.dot }} />
            <span className="max-xl:hidden">{st.label}</span>
            <ChevronDown className="size-4 text-[#8C8C8C]" />
          </button>
          {stageOpen ? (
            <>
              <button
                type="button"
                aria-label="Fechar"
                className="fixed inset-0 z-20 cursor-default"
                onClick={() => setStageOpen(false)}
              />
              <div className="absolute right-0 z-30 mt-2 w-[200px] rounded-[20px] border border-white/[0.08] bg-[#1C1C1C] p-1.5 shadow-2xl">
                <p className="px-3 pt-2 pb-1 text-[11.5px] font-semibold text-[#6F6F6F]">
                  Etapa da venda
                </p>
                {STAGES.map((s) => (
                  <button
                    key={s.v}
                    type="button"
                    onClick={() => {
                      stage.mutate(s.v);
                      setStageOpen(false);
                    }}
                    className={cn(
                      "flex h-10 w-full items-center gap-2.5 rounded-[14px] px-3 text-left text-[14px] font-semibold hover:bg-white/[0.06]",
                      s.v === contact.stage && "bg-white/[0.06]",
                    )}
                  >
                    <span className="size-2.5 rounded-full" style={{ background: s.dot }} />
                    <span className="flex-1">{s.label}</span>
                    {s.v === contact.stage ? <Check className="size-4 text-[#FFD599]" /> : null}
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </div>
        <IconBtn
          label={assistOpen ? "Fechar painel do cliente" : "Abrir painel do cliente"}
          onClick={onToggleAssist}
        >
          {assistOpen ? <PanelRightClose className="max-xl:hidden" /> : null}
          <PanelRightOpen className={cn(assistOpen && "xl:hidden")} />
        </IconBtn>
      </header>

      <div className="adm-scroll min-h-0 flex-1 overflow-y-auto bg-[radial-gradient(80%_60%_at_50%_0%,rgba(255,213,153,0.035),transparent)] px-3 py-5 sm:px-6">
        {thread.isPending ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className={cn("admin-skeleton h-14 w-2/3 rounded-[20px]", i % 2 && "ml-auto")}
              />
            ))}
          </div>
        ) : msgs.length === 0 ? (
          <Starters lead={lead} name={name} onPick={(t) => compose(t)} />
        ) : (
          msgs.map((m, i) => {
            const prev = msgs[i - 1];
            const newDay =
              !prev || new Date(prev.ts).toDateString() !== new Date(m.ts).toDateString();
            const head =
              newDay ||
              !prev ||
              prev.from_me !== m.from_me ||
              prev.sent_by !== m.sent_by ||
              +new Date(m.ts) - +new Date(prev.ts) > 10 * 60_000;
            const hits = m.from_me ? [] : quoteFor(m.body);
            const media = isMediaKind(m.kind);
            const bare = m.kind === "sticker";
            const who = m.from_me
              ? m.sent_by
                ? m.sent_by === team.me
                  ? "Você"
                  : team.first(m.sent_by)
                : "Orium"
              : null;
            return (
              <div key={m.id}>
                {newDay ? (
                  <div className="my-4 flex justify-center">
                    <span className="rounded-full bg-[#1F1F1F] px-3.5 py-1.5 text-[11.5px] font-semibold text-[#A9A9A9]">
                      {dayLabel(m.ts)}
                    </span>
                  </div>
                ) : null}
                <div
                  className={cn(
                    "flex",
                    m.from_me ? "justify-end" : "justify-start",
                    head ? "mt-3" : "mt-1",
                  )}
                >
                  <div
                    className={cn(
                      "flex max-w-[80%] min-w-0 flex-col",
                      m.from_me ? "items-end" : "items-start",
                    )}
                  >
                    {head && who ? (
                      <span className="mb-1 px-1 text-[11.5px] font-bold text-[#8C8C8C]">
                        {who}
                      </span>
                    ) : null}
                    <div
                      className={cn(
                        "text-[15px] leading-snug whitespace-pre-wrap [overflow-wrap:anywhere]",
                        bare
                          ? ""
                          : cn(
                              "rounded-[22px]",
                              media ? "p-1.5" : "px-4 py-2.5",
                              m.from_me ? "bg-[#FFD599] text-[#15130F]" : "bg-[#222] text-white",
                              head && (m.from_me ? "rounded-tr-[8px]" : "rounded-tl-[8px]"),
                            ),
                        m.pending === "failed" && "ring-2 ring-[#FF9A8A]",
                      )}
                    >
                      {media ? <MediaContent m={m} mine={m.from_me} /> : null}
                      {m.body ? (
                        <span className={cn("block", media && "px-2.5 pt-2 pb-0.5")}>{m.body}</span>
                      ) : null}
                      {!media && !m.body ? (
                        <span className="italic opacity-70">[{kindLabel(m.kind)}]</span>
                      ) : null}
                      <span
                        className={cn(
                          "mt-1 flex items-center justify-end gap-1 text-[10.5px] tabular-nums",
                          media && "px-2 pb-1",
                          bare
                            ? "text-[#7A7A7A]"
                            : m.from_me
                              ? "text-[#15130F]/50"
                              : "text-[#7A7A7A]",
                        )}
                      >
                        {new Date(m.ts).toLocaleTimeString("pt-BR", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                        {m.from_me ? (
                          m.pending === "failed" ? (
                            <AlertTriangle
                              className="size-3.5 text-[#B3261E]"
                              aria-label={m.error ?? "Falhou"}
                            />
                          ) : m.pending ? (
                            <Clock3 className="size-3.5" aria-label="Na fila" />
                          ) : (
                            <CheckCheck className="size-3.5" aria-label="Enviada" />
                          )
                        ) : null}
                      </span>
                    </div>
                    {hits.map((qt) => (
                      <button
                        key={qt.product_id}
                        type="button"
                        onClick={() => compose(pricePitch(qt))}
                        className="press group mt-1.5 flex max-w-full items-center gap-2.5 rounded-[18px] border border-[#FFD599]/20 bg-[#FFD599]/[0.06] py-1.5 pr-3 pl-1.5 text-left hover:border-[#FFD599]/45"
                      >
                        <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-[12px] bg-white">
                          {qt.image_url ? (
                            <img
                              src={qt.image_url}
                              alt=""
                              className="size-full object-contain"
                              loading="lazy"
                            />
                          ) : null}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-[12.5px] font-bold">{qt.name}</span>
                          <span className="block truncate text-[12px] text-[#D4D4D4]">
                            {qt.frasco ? `${brl(qt.frasco.pix)} no Pix` : "Sem preço"}
                            {qt.ready ? <span className="text-[#8C8C8C]"> · na loja</span> : null}
                          </span>
                        </span>
                        <span className="ml-1 shrink-0 rounded-full bg-[#FFD599] px-2.5 py-1 text-[11.5px] font-bold text-[#15130F]">
                          Responder
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={endRef} />
      </div>

      {/* escrever */}
      <div className="border-t border-white/[0.06] px-3 pt-3 pb-3 sm:px-5 sm:pb-5">
        {otherAgent ? (
          <div className="mb-3 flex items-center gap-3 rounded-[20px] bg-white/[0.05] p-3">
            <TeamAvatar id={contact.assigned_to!} size={34} />
            <p className="min-w-0 flex-1 text-[13.5px] text-[#D4D4D4]">
              <span className="font-bold text-white">{team.first(contact.assigned_to!)}</span> está
              atendendo esta conversa. Para não misturar, só quem atende responde.
            </p>
            <button
              type="button"
              onClick={() => takeOver.mutate()}
              disabled={takeOver.isPending}
              className="press h-10 shrink-0 rounded-full bg-white/[0.1] px-4 text-[13px] font-bold hover:bg-white/[0.15]"
            >
              Assumir
            </button>
          </div>
        ) : null}

        {idealKey && !otherAgent ? (
          <ReplyIdeal
            jid={contact.jid}
            startKey={idealKey}
            onClose={() => setIdealKey(0)}
            onSend={(t) => submit(t)}
            disabled={send.isPending}
          />
        ) : null}

        {!otherAgent ? (
          <div className="adm-scroll -mx-1 mb-2.5 flex items-center gap-1.5 overflow-x-auto px-1">
            <button
              type="button"
              onClick={() => setIdealKey((k) => k + 1)}
              className={cn(
                "press inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-bold",
                waitingReply
                  ? "bg-gradient-to-r from-[#FFE3B8] to-[#E9B865] text-[#15130F] shadow-[0_0_20px_rgba(255,213,153,0.25)]"
                  : "border border-[#FFD599]/40 text-[#FFD599] hover:bg-[#FFD599]/10",
              )}
            >
              <Sparkles className="size-4" /> Resposta ideal
            </button>
            {quoteList.slice(0, 3).map((qt) => (
              <button
                key={qt.product_id}
                type="button"
                onClick={() => compose(pricePitch(qt))}
                title="Responder com o preço"
                className="press inline-flex h-9 max-w-[220px] shrink-0 items-center gap-1.5 rounded-full bg-[#1F1F1F] px-3 text-[12.5px] font-semibold text-[#D4D4D4] hover:text-white"
              >
                <span className="truncate">{qt.name}</span>
                <span className="font-bold text-[#FFD599]">
                  {qt.frasco ? brl(qt.frasco.pix) : "—"}
                </span>
              </button>
            ))}
            <button
              type="button"
              aria-pressed={quick}
              onClick={() => setQuick((v) => !v)}
              className={cn(
                "press inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-semibold",
                quick ? "bg-white text-[#15130F]" : "bg-[#1F1F1F] text-[#D4D4D4] hover:text-white",
              )}
            >
              <Zap className="size-3.5" /> Rápidas
            </button>
          </div>
        ) : null}
        {quick && !otherAgent ? (
          <div className="adm-scroll -mx-1 mb-2.5 flex gap-1.5 overflow-x-auto px-1">
            {QUICK.map((qr) => (
              <button
                key={qr.label}
                type="button"
                onClick={() => {
                  compose(qr.text);
                  setQuick(false);
                }}
                className="press h-9 shrink-0 rounded-full border border-white/[0.1] px-3.5 text-[12.5px] font-semibold text-[#D4D4D4] hover:text-white"
              >
                {qr.label}
              </button>
            ))}
          </div>
        ) : null}

        <div className="flex items-end gap-2">
          <div
            className={cn(
              "flex min-w-0 flex-1 items-end rounded-[24px] border border-white/[0.08] bg-[#1A1A1A] focus-within:border-[#FFD599]/40",
              otherAgent && "opacity-50",
            )}
          >
            <textarea
              ref={taRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKey}
              disabled={otherAgent}
              rows={Math.min(6, Math.max(1, text.split("\n").length))}
              placeholder={
                otherAgent
                  ? `${team.first(contact.assigned_to!)} está atendendo`
                  : offline
                    ? "WhatsApp desconectado: a mensagem fica na fila"
                    : "Escreva sua mensagem…"
              }
              className="min-h-12 flex-1 resize-none bg-transparent px-4 py-3 text-[15px] leading-snug outline-none placeholder:text-[#6F6F6F]"
            />
          </div>
          <button
            type="button"
            onClick={() => submit()}
            disabled={!text.trim() || otherAgent}
            aria-label="Enviar"
            className="press grid size-12 shrink-0 place-items-center rounded-full bg-[#FFD599] text-[#15130F] disabled:opacity-40"
          >
            <SendHorizontal className="size-5" />
          </button>
        </div>
      </div>
    </>
  );
}

/** Conversa vazia: aberturas prontas para escolher. */
function Starters({
  lead,
  name,
  onPick,
}: {
  lead: Lead | null;
  name: string;
  onPick: (t: string) => void;
}) {
  const first = name.split(" ")[0];
  const opts = lead
    ? messageOptions(lead)
    : [
        {
          label: "Simples",
          text: `Oi${first ? `, ${first}` : ""}! Aqui é da Orium Perfumes Posso te ajudar com algum perfume?`,
        },
        {
          label: "Catálogo",
          text: `Oi${first ? `, ${first}` : ""}! Aqui é da Orium Perfumes Separei nosso catálogo pra você: https://oriumperfumes.com. Tem algum perfume que você está procurando?`,
        },
      ];
  return (
    <div className="mx-auto flex h-full max-w-[460px] flex-col justify-center py-6 text-center">
      <p className="text-[18px] font-bold tracking-[-0.02em]">Comece a conversa</p>
      <p className="mt-1 text-[13.5px] text-[#8C8C8C]">
        Toque em uma abertura para colocar na caixa de texto.
      </p>
      <div className="mt-4 space-y-2 text-left">
        {opts.map((o) => (
          <button
            key={o.label}
            type="button"
            onClick={() => onPick(o.text)}
            className="press block w-full rounded-[20px] bg-[#1C1C1C] p-4 transition-colors hover:bg-[#232323]"
          >
            <span className="text-[12px] font-bold text-[#FFD599]">{o.label}</span>
            <span className="mt-1 block text-[14px] leading-snug text-[#E5E5E5]">{o.text}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const y = new Date(today);
  y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Hoje";
  if (d.toDateString() === y.toDateString()) return "Ontem";
  return d.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "short" });
}
const kindLabel = (k: string) =>
  ({
    image: "foto",
    audio: "áudio",
    video: "vídeo",
    sticker: "figurinha",
    document: "documento",
    location: "localização",
    contact: "contato",
  })[k] ?? "mídia";

function IconBtn({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="press grid size-10 shrink-0 place-items-center rounded-full text-[#A9A9A9] hover:bg-white/[0.06] hover:text-white [&_svg]:size-[18px]"
    >
      {children}
    </button>
  );
}

/* ───────────────────────── painel do cliente ───────────────────────── */

type ATab = "resumo" | "perfumes" | "cliente";

const INS_STATUS: Record<string, { label: string; cls: string }> = {
  comprou: { label: "Comprou", cls: "bg-[#7FCF9F] text-[#15130F]" },
  negociando: { label: "Negociando", cls: "bg-[#FFD599] text-[#15130F]" },
  interessado: { label: "Interessado", cls: "bg-[#F2C46D]/20 text-[#F2C46D]" },
  perdido: { label: "Perdido", cls: "bg-[#FF9A8A]/15 text-[#FFB3A7]" },
  so_duvida: { label: "Só dúvida", cls: "bg-white/[0.08] text-[#D4D4D4]" },
  pos_venda: { label: "Pós-venda", cls: "bg-[#7FCF9F]/15 text-[#7FCF9F]" },
  sem_interesse: { label: "Não é venda", cls: "bg-[#232323] text-[#8C8C8C]" },
};
const INS_MOTIVO: Record<string, string> = {
  preco: "Achou caro",
  vou_pensar: "Ficou de pensar",
  sumiu: "Parou de responder",
  sem_estoque: "Queria algo sem estoque",
  confianca: "Dúvida se é original",
  entrega_prazo: "Entrega / prazo",
  comparando: "Comparando com outra loja",
  indeciso: "Indeciso",
  outro: "Outro motivo",
};

function Assistant({
  contact,
  lead,
  onClose,
}: {
  contact: WaContact;
  lead: Lead | null;
  onClose?: () => void;
}) {
  const [tab, setTab] = useState<ATab>("resumo");
  const [ficha, setFicha] = useState<string | null>(null);
  const thread = useThread(contact.jid);
  const quotes = useQuotes(contact.jid, thread.data);
  const name = contactName(contact);
  const wa = whatsLink(contact.phone_normalized);
  const t = lead ? TEMP[lead.temp] : null;
  const nQuotes = quotes.data?.length ?? 0;

  return (
    <div className="flex flex-col gap-4">
      {/* quem é, em uma linha */}
      <section className="flex items-center gap-3">
        <Avatar
          src={contact.avatar ?? lead?.avatar}
          name={name}
          score={lead?.score}
          temp={lead?.temp}
          size={48}
          gold={(lead?.orders_count ?? 0) > 0}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[16.5px] font-bold tracking-[-0.02em]">{name}</p>
          <p className="flex items-center gap-2 text-[12.5px] text-[#A9A9A9]">
            {t ? (
              <span
                className="inline-flex items-center gap-1.5 font-bold"
                style={{ color: t.ring === "#5A5A5A" ? "#A9A9A9" : t.ring }}
              >
                <span className="size-2 rounded-full" style={{ background: t.ring }} />
                {t.label}
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(contact.phone_normalized ?? "");
                toast.success("Número copiado");
              }}
              className="inline-flex items-center gap-1 truncate hover:text-white"
            >
              {fmtPhone(contact.phone_normalized)} <Copy className="size-3" />
            </button>
          </p>
        </div>
        {wa ? (
          <a
            href={wa}
            target="_blank"
            rel="noreferrer"
            aria-label="Abrir no WhatsApp"
            title="Abrir no WhatsApp"
            className="press grid size-9 shrink-0 place-items-center rounded-full bg-[#1C1C1C] text-[#D4D4D4] hover:text-white"
          >
            <WhatsMark className="size-4" />
          </a>
        ) : null}
        {lead ? (
          <button
            type="button"
            onClick={() => setFicha(lead.id)}
            aria-label="Ficha do cliente"
            title="Ficha do cliente"
            className="press grid size-9 shrink-0 place-items-center rounded-full bg-[#1C1C1C] text-[#D4D4D4] hover:text-white"
          >
            <UserRound className="size-4" />
          </button>
        ) : null}
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar painel"
            className="press grid size-9 shrink-0 place-items-center rounded-full text-[#8C8C8C] hover:bg-white/[0.06] hover:text-white"
          >
            <PanelRightClose className="size-[17px]" />
          </button>
        ) : null}
      </section>

      {/* abas */}
      <div className="grid grid-cols-3 gap-1 rounded-full bg-[#1A1A1A] p-1">
        {(
          [
            ["resumo", "Resumo"],
            ["perfumes", nQuotes ? `Perfumes · ${nQuotes}` : "Perfumes"],
            ["cliente", "Cliente"],
          ] as Array<[ATab, string]>
        ).map(([v, label]) => (
          <button
            key={v}
            type="button"
            aria-pressed={tab === v}
            onClick={() => setTab(v)}
            className={cn(
              "press h-9 rounded-full text-[13px] font-bold transition-colors",
              tab === v ? "bg-white text-[#15130F]" : "text-[#A9A9A9] hover:text-white",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "resumo" ? <SummaryTab contact={contact} lead={lead} /> : null}
      {tab === "perfumes" ? (
        <PerfumesTab quotes={quotes.data ?? []} loading={quotes.isFetching} />
      ) : null}
      {tab === "cliente" ? <ClientTab contact={contact} lead={lead} /> : null}

      <CustomerSheet id={ficha} onClose={() => setFicha(null)} />
    </div>
  );
}

/** Resumo: o que está acontecendo e o que fazer — só o essencial. */
function SummaryTab({ contact, lead }: { contact: WaContact; lead: Lead | null }) {
  const qc = useQueryClient();
  const tried = useRef(false);
  const q = useQuery({
    queryKey: ["wa-insight", contact.jid],
    queryFn: () => waInsight({ data: { jid: contact.jid } }),
    staleTime: 2 * 60_000,
  });
  const run = useMutation({
    mutationFn: () => waAnalyze({ data: { jid: contact.jid } }),
    onSuccess: (row) => {
      qc.setQueryData(["wa-insight", contact.jid], row);
      void qc.invalidateQueries({ queryKey: ["crm-leads"] });
      void qc.invalidateQueries({ queryKey: ["wa-inbox"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "A análise falhou agora"),
  });
  const row = q.data;
  useEffect(() => {
    if (tried.current || q.isPending || run.isPending) return;
    if ((!row || !row.resumo) && contact.last_inbound_at) {
      tried.current = true;
      run.mutate();
    }
  }, [row, q.isPending, run, contact.last_inbound_at]);
  const stale =
    !!row?.last_msg_ts &&
    !!contact.last_message_at &&
    new Date(contact.last_message_at) > new Date(row.last_msg_ts);
  const d = (row?.data ?? {}) as Partial<import("@/lib/wa-insights.server").InsightData>;
  const st = row?.status ? INS_STATUS[row.status] : null;
  const chance = row?.chance ?? null;
  const showChance = chance != null && row?.status !== "comprou" && row?.status !== "sem_interesse";
  const msg = d.mensagem_sugerida || lead?.action.message || null;

  if (run.isPending)
    return (
      <div className="flex items-center gap-3 rounded-[20px] border border-[#FFD599]/25 bg-[#FFD599]/[0.06] p-4">
        <Sparkles className="size-5 shrink-0 animate-pulse text-[#FFD599]" />
        <p className="text-[13.5px] font-semibold text-[#FFD599]">Lendo a conversa inteira…</p>
      </div>
    );
  if (!row?.resumo)
    return (
      <div className="rounded-[20px] bg-[#1A1A1A] p-4 text-center">
        <p className="text-[13.5px] text-[#A9A9A9]">
          {contact.last_inbound_at
            ? "Ainda sem análise desta conversa."
            : "A análise começa quando o cliente mandar mensagem."}
        </p>
        {contact.last_inbound_at ? (
          <button
            type="button"
            onClick={() => run.mutate()}
            className="press mt-3 inline-flex h-10 items-center gap-1.5 rounded-full bg-[#FFD599] px-4 text-[13px] font-bold text-[#15130F]"
          >
            <Sparkles className="size-4" /> Analisar agora
          </button>
        ) : null}
      </div>
    );

  return (
    <div className="space-y-3">
      {d.alerta ? (
        <p className="flex gap-2 rounded-[18px] bg-[#FF9A8A]/10 p-3 text-[13px] font-semibold text-[#FFB3A7]">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {d.alerta}
        </p>
      ) : null}

      {/* situação */}
      <section className="rounded-[22px] bg-[#1A1A1A] p-4">
        <div className="flex items-center gap-2">
          {st ? (
            <span className={cn("rounded-full px-2.5 py-1 text-[12px] font-bold", st.cls)}>
              {st.label}
            </span>
          ) : null}
          {showChance ? (
            <span className="ml-auto text-[12.5px] font-bold text-[#D4D4D4] tabular-nums">
              {chance}% de chance
            </span>
          ) : null}
        </div>
        {showChance ? (
          <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-[#2A2A2A]">
            <div
              className="h-full rounded-full transition-[width] duration-700"
              style={{
                width: `${chance}%`,
                background: chance! >= 70 ? "#7FCF9F" : chance! >= 40 ? "#FFD599" : "#FF9A8A",
              }}
            />
          </div>
        ) : null}
        <p className="mt-3 text-[14px] leading-relaxed text-[#E5E5E5]">{row.resumo}</p>
        {row.motivo && row.motivo !== "nao_se_aplica" ? (
          <p className="mt-3 text-[13px] text-[#FFB3A7]">
            <span className="font-bold">Travou: </span>
            {INS_MOTIVO[row.motivo] ?? row.motivo}
            {d.motivo_detalhe ? (
              <span className="text-[#D4D4D4]"> — {d.motivo_detalhe}</span>
            ) : null}
          </p>
        ) : null}
        {(d.estilo ?? []).length || d.orcamento ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {(d.estilo ?? []).slice(0, 4).map((e) => (
              <span
                key={e}
                className="rounded-full bg-[#FFD599]/12 px-2.5 py-1 text-[12px] font-bold text-[#FFD599]"
              >
                {e}
              </span>
            ))}
            {d.orcamento ? (
              <span className="rounded-full bg-white/[0.06] px-2.5 py-1 text-[12px] font-semibold text-[#E5E5E5]">
                💰 {d.orcamento}
              </span>
            ) : null}
          </div>
        ) : null}
      </section>

      {/* o que fazer */}
      {d.proximo_passo || msg ? (
        <section className="rounded-[22px] border border-[#FFD599]/25 bg-[#FFD599]/[0.06] p-4">
          <p className="text-[12.5px] font-bold text-[#FFD599]">O que fazer agora</p>
          {d.proximo_passo ? (
            <p className="mt-1 text-[14px] leading-snug text-[#E5E5E5]">{d.proximo_passo}</p>
          ) : null}
          {msg && row.status !== "sem_interesse" ? (
            <button
              type="button"
              onClick={() => compose(msg)}
              className="press mt-3 inline-flex h-10 items-center gap-1.5 rounded-full bg-[#FFD599] px-4 text-[13px] font-bold text-[#15130F]"
            >
              Usar mensagem sugerida
            </button>
          ) : null}
        </section>
      ) : null}

      <button
        type="button"
        onClick={() => run.mutate()}
        className={cn(
          "press inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[12.5px] font-bold",
          stale ? "bg-[#FFD599] text-[#15130F]" : "text-[#8C8C8C] hover:text-white",
        )}
      >
        <RefreshCw className="size-3.5" />{" "}
        {stale
          ? "Tem mensagem nova: atualizar análise"
          : `Analisado ${ago(row.analyzed_at)} · atualizar`}
      </button>
    </div>
  );
}

function PerfumesTab({ quotes, loading }: { quotes: PerfumeQuote[]; loading: boolean }) {
  const [manual, setManual] = useState("");
  const manualQ = useQuery({
    queryKey: ["crm-quote-manual", manual],
    queryFn: () => crmPerfumeQuote({ data: { text: manual } }),
    enabled: manual.trim().length >= 3,
    staleTime: 60_000,
  });
  return (
    <div className="space-y-3">
      <label className="relative block">
        <Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-[#6F6F6F]" />
        <input
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          placeholder="Cotar qualquer perfume"
          className={cn(pxInputClass, "pl-11")}
        />
      </label>
      {manual.trim().length >= 3 ? (
        (manualQ.data ?? []).length ? (
          manualQ.data!.map((qt) => <QuoteRow key={`m-${qt.product_id}`} q={qt} />)
        ) : manualQ.isFetching ? (
          <div className="admin-skeleton h-24 rounded-[20px]" />
        ) : (
          <p className="text-center text-[13px] text-[#8C8C8C]">
            Não achei esse perfume no catálogo.
          </p>
        )
      ) : null}
      {!manual ? (
        quotes.length ? (
          <>
            <p className="px-1 text-[12px] font-semibold text-[#8C8C8C]">Citados na conversa</p>
            {quotes.map((qt) => (
              <QuoteRow key={qt.product_id} q={qt} />
            ))}
          </>
        ) : loading ? (
          <div className="admin-skeleton h-24 rounded-[20px]" />
        ) : (
          <p className="rounded-[18px] bg-[#1A1A1A] p-4 text-center text-[13px] text-[#8C8C8C]">
            Quando o cliente falar de um perfume, o preço aparece aqui e embaixo da mensagem.
          </p>
        )
      ) : null}
    </div>
  );
}

function ClientTab({ contact, lead }: { contact: WaContact; lead: Lead | null }) {
  const facts = lead ? factsOf(lead).slice(0, 8) : [];
  const interests = lead ? interestsOf(lead).slice(0, 6) : [];
  return (
    <div className="space-y-4">
      {!contact.customer_id ? <LinkCustomer contact={contact} /> : null}
      {facts.length ? (
        <dl className="grid grid-cols-2 gap-2">
          {facts.map((f) => (
            <div key={f.label} className="min-w-0 rounded-[16px] bg-[#1A1A1A] px-3 py-2.5">
              <dt className="truncate text-[11.5px] font-semibold text-[#8C8C8C]">{f.label}</dt>
              <dd
                className={cn(
                  "mt-0.5 truncate font-bold",
                  f.strong ? "text-[16px] text-[#FFD599]" : "text-[14px]",
                )}
              >
                {f.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {interests.length ? (
        <div>
          <p className="mb-2 px-1 text-[12px] font-semibold text-[#8C8C8C]">Do que ele gosta</p>
          <div className="grid grid-cols-2 gap-2">
            {interests.map((it) => (
              <div
                key={it.key}
                className="flex min-w-0 items-center gap-2 rounded-[16px] bg-[#1A1A1A] p-1.5"
              >
                <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-[12px] bg-white">
                  {it.image_url ? (
                    <img
                      src={it.image_url}
                      alt=""
                      loading="lazy"
                      className="size-full object-contain"
                    />
                  ) : null}
                </span>
                <span className="min-w-0">
                  <span className="line-clamp-1 text-[12px] font-bold">{it.name}</span>
                  <span
                    className={cn(
                      "text-[11px] font-bold",
                      it.tone === "gold"
                        ? "text-[#FFD599]"
                        : it.tone === "green"
                          ? "text-[#7FCF9F]"
                          : "text-[#8C8C8C]",
                    )}
                  >
                    {it.tag}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {!facts.length && !interests.length && contact.customer_id ? (
        <p className="text-center text-[13px] text-[#8C8C8C]">Ainda sem dados deste cliente.</p>
      ) : null}
    </div>
  );
}

function Block({
  title,
  icon,
  badge,
  children,
}: {
  title: string;
  icon?: ReactNode;
  badge?: string;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        {icon ? <span className="text-[#FFD599] [&_svg]:size-4">{icon}</span> : null}
        <h3 className="flex-1 text-[14px] font-bold">{title}</h3>
        {badge ? (
          <span className="rounded-full bg-white/[0.07] px-2 py-0.5 text-[11.5px] font-bold text-[#D4D4D4]">
            {badge}
          </span>
        ) : null}
      </div>
      {children}
    </section>
  );
}

/** Perfume cotado: cliente paga · você paga · lucro, e o botão que responde com o preço. */
function QuoteRow({ q }: { q: PerfumeQuote }) {
  const f = q.frasco;
  return (
    <article className="rounded-[20px] bg-[#1C1C1C] p-3">
      <div className="flex items-center gap-2.5">
        <span className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-[13px] bg-white">
          {q.image_url ? (
            <img src={q.image_url} alt="" className="size-full object-contain" loading="lazy" />
          ) : null}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] font-bold">{q.name}</p>
          <p className="truncate text-[11.5px] text-[#8C8C8C]">
            {[q.brand, q.volume_ml ? `${q.volume_ml}ml` : null].filter(Boolean).join(" · ")}
            {q.ready ? (
              <span className="text-[#7FCF9F]">
                {" "}
                · {q.stock > 0 ? `${q.stock} na loja` : "pronta"}
              </span>
            ) : null}
          </p>
        </div>
      </div>
      {f ? (
        <div className="mt-2.5 grid grid-cols-3 gap-1.5 text-center">
          <Mini label="Cliente paga" value={brl(f.pix)} gold />
          <Mini label="Você paga" value={f.cost != null ? brl(f.cost) : "—"} />
          <Mini label="Lucro" value={f.profit != null ? brl(f.profit) : "—"} green />
        </div>
      ) : null}
      {q.decants.length ? (
        <p className="mt-2 truncate text-[11.5px] text-[#A9A9A9]">
          Decant: {q.decants.map((d) => `${d.ml}ml ${brl(d.pix)}`).join(" · ")}
        </p>
      ) : null}
      <button
        type="button"
        onClick={() => compose(pricePitch(q))}
        className="press mt-2.5 inline-flex h-9 w-full items-center justify-center rounded-full bg-white/[0.08] text-[12.5px] font-bold hover:bg-[#FFD599] hover:text-[#15130F]"
      >
        Responder com o preço
      </button>
    </article>
  );
}

function Mini({
  label,
  value,
  gold,
  green,
}: {
  label: string;
  value: string;
  gold?: boolean;
  green?: boolean;
}) {
  return (
    <div
      className={cn(
        "min-w-0 rounded-[12px] px-1 py-1.5",
        gold ? "bg-[#FFD599] text-[#15130F]" : "bg-[#262626]",
      )}
    >
      <p
        className={cn(
          "truncate text-[10px] font-semibold",
          gold ? "text-[#15130F]/65" : "text-[#8C8C8C]",
        )}
      >
        {label}
      </p>
      <p className={cn("truncate text-[13px] font-bold tabular-nums", green && "text-[#7FCF9F]")}>
        {value}
      </p>
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
    <Block title="Número sem ficha" icon={<UserPlus />}>
      <p className="text-[13px] text-[#8C8C8C]">
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
          Criar
        </button>
      </div>
      <label className="relative mt-2 block">
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
    </Block>
  );
}

/* ───────────────────────── menu do contato ───────────────────────── */

function ContactMenu({
  c,
  x,
  y,
  onClose,
  onOpen,
  onFicha,
  onDeleted,
}: {
  c: WaContact;
  x: number;
  y: number;
  onClose: () => void;
  onOpen: () => void;
  onFicha: (customerId: string) => void;
  onDeleted: (jid: string) => void;
}) {
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState<null | "conversa" | "cliente">(null);
  // abre para cima quando o clique foi na metade de baixo da tela; nunca sai da tela
  const vw = typeof window === "undefined" ? 1200 : window.innerWidth;
  const vh = typeof window === "undefined" ? 800 : window.innerHeight;
  const up = y > vh * 0.5;
  const place: CSSProperties = {
    left: Math.max(8, Math.min(x, vw - 256)),
    ...(up ? { bottom: Math.max(8, vh - y) } : { top: Math.max(8, y) }),
    maxHeight: up ? Math.max(200, y - 8) : Math.max(200, vh - y - 8),
  };
  useEffect(() => {
    const key = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", key);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["wa-inbox"] });
    void qc.invalidateQueries({ queryKey: ["crm-leads"] });
    void qc.invalidateQueries({ queryKey: ["crm-pulse"] });
  };
  const update = useMutation({
    mutationFn: (patch: {
      pinned?: boolean;
      archived?: boolean;
      unread?: number;
      stage?: WaContact["stage"];
    }) => waUpdateContact({ data: { jid: c.jid, ...patch } }),
    onSuccess: refresh,
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não deu certo"),
  });
  const delConversa = useMutation({
    mutationFn: () => waDeleteContact({ data: { jid: c.jid } }),
    onSuccess: () => {
      toast.success("Conversa excluída");
      onDeleted(c.jid);
      refresh();
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não foi possível excluir"),
  });
  const delCliente = useMutation({
    mutationFn: () => crmCustomerDelete({ data: { id: c.customer_id! } }),
    onSuccess: () => {
      toast.success("Cliente excluído para sempre");
      refresh();
      void qc.invalidateQueries({ queryKey: ["crm-customers"] });
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não foi possível excluir"),
  });
  const run = (fn: () => void) => () => {
    fn();
    onClose();
  };
  const wa = whatsLink(c.phone_normalized);
  const name = contactName(c);

  if (typeof document === "undefined") return null;
  // vai direto para o <body>: a moldura do CRM corta o que passa da borda
  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[80]"
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div
        role="menu"
        aria-label={`Opções de ${name}`}
        className="adm-scroll fixed z-[81] w-[248px] overflow-y-auto rounded-[22px] border border-white/[0.08] bg-[#1C1C1C] p-1.5 shadow-[0_24px_60px_rgba(0,0,0,0.6)]"
        style={place}
      >
        <div className="flex items-center gap-2.5 px-2.5 pt-2 pb-2.5">
          <Avatar src={c.avatar} name={name} size={32} />
          <div className="min-w-0">
            <p className="truncate text-[13.5px] font-bold">{name}</p>
            <p className="truncate text-[11.5px] text-[#8C8C8C]">{fmtPhone(c.phone_normalized)}</p>
          </div>
        </div>

        {confirm ? (
          <div className="rounded-[16px] bg-[#FF9A8A]/10 p-3">
            <p className="text-[13.5px] font-bold text-[#FFB3A7]">
              {confirm === "conversa" ? "Excluir esta conversa?" : "Excluir o cliente para sempre?"}
            </p>
            <p className="mt-1 text-[12px] leading-snug text-[#D4D4D4]">
              {confirm === "conversa"
                ? "Apaga as mensagens daqui do CRM. Se a pessoa escrever de novo, a conversa volta."
                : "Apaga a ficha, notas e histórico do cliente no CRM. Os pedidos continuam nas vendas. Não dá para desfazer."}
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => setConfirm(null)}
                className="press h-9 flex-1 rounded-full bg-white/[0.08] text-[12.5px] font-bold"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={delConversa.isPending || delCliente.isPending}
                onClick={() =>
                  confirm === "conversa" ? delConversa.mutate() : delCliente.mutate()
                }
                className="press h-9 flex-1 rounded-full bg-[#FF9A8A] text-[12.5px] font-bold text-[#15130F] disabled:opacity-50"
              >
                Excluir
              </button>
            </div>
          </div>
        ) : (
          <>
            <MenuItem icon={<MessageCircle />} label="Abrir conversa" onClick={run(onOpen)} />
            <AssignMenuItems c={c} done={onClose} />
            <MenuItem
              icon={<Star fill={c.pinned ? "currentColor" : "none"} />}
              label={c.pinned ? "Desafixar" : "Fixar no topo"}
              onClick={run(() => update.mutate({ pinned: !c.pinned }))}
            />
            <MenuItem
              icon={<Mail />}
              label={c.unread ? "Marcar como lida" : "Marcar como não lida"}
              onClick={run(() => update.mutate({ unread: c.unread ? 0 : 1 }))}
            />
            <div className="px-2.5 pt-2 pb-1">
              <p className="text-[11px] font-semibold text-[#6F6F6F]">Etapa</p>
              <div className="mt-1.5 flex gap-1">
                {STAGES.map((s) => (
                  <button
                    key={s.v}
                    type="button"
                    title={s.label}
                    aria-label={`Etapa ${s.label}`}
                    onClick={run(() => update.mutate({ stage: s.v }))}
                    className={cn(
                      "press grid h-8 flex-1 place-items-center rounded-[10px]",
                      c.stage === s.v ? "bg-white/[0.12]" : "hover:bg-white/[0.06]",
                    )}
                  >
                    <span className="size-2.5 rounded-full" style={{ background: s.dot }} />
                  </button>
                ))}
              </div>
              <p className="mt-1 text-[11px] text-[#8C8C8C]">
                {STAGES.find((s) => s.v === c.stage)?.label}
              </p>
            </div>
            <div className="my-1 h-px bg-white/[0.06]" />
            {c.customer_id ? (
              <MenuItem
                icon={<UserRound />}
                label="Ver ficha do cliente"
                onClick={run(() => onFicha(c.customer_id!))}
              />
            ) : null}
            <MenuItem
              icon={<Copy />}
              label="Copiar número"
              onClick={run(() => {
                void navigator.clipboard?.writeText(c.phone_normalized ?? "");
                toast.success("Número copiado");
              })}
            />
            {wa ? (
              <MenuItem
                icon={<ExternalLink />}
                label="Abrir no WhatsApp"
                onClick={run(() => window.open(wa, "_blank", "noopener"))}
              />
            ) : null}
            <MenuItem
              icon={c.archived ? <ArchiveRestore /> : <Archive />}
              label={c.archived ? "Desarquivar" : "Arquivar"}
              onClick={run(() => update.mutate({ archived: !c.archived }))}
            />
            <div className="my-1 h-px bg-white/[0.06]" />
            <MenuItem
              icon={<Trash2 />}
              label="Excluir conversa"
              danger
              onClick={() => setConfirm("conversa")}
            />
            {c.customer_id ? (
              <MenuItem
                icon={<Trash2 />}
                label="Excluir cliente"
                danger
                onClick={() => setConfirm("cliente")}
              />
            ) : null}
          </>
        )}
      </div>
    </>,
    document.body,
  );
}

function MenuItem({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        "flex h-10 w-full items-center gap-3 rounded-[14px] px-2.5 text-left text-[13.5px] font-semibold transition-colors [&_svg]:size-[17px]",
        danger ? "text-[#FF9A8A] hover:bg-[#FF9A8A]/10" : "text-[#E5E5E5] hover:bg-white/[0.06]",
      )}
    >
      <span className="grid size-5 shrink-0 place-items-center opacity-80">{icon}</span>
      {label}
    </button>
  );
}

/** Rodapé da linha: quem atende (ou "Sem atendente") e se está esperando resposta. */
function ContactRowFoot({ c, waiting }: { c: WaContact; waiting: boolean }) {
  const team = useContext(TeamContext);
  if (!c.assigned_to && !waiting) return null;
  return (
    <div className="mt-1.5 flex items-center gap-1.5">
      {c.assigned_to ? (
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full py-0.5 pr-2 pl-0.5 text-[11px] font-bold",
            c.assigned_to === team.me
              ? "bg-[#7FCF9F]/12 text-[#7FCF9F]"
              : "bg-white/[0.06] text-[#D4D4D4]",
          )}
        >
          <TeamAvatar id={c.assigned_to} size={16} />
          {c.assigned_to === team.me ? "Você" : team.first(c.assigned_to)}
        </span>
      ) : (
        <span className="rounded-full bg-[#FFD599]/12 px-2 py-0.5 text-[11px] font-bold text-[#FFD599]">
          Sem atendente
        </span>
      )}
      {waiting ? (
        <span className="text-[11px] font-bold text-[#FFD599]">· esperando resposta</span>
      ) : null}
    </div>
  );
}

/** Itens de atendimento no menu do contato. */
function AssignMenuItems({ c, done }: { c: WaContact; done: () => void }) {
  const qc = useQueryClient();
  const team = useContext(TeamContext);
  const [pick, setPick] = useState(false);
  const assign = useMutation({
    mutationFn: (userId: string | null) => waAssign({ data: { jid: c.jid, userId } }),
    onSuccess: (_d, userId) => {
      toast.success(
        userId
          ? userId === team.me
            ? "Você assumiu este atendimento"
            : `Transferido para ${team.first(userId)}`
          : "Atendimento encerrado",
      );
      void qc.invalidateQueries({ queryKey: ["wa-inbox"] });
      done();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não deu certo"),
  });
  if (pick)
    return (
      <div className="rounded-[14px] bg-white/[0.03] p-1">
        <p className="px-2.5 pt-1.5 pb-1 text-[11px] font-semibold text-[#6F6F6F]">
          Transferir para
        </p>
        {team.staff
          .filter((s) => s.id !== c.assigned_to)
          .map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => assign.mutate(s.id)}
              className="flex h-9 w-full items-center gap-2 rounded-[12px] px-2 text-left text-[13px] font-semibold hover:bg-white/[0.06]"
            >
              <TeamAvatar id={s.id} size={22} />
              {s.name}
            </button>
          ))}
      </div>
    );
  return (
    <>
      {c.assigned_to !== team.me ? (
        <MenuItem
          icon={<UserPlus />}
          label={c.assigned_to ? "Assumir eu mesmo" : "Assumir atendimento"}
          onClick={() => assign.mutate(team.me)}
        />
      ) : null}
      <MenuItem icon={<Users />} label="Transferir para…" onClick={() => setPick(true)} />
      {c.assigned_to ? (
        <MenuItem icon={<X />} label="Encerrar atendimento" onClick={() => assign.mutate(null)} />
      ) : null}
    </>
  );
}
