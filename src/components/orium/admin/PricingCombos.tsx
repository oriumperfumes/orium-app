import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarClock, CircleCheck, Layers, Minus, Pause, Plus, TrendingUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { dateBR } from "@/lib/format";
import { isoToSaoPauloInput, saoPauloDateTimeToIso } from "@/lib/promotions";
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
import { AdminConfirm, AdminEmpty, AdminMore } from "@/components/orium/admin/AdminUI";
import { MoneyInput } from "@/components/orium/admin/PriceBits";
import {
  PxCard,
  PxCardBody,
  PxCardHead,
  PxChip,
  PxField,
  PxInput,
  PxKpi,
  PxKpiRow,
  PxNote,
  PxQuick,
  PxStatus,
  PxTag,
  PxWizard,
  pxEndInDays,
  pxShortDate,
  type PxStep,
} from "@/components/orium/admin/PricingUI";

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
  (
    supabase as unknown as {
      from: (t: string) => {
        select: (c: string) => {
          order: (k: string, o: { ascending: boolean }) => Promise<{ data: unknown }>;
        };
        insert: (v: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
        update: (v: Record<string, unknown>) => {
          eq: (k: string, v: string) => Promise<{ error: { message: string } | null }>;
        };
        delete: () => {
          eq: (k: string, v: string) => Promise<{ error: { message: string } | null }>;
        };
      };
    }
  ).from("decant_combos");

export const comboStatus = (row: Pick<ComboRow, "active" | "starts_at" | "ends_at">) => {
  const now = Date.now();
  if (!row.active) return "pausada";
  if (row.starts_at && new Date(row.starts_at).getTime() > now) return "agendada";
  if (row.ends_at && new Date(row.ends_at).getTime() <= now) return "encerrada";
  return "ativa";
};

/** Lista de combos (mesma chave de cache para a aba e para o contador do topo). */
export function useAdminCombos() {
  return useQuery({
    queryKey: ["admin-decant-combos"],
    queryFn: async () =>
      ((await table().select("*").order("created_at", { ascending: false })).data ??
        []) as ComboRow[],
  });
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
    <div className="min-w-0 overflow-hidden rounded-[24px] bg-[#FFD599] p-5 text-[#15130F] lg:p-6">
      <span className="inline-flex items-center gap-2 rounded-full bg-[#15130F] px-3 py-1 text-[12px] font-semibold text-[#FFD599]">
        <span className="size-1.5 rounded-full bg-[#FFD599]" aria-hidden />
        {name.trim() || "Promoção da semana"}
      </span>
      <p className="mt-4 text-[32px] leading-[1] font-bold tracking-[-0.04em] lg:text-[38px]">
        {comboTitle(combo)}
        <br />
        {comboPriceLine(combo)}
      </p>
      <p className="mt-2 text-[14px] leading-snug text-[#15130F]/70">{comboSubtitle(combo)}</p>
      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[14px] tabular-nums">
        <span className="font-bold">{comboBrl(comboUnitPrice(combo))} cada</span>
        {regular != null ? (
          <span className="text-[#15130F]/55 line-through">{comboBrl(regular)} cada</span>
        ) : null}
        {saving > 0 ? (
          <span className="rounded-full bg-[#15130F] px-2.5 py-0.5 text-[12px] font-bold text-[#FFD599]">
            Economize {comboBrl(saving)}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function DecantCombosPanel({
  creating,
  onCreatingChange,
}: {
  creating: boolean;
  onCreatingChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<ComboRow | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const { data, isLoading } = useAdminCombos();
  const rows = useMemo(() => data ?? [], [data]);

  const live = rows.find((r) => isComboRunning(r));
  const stats = useMemo(
    () => ({
      ativas: rows.filter((r) => comboStatus(r) === "ativa").length,
      agendadas: rows.filter((r) => comboStatus(r) === "agendada").length,
      paradas: rows.filter((r) => ["encerrada", "pausada"].includes(comboStatus(r))).length,
      vendido: rows.reduce((s, r) => s + Number(r.sales_total ?? 0), 0),
      pedidos: rows.reduce((s, r) => s + Number(r.orders_count ?? 0), 0),
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

  const sheetOpen = creating || editing != null;
  const closeSheet = () => {
    setEditing(null);
    onCreatingChange(false);
  };

  return (
    <div className="min-w-0 space-y-4">
      <PxKpiRow>
        <PxKpi
          hero
          i={2}
          label="No ar agora"
          icon={<CircleCheck className="size-[18px]" strokeWidth={2.2} />}
          loading={isLoading}
          value={stats.ativas}
          foot={live ? live.name : "nenhum combo valendo"}
        />
        <PxKpi
          i={3}
          label="Agendados"
          icon={<CalendarClock className="size-[18px]" strokeWidth={2.2} />}
          loading={isLoading}
          value={stats.agendadas}
          foot="começam sozinhos"
        />
        <PxKpi
          i={4}
          label="Pausados ou encerrados"
          icon={<Pause className="size-[18px]" strokeWidth={2.2} />}
          loading={isLoading}
          value={stats.paradas}
          foot="fora da loja"
        />
        <PxKpi
          i={5}
          label="Vendido com combos"
          icon={<TrendingUp className="size-[18px]" strokeWidth={2.2} />}
          loading={isLoading}
          value={comboBrl(stats.vendido)}
          foot={`${stats.pedidos} ${stats.pedidos === 1 ? "pedido" : "pedidos"}`}
        />
      </PxKpiRow>

      {live ? (
        <PxCard i={6}>
          <PxCardHead
            title="Assim o cliente vê agora"
            sub="Cartão da Home, lembrete no decant e progresso na Sacola."
            icon={<Layers className="size-[18px]" strokeWidth={2.2} />}
          />
          <PxCardBody>
            <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)] lg:items-center">
              <ComboPreview
                name={live.name}
                quantity={live.quantity}
                price={Number(live.combo_price)}
                sizes={live.decant_sizes ?? []}
              />
              <ul className="min-w-0 space-y-2 text-[14px] leading-snug text-[#A9A9A9]">
                <li className="rounded-[18px] bg-[#232323] px-4 py-3">
                  O cliente pode misturar perfumes no mesmo combo.
                </li>
                <li className="rounded-[18px] bg-[#232323] px-4 py-3">
                  Ao juntar {live.quantity} decants, o combo fecha sozinho na Sacola.
                </li>
                <li className="rounded-[18px] bg-[#232323] px-4 py-3">
                  Sobras pagam o preço normal e o cupom não acumula com o combo.
                </li>
              </ul>
            </div>
          </PxCardBody>
        </PxCard>
      ) : null}

      <section className="min-w-0">
        <h2 className="mb-3 px-1 text-[18px] font-bold tracking-[-0.015em]">Combos de decants</h2>
        {isLoading ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="admin-skeleton h-[220px] rounded-[28px]" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <AdminEmpty>Nenhum combo criado. Crie um, por exemplo, “Leve 3 por R$ 100”.</AdminEmpty>
        ) : (
          <ul className="grid min-w-0 gap-3 sm:grid-cols-2 lg:gap-4 xl:grid-cols-3">
            {rows.map((r, i) => {
              const status = comboStatus(r);
              const sizes = r.decant_sizes ?? [];
              return (
                <li key={r.id} className="ord-in min-w-0" style={{ ["--i" as string]: i }}>
                  <article className="dash-card flex h-full min-w-0 flex-col p-5 lg:p-6">
                    <div className="flex min-w-0 items-start justify-between gap-3">
                      <div className="min-w-0">
                        <PxStatus status={status} />
                        <p className="mt-2 truncate text-[15px] font-semibold text-[#A9A9A9]">
                          {r.name}
                        </p>
                      </div>
                      <AdminMore
                        actions={[
                          { label: "Editar combo", onSelect: () => setEditing(r) },
                          {
                            label: r.active ? "Pausar combo" : "Ativar combo",
                            onSelect: () => void toggle(r.id, !r.active),
                          },
                          {
                            label: "Excluir combo",
                            danger: true,
                            separated: true,
                            onSelect: () => setRemoving(r.id),
                          },
                        ]}
                      />
                    </div>
                    <p className="mt-3 text-[26px] leading-[1.05] font-bold tracking-[-0.035em]">
                      {comboTitle(r)}
                      <br />
                      <span className="text-[#FFD599]">
                        {comboPriceLine({ combo_price: Number(r.combo_price) })}
                      </span>
                    </p>
                    <div className="mt-3 flex min-w-0 flex-wrap gap-1.5">
                      <PxTag>
                        {sizes.length
                          ? `Decants de ${comboSizesLabel(sizes)}`
                          : "Todos os tamanhos"}
                      </PxTag>
                      <PxTag>
                        {comboBrl(
                          comboUnitPrice({
                            quantity: r.quantity,
                            combo_price: Number(r.combo_price),
                          }),
                        )}{" "}
                        cada
                      </PxTag>
                    </div>
                    <div className="mt-auto pt-4">
                      <p className="text-[13px] text-[#8C8C8C]">
                        {r.starts_at ? `${dateBR(r.starts_at)} → ` : ""}
                        {r.ends_at ? dateBR(r.ends_at) : "sem data final"}
                      </p>
                      {Number(r.orders_count ?? 0) > 0 ? (
                        <p className="mt-1 text-[13px] text-[#8C8C8C] tabular-nums">
                          {r.orders_count} pedidos · {comboBrl(Number(r.sales_total ?? 0))} vendidos
                          · {comboBrl(Number(r.discount_total ?? 0))} de desconto
                        </p>
                      ) : null}
                    </div>
                  </article>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <ComboSheet
        key={editing?.id ?? (creating ? "new" : "closed")}
        row={editing}
        open={sheetOpen}
        onClose={closeSheet}
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

const COMBO_STEPS: PxStep[] = [
  { key: "oferta", label: "A oferta", hint: "Quantos decants, por quanto e de quais tamanhos." },
  {
    key: "cartao",
    label: "Cartão e período",
    hint: "A etiqueta do cartão dourado da Home e quando o combo vale.",
  },
];

const QTY_QUICK = [2, 3, 4, 5, 6].map((v) => ({ value: v, label: `${v} decants` }));
const END_QUICK = [
  { value: 0, label: "Sem fim" },
  { value: 7, label: "7 dias" },
  { value: 15, label: "15 dias" },
  { value: 30, label: "30 dias" },
];

/** Período em texto curto, para o resumo. */
const comboPeriod = (starts: string, ends: string) =>
  `${starts ? `de ${pxShortDate(starts)}` : "começa agora"} · ${ends ? `até ${pxShortDate(ends)}` : "sem data final"}`;

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
  const [step, setStep] = useState(0);
  const [name, setName] = useState(row?.name ?? "Promoção da semana");
  const [quantity, setQuantity] = useState<number>(row?.quantity ?? 3);
  const [price, setPrice] = useState<number | null>(row ? Number(row.combo_price) : 100);
  const [sizes, setSizes] = useState<number[]>(row?.decant_sizes ?? [5]);
  const [starts, setStarts] = useState(isoToSaoPauloInput(row?.starts_at ?? null));
  const [ends, setEnds] = useState(isoToSaoPauloInput(row?.ends_at ?? null));
  const [endPick, setEndPick] = useState<number | null>(row?.ends_at ? null : 0);
  const [busy, setBusy] = useState(false);

  const regular = useRegularUnit(sizes);
  const normal = regular != null ? Number((regular * quantity).toFixed(2)) : null;
  const valid = price != null && price > 0 && (normal == null || price < normal);
  const saving = normal != null && price != null ? Number((normal - price).toFixed(2)) : null;
  // sugestões de preço: ~20%, 30% e 40% abaixo do normal, em reais redondos
  const suggestions =
    normal != null
      ? [0.8, 0.7, 0.6]
          .map((f) => Math.max(1, Math.floor((normal * f) / 5) * 5))
          .filter((v, i, a) => a.indexOf(v) === i)
      : [];

  const save = async () => {
    if (!price || price <= 0) {
      toast.error("Informe o preço do combo.");
      setStep(0);
      return;
    }
    if (normal != null && price >= normal) {
      toast.error(`O combo precisa custar menos que o preço normal (${comboBrl(normal)}).`);
      setStep(0);
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
    <PxWizard
      open={open}
      onClose={onClose}
      title={row ? "Editar combo" : "Novo combo de decants"}
      steps={COMBO_STEPS}
      step={step}
      onStep={setStep}
      freeNav={!!row}
      preview={<ComboPreview name={name} quantity={quantity} price={price ?? 0} sizes={sizes} />}
      summary={[
        { label: "Preço normal", value: normal != null ? comboBrl(normal) : "—" },
        { label: "Preço do combo", value: price != null ? comboBrl(price) : "—" },
        {
          label: "Cliente economiza",
          value:
            saving != null && saving > 0 ? (
              <span className="text-[#FFD599]">{comboBrl(saving)}</span>
            ) : (
              "—"
            ),
        },
        {
          label: "Cada decant",
          value: price ? comboBrl(comboUnitPrice({ quantity, combo_price: price })) : "—",
        },
        { label: "Período", value: comboPeriod(starts, ends) },
      ]}
      canNext={step === 0 ? valid : !(starts && ends && ends <= starts)}
      onNext={() => void save()}
      finishLabel={row ? "Salvar combo" : "Criar combo"}
      busy={busy}
    >
      {step === 0 ? (
        <>
          <PxField label="Quantos decants formam o combo">
            <PxQuick options={QTY_QUICK} value={quantity} onPick={setQuantity} />
            <div className="flex h-[56px] items-center justify-between rounded-full bg-[#232323] px-1.5">
              <button
                type="button"
                aria-label="Menos um decant"
                disabled={quantity <= 2}
                onClick={() => setQuantity((q) => Math.max(2, q - 1))}
                className="press grid size-11 place-items-center rounded-full bg-[#2E2E2E] text-white disabled:opacity-40"
              >
                <Minus className="size-4" />
              </button>
              <span className="text-[18px] font-bold tabular-nums">{quantity} decants</span>
              <button
                type="button"
                aria-label="Mais um decant"
                disabled={quantity >= 20}
                onClick={() => setQuantity((q) => Math.min(20, q + 1))}
                className="press grid size-11 place-items-center rounded-full bg-[#2E2E2E] text-white disabled:opacity-40"
              >
                <Plus className="size-4" />
              </button>
            </div>
          </PxField>

          <PxField label="Tamanhos que entram" hint="Nenhum marcado = todos os tamanhos.">
            <div className="flex min-w-0 gap-2">
              {DECANT_SIZES.map((ml) => (
                <PxChip
                  key={ml}
                  on={sizes.includes(ml)}
                  onClick={() =>
                    setSizes(
                      sizes.includes(ml)
                        ? sizes.filter((s) => s !== ml)
                        : [...sizes, ml].sort((a, b) => a - b),
                    )
                  }
                >
                  {ml} ml
                </PxChip>
              ))}
            </div>
          </PxField>

          <PxField label="Preço do combo inteiro">
            {suggestions.length ? (
              <PxQuick
                options={suggestions.map((v) => ({ value: v, label: comboBrl(v) }))}
                value={price}
                onPick={(v) => setPrice(v)}
              />
            ) : null}
            <MoneyInput id="combo-price" value={price} onChange={setPrice} />
          </PxField>

          {normal != null ? (
            valid && saving != null ? (
              <PxNote tone="good">
                Preço normal {comboBrl(normal)} · o cliente economiza {comboBrl(saving)}.
              </PxNote>
            ) : (
              <PxNote tone="warning">
                O combo precisa custar menos que o preço normal ({comboBrl(normal)}).
              </PxNote>
            )
          ) : null}
        </>
      ) : (
        <>
          <PxField
            label="Etiqueta do cartão"
            htmlFor="combo-name"
            hint="Aparece no selo escuro do cartão dourado."
          >
            <PxInput
              id="combo-name"
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 32))}
              placeholder="Promoção da semana"
            />
          </PxField>
          <PxField label="Começa" hint="Vazio = começa assim que você salvar.">
            <PxInput
              id="combo-start"
              type="datetime-local"
              value={starts}
              onChange={(e) => setStarts(e.target.value)}
            />
          </PxField>
          <PxField label="Termina">
            <PxQuick
              options={END_QUICK}
              value={endPick}
              onPick={(v) => {
                setEndPick(v);
                setEnds(v === 0 ? "" : pxEndInDays(v));
              }}
            />
            <PxInput
              id="combo-end"
              type="datetime-local"
              value={ends}
              onChange={(e) => {
                setEnds(e.target.value);
                setEndPick(e.target.value ? null : 0);
              }}
            />
          </PxField>
          {starts && ends && ends <= starts ? (
            <PxNote tone="warning">O fim precisa ser depois do começo.</PxNote>
          ) : null}
          <PxNote>
            O cliente pode misturar perfumes. Quando junta {quantity} decants, o combo fecha sozinho
            na Sacola; sobras pagam o preço normal. O cupom não acumula com o combo.
          </PxNote>
        </>
      )}
    </PxWizard>
  );
}
