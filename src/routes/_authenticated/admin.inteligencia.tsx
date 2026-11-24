/**
 * CRM → INTELIGÊNCIA.
 * O que todas as conversas do WhatsApp, analisadas pela IA, dizem sobre a loja:
 * quem recuperar agora, por que os clientes não compram, perfumes mais pedidos
 * (e os que não temos em estoque), estilos, objeções e alertas.
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  BrainCircuit,
  Copy,
  Flame,
  MessageCircle,
  PackageX,
  Percent,
  RefreshCw,
  Target,
} from "lucide-react";
import { toast } from "sonner";
import { AdminShell } from "@/components/orium/AdminShell";
import { Bars } from "@/components/orium/CustomerSheet";
import { PxKpi } from "@/components/orium/admin/PricingUI";
import { Avatar, ago } from "@/components/orium/crm/shared";
import { supabase } from "@/integrations/supabase/client";
import { crmInsightsOverview } from "@/lib/crm-wa.functions";
import { brl } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/admin/inteligencia")({
  head: () => ({
    meta: [{ title: "Inteligência — Orium CRM" }, { name: "robots", content: "noindex" }],
  }),
  component: InteligenciaPage,
});

const MOTIVO: Record<string, string> = {
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

function InteligenciaPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data, isPending, isFetching, refetch, isError } = useQuery({
    queryKey: ["crm-insights-overview"],
    queryFn: () => crmInsightsOverview(),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
  useEffect(() => {
    let t: number | undefined;
    const ch = supabase
      .channel("orium-crm-inteligencia")
      .on("postgres_changes", { event: "*", schema: "public", table: "wa_insights" }, () => {
        window.clearTimeout(t);
        t = window.setTimeout(
          () => void qc.invalidateQueries({ queryKey: ["crm-insights-overview"] }),
          3000,
        );
      })
      .subscribe();
    return () => {
      window.clearTimeout(t);
      void supabase.removeChannel(ch);
    };
  }, [qc]);

  const d = data;
  const open = (jid: string) => void navigate({ to: "/admin/conversas", search: { jid } as never });
  const lostPrice = d?.motivos.find((m) => m.key === "preco")?.n ?? 0;
  const empty = !isPending && (d?.total ?? 0) === 0;

  return (
    <AdminShell
      title="Inteligência"
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
      <p className="-mt-3 mb-5 max-w-[80ch] text-[15px] text-[#A9A9A9]">
        A IA lê todas as conversas do WhatsApp e junta aqui o que elas dizem: quem dá para
        recuperar, por que as pessoas não compram e o que mais pedem.
      </p>
      {isError ? (
        <p className="mb-4 rounded-[18px] bg-[#FF9A8A]/10 p-4 text-[14px] text-[#FFB3A7]">
          Não foi possível carregar a inteligência agora.
        </p>
      ) : null}

      {empty ? (
        <section className="dash-card p-8 text-center lg:p-12">
          <span className="dash-ico mx-auto">
            <BrainCircuit className="size-[18px]" strokeWidth={2.2} />
          </span>
          <h2 className="mt-4 text-[20px] font-bold tracking-[-0.02em]">
            A análise começa quando o WhatsApp conectar
          </h2>
          <p className="mx-auto mt-2 max-w-md text-[14px] text-[#8C8C8C]">
            Conecte em CRM → Conversas. A cada 5 minutos a IA analisa as conversas novas (e as dos
            últimos 30 dias) e este painel se monta sozinho.
          </p>
        </section>
      ) : (
        <div className="space-y-4">
          <section className="grid grid-cols-2 gap-3 lg:gap-4 xl:grid-cols-4">
            <PxKpi
              i={0}
              hero
              label="Conversas analisadas"
              icon={<BrainCircuit className="size-[18px]" strokeWidth={2.2} />}
              loading={isPending}
              value={d?.total ?? 0}
              foot={`${d?.last7d ?? 0} nos últimos 7 dias`}
            />
            <PxKpi
              i={1}
              label="Chance média de compra"
              icon={<Percent className="size-[18px]" strokeWidth={2.2} />}
              loading={isPending}
              value={d?.avgChance != null ? `${d.avgChance}%` : "—"}
              foot="De quem ainda não comprou"
            />
            <PxKpi
              i={2}
              label="Negociando agora"
              icon={<Flame className="size-[18px]" strokeWidth={2.2} />}
              loading={isPending}
              value={d?.byStatus["negociando"] ?? 0}
              foot={`${d?.byStatus["comprou"] ?? 0} conversas viraram venda`}
            />
            <PxKpi
              i={3}
              label="Travaram no preço"
              icon={<Target className="size-[18px]" strokeWidth={2.2} />}
              loading={isPending}
              value={lostPrice}
              foot="Acharam caro e não fecharam"
            />
          </section>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
            {/* recuperar agora */}
            <Card
              title="Recuperar agora"
              hint="Não compraram ainda, mas dá para voltar com a mensagem certa"
              icon={<Flame />}
            >
              {isPending ? (
                <Skel n={4} />
              ) : !d?.recover.length ? (
                <Empty text="Ninguém para recuperar agora." />
              ) : (
                <ul className="space-y-2">
                  {d.recover.slice(0, 10).map((r) => (
                    <li key={r.jid} className="rounded-[20px] bg-[#141414] p-3">
                      <div className="flex items-center gap-3">
                        <Avatar src={r.avatar} name={r.name} size={40} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[14.5px] font-bold">{r.name}</p>
                          <p className="truncate text-[12.5px] text-[#A9A9A9]">
                            <span className="font-bold text-[#FFB3A7]">
                              {MOTIVO[r.motivo] ?? "Parado"}
                            </span>
                            {r.detalhe ? ` · ${r.detalhe}` : ""}
                          </p>
                        </div>
                        <span
                          className={cn(
                            "shrink-0 rounded-full px-2.5 py-1 text-[12px] font-bold tabular-nums",
                            r.chance >= 60
                              ? "bg-[#7FCF9F]/15 text-[#7FCF9F]"
                              : r.chance >= 35
                                ? "bg-[#FFD599]/15 text-[#FFD599]"
                                : "bg-white/[0.06] text-[#A9A9A9]",
                          )}
                        >
                          {r.chance}%
                        </span>
                      </div>
                      <p className="mt-2.5 rounded-[14px] bg-white/[0.04] p-2.5 text-[13px] leading-snug text-[#E5E5E5]">
                        {r.mensagem}
                      </p>
                      <div className="mt-2 flex gap-2">
                        <button
                          type="button"
                          onClick={() => open(r.jid)}
                          className="press inline-flex h-9 items-center gap-1.5 rounded-full bg-[#FFD599] px-3.5 text-[12.5px] font-bold text-[#15130F]"
                        >
                          <MessageCircle className="size-4" /> Abrir conversa
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            void navigator.clipboard?.writeText(r.mensagem);
                            toast.success("Mensagem copiada");
                          }}
                          className="press inline-flex h-9 items-center gap-1.5 rounded-full bg-white/[0.07] px-3.5 text-[12.5px] font-bold text-[#D4D4D4] hover:text-white"
                        >
                          <Copy className="size-4" /> Copiar
                        </button>
                        <span className="ml-auto self-center text-[11.5px] text-[#6F6F6F]">
                          {ago(r.at)}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <div className="space-y-4">
              <Card
                title="Por que não compram"
                hint="Motivo principal em cada conversa que não fechou"
                icon={<Target />}
              >
                {isPending ? (
                  <Skel n={4} />
                ) : !d?.motivos.length ? (
                  <Empty text="Sem motivos registrados ainda." />
                ) : (
                  <Bars
                    rows={d.motivos.map((m) => ({
                      label: MOTIVO[m.key] ?? m.key,
                      value: m.n,
                      display: `${m.n} ${m.n === 1 ? "conversa" : "conversas"}`,
                    }))}
                  />
                )}
              </Card>

              {d?.alerts.length ? (
                <Card
                  title="Alertas"
                  hint="Reclamações e problemas que pedem atenção"
                  icon={<AlertTriangle />}
                >
                  <ul className="space-y-2">
                    {d.alerts.map((a) => (
                      <li key={a.jid + a.at}>
                        <button
                          type="button"
                          onClick={() => open(a.jid)}
                          className="press w-full rounded-[16px] bg-[#FF9A8A]/[0.08] p-3 text-left hover:bg-[#FF9A8A]/[0.12]"
                        >
                          <p className="text-[13px] font-bold text-[#FFB3A7]">{a.name}</p>
                          <p className="mt-0.5 text-[13px] text-[#E5E5E5]">{a.alerta}</p>
                        </button>
                      </li>
                    ))}
                  </ul>
                </Card>
              ) : null}
            </div>
          </div>

          {/* demanda */}
          <Card
            title="Perfumes mais pedidos no WhatsApp"
            hint="Quantas conversas citaram cada perfume. Sem estoque = oportunidade de reposição."
            icon={<PackageX />}
          >
            {isPending ? (
              <Skel n={5} />
            ) : !d?.demand.length ? (
              <Empty text="Nenhum perfume citado ainda." />
            ) : (
              <div className="grid gap-2 md:grid-cols-2 2xl:grid-cols-3">
                {d.demand.map((p) => (
                  <div
                    key={p.key}
                    className="flex min-w-0 items-center gap-3 rounded-[18px] bg-[#141414] p-2.5"
                  >
                    <span className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-[14px] bg-white">
                      {p.image ? (
                        <img
                          src={p.image}
                          alt=""
                          loading="lazy"
                          className="size-full object-contain"
                        />
                      ) : (
                        <span className="text-[11px] font-bold text-[#15130F]/40">?</span>
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13.5px] font-bold">{p.name}</p>
                      <p className="truncate text-[12px] text-[#A9A9A9]">
                        {p.conversas} {p.conversas === 1 ? "conversa" : "conversas"}
                        {p.querem ? ` · ${p.querem} querem` : ""}
                        {p.compraram ? ` · ${p.compraram} compraram` : ""}
                        {p.price ? ` · ${brl(p.price)}` : ""}
                      </p>
                    </div>
                    {p.inStock === false ? (
                      <span className="shrink-0 rounded-full bg-[#FF9A8A]/15 px-2 py-1 text-[11px] font-bold text-[#FFB3A7]">
                        Sem estoque
                      </span>
                    ) : p.inStock === null ? (
                      <span className="shrink-0 rounded-full bg-white/[0.06] px-2 py-1 text-[11px] font-bold text-[#A9A9A9]">
                        Fora do catálogo
                      </span>
                    ) : p.stock > 0 ? (
                      <span className="shrink-0 rounded-full bg-[#7FCF9F]/15 px-2 py-1 text-[11px] font-bold text-[#7FCF9F]">
                        {p.stock} na loja
                      </span>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </Card>

          <div className="grid gap-4 xl:grid-cols-3">
            <Card title="Estilos que mais pedem" hint="Do que os clientes falam que gostam">
              {isPending ? <Skel n={3} /> : <Chips items={d?.estilos ?? []} gold />}
            </Card>
            <Card
              title="Ocasiões"
              hint={
                d?.presente
                  ? `${d.presente} ${d.presente === 1 ? "conversa era" : "conversas eram"} para presente`
                  : "Para quando querem o perfume"
              }
            >
              {isPending ? <Skel n={3} /> : <Chips items={d?.ocasioes ?? []} />}
            </Card>
            <Card title="Objeções mais comuns" hint="O que trava a venda, nas palavras da conversa">
              {isPending ? (
                <Skel n={3} />
              ) : !d?.objecoes.length ? (
                <Empty text="Nenhuma objeção registrada." />
              ) : (
                <ul className="space-y-1.5">
                  {d.objecoes.map((o) => (
                    <li key={o.key} className="flex items-baseline gap-2 text-[13.5px]">
                      <span className="min-w-0 flex-1 text-[#E5E5E5] first-letter:uppercase">
                        {o.key}
                      </span>
                      <span className="shrink-0 text-[12.5px] text-[#8C8C8C] tabular-nums">
                        {o.n}×
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      )}
    </AdminShell>
  );
}

function Card({
  title,
  hint,
  icon,
  children,
}: {
  title: string;
  hint?: string;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0 rounded-[28px] bg-[#1A1A1A] p-4 lg:p-5">
      <div className="mb-4 flex items-start gap-3">
        {icon ? (
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[#232323] text-[#FFD599] [&_svg]:size-[17px]">
            {icon}
          </span>
        ) : null}
        <div className="min-w-0">
          <h2 className="text-[17px] leading-tight font-bold tracking-[-0.02em]">{title}</h2>
          {hint ? <p className="mt-0.5 text-[13px] text-[#8C8C8C]">{hint}</p> : null}
        </div>
      </div>
      {children}
    </section>
  );
}

function Chips({ items, gold }: { items: Array<{ key: string; n: number }>; gold?: boolean }) {
  if (!items.length) return <Empty text="Ainda sem dados." />;
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((i) => (
        <span
          key={i.key}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-semibold",
            gold ? "bg-[#FFD599]/12 text-[#FFD599]" : "bg-white/[0.06] text-[#E5E5E5]",
          )}
        >
          <span className="first-letter:uppercase">{i.key}</span>
          <span className="tabular-nums opacity-60">{i.n}</span>
        </span>
      ))}
    </div>
  );
}

const Skel = ({ n }: { n: number }) => (
  <div className="space-y-2">
    {Array.from({ length: n }).map((_, i) => (
      <div key={i} className="admin-skeleton h-12 rounded-[16px]" />
    ))}
  </div>
);
const Empty = ({ text }: { text: string }) => (
  <p className="py-4 text-center text-[13.5px] text-[#8C8C8C]">{text}</p>
);
