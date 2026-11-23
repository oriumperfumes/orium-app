/**
 * CRM → CONVERSAS.
 * O WhatsApp da loja dentro do CRM, em tempo real, em quatro colunas:
 * caixas (filtros e etapas) | mensagens | conversa | perfil do cliente.
 * No perfil: próxima ação, perfumes citados com preço final, custo e lucro,
 * calor, perfil de compra e interesses. Nada é enviado sem clique.
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Archive,
  ArrowLeft,
  ArrowUpDown,
  Check,
  CheckCheck,
  ChevronDown,
  Clock3,
  Copy,
  Flame,
  Inbox,
  Link2,
  MailOpen,
  MessagesSquare,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Search,
  SendHorizontal,
  Star,
  UserPlus,
  UserRound,
  UserX,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { AdminShell } from "@/components/orium/AdminShell";
import { CustomerSheet, whatsLink } from "@/components/orium/CustomerSheet";
import { SidePanel } from "@/components/orium/admin/orders/model";
import { PanelHeader, PanelScroll } from "@/components/orium/admin/PanelKit";
import { pxInputClass } from "@/components/orium/admin/PricingUI";
import { WhatsMark } from "@/components/orium/crm/CrmShell";
import {
  Avatar,
  LeadReading,
  PerfumeQuoteCard,
  TEMP,
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
    meta: [{ title: "Conversas — Orium CRM" }, { name: "robots", content: "noindex" }],
  }),
  component: ConversasPage,
});

type Box =
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
const compose = (t: string) =>
  window.dispatchEvent(new CustomEvent("orium-crm-compose", { detail: t }));

function ConversasPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { jid: selected } = Route.useSearch();
  const [box, setBox] = useState<Box>("todas");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"recentes" | "quentes">("recentes");
  const [profileOpen, setProfileOpen] = useState(true);
  const [profileSheet, setProfileSheet] = useState(false);

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
        void qc.invalidateQueries({ queryKey: ["wa-thread", (p.new as { jid?: string })?.jid] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "wa_outbox" }, (p) => {
        void qc.invalidateQueries({ queryKey: ["wa-thread", (p.new as { jid?: string })?.jid] });
      })
      .subscribe();
    return () => void supabase.removeChannel(ch);
  }, [qc]);

  const contacts = useMemo(() => inbox.data?.contacts ?? [], [inbox.data]);
  const bridge = inbox.data?.bridge;
  const leadOf = (c: WaContact) => (c.customer_id ? leadById.get(c.customer_id) : undefined);

  const matchBox = (c: WaContact, b: Box): boolean => {
    if (b === "arquivadas") return c.archived;
    if (c.archived) return false;
    if (b === "todas") return true;
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
    <AdminShell title="Conversas" bare>
      <div className="flex min-h-[calc(100dvh-210px)] min-w-0 flex-1 lg:h-full lg:min-h-0">
        {/* 1. caixas */}
        <aside className="adm-scroll hidden w-[232px] shrink-0 overflow-y-auto border-r border-white/[0.06] px-3 py-5 2xl:block">
          <div className="px-2">
            <p className="text-[17px] font-bold tracking-[-0.02em]">Caixa de entrada</p>
            <p className="mt-0.5 truncate text-[12.5px] text-[#8C8C8C]">
              {bridge?.phone ? fmtPhone(bridge.phone) : "WhatsApp da loja"}
            </p>
          </div>
          <div className="mt-4 space-y-0.5">
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
            "flex min-h-0 w-full flex-col border-white/[0.06] lg:w-[340px] lg:shrink-0 lg:border-r",
            selected && "max-lg:hidden",
          )}
        >
          <div className="space-y-3 px-4 pt-1 pb-3 lg:px-4 lg:pt-5">
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
                placeholder="Buscar mensagem ou nome"
                className={cn(pxInputClass, "pl-11")}
              />
            </label>
            {/* caixas viram chips quando a coluna de caixas não cabe */}
            <div className="adm-scroll -mx-1 flex gap-1.5 overflow-x-auto px-1 2xl:hidden">
              {(
                [
                  ["todas", "Todas"],
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
                <div key={i} className="admin-skeleton mx-2 my-2 h-[78px] rounded-[20px]" />
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
                />
              ))
            )}
          </div>
        </section>

        {/* 3. conversa */}
        <section
          className={cn(
            "flex min-h-[72dvh] min-w-0 flex-1 flex-col lg:min-h-0",
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
              profileOpen={profileOpen}
              onToggleProfile={() => {
                if (window.matchMedia("(min-width: 1280px)").matches) setProfileOpen((v) => !v);
                else setProfileSheet(true);
              }}
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

        {/* 4. perfil */}
        {current && profileOpen ? (
          <aside className="adm-scroll hidden w-[350px] shrink-0 overflow-y-auto border-l border-white/[0.06] p-4 xl:block 2xl:w-[372px]">
            <Profile contact={current} lead={lead} onClose={() => setProfileOpen(false)} />
          </aside>
        ) : null}
      </div>

      <SidePanel
        open={profileSheet && !!current}
        onClose={() => setProfileSheet(false)}
        label="Cliente"
      >
        {current ? (
          <>
            <PanelHeader
              title={contactName(current)}
              subtitle={fmtPhone(current.phone_normalized)}
              onClose={() => setProfileSheet(false)}
            />
            <PanelScroll swapKey={current.jid}>
              <div className="px-5 pb-6 lg:px-6">
                <Profile contact={current} lead={lead} />
              </div>
            </PanelScroll>
          </>
        ) : null}
      </SidePanel>
    </AdminShell>
  );
}

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
}: {
  c: WaContact;
  lead?: Lead;
  active: boolean;
  onOpen: () => void;
}) {
  const qc = useQueryClient();
  const pin = useMutation({
    mutationFn: () => waUpdateContact({ data: { jid: c.jid, pinned: !c.pinned } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["wa-inbox"] }),
  });
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => (e.key === "Enter" ? onOpen() : undefined)}
      className={cn(
        "press group relative flex w-full min-w-0 cursor-pointer gap-3 rounded-[22px] p-3 text-left transition-colors",
        active ? "bg-[#FFD599]/[0.09] ring-1 ring-[#FFD599]/25" : "hover:bg-white/[0.04]",
      )}
    >
      <span className="relative shrink-0">
        <Avatar
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
        </div>
        <div className="mt-0.5 flex items-end gap-2">
          <p className="line-clamp-2 min-w-0 flex-1 text-[13px] leading-snug text-[#8C8C8C]">
            {c.last_from_me ? <span className="text-[#6F6F6F]">Você: </span> : null}
            {c.last_message_preview ?? ""}
          </p>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <span
              className={cn(
                "text-[11.5px] tabular-nums",
                c.unread ? "font-bold text-[#FFD599]" : "text-[#6F6F6F]",
              )}
            >
              {ago(c.last_message_at)}
            </span>
            {c.unread ? (
              <span className="grid h-5 min-w-5 place-items-center rounded-full bg-[#FFD599] px-1.5 text-[11px] font-bold text-[#15130F] tabular-nums">
                {c.unread}
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function BridgeStrip({ bridge, loading }: { bridge?: WaBridge; loading: boolean }) {
  if (loading || !bridge) return null;
  const stale = !bridge.last_seen || Date.now() - new Date(bridge.last_seen).getTime() > 90_000;
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

function Thread({
  contact,
  lead,
  bridge,
  onBack,
  profileOpen,
  onToggleProfile,
}: {
  contact: WaContact;
  lead: Lead | null;
  bridge?: WaBridge;
  onBack: () => void;
  profileOpen: boolean;
  onToggleProfile: () => void;
}) {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [quick, setQuick] = useState(false);
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
  const name = contactName(contact);
  const live = lead?.live?.active;

  return (
    <>
      <header className="flex items-center gap-3 border-b border-white/[0.06] px-3 py-3 sm:px-5">
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
        {lead ? <TempPill temp={lead.temp} score={lead.score} className="max-sm:hidden" /> : null}
        <IconBtn
          label="Copiar número"
          onClick={() => {
            void navigator.clipboard?.writeText(contact.phone_normalized ?? "");
            toast.success("Número copiado");
          }}
        >
          <Copy />
        </IconBtn>
        <IconBtn label={profileOpen ? "Fechar perfil" : "Ver perfil"} onClick={onToggleProfile}>
          {profileOpen ? <PanelRightClose className="max-xl:hidden" /> : null}
          <PanelRightOpen className={cn(profileOpen && "xl:hidden")} />
        </IconBtn>
      </header>

      <div className="adm-scroll flex items-center gap-1.5 overflow-x-auto border-b border-white/[0.06] px-3 py-2.5 sm:px-5">
        <span className="mr-1 shrink-0 text-[12px] font-semibold text-[#6F6F6F]">Etapa</span>
        {STAGES.map((s) => (
          <button
            key={s.v}
            type="button"
            aria-pressed={contact.stage === s.v}
            onClick={() => stage.mutate(s.v)}
            className={cn(
              "press inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-bold",
              contact.stage === s.v
                ? "bg-white text-[#15130F]"
                : "bg-[#1F1F1F] text-[#A9A9A9] hover:text-white",
            )}
          >
            <span className="size-2 rounded-full" style={{ background: s.dot }} />
            {s.label}
          </button>
        ))}
      </div>

      <div className="adm-scroll min-h-0 flex-1 overflow-y-auto px-3 py-5 sm:px-6">
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
          <p className="py-10 text-center text-[13.5px] text-[#8C8C8C]">
            Nenhuma mensagem ainda. Escreva a primeira abaixo.
          </p>
        ) : (
          msgs.map((m, i) => {
            const prev = msgs[i - 1];
            const newDay =
              !prev || new Date(prev.ts).toDateString() !== new Date(m.ts).toDateString();
            const head =
              newDay ||
              !prev ||
              prev.from_me !== m.from_me ||
              +new Date(m.ts) - +new Date(prev.ts) > 10 * 60_000;
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
                    "flex gap-2.5",
                    m.from_me ? "flex-row-reverse" : "flex-row",
                    head ? "mt-4" : "mt-1",
                  )}
                >
                  <span className="w-8 shrink-0">
                    {head ? (
                      <Avatar name={m.from_me ? "Orium" : name} size={32} gold={m.from_me} />
                    ) : null}
                  </span>
                  <div
                    className={cn(
                      "flex max-w-[78%] min-w-0 flex-col",
                      m.from_me ? "items-end" : "items-start",
                    )}
                  >
                    {head ? (
                      <p className="mb-1 flex items-baseline gap-2 text-[12.5px]">
                        <span className="font-bold text-[#D4D4D4]">
                          {m.from_me ? "Orium" : name.split(" ")[0]}
                        </span>
                        <span className="text-[#6F6F6F] tabular-nums">
                          {new Date(m.ts).toLocaleTimeString("pt-BR", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </p>
                    ) : null}
                    <div
                      className={cn(
                        "rounded-[20px] px-4 py-2.5 text-[14.5px] leading-snug whitespace-pre-wrap [overflow-wrap:anywhere]",
                        m.from_me ? "bg-[#FFD599] text-[#15130F]" : "bg-[#1F1F1F] text-white",
                        head && (m.from_me ? "rounded-tr-[6px]" : "rounded-tl-[6px]"),
                        m.pending === "failed" && "ring-2 ring-[#FF9A8A]",
                      )}
                    >
                      {m.body || <span className="italic opacity-70">[{kindLabel(m.kind)}]</span>}
                      {m.from_me ? (
                        <span className="ml-2 inline-flex translate-y-[2px] items-center text-[#15130F]/50">
                          {m.pending === "failed" ? (
                            <AlertTriangle
                              className="size-3.5 text-[#B3261E]"
                              aria-label={m.error ?? "Falhou"}
                            />
                          ) : m.pending ? (
                            <Clock3 className="size-3.5" aria-label="Na fila" />
                          ) : (
                            <CheckCheck className="size-3.5" aria-label="Enviada" />
                          )}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={endRef} />
      </div>

      <div className="px-3 pt-2 pb-3 sm:px-5 sm:pb-5">
        {quick ? (
          <div className="adm-scroll -mx-1 mb-2 flex gap-1.5 overflow-x-auto px-1">
            {QUICK.map((qr) => (
              <button
                key={qr.label}
                type="button"
                onClick={() => {
                  setText((t) => (t.trim() ? `${t.trim()} ${qr.text}` : qr.text));
                  setQuick(false);
                  taRef.current?.focus();
                }}
                className="press h-8 shrink-0 rounded-full bg-[#1F1F1F] px-3 text-[12.5px] font-semibold text-[#D4D4D4] hover:text-white"
              >
                {qr.label}
              </button>
            ))}
          </div>
        ) : null}
        <div className="flex items-end gap-2">
          <button
            type="button"
            aria-label="Respostas rápidas"
            aria-pressed={quick}
            onClick={() => setQuick((v) => !v)}
            className={cn(
              "press grid size-12 shrink-0 place-items-center rounded-full border border-white/[0.1]",
              quick ? "bg-white text-[#15130F]" : "text-[#D4D4D4] hover:text-white",
            )}
          >
            <Plus className={cn("size-5 transition-transform", quick && "rotate-45")} />
          </button>
          <div className="flex min-w-0 flex-1 items-end rounded-[24px] border border-white/[0.08] bg-[#1A1A1A] focus-within:border-[#FFD599]/40">
            <textarea
              ref={taRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKey}
              rows={Math.min(5, Math.max(1, text.split("\n").length))}
              placeholder={
                offline ? "WhatsApp desconectado: a mensagem fica na fila" : "Escreva sua mensagem…"
              }
              className="min-h-12 flex-1 resize-none bg-transparent px-4 py-3 text-[14.5px] leading-snug outline-none placeholder:text-[#6F6F6F]"
            />
          </div>
          <button
            type="button"
            onClick={submit}
            disabled={!text.trim()}
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

function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const y = new Date(today);
  y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString())
    return `Hoje, ${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}`;
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

/** Perfil do cliente (coluna da direita), no espírito dos CRMs de referência. */
function Profile({
  contact,
  lead,
  onClose,
}: {
  contact: WaContact;
  lead: Lead | null;
  onClose?: () => void;
}) {
  const [ficha, setFicha] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  const thread = useQuery({
    queryKey: ["wa-thread", contact.jid],
    queryFn: () => waThread({ data: { jid: contact.jid } }),
    staleTime: 3_000,
  });
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
  const name = contactName(contact);
  const wa = whatsLink(contact.phone_normalized);
  const quoteList = quotes.data ?? [];

  return (
    <div className="space-y-3">
      <section className="relative rounded-[28px] bg-[#1A1A1A] px-4 pt-6 pb-5 text-center">
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar perfil"
            className="press absolute top-3 right-3 grid size-9 place-items-center rounded-full text-[#8C8C8C] hover:bg-white/[0.06] hover:text-white"
          >
            <PanelRightClose className="size-[17px]" />
          </button>
        ) : null}
        <span className="relative mx-auto block w-fit">
          <Avatar
            name={name}
            score={lead?.score}
            temp={lead?.temp}
            size={86}
            gold={(lead?.orders_count ?? 0) > 0}
          />
          {lead?.live?.active ? (
            <span className="absolute right-1 bottom-1 size-4 rounded-full bg-[#7FCF9F] ring-[3px] ring-[#1A1A1A]" />
          ) : null}
        </span>
        <p className="mt-3 truncate text-[18px] font-bold tracking-[-0.02em]">{name}</p>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(contact.phone_normalized ?? "");
            toast.success("Número copiado");
          }}
          className="mx-auto mt-1 inline-flex items-center gap-1.5 text-[13px] text-[#8C8C8C] hover:text-white"
        >
          {fmtPhone(contact.phone_normalized)} <Copy className="size-3.5" />
        </button>
        {lead ? (
          <div className="mt-3 flex justify-center">
            <TempPill temp={lead.temp} score={lead.score} />
          </div>
        ) : null}
        <div className="mt-4 flex justify-center gap-2.5">
          {wa ? (
            <RoundAction label="Abrir no WhatsApp" href={wa}>
              <WhatsMark />
            </RoundAction>
          ) : null}
          {lead ? (
            <RoundAction label="Ficha completa" onClick={() => setFicha(lead.id)}>
              <UserRound />
            </RoundAction>
          ) : null}
        </div>
        {lead ? (
          <div className="mt-4 grid grid-cols-3 gap-1.5">
            <Stat
              label="Gasto"
              value={lead.spent ? `R$ ${Math.round(lead.spent).toLocaleString("pt-BR")}` : "—"}
            />
            <Stat label="Pedidos" value={String(lead.orders_count)} />
            <Stat label="Última" value={lead.last_order_at ? ago(lead.last_order_at) : "—"} />
          </div>
        ) : null}
      </section>

      {!contact.customer_id ? <LinkCustomer contact={contact} /> : null}

      {quoteList.length ? (
        <Section title="Perfumes citados" badge={String(quoteList.length)}>
          <div className="space-y-2">
            {quoteList.map((qt) => (
              <PerfumeQuoteCard key={qt.product_id} q={qt} onInsert={compose} />
            ))}
          </div>
        </Section>
      ) : null}

      {lead ? (
        <Section title="Leitura do cliente" badge={TEMP[lead.temp].label}>
          <LeadReading lead={lead} compact onUseMessage={compose} />
        </Section>
      ) : null}

      <Section title="Cotar perfume" defaultOpen={!quoteList.length}>
        <label className="relative block">
          <Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-[#6F6F6F]" />
          <input
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            placeholder="Nome do perfume"
            className={cn(pxInputClass, "pl-11")}
          />
        </label>
        <div className="mt-2 space-y-2">
          {(manualQ.data ?? []).map((qt) => (
            <PerfumeQuoteCard key={`m-${qt.product_id}`} q={qt} onInsert={compose} />
          ))}
          {manual.trim().length >= 3 && !manualQ.isFetching && !(manualQ.data ?? []).length ? (
            <p className="px-1 text-[13px] text-[#8C8C8C]">Não achei esse perfume no catálogo.</p>
          ) : null}
          {!manual && !quoteList.length ? (
            <p className="px-1 text-[13px] text-[#8C8C8C]">
              Quando o cliente falar o nome de um perfume, o preço aparece sozinho aqui.
            </p>
          ) : null}
        </div>
      </Section>

      <CustomerSheet id={ficha} onClose={() => setFicha(null)} />
    </div>
  );
}

function Section({
  title,
  badge,
  defaultOpen = true,
  children,
}: {
  title: string;
  badge?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="rounded-[24px] border border-white/[0.06] p-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-1 py-1 text-left"
      >
        <span className="min-w-0 flex-1 truncate text-[15px] font-bold">{title}</span>
        {badge ? (
          <span className="rounded-full bg-white/[0.07] px-2 py-0.5 text-[11.5px] font-bold text-[#D4D4D4]">
            {badge}
          </span>
        ) : null}
        <ChevronDown
          className={cn("size-4 text-[#8C8C8C] transition-transform", !open && "-rotate-90")}
        />
      </button>
      {open ? <div className="mt-2.5">{children}</div> : null}
    </section>
  );
}

function RoundAction({
  label,
  onClick,
  href,
  children,
}: {
  label: string;
  onClick?: () => void;
  href?: string;
  children: ReactNode;
}) {
  const cls =
    "press grid size-12 place-items-center rounded-full border border-white/[0.1] text-[#D4D4D4] hover:bg-white/[0.06] hover:text-white [&_svg]:size-[19px]";
  return href ? (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-label={label}
      title={label}
      className={cls}
    >
      {children}
    </a>
  ) : (
    <button type="button" onClick={onClick} aria-label={label} title={label} className={cls}>
      {children}
    </button>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-[16px] bg-[#232323] px-2 py-2">
      <p className="truncate text-[10.5px] font-semibold text-[#8C8C8C]">{label}</p>
      <p className="truncate text-[14px] font-bold tabular-nums">{value}</p>
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
    <Section title="Número sem ficha">
      <p className="px-1 text-[13px] text-[#8C8C8C]">
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
    </Section>
  );
}
