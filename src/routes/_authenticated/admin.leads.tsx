/**
 * CRM → HOJE.
 * A lista de vendas do dia: cada cliente cai em UMA tarefa clara (responder,
 * recuperar carrinho, oferecer o frasco…). Comece pelo destaque, atenda pelo painel
 * lateral e marque como feito. Simples como uma lista de tarefas.
 */
import { throttleByKey } from "@/lib/realtime-throttle";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check, RefreshCw, Search, SkipForward, Sparkles, Users } from "lucide-react";
import { AdminShell } from "@/components/orium/AdminShell";
import { LeadPanel, useDoneToday } from "@/components/orium/crm/LeadPanel";
import { Avatar, TEMP } from "@/components/orium/crm/shared";
import { pxInputClass } from "@/components/orium/admin/PricingUI";
import { onAdminSignal } from "@/lib/admin-signal";
import {
  TASKS,
  TASK_ORDER,
  enrich,
  firstName,
  interestsOf,
  taskOf,
  type Lead,
  type SegmentKey,
  type TaskKey,
} from "@/lib/crm-intel";
import { crmLeads } from "@/lib/crm-wa.functions";
import { brl } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/admin/leads")({
  validateSearch: (s: Record<string, unknown>): { lista?: SegmentKey } =>
    typeof s.lista === "string" ? { lista: s.lista as SegmentKey } : {},
  head: () => ({ meta: [{ title: "Hoje — Orium CRM" }, { name: "robots", content: "noindex" }] }),
  component: HojePage,
});

type View = TaskKey | "todos";
// listas do Funil → tarefa equivalente
const FROM_LIST: Partial<Record<SegmentKey, TaskKey>> = {
  responder: "reply",
  carrinho: "cart",
  esperando: "arrived",
  upgrade: "upgrade",
  promo: "stuck",
  recompra: "repurchase",
  sumidos: "winback",
  novos: "first",
};

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
}

function HojePage() {
  const qc = useQueryClient();
  const { lista } = Route.useSearch();
  const auth = useAuth() as unknown as {
    user?: { user_metadata?: Record<string, unknown> } | null;
  };
  const { done, toggle } = useDoneToday();
  const [view, setView] = useState<View | null>(
    lista && FROM_LIST[lista] ? FROM_LIST[lista]! : null,
  );
  const [q, setQ] = useState("");
  const [skip, setSkip] = useState(0);
  const [open, setOpen] = useState<{ id: string; el: HTMLElement | null } | null>(null);

  const { data, isPending, refetch, isFetching } = useQuery({
    queryKey: ["crm-leads"],
    queryFn: () => crmLeads(),
    refetchInterval: 60_000,
    staleTime: 15_000,
  });
  useEffect(() => {
    const bump = throttleByKey(() => void qc.invalidateQueries({ queryKey: ["crm-leads"] }), 4000);
    const off = onAdminSignal(["wa_contacts", "live_sessions"], () => bump());
    return () => {
      bump.cancel();
      off();
    };
  }, [qc]);

  const leads = useMemo(() => enrich(data ?? []), [data]);
  const byTask = useMemo(() => {
    const m = new Map<TaskKey, Lead[]>(TASK_ORDER.map((k) => [k, []]));
    for (const l of leads) {
      const t = taskOf(l);
      if (t) m.get(t)!.push(l);
    }
    return m;
  }, [leads]);
  const todo = useMemo(() => TASK_ORDER.flatMap((k) => byTask.get(k)!), [byTask]);
  const pending = todo.filter((l) => !done.has(l.id));
  const firstTask =
    TASK_ORDER.find((k) => byTask.get(k)!.some((l) => !done.has(l.id))) ??
    TASK_ORDER.find((k) => byTask.get(k)!.length) ??
    "first";
  const active: View = view ?? firstTask;

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    const digits = term.replace(/\D/g, "");
    const base = term ? leads : active === "todos" ? leads : (byTask.get(active) ?? []);
    const found = base.filter(
      (l) =>
        !term ||
        (l.name ?? "").toLowerCase().includes(term) ||
        (digits.length >= 3 && (l.phone ?? "").includes(digits)),
    );
    return [...found.filter((l) => !done.has(l.id)), ...found.filter((l) => done.has(l.id))];
  }, [leads, byTask, active, q, done]);

  const spot = pending.length ? pending[skip % pending.length] : null;
  const doneCount = todo.length - pending.length;
  const onTable = leads.reduce((s, l) => s + (l.cart?.total ?? 0), 0);
  const lead = open ? (leads.find((l) => l.id === open.id) ?? null) : null;
  const meta = auth.user?.user_metadata ?? {};
  const me = firstName(
    (meta["name"] as string | undefined) ?? (meta["full_name"] as string | undefined) ?? null,
  );

  return (
    <AdminShell
      title="Hoje"
      action={
        <button
          type="button"
          onClick={() => void refetch()}
          aria-label="Atualizar"
          className="press grid size-11 place-items-center rounded-full bg-[#1F1F1F] text-[#D4D4D4] hover:text-white"
        >
          <RefreshCw className={cn("size-[18px]", isFetching && "animate-spin")} />
        </button>
      }
    >
      <p className="-mt-3 mb-5 text-[15px] text-[#A9A9A9]">
        {greeting()}
        {me ? `, ${me}` : ""}.{" "}
        {isPending
          ? "Preparando sua lista…"
          : pending.length
            ? `Você tem ${pending.length} ${pending.length === 1 ? "pessoa" : "pessoas"} pra atender hoje.`
            : "Tudo em dia por aqui ✨"}
      </p>

      {/* destaque + seu dia */}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-4">
        <section className="relative overflow-hidden rounded-[30px] bg-gradient-to-br from-[#2A2416] via-[#1C1A15] to-[#171717] p-5 lg:p-6">
          <p className="flex items-center gap-2 text-[13px] font-bold text-[#FFD599]">
            <Sparkles className="size-4" /> Comece por aqui
          </p>
          {isPending ? (
            <div className="admin-skeleton mt-4 h-[120px] rounded-[22px]" />
          ) : spot ? (
            <div className="mt-4 flex flex-col gap-5 sm:flex-row sm:items-center">
              <Avatar
                src={spot.avatar}
                name={spot.name}
                score={spot.score}
                temp={spot.temp}
                size={76}
                gold={spot.orders_count > 0}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[24px] leading-tight font-bold tracking-[-0.03em]">
                  {spot.name ?? "Sem nome"}
                </p>
                <p className="mt-1 text-[16px] font-bold text-[#FFD599]">
                  {TASKS[taskOf(spot)!].title}
                </p>
                <p className="mt-0.5 text-[14px] text-[#A9A9A9]">
                  {spot.reasons[0] ?? spot.action.why}
                </p>
              </div>
              <Thumbs lead={spot} />
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => setSkip((s) => s + 1)}
                  aria-label="Próximo"
                  title="Mostrar o próximo"
                  className="press grid size-12 place-items-center rounded-full bg-white/[0.08] text-[#D4D4D4] hover:text-white"
                >
                  <SkipForward className="size-[18px]" />
                </button>
                <button
                  type="button"
                  onClick={(e) => setOpen({ id: spot.id, el: e.currentTarget })}
                  className="press inline-flex h-12 items-center gap-2 rounded-full bg-[#FFD599] px-6 text-[15px] font-bold text-[#15130F]"
                >
                  Atender <ArrowRight className="size-[18px]" />
                </button>
              </div>
            </div>
          ) : (
            <p className="mt-4 text-[18px] font-bold">Ninguém esperando agora. Bom trabalho!</p>
          )}
        </section>

        <section className="flex items-center gap-5 rounded-[30px] bg-[#1A1A1A] p-5 lg:p-6">
          <Progress value={doneCount} total={todo.length} />
          <div className="min-w-0 space-y-3">
            <div>
              <p className="text-[12.5px] font-semibold text-[#8C8C8C]">Feitos hoje</p>
              <p className="text-[22px] leading-none font-bold tracking-[-0.03em] tabular-nums">
                {doneCount}
                <span className="text-[15px] text-[#6F6F6F]"> de {todo.length}</span>
              </p>
            </div>
            <div>
              <p className="text-[12.5px] font-semibold text-[#8C8C8C]">Em carrinhos</p>
              <p className="text-[18px] leading-none font-bold tracking-[-0.02em] tabular-nums">
                {brl(onTable)}
              </p>
            </div>
          </div>
        </section>
      </div>

      {/* tarefas + pessoas */}
      <div className="mt-4 grid gap-3 lg:mt-5 lg:grid-cols-[280px_minmax(0,1fr)] lg:gap-4">
        <nav
          aria-label="Tarefas"
          className="adm-scroll -mx-1 flex gap-2 overflow-x-auto px-1 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0"
        >
          {TASK_ORDER.filter((k) => byTask.get(k)!.length).map((k) => {
            const list = byTask.get(k)!;
            const left = list.filter((l) => !done.has(l.id)).length;
            const sel = active === k && !q;
            return (
              <button
                key={k}
                type="button"
                onClick={() => {
                  setView(k);
                  setQ("");
                }}
                className={cn(
                  "press flex shrink-0 items-center gap-3 rounded-[22px] px-4 py-3 text-left transition-colors lg:w-full",
                  sel ? "bg-white text-[#15130F]" : "bg-[#1A1A1A] hover:bg-[#202020]",
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14.5px] font-bold">{TASKS[k].title}</span>
                  <span
                    className={cn(
                      "hidden truncate text-[12px] lg:block",
                      sel ? "text-[#15130F]/60" : "text-[#8C8C8C]",
                    )}
                  >
                    {TASKS[k].hint}
                  </span>
                </span>
                {left ? (
                  <span
                    className={cn(
                      "grid h-7 min-w-7 place-items-center rounded-full px-2 text-[12.5px] font-bold tabular-nums",
                      sel
                        ? "bg-[#15130F] text-[#FFD599]"
                        : k === "reply" || k === "checkout"
                          ? "bg-[#FFD599] text-[#15130F]"
                          : "bg-white/[0.08]",
                    )}
                  >
                    {left}
                  </span>
                ) : (
                  <Check
                    className={cn("size-5 shrink-0", sel ? "text-[#15130F]" : "text-[#7FCF9F]")}
                  />
                )}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => {
              setView("todos");
              setQ("");
            }}
            className={cn(
              "press flex shrink-0 items-center gap-3 rounded-[22px] px-4 py-3 text-left lg:mt-2 lg:w-full",
              active === "todos" && !q
                ? "bg-white text-[#15130F]"
                : "text-[#A9A9A9] hover:bg-white/[0.04] hover:text-white",
            )}
          >
            <Users className="size-[18px] shrink-0" />
            <span className="text-[14px] font-bold">Todos os clientes</span>
            <span className="ml-auto text-[12.5px] tabular-nums opacity-60">{leads.length}</span>
          </button>
        </nav>

        <section className="min-w-0 rounded-[30px] bg-[#1A1A1A] p-3 sm:p-4 lg:p-5">
          <div className="flex flex-col gap-3 px-1 pb-3 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-[19px] font-bold tracking-[-0.02em]">
                {q ? "Busca" : active === "todos" ? "Todos os clientes" : TASKS[active].title}
              </h2>
              <p className="truncate text-[13px] text-[#8C8C8C]">
                {q
                  ? `${rows.length} encontrados`
                  : active === "todos"
                    ? "Do mais quente ao mais frio"
                    : TASKS[active].hint}
              </p>
            </div>
            <label className="relative block sm:w-[260px]">
              <Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-[#6F6F6F]" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar cliente"
                className={cn(pxInputClass, "pl-11")}
              />
            </label>
          </div>

          {isPending ? (
            [0, 1, 2, 3].map((i) => (
              <div key={i} className="admin-skeleton mb-2 h-[76px] rounded-[22px]" />
            ))
          ) : rows.length === 0 ? (
            <p className="py-12 text-center text-[14px] text-[#8C8C8C]">Ninguém aqui.</p>
          ) : (
            <ul className="space-y-1.5">
              {rows.slice(0, 80).map((l) => {
                const isDone = done.has(l.id);
                const t = taskOf(l);
                return (
                  <li key={l.id}>
                    <div
                      className={cn(
                        "group flex items-center gap-3 rounded-[22px] bg-[#141414] p-3 transition-colors hover:bg-[#1F1F1F] sm:gap-4 sm:px-4",
                        isDone && "opacity-45",
                      )}
                    >
                      <button
                        type="button"
                        onClick={(e) => setOpen({ id: l.id, el: e.currentTarget })}
                        className="press flex min-w-0 flex-1 items-center gap-3 text-left sm:gap-4"
                      >
                        <Avatar
                          src={l.avatar}
                          name={l.name}
                          score={l.score}
                          temp={l.temp}
                          size={48}
                          gold={l.orders_count > 0}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className="truncate text-[15.5px] font-bold">
                              {l.name ?? "Sem nome"}
                            </span>
                            <span
                              className="size-1.5 shrink-0 rounded-full"
                              style={{ background: TEMP[l.temp].ring }}
                              title={TEMP[l.temp].label}
                            />
                          </span>
                          <span className="mt-0.5 block truncate text-[13px] text-[#A9A9A9]">
                            {(active === "todos" || q) && t ? (
                              <span className="font-bold text-[#FFD599]">{TASKS[t].title} · </span>
                            ) : null}
                            {l.reasons[0] ?? l.action.why}
                          </span>
                        </span>
                        <span className="hidden md:block">
                          <Thumbs lead={l} small />
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => toggle(l.id)}
                        aria-label={isDone ? "Desfazer" : "Marcar feito"}
                        title={isDone ? "Desfazer" : "Marcar feito"}
                        className={cn(
                          "press grid size-10 shrink-0 place-items-center rounded-full border transition-colors",
                          isDone
                            ? "border-[#7FCF9F] bg-[#7FCF9F] text-[#15130F]"
                            : "border-white/[0.12] text-[#6F6F6F] hover:border-[#7FCF9F] hover:text-[#7FCF9F]",
                        )}
                      >
                        <Check className="size-[18px]" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => setOpen({ id: l.id, el: e.currentTarget })}
                        className="press hidden h-10 shrink-0 items-center gap-1.5 rounded-full bg-white/[0.08] px-4 text-[13.5px] font-bold hover:bg-[#FFD599] hover:text-[#15130F] sm:inline-flex"
                      >
                        Atender
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      <LeadPanel
        lead={lead}
        originEl={open?.el ?? null}
        onClose={() => setOpen(null)}
        done={lead ? done.has(lead.id) : false}
        onDone={(v) => lead && toggle(lead.id, v)}
      />
    </AdminShell>
  );
}

/** Fotos dos perfumes de interesse (até 3). */
function Thumbs({ lead, small }: { lead: Lead; small?: boolean }) {
  const items = interestsOf(lead)
    .filter((i) => i.image_url)
    .slice(0, 3);
  if (!items.length) return null;
  const s = small ? 36 : 52;
  return (
    <span className="flex shrink-0 -space-x-2">
      {items.map((i) => (
        <span
          key={i.key}
          title={`${i.name} · ${i.tag}`}
          className="grid place-items-center overflow-hidden rounded-[12px] bg-white ring-2 ring-[#141414]"
          style={{ width: s, height: s }}
        >
          <img src={i.image_url!} alt="" loading="lazy" className="size-full object-contain" />
        </span>
      ))}
    </span>
  );
}

function Progress({ value, total }: { value: number; total: number }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const pct = total ? value / total : 0;
  return (
    <span className="relative grid size-[92px] shrink-0 place-items-center">
      <svg viewBox="0 0 80 80" className="absolute inset-0 -rotate-90">
        <circle cx="40" cy="40" r={r} fill="none" stroke="#262626" strokeWidth="8" />
        <circle
          cx="40"
          cy="40"
          r={r}
          fill="none"
          stroke="#7FCF9F"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={`${Math.max(0.001, pct * c)} ${c}`}
        />
      </svg>
      <span className="text-[19px] font-bold tabular-nums">{Math.round(pct * 100)}%</span>
    </span>
  );
}
