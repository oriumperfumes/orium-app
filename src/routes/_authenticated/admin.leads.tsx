/**
 * ADMIN → CLIENTES → LEADS.
 * O radar de vendas: cada cliente ganha calor (0–100), entra nas listas de ação
 * (responder, carrinho, decant→frasco, promoção, recompra…) e traz a próxima melhor
 * ação com mensagem pronta. Dados reais de pedidos, loja física, app e WhatsApp.
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Banknote,
  Flame,
  MessageCircle,
  MessagesSquare,
  RefreshCw,
  Search,
  Send,
  Tag,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import { AdminShell } from "@/components/orium/AdminShell";
import { CustomerSheet, whatsLink } from "@/components/orium/CustomerSheet";
import { SidePanel } from "@/components/orium/admin/orders/model";
import {
  GoldButton,
  MiniStat,
  PanelFooter,
  PanelHeader,
  PanelScroll,
  SoftButton,
} from "@/components/orium/admin/PanelKit";
import { PxKpi, PxNote, pxInputClass } from "@/components/orium/admin/PricingUI";
import { Avatar, LeadReading, TempPill, ago, fmtPhone } from "@/components/orium/crm/shared";
import { supabase } from "@/integrations/supabase/client";
import { SEGMENTS, SEGMENT_ORDER, enrich, type Lead, type SegmentKey } from "@/lib/crm-intel";
import { crmLeads, waOpenForCustomer, waSend } from "@/lib/crm-wa.functions";
import { brl } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/admin/leads")({
  validateSearch: (s: Record<string, unknown>): { lista?: SegmentKey } =>
    typeof s.lista === "string" ? { lista: s.lista as SegmentKey } : {},
  head: () => ({ meta: [{ title: "Painel — Orium CRM" }, { name: "robots", content: "noindex" }] }),
  component: LeadsPage,
});

type View = "radar" | SegmentKey;

function LeadsPage() {
  const qc = useQueryClient();
  const { lista } = Route.useSearch();
  const [view, setView] = useState<View>(lista && lista in SEGMENTS ? lista : "radar");
  useEffect(() => {
    if (lista && lista in SEGMENTS) setView(lista);
  }, [lista]);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<{ id: string; el: HTMLElement | null } | null>(null);

  const { data, isPending, isError, refetch, isFetching } = useQuery({
    queryKey: ["crm-leads"],
    queryFn: () => crmLeads(),
    refetchInterval: 60_000,
    staleTime: 15_000,
  });

  // carrinho, visita ou mensagem nova mudam o calor: recalcula sozinho
  useEffect(() => {
    let t: number | undefined;
    const bump = () => {
      window.clearTimeout(t);
      t = window.setTimeout(() => void qc.invalidateQueries({ queryKey: ["crm-leads"] }), 2500);
    };
    const ch = supabase
      .channel("orium-crm-leads")
      .on("postgres_changes", { event: "*", schema: "public", table: "wa_contacts" }, bump)
      .on("postgres_changes", { event: "*", schema: "public", table: "live_sessions" }, bump)
      .subscribe();
    return () => {
      window.clearTimeout(t);
      void supabase.removeChannel(ch);
    };
  }, [qc]);

  const leads = useMemo(() => enrich(data ?? []), [data]);
  const bySeg = useMemo(() => {
    const m = new Map<SegmentKey, Lead[]>();
    for (const k of SEGMENT_ORDER) m.set(k, []);
    for (const l of leads) for (const s of l.segments) m.get(s)!.push(l);
    return m;
  }, [leads]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    const digits = term.replace(/\D/g, "");
    const base = view === "radar" ? leads : (bySeg.get(view) ?? []);
    if (!term) return base;
    return base.filter(
      (l) =>
        (l.name ?? "").toLowerCase().includes(term) ||
        (digits.length >= 3 && (l.phone ?? "").includes(digits)),
    );
  }, [leads, bySeg, view, q]);

  const hot = bySeg.get("quentes")!.length;
  const waiting = bySeg.get("responder")!.length;
  const onTable = leads.reduce((s, l) => s + (l.cart?.total ?? 0), 0);
  const promo =
    bySeg.get("promo")!.length + bySeg.get("upgrade")!.length + bySeg.get("recompra")!.length;
  const lead = open ? (leads.find((l) => l.id === open.id) ?? null) : null;
  const radar = leads.filter((l) => l.score > 0).slice(0, 14);

  return (
    <AdminShell
      title="Painel"
      action={
        <button
          type="button"
          onClick={() => void refetch()}
          aria-label="Atualizar"
          className="press grid size-11 place-items-center rounded-full bg-[#1A1A1A] text-[#D4D4D4] hover:text-white"
        >
          <RefreshCw className={cn("size-[18px]", isFetching && "animate-spin")} />
        </button>
      }
    >
      <div className="space-y-5 lg:space-y-6">
        {isError ? <PxNote tone="danger">Não foi possível carregar os leads.</PxNote> : null}

        <section className="grid grid-cols-2 gap-3 lg:gap-4 xl:grid-cols-4">
          <PxKpi
            i={0}
            hero
            label="Quentes agora"
            icon={<Flame className="size-[18px]" strokeWidth={2.2} />}
            loading={isPending}
            value={hot}
            foot="Maior chance de comprar hoje"
            onClick={() => setView("quentes")}
            ariaLabel="Ver quentes"
          />
          <PxKpi
            i={1}
            label="Esperando resposta"
            icon={<MessagesSquare className="size-[18px]" strokeWidth={2.2} />}
            loading={isPending}
            value={waiting}
            foot="Mensagens sem resposta"
            onClick={() => setView("responder")}
            ariaLabel="Ver quem espera resposta"
          />
          <PxKpi
            i={2}
            label="Dinheiro na mesa"
            icon={<Banknote className="size-[18px]" strokeWidth={2.2} />}
            loading={isPending}
            value={brl(onTable)}
            foot="Em carrinhos que não fecharam"
            onClick={() => setView("carrinho")}
            ariaLabel="Ver carrinhos"
          />
          <PxKpi
            i={3}
            label="Oportunidades"
            icon={<Tag className="size-[18px]" strokeWidth={2.2} />}
            loading={isPending}
            value={promo}
            foot="Promoção, upgrade e recompra"
            onClick={() => setView("promo")}
            ariaLabel="Ver oportunidades"
          />
        </section>

        {/* Radar: os mais quentes num relance, como uma fila de atendimento */}
        {radar.length ? (
          <section className="dash-card adm-rise p-4 lg:p-5" style={{ ["--i" as string]: 4 }}>
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <h2 className="text-[17px] font-bold tracking-[-0.02em]">Fila de calor</h2>
              <p className="text-[13px] text-[#8C8C8C]">Toque para atender</p>
            </div>
            <div className="adm-scroll -mx-1 flex gap-3 overflow-x-auto px-1 pb-1">
              {radar.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  onClick={(e) => setOpen({ id: l.id, el: e.currentTarget })}
                  className="press group flex w-[76px] shrink-0 flex-col items-center gap-1.5"
                  title={`${l.name ?? "Cliente"} · ${l.action.title}`}
                >
                  <span className="relative">
                    <Avatar
                      name={l.name}
                      score={l.score}
                      temp={l.temp}
                      size={60}
                      gold={l.orders_count > 0}
                    />
                    <span
                      className={cn(
                        "absolute -bottom-1 left-1/2 grid h-5 min-w-5 -translate-x-1/2 place-items-center rounded-full px-1.5 text-[11px] font-bold tabular-nums ring-2 ring-[#141414]",
                        l.temp === "quente"
                          ? "bg-[#FFD599] text-[#15130F]"
                          : "bg-[#2A2A2A] text-white",
                      )}
                    >
                      {l.score}
                    </span>
                  </span>
                  <span className="w-full truncate text-center text-[12px] font-semibold text-[#D4D4D4] group-hover:text-white">
                    {(l.name ?? "Cliente").split(" ")[0]}
                  </span>
                </button>
              ))}
            </div>
          </section>
        ) : null}

        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div
            className="adm-scroll -mx-1 flex min-w-0 flex-1 gap-2 overflow-x-auto px-1 pb-1"
            role="group"
            aria-label="Listas"
          >
            <Chip
              active={view === "radar"}
              onClick={() => setView("radar")}
              label="Todos"
              n={leads.length}
            />
            {SEGMENT_ORDER.map((k) => (
              <Chip
                key={k}
                active={view === k}
                onClick={() => setView(k)}
                label={SEGMENTS[k].title}
                n={bySeg.get(k)!.length}
                hot={k === "responder" || k === "quentes"}
              />
            ))}
          </div>
          <label className="relative block lg:w-[280px]">
            <Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-[#6F6F6F]" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar nome ou celular"
              className={cn(pxInputClass, "pl-11")}
            />
          </label>
        </div>

        {view !== "radar" ? (
          <p className="-mt-2 text-[14px] text-[#8C8C8C]">{SEGMENTS[view].hint}</p>
        ) : null}

        {isPending ? (
          <div className="grid gap-3 md:grid-cols-2 lg:gap-4 xl:grid-cols-3">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="admin-skeleton h-[220px] rounded-[28px]" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <section className="dash-card p-8 text-center lg:p-12">
            <span className="dash-ico mx-auto">
              <UserRound className="size-[18px]" strokeWidth={2.2} />
            </span>
            <h2 className="mt-4 text-[19px] font-bold tracking-[-0.02em]">
              Ninguém nessa lista agora
            </h2>
            <p className="mx-auto mt-1.5 max-w-sm text-[14px] text-[#8C8C8C]">
              Quando alguém der sinal de compra, aparece aqui na hora.
            </p>
          </section>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 lg:gap-4 xl:grid-cols-3">
            {filtered.slice(0, 90).map((l, i) => (
              <LeadCard key={l.id} lead={l} i={i} onOpen={(el) => setOpen({ id: l.id, el })} />
            ))}
          </div>
        )}
      </div>

      <LeadPanel lead={lead} originEl={open?.el ?? null} onClose={() => setOpen(null)} />
    </AdminShell>
  );
}

function Chip({
  active,
  onClick,
  label,
  n,
  hot,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  n: number;
  hot?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "press inline-flex h-11 shrink-0 items-center gap-2 rounded-full px-4 text-[14px] font-bold transition-colors",
        active ? "bg-white text-[#15130F]" : "bg-[#1A1A1A] text-[#A9A9A9] hover:text-white",
      )}
    >
      {label}
      <span
        className={cn(
          "tabular-nums",
          active ? "text-[#15130F]/55" : hot && n > 0 ? "text-[#FFD599]" : "text-[#6F6F6F]",
        )}
      >
        {n}
      </span>
    </button>
  );
}

function LeadCard({
  lead: l,
  i,
  onOpen,
}: {
  lead: Lead;
  i: number;
  onOpen: (el: HTMLElement) => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => onOpen(e.currentTarget)}
      className="dash-card adm-rise press flex min-w-0 flex-col p-4 text-left transition-colors hover:bg-[#1F1F1F] lg:p-5"
      style={{ ["--i" as string]: Math.min(i, 10) }}
    >
      <div className="flex min-w-0 items-center gap-3">
        <Avatar name={l.name} score={l.score} temp={l.temp} size={48} gold={l.orders_count > 0} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[16px] font-bold tracking-[-0.01em]">
            {l.name ?? "Sem nome"}
          </p>
          <p className="truncate text-[13px] text-[#8C8C8C]">
            {l.orders_count
              ? `${l.orders_count} compra${l.orders_count > 1 ? "s" : ""} · ${brl(l.spent)}`
              : fmtPhone(l.phone) || "Sem compras"}
          </p>
        </div>
        <TempPill temp={l.temp} score={l.score} />
      </div>

      <ul className="mt-3.5 min-h-[44px] space-y-1">
        {(l.reasons.length ? l.reasons : l.profile).slice(0, 2).map((r) => (
          <li key={r} className="flex gap-2 truncate text-[13px] text-[#D4D4D4]">
            <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-[#FFD599]/80" />
            <span className="truncate">{r}</span>
          </li>
        ))}
      </ul>

      <div className="mt-auto flex items-center gap-2 pt-4">
        <span className="inline-flex h-9 min-w-0 flex-1 items-center gap-2 rounded-full bg-white/[0.06] px-3.5 text-[13px] font-bold">
          <span className="size-1.5 shrink-0 rounded-full bg-[#FFD599]" />
          <span className="truncate">{l.action.title}</span>
        </span>
        {l.wa?.last_inbound_at ? (
          <span className="shrink-0 text-[12px] text-[#8C8C8C]">{ago(l.wa.last_inbound_at)}</span>
        ) : null}
      </div>
    </button>
  );
}

function LeadPanel({
  lead,
  originEl,
  onClose,
}: {
  lead: Lead | null;
  originEl: HTMLElement | null;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [msg, setMsg] = useState("");
  const [ficha, setFicha] = useState<string | null>(null);
  useEffect(() => setMsg(lead?.action.message ?? ""), [lead?.id, lead?.action.message]);

  const send = useMutation({
    mutationFn: async () => {
      const { jid } = await waOpenForCustomer({ data: { customerId: lead!.id } });
      await waSend({ data: { jid, body: msg } });
      return jid;
    },
    onSuccess: (jid) => {
      toast.success("Mensagem na fila do WhatsApp");
      void qc.invalidateQueries({ queryKey: ["wa-inbox"] });
      void navigate({ to: "/admin/conversas", search: { jid } as never });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não foi possível enviar"),
  });

  const openChat = useMutation({
    mutationFn: () => waOpenForCustomer({ data: { customerId: lead!.id } }),
    onSuccess: ({ jid }) => void navigate({ to: "/admin/conversas", search: { jid } as never }),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Sem celular válido"),
  });

  const l = lead;
  const wa = whatsLink(l?.phone);
  return (
    <>
      <SidePanel open={!!l} onClose={onClose} label={l?.name ?? "Lead"} originEl={originEl}>
        {l ? (
          <>
            <PanelHeader
              image={undefined}
              title={
                <span className="flex min-w-0 items-center gap-3">
                  <Avatar
                    name={l.name}
                    score={l.score}
                    temp={l.temp}
                    size={52}
                    gold={l.orders_count > 0}
                  />
                  <span className="min-w-0 truncate">{l.name ?? "Sem nome"}</span>
                </span>
              }
              subtitle={fmtPhone(l.phone) || "Sem celular"}
              onClose={onClose}
            >
              <div className="mt-4 flex gap-2">
                <MiniStat
                  label="Calor"
                  value={l.score}
                  tone={l.temp === "quente" ? "gold" : undefined}
                />
                <MiniStat label="Gasto" value={brl(l.spent)} />
                <MiniStat label="Pedidos" value={l.orders_count} />
                <MiniStat
                  label="Ticket"
                  value={l.orders_count ? brl(l.spent / l.orders_count) : "—"}
                />
              </div>
            </PanelHeader>
            <PanelScroll swapKey={l.id}>
              <div className="space-y-3 px-5 pb-6 lg:px-6">
                <LeadReading lead={l} onUseMessage={(t) => setMsg(t)} />

                <Interests lead={l} />

                <section className="rounded-[24px] bg-[#1A1A1A] p-4 sm:p-5">
                  <h3 className="text-[15px] font-bold">Mensagem</h3>
                  <textarea
                    value={msg}
                    onChange={(e) => setMsg(e.target.value)}
                    rows={4}
                    placeholder="Escreva a mensagem…"
                    className="mt-3 w-full resize-none rounded-[18px] bg-[#232323] p-3.5 text-[14.5px] leading-snug outline-none placeholder:text-[#6F6F6F] focus:ring-2 focus:ring-[#FFD599]/40"
                  />
                  <p className="mt-2 text-[12.5px] text-[#8C8C8C]">
                    Sai pelo WhatsApp da loja só quando você tocar em enviar.
                  </p>
                </section>
              </div>
            </PanelScroll>
            <PanelFooter>
              <SoftButton icon={<UserRound className="size-4" />} onClick={() => setFicha(l.id)}>
                Ficha
              </SoftButton>
              {wa ? (
                <SoftButton
                  icon={<MessageCircle className="size-4" />}
                  loading={openChat.isPending}
                  onClick={() => openChat.mutate()}
                >
                  Conversa
                </SoftButton>
              ) : null}
              <GoldButton
                icon={<Send className="size-4" />}
                loading={send.isPending}
                disabled={!wa || !msg.trim()}
                onClick={() => send.mutate()}
                className="flex-1"
              >
                Enviar
              </GoldButton>
            </PanelFooter>
          </>
        ) : null}
      </SidePanel>
      <CustomerSheet id={ficha} onClose={() => setFicha(null)} />
    </>
  );
}

function Interests({ lead: l }: { lead: Lead }) {
  const rows: Array<{ label: string; items: string[] }> = [
    { label: "No carrinho", items: l.cart?.names ?? [] },
    {
      label: "Mais olhados (30 dias)",
      items: (l.views?.top ?? []).map(
        (t) => `${t.name} · ${t.views}x${t.bought ? " · já comprou" : ""}`,
      ),
    },
    {
      label: "Favoritos",
      items: (l.favorites ?? []).map((f) => `${f.name}${f.in_stock ? "" : " · sem estoque"}`),
    },
    {
      label: "Pediu aviso",
      items: (l.waiting ?? []).map((w) => `${w.name}${w.in_stock ? " · chegou!" : ""}`),
    },
    {
      label: "Últimas compras",
      items: l.recent_items.map(
        (r) =>
          `${r.name}${r.decant ? " (decant)" : ""} · ${new Date(r.at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}`,
      ),
    },
  ].filter((r) => r.items.length);
  if (!rows.length) return null;
  return (
    <section className="rounded-[24px] bg-[#1A1A1A] p-4 sm:p-5">
      <h3 className="text-[15px] font-bold">Interesses</h3>
      <div className="mt-3 space-y-3.5">
        {rows.map((r) => (
          <div key={r.label}>
            <p className="text-[12px] font-semibold text-[#8C8C8C]">{r.label}</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {r.items.slice(0, 6).map((it) => (
                <span
                  key={it}
                  className="max-w-full truncate rounded-full bg-[#232323] px-3 py-1.5 text-[12.5px] font-semibold text-[#D4D4D4]"
                >
                  {it}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
