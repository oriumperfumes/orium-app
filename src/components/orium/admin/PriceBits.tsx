import { useEffect, useState, type ReactNode } from "react";
import { HelpCircle } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { brl } from "@/lib/format";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ *
 * Peças da Central de Preços. Só apresentação: nenhuma regra de
 * cálculo vive aqui (ver pricing.server.ts / commercial-price.ts /
 * payment-rule.ts). Campos de dinheiro e porcentagem falam a língua
 * do usuário: "R$ 299,90" e "5%", com teclado numérico no celular.
 * ------------------------------------------------------------------ */

const digits = (s: string) => s.replace(/\D/g, "");

/** Campo de dinheiro: mostra R$ 299,90 e devolve 299.9. */
export function MoneyInput({
  id,
  label,
  hint,
  value,
  onChange,
  className,
}: {
  id: string;
  label?: string;
  hint?: ReactNode;
  /** valor em reais, ou null quando vazio */
  value: number | null;
  onChange: (v: number | null) => void;
  className?: string;
}) {
  const [text, setText] = useState(() =>
    value == null || !Number.isFinite(value) ? "" : value.toFixed(2),
  );
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (focused) return;
    setText(value == null || !Number.isFinite(value) ? "" : value.toFixed(2));
  }, [value, focused]);

  const commit = (raw: string) => {
    const only = digits(raw);
    if (!only) {
      setText("");
      onChange(null);
      return;
    }
    const cents = Number(only.slice(-14)) / 100;
    setText(cents.toFixed(2));
    onChange(Number(cents.toFixed(2)));
  };

  const shown =
    text && Number.isFinite(Number(text))
      ? new Intl.NumberFormat("pt-BR", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }).format(Number(text))
      : "";

  return (
    <div className={cn("min-w-0 space-y-2", className)}>
      {label ? (
        <label htmlFor={id} className="block text-[14px] font-semibold text-[#D4D4D4]">
          {label}
        </label>
      ) : null}
      <div className="flex h-[52px] min-w-0 items-center gap-2 rounded-[18px] bg-[#232323] px-4 focus-within:ring-2 focus-within:ring-[#FFD599]/50">
        <span className="shrink-0 text-[15px] font-semibold text-[#8C8C8C]">R$</span>
        <input
          data-slot="input-group-control"
          id={id}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={shown}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            commit(text);
          }}
          onChange={(e) => commit(e.target.value)}
          placeholder="0,00"
          className="min-w-0 flex-1 bg-transparent text-[17px] font-semibold tabular-nums text-white outline-none placeholder:text-[#6F6F6F]"
        />
      </div>
      {hint ? <div className="text-[13px] leading-snug text-[#8C8C8C]">{hint}</div> : null}
    </div>
  );
}

/** Campo de porcentagem: o "%" é do campo, não do que se digita. */
export function PercentInput({
  id,
  label,
  hint,
  value,
  onChange,
  className,
}: {
  id: string;
  label?: string;
  hint?: ReactNode;
  value: number | null;
  onChange: (v: number | null) => void;
  className?: string;
}) {
  const [text, setText] = useState(() => (value == null ? "" : String(value)));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (focused) return;
    setText(value == null ? "" : String(value));
  }, [value, focused]);

  return (
    <div className={cn("min-w-0 space-y-2", className)}>
      {label ? (
        <label htmlFor={id} className="block text-[14px] font-semibold text-[#D4D4D4]">
          {label}
        </label>
      ) : null}
      <div className="flex h-[52px] min-w-0 items-center gap-2 rounded-[18px] bg-[#232323] px-4 focus-within:ring-2 focus-within:ring-[#FFD599]/50">
        <input
          data-slot="input-group-control"
          id={id}
          type="text"
          inputMode="decimal"
          value={text}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(e) => {
            const raw = e.target.value.replace(/[^\d,.]/g, "").replace(",", ".");
            setText(raw);
            const n = Number(raw);
            onChange(raw === "" || Number.isNaN(n) ? null : n);
          }}
          placeholder="0"
          className="min-w-0 flex-1 bg-transparent text-[17px] font-semibold tabular-nums text-white outline-none placeholder:text-[#6F6F6F]"
        />
        <span className="shrink-0 text-[15px] font-semibold text-[#8C8C8C]">%</span>
      </div>
      {hint ? <div className="text-[13px] leading-snug text-[#8C8C8C]">{hint}</div> : null}
    </div>
  );
}

/** Campo de número inteiro (unidades). */
export function CountInput({
  id,
  label,
  value,
  onChange,
  hint,
}: {
  id: string;
  label?: string;
  value: number | null;
  onChange: (v: number | null) => void;
  hint?: ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-2">
      {label ? (
        <label htmlFor={id} className="block text-[14px] font-semibold text-[#D4D4D4]">
          {label}
        </label>
      ) : null}
      <input
        data-slot="input-group-control"
        id={id}
        type="text"
        inputMode="numeric"
        value={value == null ? "" : String(value)}
        onChange={(e) => {
          const only = digits(e.target.value);
          onChange(only ? Number(only) : null);
        }}
        className="h-[52px] w-full min-w-0 rounded-[18px] bg-[#232323] px-4 text-[17px] font-semibold tabular-nums text-white outline-none focus:ring-2 focus:ring-[#FFD599]/50"
      />
      {hint ? <div className="text-[13px] leading-snug text-[#8C8C8C]">{hint}</div> : null}
    </div>
  );
}

/** Explicação curta de um conceito, só quando o usuário pede. */
export function HelpTip({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Sobre ${title}`}
          className="grid size-7 shrink-0 place-items-center rounded-full text-[#8C8C8C] transition-colors hover:bg-white/[0.06] hover:text-white"
        >
          <HelpCircle className="size-4" strokeWidth={1.75} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[280px] rounded-[22px] border-0 bg-[#232323] p-4 text-[14px] text-white"
      >
        <p className="mb-1 font-semibold">{title}</p>
        <p className="leading-snug text-[#A9A9A9]">{children}</p>
      </PopoverContent>
    </Popover>
  );
}

/** Valor de preço com crossfade curto quando muda (sem recarregar a tela). */
export function PriceValue({
  value,
  className,
  placeholder = "—",
}: {
  value: number | null | undefined;
  className?: string;
  placeholder?: string;
}) {
  const known = typeof value === "number" && Number.isFinite(value);
  return (
    <span
      key={known ? value.toFixed(2) : "none"}
      className={cn("admin-value-in tabular-nums", className)}
    >
      {known ? brl(value) : placeholder}
    </span>
  );
}

/** Linha de degrau do preço: rótulo, valor e nota curta. */
export function LadderStep({
  label,
  value,
  note,
  tone = "default",
  strong,
  help,
}: {
  label: string;
  value: number | null | undefined;
  note?: ReactNode;
  tone?: "default" | "gold" | "warning" | "danger" | "muted";
  strong?: boolean;
  help?: ReactNode;
}) {
  const toneClass =
    tone === "gold"
      ? "text-[#FFD599]"
      : tone === "warning"
        ? "text-[#F5C26B]"
        : tone === "danger"
          ? "text-[#FF9A8A]"
          : tone === "muted"
            ? "text-[#8C8C8C]"
            : "text-white";
  return (
    <div
      className={cn(
        "flex min-w-0 items-center justify-between gap-3 rounded-[20px] px-4 py-3",
        strong ? "bg-[#2A2620]" : "bg-[#232323]",
      )}
    >
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-1">
          <p className="min-w-0 truncate text-[14px] font-semibold text-[#D4D4D4]">{label}</p>
          {help}
        </div>
        {note ? <p className="mt-0.5 truncate text-[12.5px] text-[#8C8C8C]">{note}</p> : null}
      </div>
      <PriceValue
        value={value}
        className={cn(
          "shrink-0 font-bold tracking-[-0.02em]",
          strong ? "text-[24px]" : "text-[17px]",
          toneClass,
        )}
      />
    </div>
  );
}

/** Ligação entre degraus, com a operação aplicada. */
export function LadderArrow({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-3 py-1.5 pl-6">
      <span aria-hidden className="h-5 w-px shrink-0 bg-white/15" />
      <p className="min-w-0 text-[12.5px] leading-snug text-[#8C8C8C]">{children}</p>
    </div>
  );
}

/** Métrica compacta (bloco #232323). */
export function MiniMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: ReactNode;
  tone?: "gold" | "warning" | "danger";
}) {
  return (
    <div className="min-w-0 rounded-[20px] bg-[#232323] p-4">
      <p className="truncate text-[13px] text-[#A9A9A9]">{label}</p>
      <p
        className={cn(
          "mt-1.5 truncate text-[20px] leading-tight font-bold tracking-[-0.02em] tabular-nums",
          tone === "gold" && "text-[#FFD599]",
          tone === "warning" && "text-[#F5C26B]",
          tone === "danger" && "text-[#FF9A8A]",
        )}
      >
        {value}
      </p>
    </div>
  );
}
