import { useEffect, useMemo, useState } from "react";
import { Check, Copy, MessageCircle, Send } from "lucide-react";
import { toast } from "sonner";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { ActiveOrder } from "@/lib/dashboard.functions";

export const QUOTE_SUPPLIERS = [
  { id: "mrx", name: "MRX Perfumaria", phone: "5521984649975" },
  { id: "smart", name: "Smart Mania", phone: "5521983614620" },
  { id: "rasha", name: "Rasha Fragrâncias", phone: "5521999196700" },
] as const;

type Line = { key: string; name: string };

/**
 * Regra ÚNICA da consulta a fornecedores (Dashboard e Reposição):
 * só FRASCO entra. Decant é produção interna da Orium e nunca é consultado.
 */
export function isSupplierInquiryEligible(item: {
  decant?: boolean | null;
  variant?: string | null;
  purchase_mode?: string | null;
}): boolean {
  if (item.decant) return false;
  const v = String(item.purchase_mode ?? item.variant ?? "").toUpperCase();
  if (v.includes("DECANT")) return false;
  return true;
}

export const NO_BOTTLES_MSG = "Não há frascos pendentes para consultar com fornecedores.";

export function consolidate(orders: ActiveOrder[]): Line[] {
  const list: ConsultProduct[] = [];
  for (const o of orders)
    for (const i of o.items) {
      if (!isSupplierInquiryEligible(i)) continue;
      list.push({ key: i.product_id ?? `n:${i.name.trim().toLowerCase()}`, name: i.canonical_id || i.name });
    }
  return uniqueProducts(list);
}

export function buildMessage(lines: Line[]) {
  return namesMessage(lines.map((l) => l.name));
}

export function SupplierQuoteButton({ orders }: { orders: ActiveOrder[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <TooltipProvider delayDuration={300}><Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Consultar fornecedores"
            className="press grid size-9 shrink-0 place-items-center rounded-full text-[#FFD599] transition-colors hover:bg-white/[0.06]"
          >
            <MessageCircle className="size-4" strokeWidth={1.8} />
          </button>
        </TooltipTrigger>
        <TooltipContent>Consultar fornecedores</TooltipContent>
      </Tooltip></TooltipProvider>
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerContent className="mx-auto max-h-[92dvh] w-full max-w-lg">
          {open ? <QuoteBody orders={orders} /> : null}
        </DrawerContent>
      </Drawer>
    </>
  );
}

function QuoteBody({ orders }: { orders: ActiveOrder[] }) {
  const lines = useMemo(() => consolidate(orders), [orders]);
  const auto = useMemo(() => buildMessage(lines), [lines]);
  const [text, setText] = useState(auto);
  const [edited, setEdited] = useState(false);
  const [sel, setSel] = useState<string[]>([]);
  const [sent, setSent] = useState<string[]>([]);
  // Recalcula automaticamente se os pedidos mudarem (enquanto não editado manualmente)
  useEffect(() => { if (!edited) setText(auto); }, [auto, edited]);

  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const all = sel.length === QUOTE_SUPPLIERS.length;
  const open = (phone: string, id: string) => {
    if (!lines.length) return;
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, "_blank", "noopener");
    setSent((s) => (s.includes(id) ? s : [...s, id]));
  };
  const chosen = QUOTE_SUPPLIERS.filter((s) => sel.includes(s.id));
  const next = chosen.find((s) => !sent.includes(s.id));

  return (
    <div className="overflow-y-auto px-4 pb-[calc(env(safe-area-inset-bottom)+16px)] pt-2">
      <DrawerTitle className="text-[18px] font-semibold">Consultar fornecedores</DrawerTitle>
      <p className="mt-1 text-[12.5px] text-muted-foreground">
        {orders.length} {orders.length === 1 ? "pedido" : "pedidos"} em atenção · {lines.length}{" "}
        {lines.length === 1 ? "frasco" : "frascos"} para consultar · decants não entram
      </p>

      <h3 className="mt-4 mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Frascos</h3>
      {lines.length === 0 ? (
        <p className="text-sm text-muted-foreground">{NO_BOTTLES_MSG}</p>
      ) : (
        <ul className="adm-card divide-y divide-border/60 rounded-2xl px-3">
          {lines.map((l) => (
            <li key={l.key} className="py-2 text-[13.5px]">
              <span className="block min-w-0 truncate">{l.name}</span>
            </li>
          ))}
        </ul>
      )}
      {lines.length === 0 ? null : <>


      <div className="mt-4 mb-2 flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Enviar para</h3>
        <button type="button" className="text-[12px] font-medium text-gold"
          onClick={() => setSel(all ? [] : QUOTE_SUPPLIERS.map((s) => s.id))}>
          {all ? "Limpar" : "Selecionar todos"}
        </button>
      </div>
      <div className="grid gap-2">
        {QUOTE_SUPPLIERS.map((s) => {
          const on = sel.includes(s.id);
          const done = sent.includes(s.id);
          return (
            <div key={s.id} className={cn("btn-glass flex items-center gap-3 rounded-2xl px-3 py-2.5", on && "ring-1 ring-gold/70")}>
              <button type="button" onClick={() => toggle(s.id)} aria-pressed={on} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                <span className={cn("grid size-5 shrink-0 place-items-center rounded-md border", on ? "border-gold bg-gold text-gold-foreground" : "border-border")}>
                  {on ? <Check className="size-3.5" strokeWidth={3} /> : null}
                </span>
                <span className="min-w-0 truncate text-[14px] font-medium">{s.name}</span>
              </button>
              {on && chosen.length > 1 ? (
                done ? (
                  <span className="flex items-center gap-1 text-[12px] text-gold"><Check className="size-3.5" /> aberto</span>
                ) : (
                  <Button size="sm" variant="secondary" className="h-8 rounded-full" disabled={!lines.length} onClick={() => open(s.phone, s.id)}>
                    Enviar
                  </Button>
                )
              ) : null}
            </div>
          );
        })}
      </div>

      <h3 className="mt-4 mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Mensagem</h3>
      <Textarea value={text} onChange={(e) => { setText(e.target.value); setEdited(true); }} rows={9} className="text-[13px]" />
      {edited ? (
        <button type="button" className="mt-1 text-[12px] text-muted-foreground underline" onClick={() => setEdited(false)}>
          Restaurar mensagem automática
        </button>
      ) : null}

      <div className="mt-4 grid gap-2">
        <Button
          className="w-full"
          disabled={!chosen.length || !lines.length || (chosen.length > 1 && !next)}
          onClick={() => {
            const t = chosen.length === 1 ? chosen[0] : next;
            if (t) open(t.phone, t.id);
          }}
        >
          <Send className="size-4" />
          {chosen.length <= 1
            ? "Enviar lista pelo WhatsApp"
            : next
              ? `Enviar para ${next.name} (${sent.filter((x) => sel.includes(x)).length + 1}/${chosen.length})`
              : "Todos os fornecedores abertos"}
        </Button>
        <Button variant="secondary" className="w-full"
          onClick={async () => { try { await navigator.clipboard.writeText(text); toast.success("Lista copiada"); } catch { toast.error("Não foi possível copiar"); } }}>
          <Copy className="size-4" /> Copiar lista
        </Button>
      </div>
      </>}
    </div>
  );
}

/* ───────── Reposição: consulta de disponibilidade só com nomes ───────── */

export type ConsultProduct = { key: string; name: string };

export function namesMessage(names: string[]) {
  return `Olá! Consegue verificar a disponibilidade desses produtos?\n\n${names.map((n) => `• ${n}`).join("\n")}\n\nObrigado!`;
}

/** Remove duplicados (mesmo produto ou mesmo nome) mantendo a ordem alfabética. */
export function uniqueProducts(list: ConsultProduct[]): ConsultProduct[] {
  const seenKey = new Set<string>();
  const seenName = new Set<string>();
  const out: ConsultProduct[] = [];
  for (const p of list) {
    const n = p.name.trim().toLowerCase();
    if (seenKey.has(p.key) || seenName.has(n)) continue;
    seenKey.add(p.key);
    seenName.add(n);
    out.push(p);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

export function RestockConsultSheet({ open, onOpenChange, products }: { open: boolean; onOpenChange: (o: boolean) => void; products: ConsultProduct[] }) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="mx-auto max-h-[92dvh] w-full max-w-lg">
        {open ? <ConsultBody products={products} /> : null}
      </DrawerContent>
    </Drawer>
  );
}

function ConsultBody({ products }: { products: ConsultProduct[] }) {
  const items = useMemo(() => uniqueProducts(products), [products]);
  const [picked, setPicked] = useState<string[]>(() => items.map((i) => i.key));
  const [sel, setSel] = useState<string[]>([]);
  const [sent, setSent] = useState<string[]>([]);
  const names = items.filter((i) => picked.includes(i.key)).map((i) => i.name);
  const text = namesMessage(names);

  const allItems = picked.length === items.length;
  const togglePick = (k: string) => setPicked((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]));
  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const allSup = sel.length === QUOTE_SUPPLIERS.length;
  const chosen = QUOTE_SUPPLIERS.filter((s) => sel.includes(s.id));
  const send = (phone: string, id: string) => {
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, "_blank", "noopener");
    setSent((s) => (s.includes(id) ? s : [...s, id]));
  };
  const Box = ({ on }: { on: boolean }) => (
    <span className={cn("grid size-5 shrink-0 place-items-center rounded-md border", on ? "border-gold bg-gold text-gold-foreground" : "border-border")}>
      {on ? <Check className="size-3.5" strokeWidth={3} /> : null}
    </span>
  );

  return (
    <div className="overflow-y-auto px-4 pb-[calc(env(safe-area-inset-bottom)+16px)] pt-2">
      <DrawerTitle className="text-[18px] font-semibold">Consultar fornecedores</DrawerTitle>
      <p className="mt-1 text-[12.5px] text-muted-foreground">Só consulta disponibilidade — nada na reposição é alterado.</p>

      <div className="mt-4 mb-2 flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Produtos ({names.length}/{items.length})</h3>
        <button type="button" className="text-[12px] font-medium text-gold" onClick={() => setPicked(allItems ? [] : items.map((i) => i.key))}>
          {allItems ? "Limpar" : "Selecionar todos"}
        </button>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">A reposição está vazia.</p>
      ) : (
        <ul className="adm-card max-h-64 divide-y divide-border/60 overflow-y-auto rounded-2xl px-3">
          {items.map((i) => {
            const on = picked.includes(i.key);
            return (
              <li key={i.key}>
                <button type="button" aria-pressed={on} onClick={() => togglePick(i.key)} className="flex w-full items-center gap-3 py-2.5 text-left text-[13.5px]">
                  <Box on={on} />
                  <span className="min-w-0 truncate">{i.name}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-4 mb-2 flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Enviar para</h3>
        <button type="button" className="text-[12px] font-medium text-gold" onClick={() => setSel(allSup ? [] : QUOTE_SUPPLIERS.map((s) => s.id))}>
          {allSup ? "Limpar" : "Selecionar todos"}
        </button>
      </div>
      <div className="grid gap-2">
        {QUOTE_SUPPLIERS.map((s) => {
          const on = sel.includes(s.id);
          const done = sent.includes(s.id);
          return (
            <div key={s.id} className={cn("btn-glass flex items-center gap-3 rounded-2xl px-3 py-2.5", on && "ring-1 ring-gold/70")}>
              <button type="button" onClick={() => toggle(s.id)} aria-pressed={on} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                <Box on={on} />
                <span className="min-w-0 truncate text-[14px] font-medium">{s.name}</span>
              </button>
              {on && chosen.length > 1 ? (
                <Button size="sm" variant="secondary" className="h-8 rounded-full" disabled={!names.length} onClick={() => send(s.phone, s.id)}>
                  {done ? <><Check className="size-3.5" /> Aberto</> : "Enviar"}
                </Button>
              ) : null}
            </div>
          );
        })}
      </div>

      <h3 className="mt-4 mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Mensagem</h3>
      <pre className="adm-card whitespace-pre-wrap rounded-2xl p-3 font-sans text-[13px] leading-relaxed">{text}</pre>

      <div className="mt-4 grid gap-2">
        {chosen.length <= 1 ? (
          <Button className="w-full" disabled={chosen.length !== 1 || !names.length} onClick={() => { const c = chosen[0]; if (c) send(c.phone, c.id); }}>
            <Send className="size-4" /> Enviar pelo WhatsApp
          </Button>
        ) : null}
        <Button variant="secondary" className="w-full" disabled={!names.length}
          onClick={async () => { try { await navigator.clipboard.writeText(text); toast.success("Lista copiada"); } catch { toast.error("Não foi possível copiar"); } }}>
          <Copy className="size-4" /> Copiar lista
        </Button>
      </div>
    </div>
  );
}
