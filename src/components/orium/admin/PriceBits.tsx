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
  const [text, setText] = useState(() => (value == null || !Number.isFinite(value) ? "" : value.toFixed(2)));
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

  const shown = text && Number.isFinite(Number(text))
    ? new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(text))
    : "";

  return (
    <div className={cn("min-w-0 space-y-1.5", className)}>
      {label ? (
        <label htmlFor={id} className="block text-xs font-medium text-muted-foreground">
          {label}
        </label>
      ) : null}
      <div className="flex h-12 min-w-0 items-center gap-2 rounded-xl border border-border/70 bg-background px-3 focus-within:border-gold/60">
        <span className="shrink-0 text-sm text-muted-foreground">R$</span>
        <input
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
          className="min-w-0 flex-1 bg-transparent text-base tabular-nums outline-none"
        />
      </div>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
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
    <div className={cn("min-w-0 space-y-1.5", className)}>
      {label ? (
        <label htmlFor={id} className="block text-xs font-medium text-muted-foreground">
          {label}
        </label>
      ) : null}
      <div className="flex h-12 min-w-0 items-center gap-2 rounded-xl border border-border/70 bg-background px-3 focus-within:border-gold/60">
        <input
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
          className="min-w-0 flex-1 bg-transparent text-base tabular-nums outline-none"
        />
        <span className="shrink-0 text-sm text-muted-foreground">%</span>
      </div>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
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
    <div className="min-w-0 space-y-1.5">
      {label ? (
        <label htmlFor={id} className="block text-xs font-medium text-muted-foreground">
          {label}
        </label>
      ) : null}
      <input
        id={id}
        type="text"
        inputMode="numeric"
        value={value == null ? "" : String(value)}
        onChange={(e) => {
          const only = digits(e.target.value);
          onChange(only ? Number(only) : null);
        }}
        className="h-12 w-full min-w-0 rounded-xl border border-border/70 bg-background px-3 text-base tabular-nums outline-none focus:border-gold/60"
      />
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
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
          className="grid size-6 shrink-0 place-items-center rounded-full text-muted-foreground hover:text-foreground"
        >
          <HelpCircle className="size-4" strokeWidth={1.75} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[260px] rounded-2xl p-4 text-sm">
        <p className="mb-1 font-semibold">{title}</p>
        <p className="text-muted-foreground">{children}</p>
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
    <span key={known ? value.toFixed(2) : "none"} className={cn("admin-value-in tabular-nums", className)}>
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
      ? "text-gold"
      : tone === "warning"
        ? "text-warning"
        : tone === "danger"
          ? "text-destructive"
          : tone === "muted"
            ? "text-muted-foreground"
            : "text-foreground";
  return (
    <div className="flex min-w-0 items-start justify-between gap-3">
      <div className="flex min-w-0 items-center gap-1">
        <p className="min-w-0 truncate text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
          {label}
        </p>
        {help}
      </div>
      <div className="min-w-0 text-right">
        <PriceValue
          value={value}
          className={cn(strong ? "text-xl font-semibold" : "text-base font-medium", toneClass)}
        />
        {note ? <p className="mt-0.5 text-xs text-muted-foreground">{note}</p> : null}
      </div>
    </div>
  );
}

/** Seta entre degraus, com a operação aplicada. */
export function LadderArrow({ children }: { children: ReactNode }) {
  return (
    <p className="py-1.5 pl-1 text-xs text-muted-foreground">
      <span aria-hidden>↓</span> {children}
    </p>
  );
}

/** Métrica compacta do resumo (2x2 no celular). */
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
    <div className="min-w-0 rounded-2xl border border-border/60 bg-card p-3">
      <p className="truncate text-[11px] tracking-[0.08em] text-muted-foreground uppercase">{label}</p>
      <p
        className={cn(
          "mt-1 truncate text-base font-semibold tabular-nums",
          tone === "gold" && "text-gold",
          tone === "warning" && "text-warning",
          tone === "danger" && "text-destructive",
        )}
      >
        {value}
      </p>
    </div>
  );
}
