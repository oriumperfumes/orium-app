/**
 * Peças do CRM usadas em Leads e Conversas: avatar, anel de calor, leitura do cliente
 * (motivos, perfil, próxima ação) e o cartão de preço do perfume citado no chat.
 */
import type { ReactNode } from "react";
import { Copy, Flame, PackageCheck, Snowflake, Sparkles, ThermometerSun } from "lucide-react";
import { toast } from "sonner";
import { initialsOf } from "@/components/orium/CustomerSheet";
import type { Lead, Temp } from "@/lib/crm-intel";
import type { PerfumeQuote } from "@/lib/crm-wa.functions";
import { brl } from "@/lib/format";
import { cn } from "@/lib/utils";

export const TEMP: Record<Temp, { label: string; ring: string; pill: string; icon: ReactNode }> = {
  quente: {
    label: "Quente",
    ring: "#FFB86B",
    pill: "bg-[#FFD599] text-[#15130F]",
    icon: <Flame className="size-3.5" strokeWidth={2.4} />,
  },
  morno: {
    label: "Morno",
    ring: "#F2C46D",
    pill: "bg-white/[0.08] text-white",
    icon: <ThermometerSun className="size-3.5" strokeWidth={2.4} />,
  },
  frio: {
    label: "Frio",
    ring: "#5A5A5A",
    pill: "bg-[#232323] text-[#A9A9A9]",
    icon: <Snowflake className="size-3.5" strokeWidth={2.4} />,
  },
};

export const fmtPhone = (p?: string | null) => {
  const d = (p ?? "").replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return p ?? "";
};

export function ago(iso?: string | null) {
  if (!iso) return "";
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 1) return "agora";
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d} d`;
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

/** Círculo com iniciais; o anel mostra o calor (0–100). */
export function Avatar({
  name,
  score,
  temp,
  size = 44,
  gold,
}: {
  name?: string | null;
  score?: number;
  temp?: Temp;
  size?: number;
  gold?: boolean;
}) {
  const ring = temp ? TEMP[temp].ring : "transparent";
  const pct = Math.max(0, Math.min(100, score ?? 0));
  return (
    <span
      className="relative grid shrink-0 place-items-center rounded-full"
      style={{
        width: size,
        height: size,
        background:
          score != null ? `conic-gradient(${ring} ${pct * 3.6}deg, #262626 0deg)` : undefined,
      }}
      aria-hidden
    >
      <span
        className={cn(
          "grid place-items-center rounded-full font-bold tracking-[-0.02em]",
          gold ? "bg-[#FFD599] text-[#15130F]" : "bg-[#232323] text-[#D4D4D4]",
        )}
        style={{
          width: size - (score != null ? 6 : 0),
          height: size - (score != null ? 6 : 0),
          fontSize: Math.round(size * 0.33),
        }}
      >
        {initialsOf((name ?? "").replace(/[^\p{L}\p{N}\s]/gu, "")) || "?"}
      </span>
    </span>
  );
}

export function TempPill({
  temp,
  score,
  className,
}: {
  temp: Temp;
  score?: number;
  className?: string;
}) {
  const t = TEMP[temp];
  return (
    <span
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[12.5px] font-bold",
        t.pill,
        className,
      )}
    >
      {t.icon}
      {t.label}
      {score != null ? <span className="tabular-nums opacity-60">{score}</span> : null}
    </span>
  );
}

/** Leitura do cliente: por que está quente, perfil de compra e o que fazer agora. */
export function LeadReading({
  lead,
  onUseMessage,
  compact,
}: {
  lead: Lead;
  onUseMessage?: (text: string) => void;
  compact?: boolean;
}) {
  const a = lead.action;
  return (
    <div className="space-y-3">
      <section className="rounded-[24px] bg-[#FFD599] p-4 text-[#15130F] sm:p-5">
        <div className="flex items-center gap-2 text-[12.5px] font-bold text-[#15130F]/65">
          <Sparkles className="size-4" strokeWidth={2.4} />
          Próxima ação
        </div>
        <p className="mt-1.5 text-[19px] leading-tight font-bold tracking-[-0.02em]">{a.title}</p>
        <p className="mt-1 text-[13.5px] text-[#15130F]/70">{a.why}</p>
        {a.message ? (
          <div className="mt-3 rounded-[18px] bg-[#15130F]/[0.07] p-3 text-[14px] leading-snug">
            {a.message}
          </div>
        ) : null}
        {a.message ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {onUseMessage ? (
              <button
                type="button"
                onClick={() => onUseMessage(a.message!)}
                className="press inline-flex h-10 items-center rounded-full bg-[#15130F] px-4 text-[13.5px] font-bold text-[#FFD599]"
              >
                Usar mensagem
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(a.message!);
                toast.success("Mensagem copiada");
              }}
              className="press inline-flex h-10 items-center gap-1.5 rounded-full bg-[#15130F]/10 px-4 text-[13.5px] font-bold"
            >
              <Copy className="size-4" /> Copiar
            </button>
          </div>
        ) : null}
      </section>

      {lead.reasons.length ? (
        <section className="rounded-[24px] bg-[#1A1A1A] p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-[15px] font-bold">
              Por que está {TEMP[lead.temp].label.toLowerCase()}
            </h3>
            <TempPill temp={lead.temp} score={lead.score} />
          </div>
          <ul className="mt-3 space-y-2">
            {lead.reasons.slice(0, compact ? 3 : 8).map((r) => (
              <li key={r} className="flex gap-2.5 text-[13.5px] leading-snug text-[#D4D4D4]">
                <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-[#FFD599]" />
                {r}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {lead.profile.length ? (
        <section className="rounded-[24px] bg-[#1A1A1A] p-4 sm:p-5">
          <h3 className="text-[15px] font-bold">Perfil de compra</h3>
          <ul className="mt-3 space-y-2">
            {lead.profile.slice(0, compact ? 4 : 10).map((r) => (
              <li key={r} className="flex gap-2.5 text-[13.5px] leading-snug text-[#D4D4D4]">
                <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-white/40" />
                {r}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/** Cartão de preço de um perfume citado: o que o cliente paga e o que sobra pra loja. */
export function PerfumeQuoteCard({
  q,
  onInsert,
}: {
  q: PerfumeQuote;
  onInsert?: (text: string) => void;
}) {
  const f = q.frasco;
  const line = [
    `${q.name}${q.volume_ml ? ` ${q.volume_ml}ml` : ""}`,
    f
      ? `sai por ${brl(f.pix)} no Pix${f.card && f.card !== f.pix ? ` ou ${brl(f.card)} no cartão` : ""}`
      : null,
  ]
    .filter(Boolean)
    .join(" ");
  const pitch = f
    ? `O ${line} ✨${f.promo ? ` Já com ${Math.round(f.promo)}% de desconto aplicado.` : ""}${q.ready ? " Tenho aqui pra retirar hoje." : ""}`
    : `O ${q.name} eu consigo pra você! Quer que eu veja o valor?`;
  return (
    <article className="rounded-[22px] bg-[#1A1A1A] p-3.5">
      <div className="flex items-center gap-3">
        <span className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-[14px] bg-[#232323]">
          {q.image_url ? (
            <img src={q.image_url} alt="" className="size-full object-cover" loading="lazy" />
          ) : null}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14.5px] font-bold">{q.name}</p>
          <p className="truncate text-[12.5px] text-[#8C8C8C]">
            {[q.brand, q.volume_ml ? `${q.volume_ml}ml` : null].filter(Boolean).join(" · ")}
            {q.confidence === "media" ? " · confira se é esse" : ""}
          </p>
        </div>
        {q.ready ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#7FCF9F]/15 px-2 py-1 text-[11.5px] font-bold text-[#7FCF9F]">
            <PackageCheck className="size-3.5" /> {q.stock > 0 ? `${q.stock} na loja` : "Pronta"}
          </span>
        ) : null}
      </div>
      {f ? (
        <div className="mt-3 grid grid-cols-3 gap-1.5 text-center">
          <Cell
            label="Cliente paga"
            value={brl(f.pix)}
            gold
            sub={f.promo ? `-${Math.round(f.promo)}%` : "Pix"}
          />
          <Cell label="Você paga" value={f.cost != null ? brl(f.cost) : "—"} />
          <Cell
            label="Lucro"
            value={f.profit != null ? brl(f.profit) : "—"}
            sub={f.margin != null ? `${Math.round(f.margin)}%` : undefined}
          />
        </div>
      ) : (
        <p className="mt-3 text-[13px] text-[#8C8C8C]">Sem preço de frasco cadastrado.</p>
      )}
      {q.decants.length ? (
        <p className="mt-2 truncate text-[12.5px] text-[#A9A9A9]">
          Decant:{" "}
          {q.decants
            .map((d) => `${d.ml}ml ${brl(d.pix)}${d.profit != null ? ` (+${brl(d.profit)})` : ""}`)
            .join(" · ")}
        </p>
      ) : null}
      {onInsert ? (
        <button
          type="button"
          onClick={() => onInsert(pitch)}
          className="press mt-3 inline-flex h-9 w-full items-center justify-center rounded-full bg-white/[0.08] text-[13px] font-bold hover:bg-white/[0.12]"
        >
          Responder com o preço
        </button>
      ) : null}
    </article>
  );
}

function Cell({
  label,
  value,
  sub,
  gold,
}: {
  label: string;
  value: string;
  sub?: string;
  gold?: boolean;
}) {
  return (
    <div
      className={cn(
        "min-w-0 rounded-[14px] px-1.5 py-2",
        gold ? "bg-[#FFD599] text-[#15130F]" : "bg-[#232323]",
      )}
    >
      <p
        className={cn(
          "truncate text-[10.5px] font-semibold",
          gold ? "text-[#15130F]/65" : "text-[#8C8C8C]",
        )}
      >
        {label}
      </p>
      <p className="truncate text-[14px] font-bold tabular-nums">{value}</p>
      {sub ? (
        <p
          className={cn(
            "truncate text-[10.5px] font-semibold",
            gold ? "text-[#15130F]/60" : "text-[#8C8C8C]",
          )}
        >
          {sub}
        </p>
      ) : null}
    </div>
  );
}
