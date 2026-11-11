import { useEffect, useState } from "react";
import { AlertTriangle, ArrowLeftRight, ChevronDown, TrendingDown } from "lucide-react";
import { brl } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ItemThumb } from "@/components/orium/admin/OrderItems";
import { AdminMore, AdminStatus, type AdminAction } from "@/components/orium/admin/AdminUI";

/* ------------------------------------------------------------------ *
 * Linha visual da lista de reposição.
 *
 * Três composições, decididas pelo espaço REAL do container (não pela
 * largura da janela):
 *   - até 560px  → card vertical (celular);
 *   - 560–860px  → dois níveis: produto em cima, números embaixo;
 *   - 860px+     → uma única linha larga com colunas previsíveis.
 *
 * Só apresentação — quem decide as regras é a tela.
 * ------------------------------------------------------------------ */

export type RestockRow = {
  id: string;
  name: string;
  brand: string | null;
  image: string | null;
  supplier: string;
  supplierId: string | null;
  qty: number;
  unit: number;
  fee: number;
  status: string;
  manual: boolean;
  stock: number | null;
  unavailable: boolean;
  /** economia possível trocando de fornecedor */
  cheaper: { supplier: string; supplierId: string; unit: number; saving: number } | null;
  sources: Array<{ label: string; qty: number }>;
  duplicated: boolean;
};

/** Bloco numérico: rótulo pequeno em cima, valor inteiro embaixo, nunca quebrado. */
function NumBlock({
  label,
  children,
  className,
  align = "right",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
  align?: "right" | "left";
}) {
  return (
    <div className={cn("shrink-0", align === "right" ? "text-right" : "text-left", className)}>
      <p className="text-[10px] leading-4 tracking-[0.08em] text-muted-foreground uppercase">{label}</p>
      <div className="text-sm whitespace-nowrap tabular-nums">{children}</div>
    </div>
  );
}

export function RestockItemRow({
  row,
  onQty,
  onSwap,
  actions,
}: {
  row: RestockRow;
  onQty: (qty: number) => void;
  onSwap: () => void;
  actions: AdminAction[];
}) {
  const [draft, setDraft] = useState(String(row.qty));
  const [openSources, setOpenSources] = useState(false);
  useEffect(() => setDraft(String(row.qty)), [row.qty]);

  const subtotal = row.qty * row.unit;
  const sourceLabel =
    row.sources.length === 0
      ? "Manual"
      : row.sources.length === 1
        ? row.sources[0]!.label
        : `${row.sources.length} pedidos`;

  return (
    <div className="admin-row-in @container/row min-w-0 py-4">
      <div className="grid min-w-0 gap-3 @[560px]/row:gap-4 @[860px]/row:grid-cols-[minmax(0,1fr)_auto] @[860px]/row:items-center">
        {/* identidade do produto */}
        <div className="flex min-w-0 items-start gap-3">
          <ItemThumb src={row.image} alt={row.name} size={56} />
          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 text-sm leading-5 font-medium @[560px]/row:text-[15px]">{row.name}</p>
            {row.brand ? <p className="mt-0.5 truncate text-xs text-muted-foreground">{row.brand}</p> : null}

            <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={onSwap}
                className="press inline-flex max-w-full items-center gap-1 rounded-full border border-border/60 bg-muted/30 px-2 py-0.5 text-[11px] text-muted-foreground"
                title="Trocar fornecedor"
              >
                <span className="truncate">{row.supplier}</span>
                <ArrowLeftRight className="size-3 shrink-0" strokeWidth={1.75} />
              </button>

              <button
                type="button"
                onClick={() => row.sources.length > 1 && setOpenSources((v) => !v)}
                className={cn(
                  "max-w-full truncate text-[11px] text-muted-foreground",
                  row.sources.length > 1 && "press underline-offset-2 hover:underline",
                )}
              >
                {sourceLabel}
              </button>

              {row.manual ? (
                <span
                  className="rounded-full border border-border/60 px-2 py-0.5 text-[10px] whitespace-nowrap text-muted-foreground"
                  title="Fornecedor e custo escolhidos à mão"
                >
                  manual
                </span>
              ) : null}

              {row.status !== "a comprar" ? <AdminStatus status={row.status} /> : null}

              {row.unavailable ? (
                <button
                  type="button"
                  onClick={onSwap}
                  className="press inline-flex items-center gap-1 rounded-full border border-destructive/25 bg-destructive/5 px-2 py-0.5 text-[10px] whitespace-nowrap text-destructive"
                  title={`Indisponível em ${row.supplier}`}
                >
                  <AlertTriangle className="size-3 shrink-0" strokeWidth={1.75} /> indisponível
                </button>
              ) : row.cheaper ? (
                <button
                  type="button"
                  onClick={onSwap}
                  className="press inline-flex items-center gap-1 rounded-full border border-gold/25 bg-gold/5 px-2 py-0.5 text-[10px] whitespace-nowrap text-gold"
                  title={`${row.cheaper.supplier} tem por ${brl(row.cheaper.unit)} — economia de ${brl(row.cheaper.saving)}`}
                >
                  <TrendingDown className="size-3 shrink-0" strokeWidth={1.75} />
                  economize {brl(row.cheaper.saving)}
                </button>
              ) : row.duplicated ? (
                <span
                  className="rounded-full border border-border/60 px-2 py-0.5 text-[10px] whitespace-nowrap text-muted-foreground"
                  title="Este perfume também está na lista em outro fornecedor"
                >
                  outro fornecedor
                </span>
              ) : null}
            </div>
          </div>
        </div>

        {/* números + ações: largura reservada, nada colide */}
        <div className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-3 @[860px]/row:flex-nowrap @[860px]/row:justify-end">
          <div className="shrink-0">
            <p className="text-[10px] leading-4 tracking-[0.08em] text-muted-foreground uppercase">Qtd</p>
            <div className="mt-0.5 flex items-center gap-1">
              <button
                type="button"
                aria-label="Menos uma unidade"
                onClick={() => onQty(Math.max(1, row.qty - 1))}
                className="press grid size-9 place-items-center rounded-full border border-border/60 text-lg leading-none"
              >
                −
              </button>
              <input
                value={draft}
                inputMode="numeric"
                aria-label="Quantidade"
                onChange={(e) => setDraft(e.target.value.replace(/\D/g, ""))}
                onBlur={() => {
                  const n = Math.max(1, Number(draft) || 1);
                  setDraft(String(n));
                  if (n !== row.qty) onQty(n);
                }}
                className="h-9 w-12 rounded-xl border border-border/60 bg-transparent text-center text-base tabular-nums"
              />
              <button
                type="button"
                aria-label="Mais uma unidade"
                onClick={() => onQty(row.qty + 1)}
                className="press grid size-9 place-items-center rounded-full border border-border/60 text-lg leading-none"
              >
                +
              </button>
            </div>
          </div>

          <NumBlock label="Custo" align="left" className="min-w-[104px] @[860px]/row:text-right">
            <span className="text-muted-foreground">
              {brl(row.unit)} <span className="text-[11px]">/un.</span>
            </span>
            {row.fee > 0 ? (
              <p className="text-[10px] whitespace-nowrap text-muted-foreground">inclui taxa {brl(row.fee)}</p>
            ) : null}
          </NumBlock>

          <NumBlock label="Subtotal" align="left" className="min-w-[104px] @[860px]/row:text-right">
            <span key={subtotal} className="admin-value-in font-semibold">
              {brl(subtotal)}
            </span>
          </NumBlock>

          <div className="ml-auto shrink-0 @[860px]/row:ml-2">
            <AdminMore actions={actions} label={row.name} />
          </div>
        </div>
      </div>

      {row.stock != null ? (
        <p className="mt-2 text-[11px] text-muted-foreground tabular-nums">Estoque atual {row.stock}</p>
      ) : null}

      {openSources && row.sources.length > 1 ? (
        <ul className="mt-2 space-y-0.5">
          {row.sources.map((s, i) => (
            <li key={i} className="text-xs break-words text-muted-foreground">
              {s.qty} {s.qty === 1 ? "unidade" : "unidades"} — {s.label}
            </li>
          ))}
        </ul>
      ) : null}

      
      {row.sources.length > 1 ? (
        <button
          type="button"
          onClick={() => setOpenSources((v) => !v)}
          className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground"
        >
          <ChevronDown className={cn("size-3.5 transition-transform duration-150", openSources && "rotate-180")} />
          {openSources ? "Ocultar pedidos" : "Ver pedidos"}
        </button>
      ) : null}
    </div>
  );
}
