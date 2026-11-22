/**
 * ADMIN → CONVERSÃO.
 *
 * Números reais da jornada: quantas pessoas entram, abrem perfume, favoritam,
 * adicionam ao carrinho, vão ao WhatsApp e realmente compram — e onde está a
 * maior perda. Nada de dado inventado: períodos sem registro mostram zero.
 * Gráficos de uma série só, em dourado; texto sempre na cor do texto.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Eye,
  FlaskConical,
  Globe,
  Heart,
  MonitorSmartphone,
  Percent,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  TrendingDown,
  UserCheck,
  Users,
} from "lucide-react";
import { AdminShell } from "@/components/orium/AdminShell";
import { AnimatedMetric } from "@/components/orium/AnimatedMetric";
import { Bars } from "@/components/orium/CustomerSheet";
import {
  PxCard,
  PxCardBody,
  PxCardHead,
  PxInput,
  PxKpi,
  PxKpiRow,
  PxNote,
  PxSeg,
  PxStat,
} from "@/components/orium/admin/PricingUI";
import { brl, productTitle } from "@/lib/format";
import { cn } from "@/lib/utils";
import { conversionFunnel } from "@/lib/analytics-admin.functions";

export const Route = createFileRoute("/_authenticated/admin/conversao")({
  head: () => ({
    meta: [{ title: "Conversão — Orium Admin" }, { name: "robots", content: "noindex" }],
  }),
  component: ConversionPage,
});

type Period = "hoje" | "7d" | "30d" | "custom";

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

const pct = (a: number, b: number) => (b > 0 ? (a / b) * 100 : 0);
const fmtPct = (v: number) => `${v.toFixed(1).replace(".", ",")}%`;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const SOURCE_LABEL: Record<string, string> = {
  direto: "Acesso direto",
  instagram: "Instagram",
  tiktok: "TikTok",
  google: "Google",
  whatsapp: "WhatsApp",
  facebook: "Facebook",
  youtube: "YouTube",
};

const TRIGGER_LABEL: Record<string, string> = {
  salvar_escolhas: "Salvar minhas escolhas",
  ajuda_para_escolher: "Ajuda para escolher",
  negociacao: "Negociação",
  aviso_estoque: "Aviso de estoque",
  checkout: "Finalização do pedido",
  outro: "Outro",
};

const DEVICE_LABEL: Record<string, string> = {
  mobile: "Celular",
  tablet: "Tablet",
  desktop: "Computador",
  desconhecido: "Não informado",
};

const ico = (I: typeof Eye) => <I className="size-[18px]" strokeWidth={2.2} />;

function ConversionPage() {
  const [period, setPeriod] = useState<Period>("7d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const load = useServerFn(conversionFunnel);

  const range = useMemo(() => {
    const to = new Date();
    to.setDate(to.getDate() + 1);
    to.setHours(0, 0, 0, 0);
    if (period === "hoje") return { from: startOfToday().toISOString(), to: to.toISOString() };
    if (period === "custom" && customFrom && customTo) {
      const f = new Date(`${customFrom}T00:00:00`);
      const t = new Date(`${customTo}T00:00:00`);
      t.setDate(t.getDate() + 1);
      return { from: f.toISOString(), to: t.toISOString() };
    }
    const days = period === "30d" ? 30 : 7;
    const from = startOfToday();
    from.setDate(from.getDate() - (days - 1));
    return { from: from.toISOString(), to: to.toISOString() };
  }, [period, customFrom, customTo]);

  const { data, isPending, isError, error } = useQuery({
    queryKey: ["conversion-funnel", range.from, range.to],
    queryFn: () => load({ data: range }),
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });

  const steps = data?.steps ?? [];
  const visitors = data?.visitors ?? 0;
  const stepPeople = (key: string) => steps.find((s) => s.key === key)?.people ?? 0;
  // a etapa que mais perde gente (só entre etapas com alguém na anterior)
  const worstIndex = useMemo(() => {
    let idx = -1;
    let low = Infinity;
    for (let i = 1; i < steps.length; i++) {
      const prev = steps[i - 1]!.people;
      if (prev <= 0) continue;
      const rate = pct(steps[i]!.people, prev);
      if (rate < low) {
        low = rate;
        idx = i;
      }
    }
    return idx;
  }, [steps]);
  const worst = worstIndex > 0 ? { from: steps[worstIndex - 1]!, to: steps[worstIndex]! } : null;

  return (
    <AdminShell
      title="Conversão"
      action={
        <PxSeg
          label="Período"
          value={period}
          onChange={setPeriod}
          className="w-full md:w-[360px]"
          options={[
            { value: "hoje" as const, label: "Hoje" },
            { value: "7d" as const, label: "7 dias" },
            { value: "30d" as const, label: "30 dias" },
            { value: "custom" as const, label: "Escolher" },
          ]}
        />
      }
    >
      <div className="space-y-5 lg:space-y-6">
        {period === "custom" ? (
          <div className="flex flex-wrap items-center gap-2">
            <PxInput
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="w-[170px]"
              aria-label="Data inicial"
            />
            <span className="text-[14px] text-[#8C8C8C]">até</span>
            <PxInput
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="w-[170px]"
              aria-label="Data final"
            />
            {!customFrom || !customTo ? (
              <span className="text-[13px] text-[#8C8C8C]">Escolha as duas datas</span>
            ) : null}
          </div>
        ) : null}

        {isError ? (
          <PxNote tone="danger">
            Não foi possível carregar os números agora.{" "}
            {error instanceof Error ? error.message : ""}
          </PxNote>
        ) : null}

        <PxKpiRow>
          <PxKpi
            hero
            i={0}
            label="Conversão geral"
            icon={ico(Percent)}
            loading={isPending}
            value={
              <AnimatedMetric
                value={pct(stepPeople("order_confirmed"), visitors)}
                format="percent"
                decimals={1}
              />
            }
            foot="Visitantes que viraram pedido confirmado"
          />
          <PxKpi
            i={1}
            label="Visitantes"
            icon={ico(Users)}
            loading={isPending}
            value={<AnimatedMetric value={visitors} />}
            foot={`${data?.sessions ?? 0} visitas no período`}
          />
          <PxKpi
            i={2}
            label="Viraram clientes"
            icon={ico(UserCheck)}
            loading={isPending}
            value={<AnimatedMetric value={data?.identified ?? 0} />}
            foot="Deixaram nome ou WhatsApp"
          />
          <PxKpi
            i={3}
            label="Taxa de identificação"
            icon={ico(Sparkles)}
            loading={isPending}
            value={
              <AnimatedMetric
                value={pct(data?.identified ?? 0, visitors)}
                format="percent"
                decimals={1}
              />
            }
            foot={`${data?.anonymous ?? 0} seguem anônimos`}
          />
        </PxKpiRow>

        <PxCard i={4}>
          <PxCardHead
            title="Do clique ao pedido"
            sub="Quantas pessoas chegam a cada etapa e quantas seguem para a próxima."
            icon={ico(TrendingDown)}
          />
          <PxCardBody>
            {isPending ? (
              <div className="space-y-3">
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="admin-skeleton h-12 rounded-[16px]" />
                ))}
              </div>
            ) : steps.length === 0 ? (
              <p className="text-[14px] text-[#8C8C8C]">Ainda não há registros neste período.</p>
            ) : (
              <Funnel steps={steps} worstIndex={worstIndex} />
            )}
            {worst ? (
              <div className="mt-5 flex items-start gap-3 rounded-[20px] bg-[#2A1A18] px-4 py-3.5">
                <TrendingDown
                  className="mt-0.5 size-[18px] shrink-0 text-[#FF9A8A]"
                  strokeWidth={2.2}
                />
                <p className="text-[14px] leading-snug text-[#F3D3CD]">
                  <strong className="font-bold text-white">
                    Maior perda: {worst.from.label} → {worst.to.label}.
                  </strong>{" "}
                  Só {fmtPct(pct(worst.to.people, worst.from.people))} seguem;{" "}
                  {plural(
                    Math.max(0, worst.from.people - worst.to.people),
                    "pessoa para",
                    "pessoas param",
                  )}{" "}
                  aqui.
                </p>
              </div>
            ) : null}
            <p className="mt-4 text-[12.5px] leading-relaxed text-[#6F6F6F]">
              Só entram pedidos ligados de verdade a uma visita registrada. Favoritos, ajuda e
              negociação são passos menores e ficam fora do funil.
            </p>
          </PxCardBody>
        </PxCard>

        <div className="grid gap-4 lg:grid-cols-2 lg:gap-5">
          <Card i={5} title="Pedidos do período" icon={ico(ShoppingBag)}>
            <div className="grid grid-cols-2 gap-2">
              <PxStat label="Pedidos totais" value={data?.orders?.total ?? 0} />
              <PxStat label="Confirmados" value={data?.orders?.total_confirmed ?? 0} tone="gold" />
              <PxStat
                label="Vieram do site"
                value={data?.orders?.tracked ?? 0}
                note={`${data?.orders?.tracked_confirmed ?? 0} confirmados`}
              />
              <PxStat
                label="Sem rastreio"
                value={data?.orders?.untracked ?? 0}
                note="Manuais ou antigos"
              />
            </div>
          </Card>

          <Card
            i={6}
            title="Passagem entre etapas"
            icon={ico(Percent)}
            sub="De quem chegou numa etapa, quantos foram para a próxima."
          >
            <Bars
              max={100}
              rows={[
                { label: "Entrou → abriu perfume", v: pct(stepPeople("product_view"), visitors) },
                {
                  label: "Abriu perfume → sacola",
                  v: pct(stepPeople("cart_item_added"), stepPeople("product_view")),
                },
                {
                  label: "Sacola → finalizar",
                  v: pct(stepPeople("checkout_started"), stepPeople("cart_opened")),
                },
                {
                  label: "Finalizar → WhatsApp",
                  v: pct(stepPeople("whatsapp_checkout_clicked"), stepPeople("checkout_started")),
                },
                {
                  label: "WhatsApp → pedido",
                  v: pct(data?.orders?.tracked ?? 0, stepPeople("whatsapp_checkout_clicked")),
                },
              ].map((r) => ({ label: r.label, value: r.v, display: fmtPct(r.v) }))}
            />
          </Card>

          <Card
            i={7}
            title="Passos menores"
            icon={ico(Heart)}
            sub="Sinais de interesse antes da compra."
          >
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <PxStat label="Favoritaram" value={data?.micro?.favorites ?? 0} />
              <PxStat label="Pediram ajuda" value={data?.micro?.help ?? 0} />
              <PxStat label="Viraram clientes" value={data?.micro?.leads ?? 0} tone="gold" />
              <PxStat label="Usaram a busca" value={data?.micro?.searches ?? 0} />
              <PxStat label="Negociação" value={data?.micro?.negotiation ?? 0} />
            </div>
          </Card>

          <Card i={8} title="Carrinhos" icon={ico(ShoppingCart)}>
            <div className="grid grid-cols-2 gap-2">
              <PxStat
                label="Abandonados"
                value={data?.carts?.abandoned ?? 0}
                tone={(data?.carts?.abandoned ?? 0) > 0 ? "danger" : undefined}
              />
              <PxStat label="Ativos" value={data?.carts?.active ?? 0} />
              <PxStat
                label="Valor abandonado"
                value={brl(Number(data?.carts?.abandoned_total ?? 0))}
                note={`média ${brl(Number(data?.carts?.abandoned_avg ?? 0))}`}
              />
              <PxStat
                label="Recuperados"
                value={fmtPct(pct(data?.carts?.recovered ?? 0, data?.carts?.abandoned ?? 0))}
                tone="good"
              />
            </div>
            {data?.abandoned_products?.length ? (
              <div className="mt-5">
                <p className="mb-3 text-[13px] font-semibold text-[#A9A9A9]">
                  Mais deixados na sacola
                </p>
                <Bars
                  rows={data.abandoned_products.map((p) => ({
                    label: productTitle(p.name),
                    value: p.quantity,
                    display: `${p.quantity}x`,
                  }))}
                />
              </div>
            ) : null}
          </Card>

          <Card i={9} title="De onde vêm os visitantes" icon={ico(Globe)}>
            {data?.sources?.length ? (
              <Bars
                rows={data.sources.map((s) => ({
                  label: `${SOURCE_LABEL[s.source] ?? s.source}${s.campaign ? ` · ${s.campaign}` : ""}`,
                  value: s.visitors,
                  display: `${s.visitors} · ${plural(s.leads, "cliente", "clientes")}`,
                }))}
              />
            ) : (
              <Empty>Sem visitas registradas neste período.</Empty>
            )}
          </Card>

          <Card i={10} title="De onde vêm as vendas" icon={ico(ShoppingBag)}>
            {data?.order_sources?.length ? (
              <Bars
                rows={data.order_sources.map((s) => ({
                  label: SOURCE_LABEL[s.source] ?? s.source,
                  value: s.orders,
                  display: plural(s.orders, "pedido", "pedidos"),
                }))}
              />
            ) : (
              <Empty>Nenhum pedido com origem identificada.</Empty>
            )}
          </Card>

          <Card i={11} title="Aparelhos" icon={ico(MonitorSmartphone)}>
            {data?.devices?.length ? (
              <Bars
                rows={data.devices.map((d) => {
                  const conv = data.device_conversion?.find((c) => c.device === d.device);
                  return {
                    label: DEVICE_LABEL[d.device] ?? d.device,
                    value: d.visitors,
                    display: `${d.visitors} · ${conv?.whatsapp ?? 0} no WhatsApp`,
                  };
                })}
              />
            ) : (
              <Empty>Sem dados de aparelho.</Empty>
            )}
          </Card>

          <Card i={12} title="Decant ou frasco" icon={ico(FlaskConical)}>
            <Split
              label="Visualizações"
              a={data?.variants?.decant_views ?? 0}
              b={data?.variants?.bottle_views ?? 0}
            />
            <Split
              label="Postos na sacola"
              a={data?.variants?.decant_added ?? 0}
              b={data?.variants?.bottle_added ?? 0}
              className="mt-4"
            />
            <div className="mt-5">
              <p className="mb-3 text-[13px] font-semibold text-[#A9A9A9]">
                Tamanho de decant escolhido
              </p>
              <Bars
                rows={[
                  { label: "2 ml", v: data?.variants?.decant_2ml ?? 0 },
                  { label: "5 ml", v: data?.variants?.decant_5ml ?? 0 },
                  { label: "10 ml", v: data?.variants?.decant_10ml ?? 0 },
                ].map((r) => ({ label: r.label, value: r.v, display: String(r.v) }))}
              />
            </div>
          </Card>

          <Card i={13} title="Mais vistos" icon={ico(Eye)}>
            {data?.products?.length ? (
              <Bars
                rows={data.products.map((p) => ({
                  label: productTitle(p.name),
                  value: p.views,
                  display: `${p.views} · ${p.added} na sacola`,
                  hint: `${p.views} acessos de ${plural(p.visitors, "pessoa", "pessoas")}, ${p.added} na sacola`,
                }))}
              />
            ) : (
              <Empty>Nenhum perfume aberto neste período.</Empty>
            )}
          </Card>

          <Card i={14} title="Mais postos na sacola" icon={ico(ShoppingCart)}>
            {data?.added_products?.length ? (
              <Bars
                rows={data.added_products.map((p) => ({
                  label: productTitle(p.name),
                  value: p.added,
                  display: `${p.added} · ${p.ordered} em pedidos`,
                }))}
              />
            ) : (
              <Empty>Nenhuma adição registrada.</Empty>
            )}
          </Card>

          <Card
            i={15}
            title="O que faz a pessoa se identificar"
            icon={ico(UserCheck)}
            className="lg:col-span-2"
          >
            {data?.lead_triggers?.length ? (
              <Bars
                rows={data.lead_triggers.map((t) => ({
                  label: TRIGGER_LABEL[t.trigger] ?? t.trigger,
                  value: t.leads,
                  display: plural(t.leads, "cliente", "clientes"),
                }))}
              />
            ) : (
              <Empty>Ninguém se identificou neste período.</Empty>
            )}
          </Card>
        </div>

        <p className="text-[12.5px] text-[#6F6F6F]">
          {isPending
            ? "Carregando…"
            : `${data?.sessions ?? 0} visitas e ${data?.events ?? 0} ações registradas no período.`}
        </p>
      </div>
    </AdminShell>
  );
}

/** Funil: uma barra por etapa (comprimento = pessoas) e quanto passou entre elas. */
function Funnel({
  steps,
  worstIndex,
}: {
  steps: Array<{ key: string; label: string; people: number }>;
  worstIndex: number;
}) {
  const first = steps[0]?.people ?? 0;
  return (
    <ol className="space-y-1">
      {steps.map((s, i) => {
        const width = first > 0 ? Math.max(1.5, (s.people / first) * 100) : 1.5;
        const prev = i > 0 ? steps[i - 1]!.people : null;
        const rate = prev ? pct(s.people, prev) : null;
        const bad = i === worstIndex;
        return (
          <li key={s.key}>
            {prev !== null ? (
              <div className="flex h-7 items-center gap-2 pl-1">
                <span
                  className={cn("ml-3 h-full w-px", bad ? "bg-[#FF9A8A]/50" : "bg-white/10")}
                  aria-hidden
                />
                <span
                  className={cn(
                    "inline-flex h-6 items-center rounded-full px-2.5 text-[12px] font-bold tabular-nums",
                    bad ? "bg-[#2A1A18] text-[#FF9A8A]" : "bg-[#232323] text-[#A9A9A9]",
                  )}
                >
                  {rate != null ? `${fmtPct(rate)} seguem` : "—"}
                </span>
              </div>
            ) : null}
            <div
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 sm:grid-cols-[200px_minmax(0,1fr)_72px]"
              title={`${s.label}: ${s.people} pessoas`}
            >
              <span className="min-w-0 truncate text-[14.5px] font-semibold text-[#E6E6E6]">
                {s.label}
              </span>
              <span className="text-right text-[16px] font-bold tabular-nums sm:order-3">
                {s.people}
              </span>
              <span className="col-span-2 block h-3 overflow-hidden rounded-full bg-white/[0.06] sm:order-2 sm:col-span-1">
                <span
                  className="block h-full rounded-full bg-[#FFD599] transition-[width] duration-700"
                  style={{
                    width: `${width}%`,
                    opacity: 1 - (i / Math.max(1, steps.length - 1)) * 0.35,
                  }}
                />
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Duas partes de um todo (decant × frasco) com legenda e números escritos. */
function Split({
  label,
  a,
  b,
  className,
}: {
  label: string;
  a: number;
  b: number;
  className?: string;
}) {
  const total = a + b;
  const pa = total ? (a / total) * 100 : 0;
  return (
    <div className={className} title={`${label}: decant ${a}, frasco ${b}`}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] font-semibold text-[#A9A9A9]">{label}</span>
        <span className="text-[12.5px] text-[#8C8C8C] tabular-nums">{total} no total</span>
      </div>
      <div className="mt-2 flex h-3 gap-[2px] overflow-hidden rounded-full bg-white/[0.06]">
        {total ? (
          <>
            <span className="h-full rounded-l-full bg-[#FFD599]" style={{ width: `${pa}%` }} />
            <span className="h-full flex-1 rounded-r-full bg-[#D4D4D4]" />
          </>
        ) : null}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-[#FFD599]" aria-hidden /> Decant{" "}
          <strong className="tabular-nums">{a}</strong>
          <span className="text-[#8C8C8C] tabular-nums">{total ? fmtPct(pa) : ""}</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-[#D4D4D4]" aria-hidden /> Frasco{" "}
          <strong className="tabular-nums">{b}</strong>
          <span className="text-[#8C8C8C] tabular-nums">{total ? fmtPct(100 - pa) : ""}</span>
        </span>
      </div>
    </div>
  );
}

function Card({
  title,
  sub,
  icon,
  i,
  className,
  children,
}: {
  title: string;
  sub?: string;
  icon: ReactNode;
  i: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <PxCard i={i} className={className}>
      <PxCardHead title={title} sub={sub} icon={icon} />
      <PxCardBody>{children}</PxCardBody>
    </PxCard>
  );
}

const Empty = ({ children }: { children: ReactNode }) => (
  <p className="text-[14px] text-[#8C8C8C]">{children}</p>
);
