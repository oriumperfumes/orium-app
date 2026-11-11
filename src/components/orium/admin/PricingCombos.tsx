import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Minus, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { dateBR } from "@/lib/format";
import { cn } from "@/lib/utils";
import { saoPauloDateTimeToIso } from "@/lib/promotions";
import { DECANT_SIZES, decantPrice, type DecantMl } from "@/lib/decants";
import {
  comboBrl,
  comboPriceLine,
  comboSaving,
  comboSizesLabel,
  comboSubtitle,
  comboTitle,
  comboUnitPrice,
  isComboRunning,
} from "@/lib/decant-combos";
import { useDecantSettings } from "@/lib/use-decant-settings";
import { AdminBlock, AdminCard, AdminConfirm, AdminEmpty, AdminMore, AdminStatus } from "@/components/orium/admin/AdminUI";
import { MiniMetric, MoneyInput } from "@/components/orium/admin/PriceBits";

/* ------------------------------------------------------------------ *
 * Combos de decants — "leve 3 por R$ 100". O cliente vê o cartão dourado
 * na Home, o lembrete no botão do decant e o progresso na Sacola; o preço
 * é sempre recalculado no servidor. Aqui você liga, desliga e cria outros.
 * ------------------------------------------------------------------ */

type ComboRow = {
  id: string;
  name: string;
  quantity: number;
  combo_price: number | string;
  decant_sizes: number[] | null;
  starts_at: string | null;
  ends_at: string | null;
  active: boolean;
  orders_count: number | null;
  sales_total: number | string | null;
  discount_total: number | string | null;
};

// a tabela é nova e ainda não está nos tipos gerados do banco
const table = () =>
  (supabase as unknown as {
    from: (t: string) => {
      select: (c: string) => { order: (k: string, o: { ascending: boolean }) => Promise<{ data: unknown }> };
      insert: (v: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
      update: (v: Record<string, unknown>) => { eq: (k: string, v: string) => Promise<{ error: { message: string } | null }> };
      delete: () => { eq: (k: string, v: string) => Promise<{ error: { message: string } | null }> };
    };
  }).from("decant_combos");

const statusOf = (row: Pick<ComboRow, "active" | "starts_at" | "ends_at">) => {
  const now = Date.now();
  if (!row.active) return "pausada";
  if (row.starts_at && new Date(row.starts_at).getTime() > now) return "agendada";
  if (row.ends_at && new Date(row.ends_at).getTime() <= now) return "encerrada";
  return "ativa";
};

/** ISO → valor de <input type="datetime-local"> no relógio de São Paulo. */
function isoToSaoPauloInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
  return parts.replace(" ", "T");
}

/** Menor preço normal entre os tamanhos do combo — a referência honesta da economia. */
function useRegularUnit(sizes: number[]) {
  const settings = useDecantSettings();
  if (settings === undefined) return null;
  const list = (sizes.length ? sizes : DECANT_SIZES) as DecantMl[];
  return Math.min(...list.map((ml) => decantPrice(null, settings, ml)));
}

/** Como o cliente vê o combo na Home (versão compacta). */
function ComboPreview({
  name,
  quantity,
  price,
  sizes,
}: {
  name: string;
  quantity: number;
  price: number;
  sizes: number[];
}) {
  const regular = useRegularUnit(sizes);
  const combo = { quantity, combo_price: price, decant_sizes: sizes };
  const saving = regular != null ? comboSaving(combo, regular) : 0;
  return (
    <div className="min-w-0 overflow-hidden rounded-[22px] bg-[#FFD599] p-5 text-[#15130F]">
      <span className="inline-flex items-center gap-2 rounded-full bg-[#15130F] px-3 py-1 text-[12px] font-semibold text-[#FFD599]">
        <span className="size-1.5 rounded-full bg-[#FFD599]" aria-hidden />
        {name.trim() || "Promoção da semana"}
      </span>
      <p className="mt-4 text-[32px] leading-[1] font-bold tracking-[-0.04em]">
        {comboTitle(combo)}
        <br />
        {comboPriceLine(combo)}
      </p>
      <p className="mt-2 text-[14px] leading-snug text-[#15130F]/70">{comboSubtitle(combo)}</p>
      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[14px] tabular-nums">
        <span className="font-bold">{comboBrl(comboUnitPrice(combo))} cada</span>
        {regular != null ? <span className="text-[#15130F]/55 line-through">{comboBrl(regular)} cada</span> : null}
        {saving > 0 ? (
          <span className="rounded-full bg-[#15130F] px-2.5 py-0.5 text-[12px] font-bold text-[#FFD599]">
            Economize {comboBrl(saving)}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function DecantCombosPanel() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<ComboRow | "new" | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-decant-combos"],
    queryFn: async () => ((await table().select("*").order("created_at", { ascending: false })).data ?? []) as ComboRow[],
  });
  const rows = data ?? [];

  const live = rows.find((r) => isComboRunning(r));
  const counts = useMemo(
    () => ({
      ativas: rows.filter((r) => statusOf(r) === "ativa").length,
      agendadas: rows.filter((r) => statusOf(r) === "agendada").length,
      encerradas: rows.filter((r) => ["encerrada", "pausada"].includes(statusOf(r))).length,
    }),
    [rows],
  );

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["admin-decant-combos"] });
    void qc.invalidateQueries({ queryKey: ["decant-combos-active"] });
  };
  const toggle = async (id: string, active: boolean) => {
    const { error } = await table().update({ active }).eq("id", id);
    if (error) toast.error(error.message);
    else toast.success(active ? "Combo ativado." : "Combo pausado.");
    refresh();
  };
  const remove = async (id: string) => {
    const { error } = await table().delete().eq("id", id);
    if (error) toast.error(error.message);
    else toast.success("Combo removido. Os decants voltam ao preço normal.");
    refresh();
  };

  return (
    <div className="min-w-0 space-y-5">
      <div className="grid min-w-0 grid-cols-3 gap-2">
        <MiniMetric label="Ativos" value={counts.ativas} tone="gold" />
        <MiniMetric label="Agendados" value={counts.agendadas} />
        <MiniMetric label="Encerrados" value={counts.encerradas} />
      </div>

      {live ? (
        <div className="min-w-0 space-y-2">
          <p className="text-[13px] font-semibold text-[#A9A9A9]">Assim o cliente vê agora</p>
          <ComboPreview
            name={live.name}
            quantity={live.quantity}
            price={Number(live.combo_price)}
            sizes={live.decant_sizes ?? []}
          />
        </div>
      ) : null}

      <Button className="press h-12 w-full rounded-full sm:w-auto" onClick={() => setEditing("new")}>
        <Plus className="size-4" /> Novo combo
      </Button>

      <AdminBlock title="Combos de decants">
        {isLoading ? (
          <AdminEmpty>Carregando…</AdminEmpty>
        ) : rows.length === 0 ? (
          <AdminEmpty>Nenhum combo criado. Crie um, por exemplo, “Leve 3 por R$ 100”.</AdminEmpty>
        ) : (
          <ul className="min-w-0 space-y-3">
            {rows.map((r) => {
              const status = statusOf(r);
              const sizes = r.decant_sizes ?? [];
              return (
                <li key={r.id}>
                  <AdminCard className="admin-row-in min-w-0">
                    <div className="flex min-w-0 items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-2">
                          <p className="min-w-0 truncate text-sm font-semibold">{r.name}</p>
                          <AdminStatus status={status} />
                        </div>
                        <p className="mt-1 text-base font-semibold text-gold tabular-nums">
                          {comboTitle(r)} {comboPriceLine({ combo_price: Number(r.combo_price) })}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {sizes.length ? `Decants de ${comboSizesLabel(sizes)}` : "Todos os tamanhos de decant"} ·{" "}
                          {comboBrl(comboUnitPrice({ quantity: r.quantity, combo_price: Number(r.combo_price) }))} cada
                        </p>
                        <p className="mt-1.5 text-xs text-muted-foreground">
                          {r.starts_at ? `${dateBR(r.starts_at)} → ` : ""}
                          {r.ends_at ? dateBR(r.ends_at) : "sem data final"}
                        </p>
                        {Number(r.orders_count ?? 0) > 0 ? (
                          <p className="mt-1.5 text-xs text-muted-foreground tabular-nums">
                            {r.orders_count} pedidos · {comboBrl(Number(r.sales_total ?? 0))} vendidos ·{" "}
                            {comboBrl(Number(r.discount_total ?? 0))} de desconto
                          </p>
                        ) : null}
                      </div>
                      <AdminMore
                        actions={[
                          { label: "Editar combo", onSelect: () => setEditing(r) },
                          {
                            label: r.active ? "Pausar combo" : "Ativar combo",
                            onSelect: () => void toggle(r.id, !r.active),
                          },
                          { label: "Excluir combo", danger: true, separated: true, onSelect: () => setRemoving(r.id) },
                        ]}
                      />
                    </div>
                  </AdminCard>
                </li>
              );
            })}
          </ul>
        )}
      </AdminBlock>

      <ComboSheet
        key={editing === "new" ? "new" : (editing?.id ?? "closed")}
        row={editing === "new" ? null : editing}
        open={editing != null}
        onClose={() => setEditing(null)}
        onSaved={refresh}
      />
      <AdminConfirm
        open={!!removing}
        onOpenChange={(v) => !v && setRemoving(null)}
        title="Excluir combo?"
        description="Os decants voltam ao preço normal imediatamente."
        confirmLabel="Excluir"
        danger
        onConfirm={() => removing && void remove(removing)}
      />
    </div>
  );
}

function ComboSheet({
  row,
  open,
  onClose,
  onSaved,
}: {
  row: ComboRow | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(row?.name ?? "Promoção da semana");
  const [quantity, setQuantity] = useState<number>(row?.quantity ?? 3);
  const [price, setPrice] = useState<number | null>(row ? Number(row.combo_price) : 100);
  const [sizes, setSizes] = useState<number[]>(row?.decant_sizes ?? [5]);
  const [starts, setStarts] = useState(isoToSaoPauloInput(row?.starts_at ?? null));
  const [ends, setEnds] = useState(isoToSaoPauloInput(row?.ends_at ?? null));
  const [busy, setBusy] = useState(false);

  const regular = useRegularUnit(sizes);
  const normal = regular != null ? Number((regular * quantity).toFixed(2)) : null;
  const valid = price != null && price > 0 && (normal == null || price < normal);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!price || price <= 0) {
      toast.error("Informe o preço do combo.");
      return;
    }
    if (normal != null && price >= normal) {
      toast.error(`O combo precisa custar menos que o preço normal (${comboBrl(normal)}).`);
      return;
    }
    setBusy(true);
    try {
      const payload = {
        name: name.trim() || "Promoção da semana",
        quantity,
        combo_price: price,
        decant_sizes: sizes,
        starts_at: saoPauloDateTimeToIso(starts),
        ends_at: saoPauloDateTimeToIso(ends),
      };
      const { error } = row
        ? await table().update(payload).eq("id", row.id)
        : await table().insert({ ...payload, active: true });
      if (error) throw new Error(error.message);
      toast.success(row ? "Combo atualizado." : "Combo criado e já valendo.");
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível salvar.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent
        side="bottom"
        className="max-h-[90vh] overflow-y-auto rounded-t-[24px] px-4 pb-[calc(env(safe-area-inset-bottom,0px)+16px)]"
      >
        <SheetHeader className="px-0 text-left">
          <SheetTitle className="text-base">{row ? "Editar combo" : "Novo combo de decants"}</SheetTitle>
        </SheetHeader>

        <form onSubmit={save} className="mt-3 min-w-0 space-y-5">
          <ComboPreview name={name} quantity={quantity} price={price ?? 0} sizes={sizes} />

          <div className="min-w-0 space-y-1.5">
            <Label htmlFor="combo-name">Etiqueta do cartão</Label>
            <Input
              id="combo-name"
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 32))}
              placeholder="Promoção da semana"
              className="h-12 rounded-xl text-base"
            />
          </div>

          <div className="min-w-0 space-y-1.5">
            <Label>Quantos decants formam o combo</Label>
            <div className="flex h-12 items-center justify-between rounded-xl border border-border/70 bg-background px-1.5">
              <button
                type="button"
                aria-label="Menos um decant"
                disabled={quantity <= 2}
                onClick={() => setQuantity((q) => Math.max(2, q - 1))}
                className="press grid size-9 place-items-center rounded-full bg-[#1F1F1F] text-white disabled:opacity-40"
              >
                <Minus className="size-4" />
              </button>
              <span className="text-lg font-semibold tabular-nums">{quantity} decants</span>
              <button
                type="button"
                aria-label="Mais um decant"
                disabled={quantity >= 20}
                onClick={() => setQuantity((q) => Math.min(20, q + 1))}
                className="press grid size-9 place-items-center rounded-full bg-[#1F1F1F] text-white disabled:opacity-40"
              >
                <Plus className="size-4" />
              </button>
            </div>
          </div>

          <MoneyInput
            id="combo-price"
            label="Preço do combo inteiro"
            value={price}
            onChange={setPrice}
            hint={
              normal != null ? (
                <>
                  Preço normal: {comboBrl(normal)}.{" "}
                  {valid && price != null ? (
                    <span className="font-semibold text-gold">
                      O cliente economiza {comboBrl(Number((normal - price).toFixed(2)))}.
                    </span>
                  ) : (
                    <span className="text-destructive">O combo precisa custar menos que isso.</span>
                  )}
                </>
              ) : undefined
            }
          />

          <div className="min-w-0 space-y-1.5">
            <Label>Tamanhos que entram (nenhum marcado = todos)</Label>
            <div className="flex min-w-0 gap-2">
              {DECANT_SIZES.map((ml) => (
                <button
                  key={ml}
                  type="button"
                  onClick={() => setSizes(sizes.includes(ml) ? sizes.filter((s) => s !== ml) : [...sizes, ml].sort((a, b) => a - b))}
                  className={cn(
                    "h-11 min-w-0 flex-1 rounded-xl border text-sm",
                    sizes.includes(ml) ? "border-gold bg-gold/10 font-medium" : "border-border/60 text-muted-foreground",
                  )}
                >
                  {ml}ml
                </button>
              ))}
            </div>
          </div>

          <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="combo-start">Começa em (opcional)</Label>
              <Input
                id="combo-start"
                type="datetime-local"
                value={starts}
                onChange={(e) => setStarts(e.target.value)}
                className="h-12 rounded-xl text-base"
              />
            </div>
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="combo-end">Termina em (opcional)</Label>
              <Input
                id="combo-end"
                type="datetime-local"
                value={ends}
                onChange={(e) => setEnds(e.target.value)}
                className="h-12 rounded-xl text-base"
              />
            </div>
          </div>

          <p className="text-xs leading-relaxed text-muted-foreground">
            O cliente pode misturar perfumes. Quando junta {quantity} decants, o combo fecha sozinho na Sacola; sobras pagam
            o preço normal. O cupom não acumula com o combo.
          </p>

          <Button type="submit" disabled={busy} className="press h-12 w-full rounded-full">
            {busy ? <Loader2 className="size-4 animate-spin" /> : row ? "Salvar combo" : "Criar combo"}
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}
