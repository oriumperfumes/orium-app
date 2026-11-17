/**
 * Peças compartilhadas das janelas de Vendas da loja (venda do catálogo,
 * venda do mostruário, detalhe e edição): pagamento, cliente, foto e valor.
 * Mesma linguagem do PanelKit — #1A1A1A, controles #232323, branco = escolhido.
 */
import { useEffect, useState, type ReactNode } from "react";
import { Banknote, CreditCard, Gem, QrCode, Search, UserRound, X } from "lucide-react";
import { Segmented } from "@/components/orium/admin/PanelKit";
import { storeSaleCustomerSearch } from "@/lib/store-sales.functions";
import { cn } from "@/lib/utils";

export const PAYMENTS = [
  { value: "PIX", label: "Pix", icon: <QrCode /> },
  { value: "CARTAO", label: "Cartão", icon: <CreditCard /> },
  { value: "DINHEIRO", label: "Dinheiro", icon: <Banknote /> },
] as const;

export const PAYMENT_LABEL: Record<string, string> = { PIX: "Pix", CARTAO: "Cartão", DINHEIRO: "Dinheiro" };

/** Venda de peça do mostruário da Negociação (a foto vem da rota da Negociação). */
export const isShowcaseImage = (url: string | null | undefined) => !!url && url.includes("/api/public/negociacao-foto");

export const saleUid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

/** Rótulo de seção dentro das janelas de venda. */
export function SectionLabel({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2.5 flex min-w-0 items-center justify-between gap-2">
      <p className="text-[13px] font-semibold text-[#A9A9A9]">{children}</p>
      {right}
    </div>
  );
}

/** Foto do perfume (ou do mostruário) em miniatura arredondada. */
export function SaleThumb({ url, name, size = 56, className }: { url: string | null | undefined; name?: string | null; size?: number; className?: string }) {
  const showcase = isShowcaseImage(url);
  return (
    <span
      className={cn("relative grid shrink-0 place-items-center overflow-hidden rounded-[16px] bg-[#232323] text-[#6F6F6F]", className)}
      style={{ width: size, height: size }}
    >
      {url ? <img src={url} alt={name ?? ""} className={cn("size-full", showcase ? "object-cover" : "object-contain p-1")} loading="lazy" /> : <Gem className="size-5" />}
      {showcase ? (
        <span className="absolute right-1 bottom-1 grid size-4 place-items-center rounded-full bg-[#FFD599] text-[#15130F]" title="Mostruário">
          <Gem className="size-2.5" strokeWidth={2.6} />
        </span>
      ) : null}
    </span>
  );
}

/** Forma de pagamento em pílulas com ícone. */
export function PaymentPicker({ value, onChange }: { value: string | null; onChange: (v: string) => void }) {
  return (
    <Segmented
      full
      value={value}
      onChange={onChange}
      options={PAYMENTS.map((p) => ({
        value: p.value,
        label: (
          <>
            {p.icon}
            {p.label}
          </>
        ),
      }))}
    />
  );
}

/** Valor em reais grande, para "por quanto vendeu". */
export function MoneyInput({
  value,
  onChange,
  placeholder = "0,00",
  autoFocus,
  size = "lg",
  id,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  size?: "lg" | "md";
  id?: string;
}) {
  return (
    <label
      htmlFor={id}
      className={cn(
        "pk-money flex min-w-0 cursor-text items-baseline gap-2 rounded-[20px] bg-[#232323] px-5 transition-colors duration-200 focus-within:bg-[#2A2A2A] hover:bg-[#262626]",
        size === "lg" ? "py-4" : "py-3",
      )}
    >
      <span className={cn("font-semibold text-[#8C8C8C]", size === "lg" ? "text-[20px]" : "text-[15px]")}>R$</span>
      <input
        id={id}
        inputMode="decimal"
        autoFocus={autoFocus}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value.replace(/[^\d.,]/g, ""))}
        className={cn(
          "pk-field min-w-0 flex-1 bg-transparent font-bold tracking-[-0.03em] text-white tabular-nums outline-none placeholder:text-[#4A4A4A]",
          size === "lg" ? "text-[36px] leading-none" : "text-[22px] leading-none",
        )}
      />
    </label>
  );
}

/** "1.234,56" / "1234.5" → número (ou null). */
export function parseMoney(v: string): number | null {
  const s = v.trim();
  if (!s) return null;
  const normalized = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

/** Cliente opcional: busca no CRM por nome ou WhatsApp. */
export function CustomerField({
  value,
  onChange,
}: {
  value: { id: string | null; name: string | null };
  onChange: (c: { id: string | null; name: string | null }) => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Array<{ id: string; name: string | null; phone: string | null }>>([]);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setResults([]);
      return;
    }
    let alive = true;
    const t = setTimeout(() => {
      void storeSaleCustomerSearch({ data: { q: term } })
        .then((r) => alive && setResults(r))
        .catch(() => undefined);
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q]);

  if (value.id || value.name) {
    return (
      <div className="ui-pop flex min-w-0 items-center gap-3 rounded-[18px] bg-[#232323] p-2.5 pr-2">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[#FFD599] text-[15px] font-bold text-[#15130F]">
          {(value.name ?? "?").trim().charAt(0).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold">{value.name ?? "Cliente"}</span>
          <span className="block text-[12.5px] text-[#8C8C8C]">{value.id ? "Ficha do CRM" : "Mencionado na venda"}</span>
        </span>
        <button
          type="button"
          aria-label="Tirar cliente"
          onClick={() => onChange({ id: null, name: null })}
          className="press grid size-9 place-items-center rounded-full bg-[#2E2E2E] text-[#D4D4D4] hover:bg-[#383838]"
        >
          <X className="size-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="min-w-0">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-4 size-[18px] -translate-y-1/2 text-[#6F6F6F]" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Nome ou WhatsApp (opcional)"
          className="pk-field h-12 w-full min-w-0 rounded-[16px] bg-[#232323] pr-4 pl-11 text-[16px] text-white outline-none transition-colors duration-200 placeholder:text-[#6F6F6F] hover:bg-[#262626] focus:bg-[#2A2A2A]"
        />
      </div>
      {results.length > 0 ? (
        <div className="ui-pop mt-2 overflow-hidden rounded-[18px] bg-[#1F1F1F] p-1">
          {results.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                onChange({ id: c.id, name: c.name });
                setQ("");
                setResults([]);
              }}
              className="press flex w-full min-w-0 items-center gap-3 rounded-[14px] p-2.5 text-left hover:bg-[#2A2A2A]"
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[#2E2E2E] text-[#D4D4D4]">
                <UserRound className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14.5px] font-semibold">{c.name ?? "Sem nome"}</span>
                {c.phone ? <span className="block truncate text-[12.5px] text-[#8C8C8C]">{c.phone}</span> : null}
              </span>
            </button>
          ))}
        </div>
      ) : q.trim().length >= 2 ? (
        <button
          type="button"
          onClick={() => {
            onChange({ id: null, name: q.trim() });
            setQ("");
          }}
          className="press mt-2 inline-flex h-9 items-center gap-1.5 rounded-full bg-[#1F1F1F] px-3.5 text-[13px] font-semibold text-[#D4D4D4] hover:bg-[#2A2A2A]"
        >
          Usar “{q.trim()}” sem ficha
        </button>
      ) : null}
    </div>
  );
}

/** ISO → valor aceito por <input type="datetime-local"> no fuso local. */
export const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
