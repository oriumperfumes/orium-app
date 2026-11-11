/**
 * ADMIN → CONVERSÃO.
 *
 * Números reais da jornada: quantas pessoas entram, abrem perfume, favoritam,
 * adicionam ao carrinho, vão ao WhatsApp e realmente compram — e onde está a
 * maior perda. Nada de dado inventado: períodos sem registro mostram zero.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AdminShell } from "@/components/orium/AdminShell";
import { AnimatedMetric } from "@/components/orium/AnimatedMetric";
import { SegmentedControl } from "@/components/orium/SegmentedControl";
import { Input } from "@/components/ui/input";
import { brl, productTitle } from "@/lib/format";
import { conversionFunnel, type FunnelReport } from "@/lib/analytics-admin.functions";

export const Route = createFileRoute("/_authenticated/admin/conversao")({
  head: () => ({ meta: [{ title: "Conversão — Orium Admin" }, { name: "robots", content: "noindex" }] }),
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
  });

  const steps = data?.steps ?? [];
  const drops = useMemo(() => {
    const out: Array<{ from: string; to: string; rate: number; lost: number }> = [];
    for (let i = 1; i < steps.length; i++) {
      const prev = steps[i - 1]!;
      const cur = steps[i]!;
      if (prev.people <= 0) continue;
      out.push({
        from: prev.label,
        to: cur.label,
        rate: pct(cur.people, prev.people),
        lost: Math.max(0, prev.people - cur.people),
      });
    }
    return out;
  }, [steps]);
  const worst = drops.slice().sort((a, b) => a.rate - b.rate)[0] ?? null;
  const stepPeople = (key: string) => steps.find((s) => s.key === key)?.people ?? 0;

  return (
    <AdminShell title="Conversão">
      <div className="admin-in mb-4">
        <SegmentedControl
          label="Período"
          value={period}
          onChange={setPeriod}
          options={[
            { value: "hoje" as const, label: "Hoje" },
            { value: "7d" as const, label: "7 dias" },
            { value: "30d" as const, label: "30 dias" },
            { value: "custom" as const, label: "Período" },
          ]}
        />
        {period === "custom" ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <Input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="h-11 w-40 rounded-2xl"
              aria-label="Data inicial"
            />
            <Input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="h-11 w-40 rounded-2xl"
              aria-label="Data final"
            />
          </div>
        ) : null}
      </div>

      {isError ? (
        <div className="admin-in mb-4 rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          Não foi possível carregar os números agora. {error instanceof Error ? error.message : ""}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {isPending
          ? Array.from({ length: 4 }).map((_, i) => <CardSkeleton key={i} i={i} />)
          : [
              <Metric key="v" i={0} label="Visitantes" value={data?.visitors ?? 0} />,
              <Metric key="l" i={1} label="Viraram leads" value={data?.identified ?? 0} />,
              <Metric
                key="t"
                i={2}
                label="Taxa de identificação"
                value={pct(data?.identified ?? 0, data?.visitors ?? 0)}
                format="percent"
              />,
              <Metric
                key="c"
                i={3}
                label="Conversão geral"
                value={pct(
                  steps.find((s) => s.key === "order_confirmed")?.people ?? 0,
                  data?.visitors ?? 0,
                )}
                format="percent"
              />,
            ]}
      </div>

      <Panel title="Funil de compra">
        {isPending ? (
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="admin-skeleton h-10 w-full" />
            ))}
          </div>
        ) : steps.length === 0 ? (
          <Empty>Ainda não há registros neste período.</Empty>
        ) : (
          <ol className="space-y-1">
            {steps.map((s, i) => {
              const first = steps[0]?.people ?? 0;
              const width = first > 0 ? Math.max(6, (s.people / first) * 100) : 6;
              const prev = i > 0 ? steps[i - 1]!.people : null;
              return (
                <li key={s.key}>
                  {prev !== null ? (
                    <p className="py-1 pl-1 text-[11px] text-muted-foreground">
                      ↓ {prev > 0 ? fmtPct(pct(s.people, prev)) : "—"}
                    </p>
                  ) : null}
                  <div className="relative overflow-hidden rounded-2xl bg-accent/50">
                    <div className="absolute inset-y-0 left-0 bg-primary/15" style={{ width: `${width}%` }} />
                    <div className="relative flex items-center justify-between gap-3 px-3.5 py-3">
                      <span className="min-w-0 truncate text-sm">{s.label}</span>
                      <span className="text-sm font-semibold tabular-nums">{s.people}</span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        {worst ? (
          <p className="mt-4 rounded-2xl bg-accent/50 p-3 text-xs text-muted-foreground">
            <strong className="text-foreground">Maior perda:</strong> {worst.from} → {worst.to} — apenas{" "}
            {fmtPct(worst.rate)} seguem ({worst.lost} pessoas param aqui).
          </p>
        ) : null}
        <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
          O funil conta apenas pedidos com ligação comprovada com a visita registrada. Favoritos, ajuda e
          negociação são microconversões e ficam fora dele.
        </p>
      </Panel>

      <Panel title="Pedidos do período">
        <Rows
          rows={[
            { label: "Rastreados pelo funil", value: String(data?.orders?.tracked ?? 0) },
            { label: "Confirmados (rastreados)", value: String(data?.orders?.tracked_confirmed ?? 0) },
            { label: "Pedidos totais", value: String(data?.orders?.total ?? 0) },
            { label: "Confirmados no total", value: String(data?.orders?.total_confirmed ?? 0) },
            { label: "Sem rastreio (manuais/antigos)", value: String(data?.orders?.untracked ?? 0) },
          ]}
        />
      </Panel>

      <Panel title="Taxas da jornada">
        <Rows
          rows={[
            { label: "Card → produto aberto", value: fmtPct(pct(stepPeople("product_view"), data?.visitors ?? 0)) },
            {
              label: "Produto → carrinho",
              value: fmtPct(pct(stepPeople("cart_item_added"), stepPeople("product_view"))),
            },
            {
              label: "Carrinho → finalização",
              value: fmtPct(pct(stepPeople("checkout_started"), stepPeople("cart_opened"))),
            },
            {
              label: "Finalização → WhatsApp",
              value: fmtPct(pct(stepPeople("whatsapp_checkout_clicked"), stepPeople("checkout_started"))),
            },
            {
              label: "WhatsApp → pedido rastreado",
              value: fmtPct(pct(data?.orders?.tracked ?? 0, stepPeople("whatsapp_checkout_clicked"))),
            },
          ]}
        />
      </Panel>

      <Panel title="Microconversões">
        <Rows
          rows={[
            { label: "Favoritaram", value: String(data?.micro?.favorites ?? 0) },
            { label: "Pediram ajuda para escolher", value: String(data?.micro?.help ?? 0) },
            { label: "Viraram leads", value: String(data?.micro?.leads ?? 0) },
            { label: "Usaram a busca", value: String(data?.micro?.searches ?? 0) },
            { label: "Interesses em negociação", value: String(data?.micro?.negotiation ?? 0) },
          ]}
        />
      </Panel>


      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Origem dos visitantes">
          {data?.sources?.length ? (
            <Rows
              rows={data.sources.map((s) => ({
                label: `${SOURCE_LABEL[s.source] ?? s.source}${s.campaign ? ` · ${s.campaign}` : ""}`,
                value: `${s.visitors} · ${s.leads} lead${s.leads === 1 ? "" : "s"}`,
              }))}
            />
          ) : (
            <Empty>Sem visitas registradas neste período.</Empty>
          )}
        </Panel>

        <Panel title="Origem das vendas">
          {data?.order_sources?.length ? (
            <Rows
              rows={data.order_sources.map((s) => ({
                label: SOURCE_LABEL[s.source] ?? s.source,
                value: `${s.orders} pedido${s.orders === 1 ? "" : "s"}`,
              }))}
            />
          ) : (
            <Empty>Nenhum pedido com origem identificada.</Empty>
          )}
        </Panel>

        <Panel title="Dispositivos">
          {data?.devices?.length ? (
            <Rows
              rows={data.devices.map((d) => {
                const conv = data.device_conversion?.find((c) => c.device === d.device);
                return {
                  label: DEVICE_LABEL[d.device] ?? d.device,
                  value: `${d.visitors} visitantes · ${conv?.whatsapp ?? 0} no WhatsApp`,
                };
              })}
            />
          ) : (
            <Empty>Sem dados de dispositivo.</Empty>
          )}
        </Panel>

        <Panel title="Decant x Frasco">
          <Rows
            rows={[
              { label: "Visualizações em Decant", value: String(data?.variants?.decant_views ?? 0) },
              { label: "Visualizações em Frasco", value: String(data?.variants?.bottle_views ?? 0) },
              { label: "Adições de Decant", value: String(data?.variants?.decant_added ?? 0) },
              { label: "Adições de Frasco", value: String(data?.variants?.bottle_added ?? 0) },
              { label: "Decant 2ml", value: String(data?.variants?.decant_2ml ?? 0) },
              { label: "Decant 5ml", value: String(data?.variants?.decant_5ml ?? 0) },
              { label: "Decant 10ml", value: String(data?.variants?.decant_10ml ?? 0) },
            ]}
          />
        </Panel>

        <Panel title="Mais visualizados">
          {data?.products?.length ? (
            <Rows
              rows={data.products.map((p) => ({
                label: productTitle(p.name),
                value: `${p.views} acessos · ${p.visitors} pessoas · ${p.added} no carrinho`,
              }))}
            />
          ) : (
            <Empty>Nenhum perfume aberto neste período.</Empty>
          )}
        </Panel>

        <Panel title="Mais adicionados ao carrinho">
          {data?.added_products?.length ? (
            <Rows
              rows={data.added_products.map((p) => ({
                label: productTitle(p.name),
                value: `${p.added} adições · ${p.ordered} em pedidos`,
              }))}
            />
          ) : (
            <Empty>Nenhuma adição registrada.</Empty>
          )}
        </Panel>

        <Panel title="Carrinhos">
          <Rows
            rows={[
              { label: "Abandonados", value: String(data?.carts?.abandoned ?? 0) },
              { label: "Ativos", value: String(data?.carts?.active ?? 0) },
              { label: "Valor abandonado", value: brl(Number(data?.carts?.abandoned_total ?? 0)) },
              { label: "Valor médio abandonado", value: brl(Number(data?.carts?.abandoned_avg ?? 0)) },
              {
                label: "Taxa de recuperação",
                value: fmtPct(pct(data?.carts?.recovered ?? 0, data?.carts?.abandoned ?? 0)),
              },
            ]}
          />
          {data?.abandoned_products?.length ? (
            <>
              <p className="mt-4 mb-2 text-xs tracking-wide text-muted-foreground uppercase">
                Mais abandonados
              </p>
              <Rows
                rows={data.abandoned_products.map((p) => ({
                  label: productTitle(p.name),
                  value: `${p.quantity}x`,
                }))}
              />
            </>
          ) : null}
        </Panel>

        <Panel title="O que mais gera identificação">
          {data?.lead_triggers?.length ? (
            <Rows
              rows={data.lead_triggers.map((t) => ({
                label: TRIGGER_LABEL[t.trigger] ?? t.trigger,
                value: `${t.leads} lead${t.leads === 1 ? "" : "s"}`,
              }))}
            />
          ) : (
            <Empty>Ninguém se identificou neste período.</Empty>
          )}
        </Panel>
      </div>

      <p className="mt-6 text-xs text-muted-foreground">
        {isPending
          ? "Carregando..."
          : `${data?.sessions ?? 0} sessões e ${data?.events ?? 0} eventos no período · ${
              data?.anonymous ?? 0
            } visitantes seguem anônimos.`}
      </p>
    </AdminShell>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="admin-in mt-4 rounded-2xl bg-card p-4 shadow-soft sm:p-5">
      <h2 className="mb-3 text-sm font-medium text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

function Rows({ rows }: { rows: Array<{ label: string; value: string }> }) {
  return (
    <ul className="divide-y divide-border/60">
      {rows.map((r, i) => (
        <li key={`${r.label}-${i}`} className="flex items-center justify-between gap-3 py-2.5">
          <span className="min-w-0 flex-1 truncate text-sm">{r.label}</span>
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{r.value}</span>
        </li>
      ))}
    </ul>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

function Metric({
  label,
  value,
  format,
  i,
}: {
  label: string;
  value: number | null;
  format?: "number" | "percent";
  i: number;
}) {
  return (
    <div
      style={{ "--i": i } as CSSProperties}
      className="admin-card admin-in min-w-0 overflow-hidden rounded-2xl bg-card p-4 shadow-soft sm:p-5"
    >
      <p className="text-xs tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className="metric-value mt-2 min-w-0 font-semibold tabular-nums whitespace-nowrap">
        <AnimatedMetric value={value} format={format ?? "number"} decimals={format === "percent" ? 1 : 0} />
      </p>
    </div>
  );
}

function CardSkeleton({ i }: { i: number }) {
  return (
    <div style={{ "--i": i } as CSSProperties} className="admin-in rounded-2xl bg-card p-4 shadow-soft sm:p-5">
      <div className="admin-skeleton h-3 w-20" />
      <div className="admin-skeleton mt-3 h-7 w-24" />
    </div>
  );
}
