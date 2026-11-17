/**
 * VENDI UMA PEÇA DO MOSTRUÁRIO (Negociação)
 *
 * Dois passos na mesma janela: 1) escolher a peça na grade de fotos reais;
 * 2) por quanto vendeu (+ custo opcional para o lucro), pagamento, cliente.
 * Ao confirmar, a venda entra em Vendas da loja e a peça sai da vitrine
 * como Vendida.
 */
import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, CalendarClock, Check, Droplet, Gem, Search, TrendingUp, X } from "lucide-react";
import { GoldButton, SoftButton } from "@/components/orium/admin/PanelKit";
import { listNegotiationAdmin, sellNegotiationItem } from "@/lib/negotiation.functions";
import { negotiationPhoto } from "@/lib/negotiation";
import { brl } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CustomerField, MoneyInput, PaymentPicker, SectionLabel, parseMoney, saleUid, toLocalInput } from "./parts";

type Piece = {
  id: string;
  name: string;
  brand: string | null;
  volume_ml: number | null;
  remaining_ml: number | null;
  image_url: string | null;
  status: string;
  condition_note: string | null;
};

const STATUS: Record<string, { label: string; dot: string }> = {
  AVAILABLE: { label: "Disponível", dot: "#7FCF9F" },
  NEGOTIATING: { label: "Negociando", dot: "#F2C46D" },
  HIDDEN: { label: "Oculta", dot: "#6F6F6F" },
};

export function ShowcaseSale({ onClose, onSaved }: { onClose: () => void; onSaved: (saleId: string, total: number) => void }) {
  const [piece, setPiece] = useState<Piece | null>(null);
  const [q, setQ] = useState("");
  const [price, setPrice] = useState("");
  const [cost, setCost] = useState("");
  const [payment, setPayment] = useState<string | null>(null);
  const [customer, setCustomer] = useState<{ id: string | null; name: string | null }>({ id: null, name: null });
  const [soldAt, setSoldAt] = useState<string | null>(null);
  const [showDate, setShowDate] = useState(false);
  const key = useRef(saleUid());

  const { data, isLoading } = useQuery({
    queryKey: ["negotiation-admin"],
    queryFn: () => listNegotiationAdmin(),
    staleTime: 15_000,
  });

  const pieces = useMemo(() => {
    const all = ((data?.items ?? []) as Piece[]).filter((p) => p.status !== "SOLD");
    const order = (s: string) => (s === "NEGOTIATING" ? 0 : s === "AVAILABLE" ? 1 : 2);
    const term = q.trim().toLowerCase();
    return all
      .filter((p) => !term || `${p.name} ${p.brand ?? ""}`.toLowerCase().includes(term))
      .sort((a, b) => order(a.status) - order(b.status));
  }, [data, q]);

  const value = parseMoney(price);
  const costValue = parseMoney(cost);
  const profit = value != null && costValue != null ? value - costValue : null;
  const missing = !piece ? "Escolha a peça" : !(value && value > 0) ? "Informe o valor" : !payment ? "Escolha o pagamento" : null;

  const sell = useMutation({
    mutationFn: () =>
      sellNegotiationItem({
        data: {
          itemId: piece!.id,
          price: value!,
          cost: costValue,
          paymentMethod: payment!,
          customerId: customer.id,
          customerName: customer.name,
          soldAt,
          idempotencyKey: key.current,
        },
      }),
    onSuccess: (res) => onSaved(res.id, value ?? 0),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não consegui registrar a venda."),
  });

  /* ── passo 1: escolher a peça ─────────────────────────────────── */
  if (!piece) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="shrink-0 px-5 pb-3 lg:px-6">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-4 size-[18px] -translate-y-1/2 text-[#6F6F6F]" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar peça do mostruário"
              className="pk-field h-12 w-full min-w-0 rounded-[16px] bg-[#232323] pr-4 pl-11 text-[16px] text-white outline-none placeholder:text-[#6F6F6F] focus:bg-[#2A2A2A]"
            />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-6 lg:px-6">
          {isLoading ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="admin-skeleton aspect-[4/5] rounded-[22px]" />
              ))}
            </div>
          ) : pieces.length === 0 ? (
            <div className="flex flex-col items-center rounded-[24px] bg-[#1A1A1A] px-6 py-12 text-center">
              <span className="grid size-12 place-items-center rounded-full bg-[#232323] text-[#FFD599]">
                <Gem className="size-5" />
              </span>
              <p className="mt-3 text-[16px] font-bold">{q ? "Nenhuma peça com esse nome" : "Nenhuma peça no mostruário"}</p>
              <p className="mt-1 text-[13.5px] text-[#8C8C8C]">Peças vendidas não aparecem aqui.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {pieces.map((p, i) => {
                const st = STATUS[p.status] ?? STATUS.AVAILABLE!;
                const img = negotiationPhoto(p.image_url, "card");
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPiece(p)}
                    className="pk-tile pk-in press group flex min-w-0 flex-col overflow-hidden rounded-[22px] bg-[#1A1A1A] text-left"
                    style={{ ["--i" as string]: i }}
                  >
                    <span className="relative block aspect-[4/5] w-full overflow-hidden bg-[#232323]">
                      {img ? (
                        <img src={img} alt="" loading="lazy" className="pk-tile-img size-full object-cover group-hover:scale-[1.04]" />
                      ) : (
                        <span className="grid size-full place-items-center text-[#6F6F6F]">
                          <Gem className="size-6" />
                        </span>
                      )}
                      <span className="absolute top-2 left-2 inline-flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-[11.5px] font-semibold text-white backdrop-blur">
                        <span className="size-1.5 rounded-full" style={{ background: st.dot }} />
                        {st.label}
                      </span>
                    </span>
                    <span className="block min-w-0 p-3">
                      <span className="block truncate text-[12px] text-[#8C8C8C]">{p.brand ?? "Orium"}</span>
                      <span className="block truncate text-[14px] font-bold">{p.name}</span>
                      {p.remaining_ml != null ? (
                        <span className="mt-1 inline-flex items-center gap-1 text-[12px] font-semibold text-[#FFD599]">
                          <Droplet className="size-3" />
                          {p.remaining_ml}
                          {p.volume_ml ? `/${p.volume_ml}` : ""} ml
                        </span>
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <footer className="pk-footer flex shrink-0 items-center gap-2 border-t border-white/[0.06] bg-[#121212] px-5 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] lg:px-6 lg:pb-5">
          <p className="min-w-0 flex-1 text-[13px] text-[#8C8C8C]">Toque na peça que você vendeu.</p>
          <SoftButton onClick={onClose} icon={<X />}>
            Cancelar
          </SoftButton>
        </footer>
      </div>
    );
  }

  /* ── passo 2: valor, pagamento e cliente ──────────────────────── */
  const img = negotiationPhoto(piece.image_url, "full");
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="ui-view-in min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain px-5 pt-1 pb-6 lg:px-6">
        {/* a peça escolhida */}
        <div className="showcase-hero relative overflow-hidden rounded-[26px] bg-[#1A1A1A]">
          <div className="flex min-w-0 items-center gap-4 p-3.5">
            <span className="relative size-[88px] shrink-0 overflow-hidden rounded-[18px] bg-[#232323]">
              {img ? <img src={img} alt="" className="size-full object-cover" /> : <Gem className="m-auto mt-8 size-6 text-[#6F6F6F]" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#FFD599]/12 px-2.5 py-0.5 text-[11.5px] font-bold tracking-wide text-[#FFD599] uppercase">
                <Gem className="size-3" /> Mostruário
              </span>
              <span className="mt-1.5 block truncate text-[12.5px] text-[#8C8C8C]">{piece.brand ?? "Orium"}</span>
              <span className="block truncate text-[17px] font-bold tracking-[-0.015em]">{piece.name}</span>
              {piece.remaining_ml != null ? (
                <span className="block text-[12.5px] text-[#A9A9A9]">
                  {piece.remaining_ml}
                  {piece.volume_ml ? ` de ${piece.volume_ml}` : ""} ml no frasco
                </span>
              ) : null}
            </span>
            <button
              type="button"
              onClick={() => setPiece(null)}
              className="press inline-flex h-9 shrink-0 items-center gap-1 self-start rounded-full bg-[#232323] px-3 text-[12.5px] font-semibold text-[#D4D4D4] hover:bg-[#2E2E2E]"
            >
              <ArrowLeft className="size-3.5" /> Trocar
            </button>
          </div>
        </div>

        <section>
          <SectionLabel>Por quanto você vendeu?</SectionLabel>
          <MoneyInput id="showcase-price" value={price} onChange={setPrice} autoFocus />
        </section>

        <section>
          <SectionLabel right={<span className="text-[12.5px] text-[#6F6F6F]">Opcional</span>}>Quanto ela custou</SectionLabel>
          <MoneyInput value={cost} onChange={setCost} size="md" />
          <div
            className={cn(
              "grid transition-[grid-template-rows,opacity] duration-300 ease-[var(--ease-orium)]",
              profit != null ? "mt-2.5 grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
            )}
          >
            <div className="min-h-0 overflow-hidden">
              <div className={cn("flex items-center gap-2 rounded-[16px] px-4 py-3 text-[14px] font-semibold", (profit ?? 0) >= 0 ? "bg-[#7FCF9F]/10 text-[#7FCF9F]" : "bg-[#FF9A8A]/10 text-[#FF9A8A]")}>
                <TrendingUp className="size-4" />
                Lucro de {brl(profit ?? 0)}
                {value ? <span className="ml-auto opacity-75 tabular-nums">{Math.round(((profit ?? 0) / value) * 100)}%</span> : null}
              </div>
            </div>
          </div>
        </section>

        <section>
          <SectionLabel>Pagamento</SectionLabel>
          <PaymentPicker value={payment} onChange={setPayment} />
        </section>

        <section>
          <SectionLabel>Cliente</SectionLabel>
          <CustomerField value={customer} onChange={setCustomer} />
        </section>

        <section>
          {showDate ? (
            <>
              <SectionLabel>Data e hora da venda</SectionLabel>
              <input
                type="datetime-local"
                className="pk-field h-12 w-full min-w-0 rounded-[16px] bg-[#232323] px-4 text-[16px] text-white outline-none [color-scheme:dark] focus:bg-[#2A2A2A]"
                value={toLocalInput(soldAt ?? new Date().toISOString())}
                onChange={(e) => setSoldAt(e.target.value ? new Date(e.target.value).toISOString() : null)}
              />
            </>
          ) : (
            <button
              type="button"
              onClick={() => setShowDate(true)}
              className="press inline-flex h-10 items-center gap-2 rounded-full bg-[#1A1A1A] px-4 text-[13.5px] font-semibold text-[#BABABA] hover:bg-[#202020] hover:text-white"
            >
              <CalendarClock className="size-4" /> Agora · mudar data
            </button>
          )}
        </section>

        <p className="text-[12.5px] leading-snug text-[#6F6F6F]">
          Ao confirmar, a venda entra no faturamento da loja e a peça sai da vitrine como <b className="text-[#A9A9A9]">Vendida</b>.
        </p>
      </div>

      <footer className="pk-footer shrink-0 border-t border-white/[0.06] bg-[#121212] px-5 pt-3.5 pb-[max(1rem,env(safe-area-inset-bottom))] lg:px-6 lg:pb-5">
        <div className="flex min-w-0 items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[12.5px] font-semibold text-[#8C8C8C]">Total da venda</p>
            <p className="mt-0.5 text-[30px] leading-none font-bold tracking-[-0.04em] tabular-nums">{value ? brl(value) : "—"}</p>
          </div>
          <p className={cn("pb-1 text-right text-[12.5px] font-semibold", missing ? "text-[#FFD599]" : "text-[#7FCF9F]")}>
            {missing ?? (
              <span className="inline-flex items-center gap-1">
                <Check className="size-3.5" strokeWidth={3} /> Pronto
              </span>
            )}
          </p>
        </div>
        <div className="mt-3 flex gap-2">
          <SoftButton aria-label="Voltar" onClick={() => setPiece(null)} className="w-[52px] px-0" icon={<ArrowLeft />} />
          <GoldButton
            className="flex-1"
            disabled={!!missing}
            loading={sell.isPending}
            icon={<Check className="size-[18px]" strokeWidth={2.6} />}
            onClick={() => sell.mutate()}
          >
            Confirmar venda
          </GoldButton>
        </div>
      </footer>
    </div>
  );
}
