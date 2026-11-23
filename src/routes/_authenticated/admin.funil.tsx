/**
 * CRM → FUNIL.
 * A jornada de venda de cada cliente: Novo → Interessado → Negociando → Comprou,
 * em colunas ligadas, com quem atender agora no topo, listas inteligentes ao lado
 * e as próximas ações embaixo. A etapa vem da conversa do WhatsApp; sem conversa,
 * é deduzida pelo comportamento no app.
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check, CheckCheck, MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { AdminShell } from "@/components/orium/AdminShell";
import { CustomerSheet } from "@/components/orium/CustomerSheet";
import { Avatar, TEMP, TempPill, ago } from "@/components/orium/crm/shared";
import { SEGMENTS, enrich, type Lead, type SegmentKey } from "@/lib/crm-intel";
import {
  crmLeads,
  waInbox,
  waOpenForCustomer,
  waUpdateContact,
  type WaContact,
} from "@/lib/crm-wa.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/admin/funil")({
  head: () => ({ meta: [{ title: "Funil — Orium CRM" }, { name: "robots", content: "noindex" }] }),
  component: FunilPage,
});

type Stage = WaContact["stage"];
const COLS: Array<{ v: Stage; label: string; hint: string }> = [
  { v: "novo", label: "Novo", hint: "Chegou agora" },
  { v: "interessado", label: "Interessado", hint: "Olhando perfumes" },
  { v: "negociando", label: "Negociando", hint: "Falando de preço" },
  { v: "comprou", label: "Comprou", hint: "Venda feita" },
];
const NEXT: Record<Stage, Stage | null> = {
  novo: "interessado",
  interessado: "negociando",
  negociando: "comprou",
  comprou: null,
  perdido: null,
};
const ROW_H = 68;
const HEAD_H = 64;
const MAX_ROWS = 6;

type Item = {
  key: string;
  name: string;
  sub: string;
  stage: Stage;
  lead: Lead | null;
  jid: string | null;
  hot: boolean;
  score: number;
};

function FunilPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [ficha, setFicha] = useState<string | null>(null);
  const leadsQ = useQuery({
    queryKey: ["crm-leads"],
    queryFn: () => crmLeads(),
    staleTime: 30_000,
  });
  const inboxQ = useQuery({ queryKey: ["wa-inbox"], queryFn: () => waInbox(), staleTime: 15_000 });
  const leads = useMemo(() => enrich(leadsQ.data ?? []), [leadsQ.data]);

  const items = useMemo<Item[]>(() => {
    const contacts = inboxQ.data?.contacts ?? [];
    const byCustomer = new Map(
      contacts.filter((c) => c.customer_id).map((c) => [c.customer_id!, c]),
    );
    const out: Item[] = leads.map((l) => {
      const c = byCustomer.get(l.id);
      const derived: Stage =
        l.orders_count > 0
          ? "comprou"
          : l.cart || (l.views?.d7 ?? 0) > 0 || (l.favorites?.length ?? 0) > 0
            ? "interessado"
            : "novo";
      return {
        key: l.id,
        name: l.name ?? "Sem nome",
        sub: l.action.title,
        stage: c?.stage ?? derived,
        lead: l,
        jid: c?.jid ?? null,
        hot: l.temp === "quente",
        score: l.score,
      };
    });
    for (const c of contacts)
      if (!c.customer_id && !c.archived)
        out.push({
          key: c.jid,
          name: c.push_name || c.phone_normalized || "Contato",
          sub: c.last_message_preview ?? "Sem ficha",
          stage: c.stage,
          lead: null,
          jid: c.jid,
          hot: c.last_from_me === false,
          score: c.last_from_me === false ? 40 : 0,
        });
    return out.sort((a, b) => b.score - a.score);
  }, [leads, inboxQ.data]);

  const byStage = (s: Stage) => items.filter((i) => i.stage === s);
  const queue = items.filter((i) => i.score > 0 && i.stage !== "comprou").slice(0, 10);

  const advance = useMutation({
    mutationFn: async (it: Item) => {
      const to = NEXT[it.stage];
      if (!to) return;
      let jid = it.jid;
      if (!jid && it.lead)
        jid = (await waOpenForCustomer({ data: { customerId: it.lead.id } })).jid;
      if (!jid) throw new Error("Sem celular para acompanhar a etapa.");
      await waUpdateContact({ data: { jid, stage: to } });
      return to;
    },
    onSuccess: (to) => {
      if (to) toast.success(`Movido para ${COLS.find((c) => c.v === to)?.label}`);
      void qc.invalidateQueries({ queryKey: ["wa-inbox"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não foi possível mover"),
  });

  const open = (it: Item) => {
    if (it.jid) void navigate({ to: "/admin/conversas", search: { jid: it.jid } as never });
    else if (it.lead) setFicha(it.lead.id);
  };

  const segCount = (k: SegmentKey) => leads.filter((l) => l.segments.includes(k)).length;
  const tiles: SegmentKey[] = [
    "responder",
    "carrinho",
    "esperando",
    "upgrade",
    "promo",
    "recompra",
  ];
  const temps = (["quente", "morno", "frio"] as const).map((t) => ({
    t,
    n: leads.filter((l) => l.temp === t).length,
  }));
  const loading = leadsQ.isPending || inboxQ.isPending;

  return (
    <AdminShell title="Funil de vendas">
      <div className="space-y-4">
        {/* atender agora */}
        <section className="flex flex-col gap-4 rounded-[30px] bg-[#1A1A1A] p-4 lg:flex-row lg:items-center lg:p-5">
          <div className="shrink-0 lg:w-[180px]">
            <p className="text-[17px] font-bold tracking-[-0.02em]">Atender agora</p>
            <p className="text-[13px] text-[#8C8C8C]">Por ordem de calor</p>
          </div>
          <div className="adm-scroll -mx-1 flex min-w-0 flex-1 gap-2 overflow-x-auto px-1 py-1">
            {loading
              ? [0, 1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="admin-skeleton size-[60px] shrink-0 rounded-full" />
                ))
              : queue.map((it) => (
                  <button
                    key={it.key}
                    type="button"
                    onClick={() => open(it)}
                    title={`${it.name} · ${it.sub}`}
                    className="press relative shrink-0 rounded-full bg-[#232323] p-1.5"
                  >
                    <Avatar
                      name={it.name}
                      score={it.lead?.score}
                      temp={it.lead?.temp}
                      size={52}
                      gold={(it.lead?.orders_count ?? 0) > 0}
                    />
                    <span
                      className={cn(
                        "absolute -bottom-1 left-1/2 grid h-5 min-w-5 -translate-x-1/2 place-items-center rounded-full px-1.5 text-[10.5px] font-bold tabular-nums ring-2 ring-[#1A1A1A]",
                        it.hot ? "bg-[#FF9A8A] text-[#15130F]" : "bg-[#3A3A3A] text-white",
                      )}
                    >
                      {it.score}
                    </span>
                  </button>
                ))}
          </div>
        </section>

        {/* jornada */}
        <section className="rounded-[30px] bg-[#171717] p-4 lg:p-5">
          <div className="flex flex-col gap-4 min-[1800px]:flex-row">
            <div className="adm-scroll -mx-1 min-w-0 flex-1 overflow-x-auto px-1 pb-1">
              <div className="flex min-w-[980px] items-start">
                {COLS.map((col, ci) => {
                  const all = byStage(col.v);
                  const rows = all.slice(0, MAX_ROWS);
                  const next =
                    ci < COLS.length - 1 ? byStage(COLS[ci + 1].v).slice(0, MAX_ROWS) : null;
                  return (
                    <div key={col.v} className="flex min-w-0 flex-1 items-start">
                      <div className="min-w-0 flex-1">
                        <div className="rounded-[26px] bg-[#1F1F1F] px-2 pb-2">
                          <div
                            className="flex items-center justify-between px-2"
                            style={{ height: HEAD_H }}
                          >
                            <div className="min-w-0">
                              <p className="truncate text-[15px] font-bold">{col.label}</p>
                              <p className="truncate text-[12px] text-[#8C8C8C]">{col.hint}</p>
                            </div>
                            <span className="grid h-7 min-w-7 place-items-center rounded-full bg-white/[0.08] px-2 text-[12.5px] font-bold tabular-nums">
                              {all.length}
                            </span>
                          </div>
                          {loading ? (
                            [0, 1, 2].map((i) => (
                              <div
                                key={i}
                                className="admin-skeleton mb-1 rounded-[18px]"
                                style={{ height: ROW_H - 6 }}
                              />
                            ))
                          ) : rows.length === 0 ? (
                            <div
                              className="grid place-items-center rounded-[18px] border border-dashed border-white/[0.08] text-[12.5px] text-[#6F6F6F]"
                              style={{ height: ROW_H * 2 }}
                            >
                              Ninguém aqui
                            </div>
                          ) : (
                            rows.map((it) => (
                              <div
                                key={it.key}
                                className="group relative flex items-center gap-2.5 rounded-[18px] px-2 transition-colors hover:bg-white/[0.04]"
                                style={{ height: ROW_H }}
                              >
                                <span className="absolute top-1/2 -left-[13px] size-2 -translate-y-1/2 rounded-full bg-[#3A3A3A] ring-[3px] ring-[#171717]" />
                                <span
                                  className="absolute top-1/2 -right-[13px] size-2 -translate-y-1/2 rounded-full ring-[3px] ring-[#171717]"
                                  style={{ background: it.hot ? "#FF9A8A" : "#3A3A3A" }}
                                />
                                <button
                                  type="button"
                                  onClick={() => open(it)}
                                  className="press flex min-w-0 flex-1 items-center gap-2.5 text-left"
                                >
                                  <Avatar
                                    name={it.name}
                                    size={40}
                                    gold={(it.lead?.orders_count ?? 0) > 0}
                                  />
                                  <span className="min-w-0">
                                    <span
                                      className={cn(
                                        "block truncate text-[13.5px]",
                                        it.hot
                                          ? "font-bold text-white"
                                          : "font-semibold text-[#D4D4D4]",
                                      )}
                                    >
                                      {it.name}
                                    </span>
                                    <span className="block truncate text-[12px] text-[#8C8C8C]">
                                      {it.sub}
                                    </span>
                                  </span>
                                </button>
                                {NEXT[it.stage] ? (
                                  <button
                                    type="button"
                                    onClick={() => advance.mutate(it)}
                                    title={`Mover para ${COLS.find((c) => c.v === NEXT[it.stage])?.label}`}
                                    aria-label="Avançar etapa"
                                    className="press grid size-10 shrink-0 place-items-center rounded-full border border-white/[0.1] text-[#A9A9A9] hover:border-[#FFD599]/50 hover:text-[#FFD599]"
                                  >
                                    <ArrowRight className="size-4" />
                                  </button>
                                ) : (
                                  <CheckCheck
                                    className="mr-2 size-4 shrink-0 text-[#7FCF9F]"
                                    aria-label="Comprou"
                                  />
                                )}
                              </div>
                            ))
                          )}
                          {all.length > MAX_ROWS ? (
                            <button
                              type="button"
                              onClick={() => void navigate({ to: "/admin/leads" })}
                              className="press mt-1 flex h-10 w-full items-center justify-center gap-1.5 rounded-[16px] text-[12.5px] font-bold text-[#A9A9A9] hover:bg-white/[0.04] hover:text-white"
                            >
                              <MoreHorizontal className="size-4" /> mais {all.length - MAX_ROWS}
                            </button>
                          ) : null}
                        </div>
                        <p className="mt-3 text-center text-[13px] font-semibold text-[#A9A9A9]">
                          {col.label}
                        </p>
                      </div>
                      {next ? <Links from={rows} to={next} /> : null}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* listas inteligentes */}
            <div className="grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6 min-[1800px]:w-[300px] min-[1800px]:grid-cols-2 min-[1800px]:content-start">
              {tiles.map((k, i) => (
                <button
                  key={k}
                  type="button"
                  onClick={() =>
                    void navigate({ to: "/admin/leads", search: { lista: k } as never })
                  }
                  className={cn(
                    "press flex min-h-[104px] flex-col justify-between rounded-[22px] p-3.5 text-left transition-colors",
                    i === 0 ? "bg-white text-[#15130F]" : "bg-[#1F1F1F] hover:bg-[#262626]",
                  )}
                >
                  <span
                    className={cn(
                      "text-[13px] leading-tight font-bold",
                      i === 0 ? "text-[#15130F]" : "text-[#D4D4D4]",
                    )}
                  >
                    {SEGMENTS[k].title}
                  </span>
                  <span className="text-[26px] leading-none font-bold tracking-[-0.04em] tabular-nums">
                    {loading ? "–" : segCount(k)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </section>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          {/* próximas ações */}
          <section className="rounded-[30px] bg-[#1A1A1A] p-4 lg:p-5">
            <h2 className="text-[17px] font-bold tracking-[-0.02em]">Próximas ações</h2>
            <div className="mt-3 hidden grid-cols-[minmax(0,1.3fr)_minmax(0,1.4fr)_96px_80px] gap-3 px-2 pb-2 text-[12px] font-semibold text-[#6F6F6F] md:grid">
              <span>Cliente</span>
              <span>Ação</span>
              <span>Calor</span>
              <span className="text-right">Atividade</span>
            </div>
            <div className="divide-y divide-white/[0.05]">
              {leads.slice(0, 8).map((l) => (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => setFicha(l.id)}
                  className="press grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-[14px] px-2 py-2.5 text-left hover:bg-white/[0.03] md:grid-cols-[minmax(0,1.3fr)_minmax(0,1.4fr)_96px_80px]"
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    <Avatar name={l.name} size={32} gold={l.orders_count > 0} />
                    <span className="truncate text-[13.5px] font-semibold">
                      {l.name ?? "Sem nome"}
                    </span>
                  </span>
                  <span className="hidden truncate text-[13px] text-[#D4D4D4] md:block">
                    {l.action.title}
                  </span>
                  <span>
                    <TempPill temp={l.temp} score={l.score} className="h-6 px-2 text-[11.5px]" />
                  </span>
                  <span className="hidden text-right text-[12.5px] text-[#8C8C8C] tabular-nums md:block">
                    {ago(
                      l.live?.at ?? l.wa?.last_inbound_at ?? l.views?.last_at ?? l.last_order_at,
                    ) || "—"}
                  </span>
                </button>
              ))}
            </div>
          </section>

          {/* calor da base */}
          <section className="rounded-[30px] bg-[#1A1A1A] p-4 lg:p-5">
            <h2 className="text-[17px] font-bold tracking-[-0.02em]">Calor da base</h2>
            <div className="mt-4 grid grid-cols-3 gap-2">
              {temps.map(({ t, n }) => (
                <Ring
                  key={t}
                  label={TEMP[t].label}
                  n={n}
                  total={Math.max(1, leads.length)}
                  color={TEMP[t].ring}
                />
              ))}
            </div>
            <p className="mt-4 flex items-center gap-2 text-[13px] text-[#8C8C8C]">
              <Check className="size-4 text-[#7FCF9F]" />
              {leads.filter((l) => l.orders_count > 0).length} de {leads.length} já compraram
            </p>
          </section>
        </div>
      </div>
      <CustomerSheet id={ficha} onClose={() => setFicha(null)} />
    </AdminShell>
  );
}

/** Linhas que ligam uma coluna à próxima (como na jornada de referência). */
function Links({ from, to }: { from: Item[]; to: Item[] }) {
  const W = 40;
  const n = Math.max(from.length, to.length, 2);
  const H = HEAD_H + n * ROW_H;
  const y = (i: number) => HEAD_H + i * ROW_H + ROW_H / 2;
  if (!from.length) return <div style={{ width: W }} className="shrink-0" />;
  const target = to.length ? 0 : -1;
  return (
    <svg width={W} height={H} className="shrink-0" aria-hidden>
      {from.map((it, i) => {
        const ty = target >= 0 ? y(Math.min(i, to.length - 1)) : y(i);
        const y0 = y(i);
        return (
          <path
            key={it.key}
            d={`M0 ${y0} C ${W / 2} ${y0}, ${W / 2} ${ty}, ${W} ${ty}`}
            fill="none"
            stroke={it.hot ? "#FF9A8A" : "#3A3A3A"}
            strokeWidth={1.6}
            strokeDasharray={target < 0 ? "3 4" : undefined}
          />
        );
      })}
    </svg>
  );
}

function Ring({
  label,
  n,
  total,
  color,
}: {
  label: string;
  n: number;
  total: number;
  color: string;
}) {
  const r = 38;
  const c = 2 * Math.PI * r;
  const pct = n / total;
  return (
    <div className="flex flex-col items-center" title={`${label}: ${n} clientes`}>
      <svg viewBox="0 0 100 100" className="size-[104px] -rotate-90">
        <circle cx="50" cy="50" r={r} fill="none" stroke="#262626" strokeWidth="12" />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={`${Math.max(0.001, pct * c)} ${c}`}
        />
      </svg>
      <p className="-mt-[66px] text-[22px] font-bold tracking-[-0.03em] tabular-nums">{n}</p>
      <p className="mt-[34px] text-[13px] font-semibold text-[#A9A9A9]">{label}</p>
    </div>
  );
}
