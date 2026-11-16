import { useEffect, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Check, Loader2, Minus, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { Tag } from "@/components/orium/admin/ProductBits";
import { brl, dateBR } from "@/lib/format";
import { getPaymentPricing } from "@/lib/payment-rule";
import { usePaymentSettings } from "@/lib/payment";
import { productAdminState, productSetAvailability, productSetLocalStock, productUpdatePrice } from "@/lib/product-admin.functions";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ *
 * Controles manuais de produto. Tudo passa pelos mesmos serviços
 * que o Copilot usa (estoque local, disponibilidade, preço).
 * ------------------------------------------------------------------ */

export type AvailMode = "AUTO" | "FORCE_AVAILABLE" | "FORCE_UNAVAILABLE";
type SaveState = "idle" | "saving" | "saved";

export const MODE_OPTIONS: Array<[AvailMode, string, string]> = [
  ["AUTO", "Automática", "Estoque Orium ou fornecedor com sob encomenda"],
  ["FORCE_AVAILABLE", "Pronta entrega", "Disponível mesmo com fornecedor sem estoque"],
  ["FORCE_UNAVAILABLE", "Indisponível", "Fora de venda mesmo com estoque"],
];

const SOURCE_LABEL: Record<string, string> = {
  local: "Estoque local",
  manual: "Override manual",
  supplier: "Fornecedor (sob encomenda)",
  blocked: "Bloqueado manualmente",
  none: "Nenhuma fonte disponível",
};

const REASONS = ["Reposição chegou", "Ajuste de inventário", "Contagem física", "Devolução", "Outro"];

export function useProductState(productId: string) {
  const load = useServerFn(productAdminState);
  return useQuery({ queryKey: ["product-admin-state", productId], queryFn: () => load({ data: { productId } }) });
}

function useRefresh(productId: string) {
  const qc = useQueryClient();
  return async () => {
    await qc.invalidateQueries({ queryKey: ["product-admin-state", productId] });
    void qc.invalidateQueries({ queryKey: ["maintenance-data"] });
    void qc.invalidateQueries({ queryKey: ["orium-stock", productId] });
  };
}

export function SaveBadge({ state }: { state: SaveState }) {
  if (state === "idle") return null;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" aria-live="polite">
      {state === "saving" ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3 text-success" />}
      {state === "saving" ? "Salvando…" : "Salvo"}
    </span>
  );
}

function useSaver() {
  const [state, setState] = useState<SaveState>("idle");
  useEffect(() => {
    if (state !== "saved") return;
    const t = setTimeout(() => setState("idle"), 2500);
    return () => clearTimeout(t);
  }, [state]);
  const run = async (fn: () => Promise<unknown>, onError?: () => void) => {
    setState("saving");
    try {
      await fn();
      setState("saved");
      return true;
    } catch (e) {
      setState("idle");
      onError?.();
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar.");
      return false;
    }
  };
  return { state, run };
}

function Section({ title, subtitle, right, children }: { title: string; subtitle?: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="min-w-0 rounded-[24px] bg-[#1A1A1A] p-4 sm:p-5">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[16px] leading-tight font-bold">{title}</h3>
          {subtitle ? <p className="mt-1 text-[13px] leading-snug text-[#8C8C8C]">{subtitle}</p> : null}
        </div>
        {right}
      </div>
      <div className="mt-4 min-w-0">{children}</div>
    </section>
  );
}

export function Stepper({ value, onChange, min = 0 }: { value: number; onChange: (v: number) => void; min?: number }) {
  return (
    <div className="flex items-center gap-2">
      <Button type="button" variant="ghost" size="icon" className="size-12 rounded-full bg-[#232323] text-white hover:bg-[#2C2C2C] hover:text-white" disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))} aria-label="Diminuir">
        <Minus className="size-4" />
      </Button>
      <input
        inputMode="numeric"
        aria-label="Quantidade"
        value={String(value)}
        onChange={(e) => onChange(Math.max(min, Number(e.target.value.replace(/\D/g, "") || 0)))}
        className="h-12 w-20 pk-field rounded-[16px] bg-[#232323] text-center text-[18px] font-bold text-white tabular-nums outline-none transition-colors focus:bg-[#2A2A2A]"
      />
      <Button type="button" variant="ghost" size="icon" className="size-12 rounded-full bg-[#232323] text-white hover:bg-[#2C2C2C] hover:text-white" onClick={() => onChange(value + 1)} aria-label="Aumentar">
        <Plus className="size-4" />
      </Button>
    </div>
  );
}

export function ModePicker({ value, onChange, disabled }: { value: AvailMode; onChange: (m: AvailMode) => void; disabled?: boolean }) {
  return (
    <div role="radiogroup" className="grid min-w-0 gap-2">
      {MODE_OPTIONS.map(([k, label, hint]) => (
        <button
          key={k}
          type="button"
          role="radio"
          aria-checked={value === k}
          disabled={disabled}
          onClick={() => onChange(k)}
          className={cn(
            "pk-choice press flex min-h-14 min-w-0 items-center gap-3 rounded-[18px] px-4 py-2.5 text-left",
            value === k ? "bg-white text-[#15130F]" : "bg-[#232323] hover:bg-[#2A2A2A]",
          )}
        >
          <span className={cn("grid size-4 shrink-0 place-items-center rounded-full border", value === k ? "border-[#15130F]" : "border-[#6F6F6F]")}>
            {value === k ? <span className="size-2 rounded-full bg-[#15130F]" /> : null}
          </span>
          <span className="min-w-0">
            <span className="block text-[14.5px] font-bold">{label}</span>
            <span className="block text-[12.5px] leading-snug opacity-60">{hint}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

/** Aba ESTOQUE: estoque físico da Orium + disponibilidade pública. */
export function StockTab({ productId }: { productId: string }) {
  const { data: s } = useProductState(productId);
  const refresh = useRefresh(productId);
  const setStock = useServerFn(productSetLocalStock);
  const setAvail = useServerFn(productSetAvailability);
  const stockSaver = useSaver();
  const availSaver = useSaver();
  const [op, setOp] = useState<"set" | "add" | "remove">("set");
  const [qty, setQty] = useState(0);
  const [reason, setReason] = useState<string | null>(null);
  const [mode, setMode] = useState<AvailMode>("AUTO");
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!s) return;
    setMode(s.mode as AvailMode);
    if (op === "set") setQty(s.localStock);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s?.localStock, s?.mode]);

  if (!s) return <div className="h-40 admin-skeleton rounded-[24px]" />;

  const result = op === "set" ? qty : op === "add" ? s.localStock + qty : s.localStock - qty;
  const negative = result < 0;
  const changed = result !== s.localStock;

  const saveStock = async () => {
    const ok = await stockSaver.run(() => setStock({ data: { productId, mode: op, quantity: qty, reason } }));
    setConfirming(false);
    if (ok) {
      await refresh();
      setOp("set");
      setReason(null);
    }
  };
  const saveMode = async (m: AvailMode) => {
    const prev = mode;
    setMode(m);
    const ok = await availSaver.run(() => setAvail({ data: { productIds: [productId], mode: m } }), () => setMode(prev));
    if (ok) await refresh();
  };

  const bottleMl = s.volumeMl ?? 100;
  const openMl = s.decantMlConsumed > 0 ? Math.max(0, bottleMl - (s.decantMlConsumed % bottleMl || bottleMl)) : 0;

  return (
    <div className="min-w-0 space-y-4">
      <Section title="Estoque da Orium" subtitle="Somente o estoque físico da loja. Não inclui fornecedores." right={<SaveBadge state={stockSaver.state} />}>
        <p className="text-[40px] leading-none font-bold tracking-[-0.04em] tabular-nums">
          {s.localStock} <span className="text-sm font-normal text-muted-foreground">frasco(s) lacrado(s)</span>
        </p>
        {s.saleMode !== "FULL" && s.decantAvailable ? (
          <p className="mt-1 text-xs text-muted-foreground">
            Decants: {s.decantMlConsumed > 0 ? `${s.decantMlConsumed} ml já usados em decants · frasco aberto com ~${openMl} ml` : "nenhum frasco aberto para decant"}
          </p>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-2" role="tablist">
          {(
            [
              ["set", "Definir estoque"],
              ["add", "Adicionar"],
              ["remove", "Remover"],
            ] as const
          ).map(([k, l]) => (
            <button
              key={k}
              type="button"
              onClick={() => {
                setOp(k);
                setQty(k === "set" ? s.localStock : 1);
              }}
              className={cn("press h-10 rounded-full px-4 text-[13.5px] font-semibold transition-colors duration-200", op === k ? "bg-white text-[#15130F]" : "bg-[#232323] text-[#A9A9A9] hover:bg-[#2A2A2A] hover:text-white")}
            >
              {l}
            </button>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Stepper value={qty} onChange={setQty} />
          <p className="text-sm text-muted-foreground">
            Resultado: <span className={cn("font-semibold tabular-nums", negative ? "text-destructive" : "text-foreground")}>{result}</span>
          </p>
        </div>
        {negative ? <p className="mt-2 text-xs text-destructive">Não dá para remover mais do que existe ({s.localStock}).</p> : null}
        {op === "remove" ? (
          <p className="mt-2 text-xs text-muted-foreground">Vendeu? Prefira registrar em Vendas da loja ou Pedidos — o estoque baixa sozinho.</p>
        ) : null}

        <div className="mt-3 flex flex-wrap gap-1.5">
          {REASONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setReason(reason === r ? null : r)}
              className={cn("press h-8 rounded-full px-3 text-[12.5px] font-semibold transition-colors duration-200", reason === r ? "bg-[#FFD599] text-[#15130F]" : "bg-[#232323] text-[#8C8C8C] hover:text-white")}
            >
              {r}
            </button>
          ))}
        </div>

        {confirming ? (
          <div className="mt-4 adm-pop rounded-[18px] bg-[#232323] p-4">
            <p className="text-sm">
              Estoque Orium: <span className="font-semibold tabular-nums">{s.localStock} → {result}</span>
            </p>
            <div className="mt-3 flex gap-2">
              <Button variant="ghost" className="h-11 flex-1 rounded-full bg-[#2E2E2E] font-semibold text-white hover:bg-[#383838]" onClick={() => setConfirming(false)}>
                Cancelar
              </Button>
              <Button className="h-11 flex-1 rounded-full bg-[#FFD599] font-bold text-[#15130F] hover:bg-[#FFDDAA]" disabled={stockSaver.state === "saving"} onClick={saveStock}>
                Confirmar
              </Button>
            </div>
          </div>
        ) : (
          <Button className="mt-4 h-12 w-full rounded-full sm:w-auto sm:px-8 bg-[#FFD599] font-bold text-[#15130F] hover:bg-[#FFDDAA]" disabled={!changed || negative} onClick={() => setConfirming(true)}>
            Salvar estoque
          </Button>
        )}
      </Section>

      <Section title="Disponibilidade na Orium" subtitle="O cliente vê somente Disponível ou Indisponível." right={<SaveBadge state={availSaver.state} />}>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className={cn("size-2.5 rounded-full", s.inStock ? "bg-success" : "bg-muted-foreground")} />
          <p className="text-sm font-medium">{s.inStock ? (s.source === "supplier" ? "Disponível sob encomenda" : "Disponível para pronta entrega") : "Indisponível"}</p>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {s.inStock ? "Disponível por" : "Motivo"}: {SOURCE_LABEL[s.source] ?? s.source}
          {s.source === "local" ? ` · ${s.localStock} unidade(s)` : ""}
        </p>
        {s.mode === "FORCE_AVAILABLE" ? (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-warning">
            <AlertTriangle className="size-3.5" />
            {s.localStock > 0 ? "Disponibilidade manual ativa." : "Disponibilidade manual ativa sem estoque registrado."}
          </p>
        ) : null}
        {s.mode === "FORCE_UNAVAILABLE" ? (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-warning">
            <AlertTriangle className="size-3.5" /> Bloqueado manualmente.
          </p>
        ) : null}
        <p className="mt-5 mb-2.5 text-[13px] font-semibold text-[#A9A9A9]">Disponibilidade do frasco</p>
        <ModePicker value={mode} onChange={(m) => m !== mode && saveMode(m)} disabled={availSaver.state === "saving"} />
        {s.saleMode !== "FULL" ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Decant: {s.decantAvailable ? "disponível" : "desligado"} (ajuste em Preço e estoque).
          </p>
        ) : null}
      </Section>
    </div>
  );
}

/** Aba VENDA: precificação automática x personalizada. */
export function PricingTab({ productId }: { productId: string }) {
  const { data: s } = useProductState(productId);
  const refresh = useRefresh(productId);
  const update = useServerFn(productUpdatePrice);
  const payment = usePaymentSettings();
  const saver = useSaver();
  const [custom, setCustom] = useState(false);
  const [pix, setPix] = useState("");
  const [wholesale, setWholesale] = useState("");
  const [preview, setPreview] = useState<null | "custom" | "auto">(null);
  const [dec, setDec] = useState({ d2: "", d5: "", d10: "" });

  useEffect(() => {
    if (!s) return;
    setCustom(s.customRetail || s.manualPricing);
    setPix(s.retail != null ? String(s.retail) : "");
    setWholesale(s.wholesale != null ? String(s.wholesale) : "");
    setDec({ d2: s.decant.d2 != null ? String(s.decant.d2) : "", d5: s.decant.d5 != null ? String(s.decant.d5) : "", d10: s.decant.d10 != null ? String(s.decant.d10) : "" });
  }, [s]);

  if (!s) return <div className="h-40 admin-skeleton rounded-[24px]" />;

  const val = (v: string) => (v.trim() === "" ? null : Number(v.replace(",", ".")));
  const pixN = val(pix);
  const card = pixN ? getPaymentPricing(pixN, payment).cardPrice : null;
  const profit = pixN != null && s.cost != null ? pixN - s.cost : null;
  const margin = profit != null && pixN ? (profit / pixN) * 100 : null;

  const applyCustom = async () => {
    const ok = await saver.run(async () => {
      if (pixN != null && pixN !== s.retail) await update({ data: { productId, kind: "pix", value: pixN } });
      const w = val(wholesale);
      if (w != null && w !== s.wholesale) await update({ data: { productId, kind: "wholesale", value: w } });
    });
    setPreview(null);
    if (ok) await refresh();
  };
  const backToAuto = async () => {
    const ok = await saver.run(async () => {
      await update({ data: { productId, kind: "auto", value: null } });
      if (s.customWholesale) await update({ data: { productId, kind: "auto_wholesale", value: null } });
    });
    setPreview(null);
    if (ok) await refresh();
  };
  const saveDecant = async (k: "d2" | "d5" | "d10") => {
    const v = val(dec[k]);
    const cur = s.decant[k];
    if (v === cur) return;
    const ok = await saver.run(
      () => update({ data: { productId, kind: k === "d2" ? "decant_2" : k === "d5" ? "decant_5" : "decant_10", value: v } }),
      () => setDec((d) => ({ ...d, [k]: cur != null ? String(cur) : "" })),
    );
    if (ok) await refresh();
  };

  const inputCls = "h-12 w-full min-w-0 pk-field rounded-[16px] bg-[#232323] px-4 text-base text-white tabular-nums outline-none transition-colors placeholder:text-[#6F6F6F] focus:bg-[#2A2A2A] disabled:opacity-60";

  return (
    <div className="min-w-0 space-y-4">
      <Section title="Precificação" subtitle="Preço cadastrado = preço no Pix. O cartão é calculado pela regra central." right={<SaveBadge state={saver.state} />}>
        {!s.manualPricing ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {(
              [
                [false, "Automática", "Usa a regra global"],
                [true, "Preço personalizado", "Você define o preço"],
              ] as const
            ).map(([k, l, h]) => (
              <button
                key={l}
                type="button"
                onClick={() => (k === false && s.customRetail ? setPreview("auto") : setCustom(k))}
                className={cn("pk-choice press min-h-14 rounded-[18px] px-4 py-2.5 text-left", custom === k ? "bg-white text-[#15130F]" : "bg-[#232323] hover:bg-[#2A2A2A]")}
              >
                <span className="block text-[14.5px] font-bold">{l}</span>
                <span className="block text-[12.5px] leading-snug opacity-60">{h}</span>
              </button>
            ))}
          </div>
        ) : (
          <Tag>Produto manual · preço sempre definido por você</Tag>
        )}

        <div className="mt-3 divide-y divide-white/[0.06] text-sm">
          <Row label="Preço automático" value={brl(s.auto?.retail)} />
          <Row label="Custo" value={brl(s.cost)} />
        </div>

        {custom ? (
          <div className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2">
            <label className="min-w-0 space-y-1 text-xs text-muted-foreground">
              Preço Pix (R$)
              <input inputMode="decimal" value={pix} onChange={(e) => setPix(e.target.value)} className={inputCls} />
            </label>
            {s.saleMode !== "DECANT" ? (
              <label className="min-w-0 space-y-1 text-xs text-muted-foreground">
                Atacado (R$)
                <input inputMode="decimal" value={wholesale} onChange={(e) => setWholesale(e.target.value)} className={inputCls} />
              </label>
            ) : null}
          </div>
        ) : null}

        <div className="mt-3 divide-y divide-white/[0.06] text-sm">
          <Row label="Preço no Pix" value={brl(custom ? pixN : s.retail)} strong />
          <Row label="Preço no cartão" value={brl(custom ? card : s.retail ? getPaymentPricing(s.retail, payment).cardPrice : null)} />
          <Row label="Lucro bruto" value={brl(custom ? profit : s.retail != null && s.cost != null ? s.retail - s.cost : null)} />
          <Row label="Margem bruta" value={custom ? (margin != null ? `${margin.toFixed(1).replace(".", ",")}%` : "—") : s.retail && s.cost != null ? `${(((s.retail - s.cost) / s.retail) * 100).toFixed(1).replace(".", ",")}%` : "—"} />
        </div>
        {custom && profit != null && profit < 0 ? <p className="mt-2 text-xs text-destructive">Atenção: preço abaixo do custo.</p> : null}

        {preview === "custom" ? (
          <Confirm
            lines={[`Pix: ${brl(s.retail)} → ${brl(pixN)}`, ...(val(wholesale) !== s.wholesale ? [`Atacado: ${brl(s.wholesale)} → ${brl(val(wholesale))}`] : [])]}
            onCancel={() => setPreview(null)}
            onConfirm={applyCustom}
            busy={saver.state === "saving"}
          />
        ) : preview === "auto" ? (
          <Confirm
            lines={[`Atual: ${brl(s.retail)} personalizado`, `Automático: ${brl(s.auto?.retail)}`]}
            onCancel={() => setPreview(null)}
            onConfirm={backToAuto}
            busy={saver.state === "saving"}
          />
        ) : (
          <div className="mt-4 flex flex-wrap gap-2">
            {custom ? (
              <Button className="h-12 rounded-full px-6 bg-[#FFD599] font-bold text-[#15130F] hover:bg-[#FFDDAA]" disabled={!pixN || (pixN === s.retail && val(wholesale) === s.wholesale)} onClick={() => setPreview("custom")}>
                Revisar e salvar
              </Button>
            ) : null}
            {s.customRetail && !s.manualPricing ? (
              <Button variant="ghost" className="h-12 rounded-full px-6 bg-[#232323] font-semibold text-white hover:bg-[#2C2C2C]" onClick={() => setPreview("auto")}>
                Voltar ao preço automático
              </Button>
            ) : null}
          </div>
        )}
      </Section>

      {s.saleMode !== "FULL" ? (
        <Section title="Decants" subtitle="Em branco = preço oficial da configuração. Salva ao sair do campo.">
          <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-3">
            {(["d2", "d5", "d10"] as const).map((k) => (
              <label key={k} className="min-w-0 space-y-1 text-xs text-muted-foreground">
                {k.slice(1)} ml (R$)
                <input
                  inputMode="decimal"
                  placeholder="preço oficial"
                  value={dec[k]}
                  onChange={(e) => setDec((d) => ({ ...d, [k]: e.target.value }))}
                  onBlur={() => saveDecant(k)}
                  className={inputCls}
                />
              </label>
            ))}
          </div>
        </Section>
      ) : null}
    </div>
  );
}

function Confirm({ lines, onCancel, onConfirm, busy }: { lines: string[]; onCancel: () => void; onConfirm: () => void; busy: boolean }) {
  return (
    <div className="mt-4 adm-pop rounded-[18px] bg-[#232323] p-4">
      {lines.map((l) => (
        <p key={l} className="text-sm tabular-nums">
          {l}
        </p>
      ))}
      <div className="mt-3 flex gap-2">
        <Button variant="ghost" className="h-11 flex-1 rounded-full bg-[#2E2E2E] font-semibold text-white hover:bg-[#383838]" onClick={onCancel}>
          Cancelar
        </Button>
        <Button className="h-11 flex-1 rounded-full bg-[#FFD599] font-bold text-[#15130F] hover:bg-[#FFDDAA]" disabled={busy} onClick={onConfirm}>
          Confirmar
        </Button>
      </div>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 py-2">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("tabular-nums", strong && "font-semibold")}>{value}</span>
    </div>
  );
}

/** Aba FORNECEDORES: ofertas separadas do estoque Orium. */
export function SuppliersTab({ productId }: { productId: string }) {
  const { data: s } = useProductState(productId);
  if (!s) return <div className="h-40 admin-skeleton rounded-[24px]" />;
  type Offer = { id: string; supplier: string; name: string; price: number | null; inStock: boolean; syncedAt: string | null };
  const offers = s.offers as Offer[];
  const priced = offers.filter((o) => o.price != null);
  const best = priced.length ? priced.reduce((a, b) => ((b.price ?? 0) < (a.price ?? 0) ? b : a)) : null;
  return (
    <Section title="Fornecedores" subtitle="Custo e estoque dos fornecedores. Não é o estoque da Orium.">
      {offers.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum fornecedor vinculado.</p>
      ) : (
        <ul className="min-w-0 divide-y divide-white/[0.06]">
          {offers.map((o) => (
            <li key={o.id} className="flex min-w-0 items-start justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{o.supplier}</p>
                <p className="truncate text-xs text-muted-foreground">{o.name}</p>
                <p className="mt-1 flex flex-wrap gap-1.5">
                  <Tag tone={o.inStock ? "ok" : "muted"}>{o.inStock ? "Disponível" : "Indisponível"}</Tag>
                  {best?.id === o.id ? <Tag tone="gold">Menor custo</Tag> : null}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-sm font-semibold tabular-nums">{brl(o.price)}</p>
                <p className="text-[11px] text-muted-foreground">{o.syncedAt ? dateBR(o.syncedAt) : "—"}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-xs text-muted-foreground">A sincronização nunca altera o estoque Orium nem a disponibilidade manual.</p>
    </Section>
  );
}

export function HistoryList({ productId }: { productId: string }) {
  const { data: s } = useProductState(productId);
  if (!s) return null;
  return (
    <Section title="Histórico" subtitle="Estoque, disponibilidade e preço — quem alterou e quando.">
      {s.history.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sem alterações registradas.</p>
      ) : (
        <ul className="min-w-0 space-y-2.5">
          {s.history.map((h, i) => (
            <li key={i} className="min-w-0 text-sm">
              <p className="text-xs text-muted-foreground">
                {new Date(h.at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                {h.who ? ` · ${h.who}` : ""}
              </p>
              <p className="min-w-0 break-words">
                <span className="font-medium capitalize">{h.kind === "estoque" ? "Estoque local" : h.kind}</span> · {h.from} → {h.to}
                {h.note ? <span className="text-xs text-muted-foreground"> · {h.note}</span> : null}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/* ------------------------------ edição rápida ------------------------------ */

export type QuickKind = "stock" | "availability" | "price";

export function QuickEditSheet({ productId, name, kind, onClose }: { productId: string; name: string; kind: QuickKind | null; onClose: () => void }) {
  return (
    <Drawer open={kind !== null} onOpenChange={(o) => !o && onClose()}>
      <DrawerContent className="max-h-[90vh] border-0 bg-[#121212] text-white">
        <DrawerTitle className="px-5 pt-4 text-[22px] font-bold tracking-[-0.02em]">
          {kind === "stock" ? "Ajustar estoque" : kind === "availability" ? "Disponibilidade" : "Alterar preço"}
          <span className="mt-0.5 block truncate text-[14px] font-normal tracking-normal text-[#8C8C8C]">{name}</span>
        </DrawerTitle>
        <div className="min-h-0 min-w-0 overflow-y-auto px-4 py-3 pb-[calc(env(safe-area-inset-bottom,0px)+16px)]">
          {kind === "stock" ? <QuickStock productId={productId} onDone={onClose} /> : null}
          {kind === "availability" ? <QuickAvailability productId={productId} onDone={onClose} /> : null}
          {kind === "price" ? <QuickPrice productId={productId} onDone={onClose} /> : null}
        </div>
      </DrawerContent>
    </Drawer>
  );
}

function QuickStock({ productId, onDone }: { productId: string; onDone: () => void }) {
  const { data: s } = useProductState(productId);
  const refresh = useRefresh(productId);
  const setStock = useServerFn(productSetLocalStock);
  const saver = useSaver();
  const [qty, setQty] = useState<number | null>(null);
  if (!s) return <div className="h-24 admin-skeleton rounded-[24px]" />;
  const v = qty ?? s.localStock;
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Estoque Orium atual: <span className="font-semibold text-foreground tabular-nums">{s.localStock}</span>
      </p>
      <Stepper value={v} onChange={setQty} />
      {v !== s.localStock ? <p className="text-sm tabular-nums">{s.localStock} → {v}</p> : null}
      <Button
        className="h-[52px] w-full rounded-full text-[15px] bg-[#FFD599] font-bold text-[#15130F] hover:bg-[#FFDDAA]"
        disabled={v === s.localStock || saver.state === "saving"}
        onClick={async () => {
          const ok = await saver.run(() => setStock({ data: { productId, mode: "set", quantity: v, reason: "Ajuste rápido" } }));
          if (ok) {
            await refresh();
            toast.success("Estoque salvo.");
            onDone();
          }
        }}
      >
        {saver.state === "saving" ? "Salvando…" : "Confirmar e salvar"}
      </Button>
    </div>
  );
}

function QuickAvailability({ productId, onDone }: { productId: string; onDone: () => void }) {
  const { data: s } = useProductState(productId);
  const refresh = useRefresh(productId);
  const setAvail = useServerFn(productSetAvailability);
  const saver = useSaver();
  const [mode, setMode] = useState<AvailMode | null>(null);
  if (!s) return <div className="h-24 admin-skeleton rounded-[24px]" />;
  const m = mode ?? (s.mode as AvailMode);
  return (
    <div className="space-y-4">
      <ModePicker value={m} onChange={setMode} />
      {m === "FORCE_AVAILABLE" && s.localStock === 0 ? (
        <p className="text-xs text-warning">Disponibilidade manual ativa sem estoque registrado.</p>
      ) : null}
      <Button
        className="h-[52px] w-full rounded-full text-[15px] bg-[#FFD599] font-bold text-[#15130F] hover:bg-[#FFDDAA]"
        disabled={m === s.mode || saver.state === "saving"}
        onClick={async () => {
          const ok = await saver.run(() => setAvail({ data: { productIds: [productId], mode: m } }));
          if (ok) {
            await refresh();
            toast.success("Disponibilidade salva.");
            onDone();
          }
        }}
      >
        {saver.state === "saving" ? "Salvando…" : "Salvar"}
      </Button>
    </div>
  );
}

function QuickPrice({ productId, onDone }: { productId: string; onDone: () => void }) {
  const { data: s } = useProductState(productId);
  const refresh = useRefresh(productId);
  const update = useServerFn(productUpdatePrice);
  const payment = usePaymentSettings();
  const saver = useSaver();
  const [v, setV] = useState("");
  const [review, setReview] = useState(false);
  if (!s) return <div className="h-24 admin-skeleton rounded-[24px]" />;
  const n = v.trim() ? Number(v.replace(",", ".")) : null;
  const profit = n != null && s.cost != null ? n - s.cost : null;
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Preço atual (Pix): <span className="font-semibold text-foreground">{brl(s.retail)}</span>
      </p>
      <label className="block space-y-1 text-xs text-muted-foreground">
        Novo preço Pix (R$)
        <input inputMode="decimal" value={v} onChange={(e) => { setV(e.target.value); setReview(false); }} className="mt-1.5 h-12 w-full pk-field rounded-[16px] bg-[#232323] px-4 text-base text-white tabular-nums outline-none transition-colors focus:bg-[#2A2A2A]" />
      </label>
      {n ? (
        <p className="text-sm text-muted-foreground">
          Cartão {brl(getPaymentPricing(n, payment).cardPrice)} · Lucro <span className={cn("font-medium", profit != null && profit < 0 ? "text-destructive" : "text-foreground")}>{brl(profit)}</span>
        </p>
      ) : null}
      {review && n ? <p className="text-sm tabular-nums">{brl(s.retail)} → {brl(n)}</p> : null}
      <Button
        className="h-[52px] w-full rounded-full text-[15px] bg-[#FFD599] font-bold text-[#15130F] hover:bg-[#FFDDAA]"
        disabled={!n || n <= 0 || n === s.retail || saver.state === "saving"}
        onClick={async () => {
          if (!review) return setReview(true);
          const ok = await saver.run(() => update({ data: { productId, kind: "pix", value: n } }));
          if (ok) {
            await refresh();
            toast.success("Preço aplicado.");
            onDone();
          }
        }}
      >
        {saver.state === "saving" ? "Salvando…" : review ? "Confirmar" : "Revisar"}
      </Button>
    </div>
  );
}
