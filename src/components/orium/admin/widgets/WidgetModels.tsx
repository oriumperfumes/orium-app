/**
 * Modelos de widget da Orium (prévia no Admin, com os pedidos de verdade).
 * Os mesmos modelos são desenhados no iPhone (Scriptable), no Android e no
 * Windows — aqui é onde o dono escolhe qual combina mais com ele.
 *
 * Tamanhos na proporção do iPhone: pequeno 1:1, médio 2.14:1, grande ~1:1.05.
 */
import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { brl } from "@/lib/format";
import type { WidgetPhase, WidgetSummary } from "@/lib/widget.functions";

export type WidgetSize = "small" | "medium" | "large";
export type WidgetModelKey = "foco" | "foco-claro" | "proximas" | "semana" | "fases" | "receber" | "painel";

export const WIDGET_MODELS: Array<{ key: WidgetModelKey; name: string; size: WidgetSize; about: string }> = [
  { key: "foco", name: "Foco do dia", size: "small", about: "O número que importa agora: hoje, amanhã ou o próximo dia de entrega." },
  { key: "foco-claro", name: "Foco claro", size: "small", about: "O mesmo foco, em cartão claro para telas com papel de parede escuro." },
  { key: "receber", name: "A receber", size: "small", about: "Quanto ainda falta receber e de quantos clientes." },
  { key: "proximas", name: "Próximas entregas", size: "medium", about: "As 3 próximas entregas com horário, cliente e fase." },
  { key: "semana", name: "Semana", size: "medium", about: "Os próximos 7 dias: cada bolinha dourada é um dia com entrega." },
  { key: "fases", name: "Onde estão os pedidos", size: "medium", about: "Quantos pedidos em cada fase: pagamento, fornecedor, a caminho, pronto." },
  { key: "painel", name: "Painel completo", size: "large", about: "Foco do dia, a semana e as próximas entregas num widget só." },
];

const PHASE_DOT: Record<WidgetPhase, string> = { pagamento: "#D4D4D4", comprar: "#FF8A75", chegando: "#FFD599", entregar: "#FFFFFF" };
const TONE: Record<WidgetSummary["tone"], string> = { red: "#FF8A75", gold: "#FFD599", green: "#7FCF9F" };

const SIZE: Record<WidgetSize, string> = {
  small: "w-[170px] h-[170px]",
  medium: "w-[364px] h-[170px] max-w-full",
  large: "w-[364px] h-[382px] max-w-full",
};

function Shell({ size, light, children, className, style }: { size: WidgetSize; light?: boolean; children: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-[26px] p-4 font-sans select-none",
        light ? "bg-[#F4F1EA] text-[#15130F]" : "bg-[#141414] text-white ring-1 ring-white/[0.06]",
        SIZE[size],
        className,
      )}
      style={style}
    >
      {children}
    </div>
  );
}

/** Marca discreta da Orium no canto. */
function Mark({ light }: { light?: boolean }) {
  return <span className={cn("text-[10px] font-bold tracking-[0.18em]", light ? "text-[#15130F]/45" : "text-white/35")}>ORIUM</span>;
}

function Ring({ value, total, size = 44, light }: { value: number; total: number; size?: number; light?: boolean }) {
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  const p = total > 0 ? Math.min(1, value / total) : 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={light ? "#15130F1A" : "#2E2E2E"} strokeWidth="5" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#FFD599" strokeWidth="5" strokeLinecap="round" strokeDasharray={`${c * p} ${c}`} />
    </svg>
  );
}

const focusLabel = (s: WidgetSummary) => (s.focus === "today" ? "Hoje" : s.focus === "tomorrow" ? "Amanhã" : s.focus === "week" ? "Próxima entrega" : "Tudo em dia");
const focusReady = (s: WidgetSummary) => {
  const g = s.focus === "today" ? ["late", "today"] : s.focus === "tomorrow" ? ["tomorrow"] : [];
  const list = s.next.filter((o) => g.includes(o.group));
  return { ready: list.filter((o) => o.phase === "entregar").length, total: list.length };
};

export function WidgetPreview({ model, s }: { model: WidgetModelKey; s: WidgetSummary }) {
  switch (model) {
    case "foco":
    case "foco-claro": {
      const light = model === "foco-claro";
      const fr = focusReady(s);
      return (
        <Shell size="small" light={light}>
          <div className="flex items-start justify-between">
            <span className="flex items-center gap-1.5 text-[12px] font-semibold">
              <span className="size-2 rounded-full" style={{ background: TONE[s.tone] }} />
              {focusLabel(s)}
            </span>
            {fr.total ? (
              <span className="relative grid place-items-center">
                <Ring value={fr.ready} total={fr.total} size={40} light={light} />
                <span className="absolute text-[10px] font-bold tabular-nums">
                  {fr.ready}/{fr.total}
                </span>
              </span>
            ) : null}
          </div>
          <div className="absolute inset-x-4 bottom-4">
            <p className="text-[52px] leading-none font-semibold tracking-[-0.05em] tabular-nums">{s.focusCount || s.counts.open}</p>
            <p className="mt-1 text-[13px] leading-tight font-semibold">{s.focus === "none" ? "pedidos em andamento" : s.focusCount === 1 ? "pedido para entregar" : "pedidos para entregar"}</p>
            <p className={cn("mt-0.5 truncate text-[11px]", light ? "text-[#15130F]/55" : "text-white/50")}>{s.sub}</p>
          </div>
        </Shell>
      );
    }
    case "receber": {
      const total = s.receivable;
      return (
        <Shell size="small">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-semibold text-white/70">A receber</span>
            <Mark />
          </div>
          <div className="absolute inset-x-4 bottom-4">
            <p className="text-[11px] text-white/50">R$</p>
            <p className="text-[34px] leading-none font-semibold tracking-[-0.045em] text-[#FFD599] tabular-nums">{brl(total).replace("R$", "").trim().replace(/,\d\d$/, "")}</p>
            <p className="mt-1.5 text-[12px] font-semibold">
              {s.counts.owing} {s.counts.owing === 1 ? "cliente devendo" : "clientes devendo"}
            </p>
            <div className="mt-2 flex h-2 gap-1">
              {Array.from({ length: 8 }, (_, i) => (
                <span key={i} className={cn("flex-1 rounded-full", i < Math.min(8, s.counts.owing) ? "bg-[#FFD599]" : "bg-[#2E2E2E]")} />
              ))}
            </div>
          </div>
        </Shell>
      );
    }
    case "proximas": {
      const list = s.next.slice(0, 3);
      return (
        <Shell size="medium">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-[13px] font-semibold">
              <span className="size-2 rounded-full" style={{ background: TONE[s.tone] }} />
              {s.title}
            </span>
            <Mark />
          </div>
          <ul className="mt-2.5 space-y-1.5">
            {list.length ? (
              list.map((o) => (
                <li key={o.id} className="flex items-center gap-2.5 rounded-[12px] bg-white/[0.05] px-2.5 py-[7px]">
                  <span className={cn("w-[62px] shrink-0 truncate text-[11px] font-semibold tabular-nums", o.group === "late" ? "text-[#FF8A75]" : o.group === "today" ? "text-[#FFD599]" : "text-white/60")}>
                    {o.short}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{o.name}</span>
                  <span className="size-2 shrink-0 rounded-full" style={{ background: PHASE_DOT[o.phase] }} />
                </li>
              ))
            ) : (
              <li className="pt-6 text-center text-[13px] text-white/50">Nenhuma entrega marcada 👌</li>
            )}
          </ul>
        </Shell>
      );
    }
    case "semana": {
      return (
        <Shell size="medium">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-semibold">
              {s.week.reduce((a, d) => a + d.count, 0)} entregas <span className="text-white/50">nos próximos 7 dias</span>
            </span>
            <Mark />
          </div>
          <div className="absolute inset-x-4 bottom-4 grid grid-cols-7 gap-1.5">
            {s.week.map((d, i) => (
              <div key={d.date} className="flex flex-col items-center gap-1.5">
                <span className={cn("text-[10.5px] font-semibold", i === 0 ? "text-white" : "text-white/45")}>{d.label}</span>
                <span
                  className={cn(
                    "grid size-[38px] place-items-center rounded-full text-[14px] font-bold tabular-nums",
                    d.count ? "bg-[#FFD599] text-[#15130F]" : "bg-[#222] text-white/40",
                    i === 0 && !d.count && "ring-2 ring-white/70",
                    i === 0 && d.count && "ring-2 ring-white ring-offset-2 ring-offset-[#141414]",
                  )}
                >
                  {d.day}
                </span>
                <span className={cn("text-[10.5px] font-bold tabular-nums", d.count ? "text-[#FFD599]" : "text-transparent")}>{d.count || 0}</span>
              </div>
            ))}
          </div>
        </Shell>
      );
    }
    case "fases": {
      const bars: Array<{ k: WidgetPhase; label: string; n: number }> = [
        { k: "pagamento", label: "Pagto", n: s.counts.open - s.counts.toBuy - s.counts.arriving - s.counts.ready },
        { k: "comprar", label: "Fornec.", n: s.counts.toBuy },
        { k: "chegando", label: "A caminho", n: s.counts.arriving },
        { k: "entregar", label: "Pronto", n: s.counts.ready },
      ];
      const max = Math.max(1, ...bars.map((b) => b.n));
      return (
        <Shell size="medium">
          <div className="flex h-full gap-4">
            <div className="flex w-[104px] shrink-0 flex-col justify-between">
              <Mark />
              <div>
                <p className="text-[46px] leading-none font-semibold tracking-[-0.05em] tabular-nums">{s.counts.open}</p>
                <p className="mt-1 text-[12px] leading-tight font-semibold text-white/70">pedidos em andamento</p>
              </div>
            </div>
            <div className="grid flex-1 grid-cols-4 items-end gap-2">
              {bars.map((b) => (
                <div key={b.k} className="flex h-full flex-col items-center justify-end gap-1">
                  <span className="text-[13px] font-bold tabular-nums">{Math.max(0, b.n)}</span>
                  <span className="flex h-[78px] w-full items-end overflow-hidden rounded-[10px] bg-[#222]">
                    <span className="w-full rounded-[10px]" style={{ height: `${Math.max(6, (Math.max(0, b.n) / max) * 100)}%`, background: PHASE_DOT[b.k] }} />
                  </span>
                  <span className="truncate text-[10px] font-semibold text-white/55">{b.label}</span>
                </div>
              ))}
            </div>
          </div>
        </Shell>
      );
    }
    case "painel": {
      const fr = focusReady(s);
      return (
        <Shell size="large">
          <div className="flex items-start justify-between">
            <div>
              <span className="flex items-center gap-1.5 text-[12px] font-semibold text-white/70">
                <span className="size-2 rounded-full" style={{ background: TONE[s.tone] }} />
                {focusLabel(s)}
              </span>
              <p className="mt-1 text-[22px] leading-tight font-semibold tracking-[-0.03em]">{s.title}</p>
              <p className="text-[12px] text-white/55">{s.sub}</p>
            </div>
            {fr.total ? (
              <span className="relative grid place-items-center">
                <Ring value={fr.ready} total={fr.total} size={52} />
                <span className="absolute text-[11px] font-bold tabular-nums">
                  {fr.ready}/{fr.total}
                </span>
              </span>
            ) : (
              <Mark />
            )}
          </div>
          <div className="mt-3 grid grid-cols-7 gap-1">
            {s.week.map((d, i) => (
              <div key={d.date} className="flex flex-col items-center gap-1">
                <span className="text-[9.5px] font-semibold text-white/45">{d.label}</span>
                <span className={cn("grid size-[30px] place-items-center rounded-full text-[12px] font-bold tabular-nums", d.count ? "bg-[#FFD599] text-[#15130F]" : "bg-[#222] text-white/40", i === 0 && "ring-2 ring-white/70")}>{d.day}</span>
              </div>
            ))}
          </div>
          <ul className="mt-3 space-y-1.5">
            {s.next.slice(0, 3).map((o) => (
              <li key={o.id} className="flex items-center gap-2.5 rounded-[12px] bg-white/[0.05] px-2.5 py-[7px]">
                <span className={cn("w-[66px] shrink-0 truncate text-[11px] font-semibold tabular-nums", o.group === "late" ? "text-[#FF8A75]" : o.group === "today" ? "text-[#FFD599]" : "text-white/60")}>
                  {o.short}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold">{o.name}</span>
                  <span className="block truncate text-[10.5px] text-white/50">{o.phaseLabel}</span>
                </span>
                <span className="size-2 shrink-0 rounded-full" style={{ background: PHASE_DOT[o.phase] }} />
              </li>
            ))}
          </ul>
          <div className="absolute inset-x-4 bottom-3.5 flex items-center justify-between text-[11px] text-white/50">
            <span>
              A receber <b className="text-[#FFD599] tabular-nums">{brl(s.receivable)}</b>
            </span>
            <Mark />
          </div>
        </Shell>
      );
    }
  }
}
