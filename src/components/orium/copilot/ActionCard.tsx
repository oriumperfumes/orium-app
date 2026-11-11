import { CopilotActionCard, CopilotConfirmationActions } from "./CopilotUI";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Check, AlertTriangle, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { copilotCancel, copilotConfirm, copilotUndo } from "@/lib/copilot.functions";
import { cn } from "@/lib/utils";

const brl = (v: number | null | undefined) =>
  v == null ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const when = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "sem data de fim";

export type ActionProposal = {
  kind: "action";
  action_id: string;
  tool: string;
  label: string;
  risk: string;
  reversible: boolean;
  expires_at: string;
  preview: any;
};

export type ActionOutcome = { ok: boolean; partial?: boolean; error?: string; result?: any; undoable?: boolean };

function Thumb({ src, alt }: { src?: string | null; alt: string }) {
  return src ? (
    <img src={src} alt={alt} className="size-12 shrink-0 rounded-lg bg-muted object-cover" loading="lazy" />
  ) : (
    <div className="size-12 shrink-0 rounded-lg bg-muted" />
  );
}

function Row({ label, from, to, strong }: { label: string; from?: string | number | null | undefined; to: string | number | null | undefined; strong?: boolean }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-3 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className={cn("min-w-0 text-right tabular-nums break-words", strong && "font-semibold")}>
        {from !== undefined ? (
          <>
            <span className="text-muted-foreground">{from ?? "—"}</span> <span className="text-primary">→</span>{" "}
          </>
        ) : null}
        {to ?? "—"}
      </span>
    </div>
  );
}

function BelowCost({ text }: { text: string }) {
  return (
    <p className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/15 px-3 py-2 text-sm font-semibold text-destructive">
      <AlertTriangle className="size-4 shrink-0" /> {text}
    </p>
  );
}

function fmtRule(key: string, v: any) {
  if (typeof v === "boolean") return v ? "Ligado" : "Desligado";
  if (key === "pix_discount_percent") return `${String(v).replace(".", ",")}%`;
  if (key === "wholesale_min_quantity") return `${v} unid.`;
  if (key.endsWith("_markup")) return `custo + ${brl(v)}`;
  return brl(v);
}

function PriceLineView({ l, compact }: { l: any; compact?: boolean }) {
  return (
    <div className="space-y-2">
      <div className="flex min-w-0 items-center gap-3">
        {compact ? null : <Thumb src={l.product?.image_url} alt={l.product?.name ?? ""} />}
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{l.product?.name}</p>
          {compact ? null : <p className="truncate text-xs text-muted-foreground">{l.product?.brand}</p>}
        </div>
      </div>
      <Row label={l.kind_label} from={brl(l.from)} to={brl(l.to)} strong />
      {l.card_equivalent != null ? <Row label={l.price_kind === "card" ? "No Pix fica" : "No cartão fica"} to={brl(l.card_equivalent)} /> : null}
      {l.cost != null ? <Row label={l.price_kind?.startsWith("decant") ? "Custo estimado" : "Custo atual"} to={brl(l.cost)} /> : null}
      {l.gross_profit != null ? <Row label="Lucro bruto" to={brl(l.gross_profit)} /> : null}
      {l.margin_percent != null ? <Row label="Margem bruta" to={`${String(l.margin_percent).replace(".", ",")}%`} /> : null}
      {l.below_cost ? <BelowCost text="ATENÇÃO: este preço fica abaixo do custo." /> : null}
    </div>
  );
}

function PreviewBody({ tool, p }: { tool: string; p: any }) {
  switch (tool) {
    case "price_change":
      return <PriceLineView l={p} />;
    case "price_batch":
      return (
        <div className="space-y-3">
          {(p.lines ?? []).map((l: any, i: number) => <PriceLineView key={i} l={l} compact />)}
          {p.below_cost ? <BelowCost text={`${p.below_cost} preço(s) abaixo do custo.`} /> : null}
        </div>
      );
    case "pricing_rules":
      return (
        <div className="space-y-2">
          {(p.changes ?? []).map((c: any) => (
            <Row key={c.key} label={c.label} from={fmtRule(c.key, c.from)} to={fmtRule(c.key, c.to)} strong />
          ))}
          <p className="text-sm text-muted-foreground">
            {[
              p.impact?.affected ? `${p.impact.affected} frasco(s) mudam de preço` : null,
              p.impact?.decant_affected ? `${p.impact.decant_affected} produto(s) com decant no preço global` : null,
              p.impact?.pix_affected ? `${p.impact.pix_affected} produto(s) têm o valor no cartão recalculado` : null,
            ].filter(Boolean).join(" · ") || "Nenhum produto muda de preço agora."}
          </p>
          {(p.impact?.sample ?? []).slice(0, 5).map((r: any) => <Row key={r.id} label={r.name} from={brl(r.from)} to={brl(r.to)} />)}
          {p.impact?.below_cost ? <BelowCost text={`${p.impact.below_cost} produto(s) ficariam abaixo do custo.`} /> : null}
        </div>
      );
    case "stock_change":
      return (
        <div className="space-y-3">
          {(p.lines ?? []).map((l: any) => (
            <div key={l.product.id} className="space-y-1.5">
              <div className="flex min-w-0 items-center gap-3">
                <Thumb src={l.product.image_url} alt={l.product.name} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{l.product.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {l.mode === "set" ? "Definir" : l.mode === "add" ? `Adicionar +${l.quantity}` : `Remover −${l.quantity}`}
                  </p>
                </div>
              </div>
              <Row label="Estoque Orium" from={`${l.before} un.`} to={`${l.after} un.`} strong />
              <Row label="Disponibilidade" from={l.availability_before} to={l.availability_after} />
            </div>
          ))}
        </div>
      );
    case "availability":
      return (
        <div className="space-y-2">
          <div className="flex min-w-0 items-center gap-3">
            <Thumb src={p.product?.image_url} alt={p.product?.name ?? ""} />
            <p className="min-w-0 truncate font-medium">{p.product?.name}</p>
          </div>
          <Row label="Disponibilidade manual" from={p.from} to={p.to} strong />
          <Row label="Estoque Orium" to={`${p.orium_stock} un.`} />
        </div>
      );
    case "coupon_create":
      return (
        <div className="space-y-2">
          <Row label="Código" to={p.code} strong />
          <Row label="Desconto" to={`${p.percent}%`} />
          <Row label="Validade" to={when(p.ends_at)} />
          <Row label="Limite de usos" to={p.max_redemptions ?? "sem limite"} />
          <Row label="Visibilidade" to={p.visibility} />
          <Row label="Vale para" to={p.applies_to === "FULL" ? "Frascos" : p.applies_to === "DECANT" ? "Decants" : "Frascos e decants"} />
        </div>
      );
    case "coupon_toggle":
      return <Row label={`Cupom ${p.code}`} from={p.from} to={p.to} strong />;
    case "promotion_create":
      return (
        <div className="space-y-2">
          <div className="flex min-w-0 items-center gap-3">
            <Thumb src={p.product?.image_url} alt={p.product?.name ?? ""} />
            <p className="min-w-0 truncate font-medium">{p.product?.name}</p>
          </div>
          <Row label="Desconto" to={`${p.percent}%`} strong />
          <Row label="Vale para" to={p.applies_to === "FULL" ? "Frasco" : p.applies_to === "DECANT" ? "Decants" : "Frasco e decants"} />
          {p.price_to != null ? <Row label="Frasco" from={brl(p.price_from)} to={brl(p.price_to)} /> : null}
          <Row label="Até" to={when(p.ends_at)} />
          {p.below_cost ? (
            <p className="flex items-center gap-2 rounded-lg bg-destructive/15 px-3 py-2 text-sm font-medium text-destructive">
              <AlertTriangle className="size-4 shrink-0" /> Com o desconto, o frasco fica abaixo do custo.
            </p>
          ) : null}
        </div>
      );
    case "promotion_end":
      return (
        <div className="space-y-1">
          <p className="font-medium">{p.product?.name}</p>
          {(p.promotions ?? []).map((x: any) => (
            <Row key={x.name} label={x.name} to={`${x.percent}% → encerrar`} />
          ))}
        </div>
      );
    case "order_status":
      return (
        <div className="space-y-2">
          <Row label={`Pedido ${p.order_number}`} to={p.customer ? String(p.customer).split(" ")[0] : ""} />
          <Row label="Situação" from={p.from} to={p.to} strong />
          <Row label="Total" to={brl(p.total)} />
        </div>
      );
    case "store_sale_register":
      return (
        <div className="space-y-2.5">
          {(p.lines ?? []).map((l: any, i: number) => (
            <div key={i} className="flex items-center gap-3">
              <Thumb src={l.product?.image_url} alt={l.product?.name ?? ""} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{l.product?.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {l.product?.brand ? `${l.product.brand} · ` : ""}
                  {l.quantity} × {l.variant === "DECANT" ? `Decant ${l.decant_ml}ml` : "Frasco"}
                </p>
              </div>
              <span className="shrink-0 text-sm tabular-nums">{brl(l.subtotal)}</span>
            </div>
          ))}
          <Row label="Pagamento" to={p.payment} />
          {p.customer_name ? <Row label="Cliente" to={p.customer_name} /> : null}
          <Row label="Total" to={brl(p.total)} strong />
        </div>
      );
    case "order_create":
      return (
        <div className="space-y-2.5">
          <Row label="Cliente" to={p.customer_name} />
          {(p.lines ?? []).map((l: any, i: number) => (
            <div key={i} className="flex items-center gap-3">
              <Thumb src={l.product?.image_url} alt={l.product?.name ?? ""} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{l.product?.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {l.quantity} × {l.variant === "DECANT" ? `Decant ${l.decant_ml}ml` : "Frasco"} · {brl(l.unit_price)}
                </p>
              </div>
              <span className="shrink-0 text-sm tabular-nums">{brl(l.subtotal)}</span>
            </div>
          ))}
          <Row label="Total" to={brl(p.total)} strong />
          <Row label="Pagamento" to={p.payment} />
          <Row label="Pago" to={brl(p.amount_paid)} />
          <Row label="Restante" to={brl(p.amount_due)} strong />
        </div>
      );
    case "order_to_restock":
    case "restock_add": {
      const lines = p.lines ?? p.items ?? [];
      return (
        <div className="space-y-2">
          {p.order_number ? <p className="text-sm text-muted-foreground">Pedido {p.order_number}</p> : null}
          {lines.map((l: any, i: number) => (
            <div key={i} className="flex items-center gap-3">
              <Thumb src={l.product?.image_url ?? l.image_url} alt={l.product?.name ?? l.name ?? ""} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {l.quantity}× {l.product?.name ?? l.name}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {l.supplier ?? ""} {l.unit_cost != null ? `· ${brl(l.unit_cost)}` : ""}
                  {l.status && l.status !== "disponivel" ? " · disponibilidade não confirmada" : ""}
                </p>
              </div>
            </div>
          ))}
          {p.total != null ? <Row label="Total estimado" to={brl(p.total)} strong /> : null}
        </div>
      );
    }
    case "command_save":
      return (
        <div className="space-y-3">
          <p className="font-display text-xl">“{p.name}”</p>
          <div>
            <p className="text-xs text-muted-foreground">Quando você disser</p>
            <p className="mt-1 flex flex-wrap gap-1.5">
              {(p.phrases ?? []).map((ph: string) => (
                <span key={ph} className="rounded-md bg-muted px-2 py-0.5 text-xs">{ph}</span>
              ))}
            </p>
          </div>
          {p.steps?.length ? (
            <div>
              <p className="text-xs text-muted-foreground">O Copilot irá</p>
              <ul className="mt-1 space-y-1 text-sm">
                {p.steps.map((st: string, i: number) => (
                  <li key={i} className="flex gap-2"><span className="text-gold">•</span>{st}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      );
    case "supplier_catalog":
      return (
        <div className="space-y-1">
          <p className="font-display text-xl break-words">{p.supplier}</p>
          <Row label="Catálogo público" from={p.from} to={p.to} strong />
          <p className="text-sm text-muted-foreground">Preços, disponibilidade e comparação continuam sincronizando{p.sync_continues ? "" : " (sincronização automática está pausada)"}. Escolhas por produto são mantidas.</p>
        </div>
      );
    case "command_delete":
      return (
        <div className="space-y-1">
          <p className="font-display text-xl">“{p.name}”</p>
          <p className="text-sm text-muted-foreground">O comando deixa de funcionar. Dá para desfazer logo depois.</p>
        </div>
      );
    default:
      return null;
  }
}

function OutcomeBody({ tool, preview, outcome }: { tool: string; preview: any; outcome: ActionOutcome }) {
  if (!outcome.ok)
    return <p className="text-sm text-destructive">Não consegui concluir. {outcome.error}</p>;
  const r = outcome.result ?? {};
  if (tool === "stock_change") {
    return (
      <div className="space-y-1.5 text-sm">
        {(r.done ?? []).map((d: any) => (
          <p key={d.product_id}>
            <span className="font-medium">{d.name}</span>: {d.before} → {d.after} un. · {d.available_before ? "Disponível" : "Indisponível"} →{" "}
            {d.available_after ? "Disponível" : "Indisponível"}
          </p>
        ))}
        {(r.failed ?? []).length ? (
          <p className="text-destructive">
            {r.done?.length ?? 0} concluída(s), {r.failed.length} falhou: {r.failed.map((f: any) => f.error).join("; ")}
          </p>
        ) : null}
      </div>
    );
  }
  if (tool === "price_change" || tool === "price_batch")
    return <p className="text-sm">{r.done?.length ?? 1} preço(s) atualizado(s){r.failed?.length ? ` · ${r.failed.length} falhou: ${r.failed.map((f: any) => f.error).join("; ")}` : ""}. Catálogo, carrinho e pedidos já usam o novo valor.</p>;
  if (tool === "pricing_rules") return <p className="text-sm">{r.changes?.length} regra(s) salva(s){r.recalculated ? " e catálogo recalculado" : ""}.</p>;
  if (tool === "restock_add") return <p className="text-sm">{r.added} novo(s), {r.updated} atualizado(s){r.failed?.length ? ` · ${r.failed.length} falhou` : ""}.</p>;
  if (tool === "store_sale_register") return <p className="text-sm">Venda de {brl(preview?.total)} registrada. Estoque e lucro atualizados.</p>;
  if (tool === "order_create") return <p className="text-sm">Pedido {r.order_number} criado como pendente.</p>;
  if (tool === "order_to_restock") return <p className="text-sm">Itens enviados para a reposição.</p>;
  if (tool === "coupon_create") return <p className="text-sm">Cupom {r.coupon?.code} criado.</p>;
  if (tool === "promotion_create") return <p className="text-sm">Promoção “{r.promotion?.name}” ativa.</p>;
  if (tool === "command_save") return <p className="text-sm">Comando “{r.name}” {r.updated ? "atualizado" : "criado"} e ativo. É só dizer.</p>;
  if (tool === "command_delete") return <p className="text-sm">Comando “{r.name}” excluído.</p>;
  if (tool === "order_status") return <p className="text-sm">Pedido: {r.from} → {r.to}.</p>;
  if (tool === "supplier_catalog") return <p className="text-sm">{preview?.supplier}: {preview?.to}.</p>;
  if (tool === "availability") return <p className="text-sm">{r.name}: {r.available_after ? "Disponível" : "Indisponível"} publicamente.</p>;
  return <p className="text-sm">Concluído.</p>;
}

const DONE_TITLE: Record<string, string> = {
  price_change: "Preço atualizado",
  price_batch: "Preços atualizados",
  pricing_rules: "Regras de preço atualizadas",
  stock_change: "Estoque atualizado",
  availability: "Disponibilidade atualizada",
  supplier_catalog: "Catálogo do fornecedor atualizado",
  coupon_create: "Cupom criado",
  coupon_toggle: "Cupom atualizado",
  promotion_create: "Promoção criada",
  promotion_end: "Promoção encerrada",
  order_status: "Pedido atualizado",
  restock_add: "Reposição atualizada",
  order_to_restock: "Reposição atualizada",
  command_save: "Comando salvo",
  command_delete: "Comando excluído",
  store_sale_register: "Venda registrada",
  order_create: "Pedido criado",
};

export function ActionCard({
  proposal,
  outcome,
  onOutcome,
  onCorrect,
}: {
  proposal: ActionProposal;
  outcome: ActionOutcome | undefined;
  onOutcome: (o: ActionOutcome | "canceled") => void;
  /** abre o microfone para corrigir falando */
  onCorrect?: (() => void) | undefined;
}) {
  const confirm = useServerFn(copilotConfirm);
  const cancel = useServerFn(copilotCancel);
  const undo = useServerFn(copilotUndo);
  const [busy, setBusy] = useState<null | "confirm" | "undo">(null);
  const [undone, setUndone] = useState(false);
  const [undoLeft, setUndoLeft] = useState(0);
  const [canceled, setCanceled] = useState(false);

  useEffect(() => {
    if (!outcome?.ok || !outcome.undoable) return;
    setUndoLeft(20);
    const t = setInterval(() => setUndoLeft((s) => (s <= 1 ? (clearInterval(t), 0) : s - 1)), 1000);
    return () => clearInterval(t);
  }, [outcome]);

  const critical = proposal.risk === "CRITICAL";
  const expired = !outcome && Date.parse(proposal.expires_at) < Date.now();

  const doConfirm = async () => {
    setBusy("confirm");
    try {
      onOutcome((await confirm({ data: { actionId: proposal.action_id } })) as ActionOutcome);
    } catch (e) {
      onOutcome({ ok: false, error: e instanceof Error ? e.message : "Falha." });
    } finally {
      setBusy(null);
    }
  };

  return (
    <CopilotActionCard done={!!outcome?.ok}>
      <div className="mb-3 flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <p className={cn("min-w-0 text-[11px] font-semibold tracking-[0.14em] uppercase", outcome?.ok ? "text-gold" : "text-muted-foreground")}>
          {outcome?.ok ? `✓ ${DONE_TITLE[proposal.tool] ?? "Concluído"}` : proposal.label}
        </p>
        {critical ? <span className="text-[11px] font-medium text-destructive">Confirmação forte</span> : null}
      </div>
      <div className="min-w-0 break-words">
        {outcome ? <OutcomeBody tool={proposal.tool} preview={proposal.preview} outcome={outcome} /> : <PreviewBody tool={proposal.tool} p={proposal.preview} />}
      </div>

      {!outcome && !canceled && !expired ? (
        <CopilotConfirmationActions
          confirmLabel={proposal.tool === "store_sale_register" ? "Confirmar venda" : "Confirmar"}
          busy={busy === "confirm"}
          disabled={busy != null}
          onConfirm={doConfirm}
          onCorrect={onCorrect}
          onCancel={async () => {
            setCanceled(true);
            onOutcome("canceled");
            await cancel({ data: { actionId: proposal.action_id } }).catch(() => null);
          }}
        />
      ) : null}
      {canceled ? <p className="mt-3 text-sm text-muted-foreground">Cancelado. Nada foi alterado.</p> : null}
      {expired && !canceled ? <p className="mt-3 text-sm text-muted-foreground">Confirmação expirada. Peça de novo.</p> : null}
      {outcome?.ok && undoLeft > 0 && !undone ? (
        <Button
          variant="ghost"
          size="sm"
          className="mt-3 rounded-full"
          disabled={busy != null}
          onClick={async () => {
            setBusy("undo");
            try {
              await undo({ data: { actionId: proposal.action_id } });
              setUndone(true);
            } catch (e) {
              onOutcome({ ok: false, error: e instanceof Error ? e.message : "Não consegui desfazer." });
            } finally {
              setBusy(null);
            }
          }}
        >
          <Undo2 className="size-4" /> Desfazer ({undoLeft}s)
        </Button>
      ) : null}
      {undone ? <p className="mt-3 text-sm text-muted-foreground">Desfeito. A alteração foi revertida e registrada.</p> : null}
    </CopilotActionCard>
  );
}
