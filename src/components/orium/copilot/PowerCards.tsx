/**
 * Prévias e resultados das ações novas do Copilot: peça na Negociação,
 * perfume novo no catálogo, edição de produto, edição e pagamento de pedido.
 */
import { Link } from "@tanstack/react-router";
import { AlertTriangle, ArrowUpRight, Droplet, Gem, Minus, Plus, RefreshCw } from "lucide-react";
import { brl } from "@/lib/format";
import { cn } from "@/lib/utils";

export const POWER_DONE_TITLE: Record<string, string> = {
  negotiation_create: "Peça na Negociação",
  catalog_create: "Perfume no catálogo",
  product_update: "Produto atualizado",
  order_edit: "Pedido atualizado",
  order_payment: "Pagamento atualizado",
};

const GENDER: Record<string, string> = { MASCULINO: "Masculino", FEMININO: "Feminino", UNISSEX: "Unissex" };
const SALE: Record<string, string> = { FULL: "Só frasco", DECANT: "Só decant", BOTH: "Frasco e decant" };
const VIS: Record<string, string> = { ATIVO: "À venda", OCULTO: "Oculto", INDISPONIVEL: "Indisponível" };
const STATUS: Record<string, string> = { AVAILABLE: "Disponível", NEGOTIATING: "Negociando", HIDDEN: "Oculta" };

function Chips({ items }: { items: string[] }) {
  if (!items?.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((t) => (
        <span key={t} className="rounded-full bg-[#232323] px-2.5 py-1 text-[12px] font-semibold text-[#D4D4D4]">
          {t}
        </span>
      ))}
    </div>
  );
}

function Pyramid({ notes }: { notes?: { top?: string[]; heart?: string[]; base?: string[] } }) {
  const rows = [
    ["Saída", notes?.top ?? []],
    ["Coração", notes?.heart ?? []],
    ["Fundo", notes?.base ?? []],
  ] as const;
  if (!rows.some(([, l]) => l.length)) return null;
  return (
    <div className="space-y-1.5 rounded-[16px] bg-[#1F1F1F] p-3">
      {rows.map(([label, list]) =>
        list.length ? (
          <p key={label} className="flex min-w-0 gap-2 text-[13px] leading-snug">
            <span className="w-[62px] shrink-0 font-semibold text-[#8C8C8C]">{label}</span>
            <span className="min-w-0 text-[#E6E6E6]">{list.slice(0, 6).join(", ")}</span>
          </p>
        ) : null,
      )}
    </div>
  );
}

function Hero({ image, eyebrow, title, sub, cover }: { image?: string | null; eyebrow?: React.ReactNode; title: string; sub?: React.ReactNode; cover?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-3.5">
      <span className={cn("grid size-[76px] shrink-0 place-items-center overflow-hidden rounded-[18px]", image ? (cover ? "bg-[#232323]" : "bg-white") : "bg-[#232323] text-[#6F6F6F]")}>
        {image ? <img src={image} alt="" className={cn("size-full", cover ? "object-cover" : "object-contain p-1.5")} /> : <Gem className="size-6" />}
      </span>
      <span className="min-w-0 flex-1">
        {eyebrow ? <span className="block truncate text-[12.5px] text-[#8C8C8C]">{eyebrow}</span> : null}
        <span className="block text-[16px] leading-snug font-bold tracking-[-0.01em]">{title}</span>
        {sub ? <span className="mt-0.5 block text-[12.5px] text-[#A9A9A9]">{sub}</span> : null}
      </span>
    </div>
  );
}

function Line({ label, value, strong }: { label: string; value: React.ReactNode; strong?: boolean }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-3 text-[13.5px]">
      <span className="shrink-0 text-[#8C8C8C]">{label}</span>
      <span className={cn("min-w-0 text-right break-words", strong && "font-bold text-white")}>{value}</span>
    </div>
  );
}

function Description({ text }: { text?: string | null }) {
  if (!text) return null;
  return <p className="line-clamp-4 text-[13.5px] leading-relaxed text-[#BABABA]">{text}</p>;
}

/** Prévia (antes de confirmar). Devolve null se a ferramenta não é nova. */
export function PowerPreview({ tool, p }: { tool: string; p: any }) {
  switch (tool) {
    case "negotiation_create":
      return (
        <div className="space-y-3">
          <Hero
            image={p.image}
            cover
            eyebrow={p.brand ?? "Mostruário"}
            title={p.name}
            sub={
              <span className="inline-flex items-center gap-1 font-semibold text-[#FFD599]">
                <Droplet className="size-3" />
                {p.remaining_ml != null ? `${p.remaining_ml}${p.volume_ml ? ` de ${p.volume_ml}` : ""} ml` : p.volume_ml ? `${p.volume_ml} ml` : ""} · {p.condition}
              </span>
            }
          />
          <Chips items={p.accords ?? []} />
          <Pyramid notes={p.notes} />
          <Description text={p.description} />
          <Line label="Situação" value={STATUS[p.status] ?? p.status} />
        </div>
      );
    case "catalog_create":
      return (
        <div className="space-y-3">
          {p.duplicate ? (
            <p className="flex items-start gap-2 rounded-[14px] bg-[#FFD599]/12 px-3 py-2.5 text-[13px] font-semibold text-[#FFD599]">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" /> Já existe “{p.duplicate.name}” de {p.duplicate.brand} no catálogo. Confirmar cria outro.
            </p>
          ) : null}
          <Hero
            image={p.image}
            eyebrow={p.brand}
            title={p.name}
            sub={[p.concentration, p.volume_ml ? `${p.volume_ml} ml` : null, GENDER[p.gender] ?? null].filter(Boolean).join(" · ")}
          />
          <Chips items={p.accords ?? []} />
          <Pyramid notes={p.notes} />
          <Description text={p.description} />
          <div className="space-y-1.5 border-t border-white/[0.06] pt-3">
            <Line label="Preço do frasco" strong value={p.price_on_request ? "Sob consulta" : p.sale_mode === "DECANT" ? "Só decant" : p.retail_price != null ? `${brl(p.retail_price)}${p.auto_price ? " (regra da loja)" : ""}` : "—"} />
            {p.cost != null ? <Line label="Custo" value={brl(p.cost)} /> : null}
            <Line label="Venda" value={SALE[p.sale_mode] ?? p.sale_mode} />
            <Line label="Situação" value={VIS[p.visibility] ?? p.visibility} />
            {p.stock ? <Line label="Estoque" value={`${p.stock} un.`} /> : null}
          </div>
        </div>
      );
    case "product_update":
      return (
        <div className="space-y-3">
          <Hero image={p.product?.image} eyebrow={p.product?.brand} title={p.product?.name ?? "Produto"} />
          <div className="space-y-2 rounded-[16px] bg-[#1F1F1F] p-3">
            {(p.changes ?? []).map((c: any, i: number) => (
              <div key={i} className="min-w-0 text-[13.5px]">
                <span className="font-semibold text-[#8C8C8C]">{c.label}</span>
                <p className="min-w-0 break-words">
                  <span className="text-[#8C8C8C]">{c.from}</span> <span className="text-[#FFD599]">→</span> <span className="font-semibold">{c.to}</span>
                </p>
              </div>
            ))}
          </div>
        </div>
      );
    case "order_edit":
      return (
        <div className="space-y-3">
          <p className="text-[15px] font-bold">
            Pedido {p.order_number} <span className="font-normal text-[#8C8C8C]">· {p.customer}</span>
          </p>
          {(p.added ?? []).length || (p.removed ?? []).length || (p.changed ?? []).length ? (
            <div className="space-y-1.5 rounded-[16px] bg-[#1F1F1F] p-3 text-[13.5px]">
              {(p.added ?? []).map((t: string) => (
                <p key={`a${t}`} className="flex gap-2">
                  <Plus className="mt-0.5 size-3.5 shrink-0 text-[#7FCF9F]" /> {t}
                </p>
              ))}
              {(p.removed ?? []).map((t: string) => (
                <p key={`r${t}`} className="flex gap-2 text-[#BABABA]">
                  <Minus className="mt-0.5 size-3.5 shrink-0 text-[#FF9A8A]" /> {t}
                </p>
              ))}
              {(p.changed ?? []).map((t: string) => (
                <p key={`c${t}`} className="flex gap-2">
                  <RefreshCw className="mt-0.5 size-3.5 shrink-0 text-[#FFD599]" /> {t}
                </p>
              ))}
            </div>
          ) : null}
          {(p.fields ?? []).map((f: any, i: number) => (
            <Line key={i} label={f.label} value={<><span className="text-[#8C8C8C]">{f.from}</span> <span className="text-[#FFD599]">→</span> {f.to}</>} />
          ))}
          {p.delivery ? <Line label="Entrega" value={`${new Date(`${p.delivery.date}T12:00`).toLocaleDateString("pt-BR")}${p.delivery.time ? ` às ${p.delivery.time}` : ""}`} /> : null}
          <Line label="Total" strong value={<><span className="font-normal text-[#8C8C8C]">{brl(p.before)}</span> <span className="text-[#FFD599]">→</span> {brl(p.after)}</>} />
          {(p.warnings ?? []).map((w: string) => (
            <p key={w} className="text-[12.5px] text-[#FFD599]">{w}</p>
          ))}
        </div>
      );
    case "order_payment":
      return (
        <div className="space-y-2">
          <p className="text-[15px] font-bold">
            Pedido {p.order_number} <span className="font-normal text-[#8C8C8C]">· {p.customer}</span>
          </p>
          <Line label="Pago" strong value={<><span className="font-normal text-[#8C8C8C]">{brl(p.before)}</span> <span className="text-[#FFD599]">→</span> {brl(p.after)}</>} />
          <Line label="Total do pedido" value={brl(p.total)} />
          <Line label="Falta receber" value={brl(Math.max(0, p.total - p.after))} />
        </div>
      );
    default:
      return null;
  }
}

/** Resultado (depois de confirmar). Devolve null se a ferramenta não é nova. */
export function PowerOutcome({ tool, preview, r }: { tool: string; preview: any; r: any }) {
  switch (tool) {
    case "negotiation_create":
      return (
        <div className="space-y-2.5">
          <p className="text-[14px]">“{preview?.name}” já está na vitrine da Negociação.</p>
          <Link to="/admin/negociacao" className="press inline-flex h-9 items-center gap-1.5 rounded-full bg-[#232323] px-3.5 text-[13px] font-semibold hover:bg-[#2E2E2E]">
            Abrir Negociação <ArrowUpRight className="size-3.5" />
          </Link>
        </div>
      );
    case "catalog_create":
      return (
        <div className="space-y-2.5">
          <p className="text-[14px]">“{preview?.name}” entrou no catálogo com a ficha olfativa.</p>
          <div className="flex flex-wrap gap-2">
            {r?.id ? (
              <Link to="/admin/produtos/$id" params={{ id: r.id }} className="press inline-flex h-9 items-center gap-1.5 rounded-full bg-[#232323] px-3.5 text-[13px] font-semibold hover:bg-[#2E2E2E]">
                Ver no Admin <ArrowUpRight className="size-3.5" />
              </Link>
            ) : null}
            {r?.slug ? (
              <a href={`/perfume/${r.slug}`} target="_blank" rel="noreferrer" className="press inline-flex h-9 items-center gap-1.5 rounded-full bg-[#232323] px-3.5 text-[13px] font-semibold hover:bg-[#2E2E2E]">
                Ver na loja <ArrowUpRight className="size-3.5" />
              </a>
            ) : null}
          </div>
        </div>
      );
    case "product_update":
      return <p className="text-[14px]">{preview?.product?.name}: {(preview?.changes ?? []).map((c: any) => c.label.toLowerCase()).join(", ")} atualizado.</p>;
    case "order_edit":
      return (
        <p className="text-[14px]">
          Pedido {preview?.order_number} salvo. Total {brl(r?.total ?? preview?.after)}.{(r?.warnings ?? []).length ? ` ${r.warnings.join(" ")}` : ""}
        </p>
      );
    case "order_payment":
      return <p className="text-[14px]">Pedido {preview?.order_number}: {brl(preview?.after)} recebido de {brl(preview?.total)}.</p>;
    default:
      return null;
  }
}

/** Ficha encontrada na internet (resultado de research_perfume). */
export function ResearchCard({ o }: { o: any }) {
  if (!o?.found) return null;
  const host = (u: string) => {
    try {
      return new URL(u).hostname.replace(/^www\./, "");
    } catch {
      return u;
    }
  };
  return (
    <div className="copilot-card cp-card copilot-msg-in w-full max-w-md space-y-3 rounded-[24px] p-4">
      <div className="min-w-0">
        <p className="text-[12.5px] text-[#8C8C8C]">{o.brand ?? "Marca não confirmada"}</p>
        <p className="text-[17px] leading-snug font-bold tracking-[-0.015em]">{o.name}</p>
        <p className="mt-0.5 text-[12.5px] text-[#A9A9A9]">
          {[o.concentration, o.volume_ml ? `${o.volume_ml} ml` : null, GENDER[o.gender] ?? null, o.year, o.perfumer].filter(Boolean).join(" · ")}
        </p>
      </div>
      <Chips items={(o.accords ?? []).slice(0, 6).map((a: any) => a.name)} />
      <Pyramid notes={{ top: o.top, heart: o.heart, base: o.base }} />
      <Description text={o.description} />
      {o.sources?.length ? (
        <p className="truncate text-[11.5px] text-[#6F6F6F]">Fontes: {o.sources.map(host).join(" · ")}</p>
      ) : null}
    </div>
  );
}
