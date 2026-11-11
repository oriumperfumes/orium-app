import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Loader2, Search, UserPlus, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

export type PickedCustomer = { customerId: string | null; name: string; phone: string };
type Row = { id: string; name: string | null; phone: string | null; phone_normalized: string | null; orders: number; last_order_at: string | null };

/** "+55 (21) 99999-1234" e "21999991234" viram o mesmo número (11 dígitos, sem DDI). */
export const normPhone = (v: string) => {
  let d = (v ?? "").replace(/\D/g, "");
  if (d.length > 11 && d.startsWith("55")) d = d.slice(-11);
  return d;
};
export const fmtPhone = (v: string | null | undefined) => {
  const d = normPhone(v ?? "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return v ?? "";
};
const maskPhone = (v: string) => {
  const d = normPhone(v).slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
};

async function pick(q: string | null, limit = 12): Promise<Row[]> {
  const { data, error } = await (supabase as any).rpc("crm_customer_pick", { p_q: q, p_limit: limit });
  if (error) throw error;
  return (data ?? []) as Row[];
}

function useDebounced<T>(v: T, ms = 220) {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
}

/**
 * Cliente do pedido: escolhe uma ficha existente (vincula pelo id) ou cadastra
 * um cliente novo (a ficha é criada ao salvar, se o telefone ainda não existir).
 *
 * Tudo acontece no próprio lugar (sem gaveta por cima): a busca abre logo
 * abaixo do campo, então funciona dentro de qualquer janela do Admin.
 */
export function CustomerPicker({
  value,
  onChange,
  inlineNew = true,
  label = "Cliente",
}: {
  value: PickedCustomer;
  onChange: (v: PickedCustomer) => void;
  /** false = os campos de nome/WhatsApp ficam no formulário de quem usa (edição) */
  inlineNew?: boolean;
  label?: string;
}) {
  const [searching, setSearching] = useState(false);
  const [q, setQ] = useState("");
  const dq = useDebounced(q.trim());
  const [creating, setCreating] = useState(!value.customerId && !!value.name);
  const inputRef = useRef<HTMLInputElement>(null);

  const list = useQuery({
    queryKey: ["customer-pick", dq],
    enabled: searching,
    staleTime: 15_000,
    queryFn: () => pick(dq || null, 8),
  });

  // cliente novo: avisa se o WhatsApp digitado já tem ficha
  const phoneDigits = normPhone(value.phone);
  const dup = useQuery({
    queryKey: ["customer-dup", phoneDigits],
    enabled: creating && !value.customerId && phoneDigits.length >= 10,
    queryFn: async () => (await pick(phoneDigits, 3)).filter((r) => r.phone_normalized === phoneDigits),
  });

  const openSearch = () => {
    setSearching(true);
    setTimeout(() => inputRef.current?.focus(), 30);
  };
  const choose = (r: Row) => {
    onChange({ customerId: r.id, name: r.name ?? "", phone: fmtPhone(r.phone ?? r.phone_normalized) });
    setCreating(false);
    setSearching(false);
    setQ("");
  };
  const createNew = () => {
    const digits = /\d{4,}/.test(q);
    onChange({ customerId: null, name: digits ? "" : q.trim(), phone: digits ? maskPhone(q) : "" });
    setCreating(true);
    setSearching(false);
    setQ("");
  };
  const initials = (n: string) =>
    n
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("") || "?";

  const field =
    "w-full rounded-[16px] bg-[#1F1F1F] px-4 text-[15.5px] text-white outline-none placeholder:text-[#6F6F6F] focus:ring-2 focus:ring-[#FFD599]/50";

  return (
    <div className="space-y-2">
      {label ? <p className="px-1 text-[13px] font-semibold text-[#A9A9A9]">{label}</p> : null}

      {searching ? (
        <div className="adm-pop overflow-hidden rounded-[20px] bg-[#1A1A1A] ring-1 ring-white/[0.06]">
          <div className="flex items-center gap-2 border-b border-white/[0.06] px-4">
            <Search className="size-[18px] shrink-0 text-[#8C8C8C]" />
            <input
              ref={inputRef}
              data-slot="input-group-control"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setSearching(false);
                if (e.key === "Enter" && list.data?.[0]) {
                  e.preventDefault();
                  choose(list.data[0]);
                }
              }}
              placeholder="Nome ou WhatsApp do cliente"
              className="h-[52px] min-w-0 flex-1 bg-transparent text-[15.5px] outline-none placeholder:text-[#6F6F6F]"
            />
            {list.isFetching ? <Loader2 className="size-4 animate-spin text-[#8C8C8C]" /> : null}
            <button type="button" aria-label="Fechar busca" onClick={() => setSearching(false)} className="press grid size-8 place-items-center rounded-full bg-[#2A2A2A]">
              <X className="size-4" />
            </button>
          </div>
          <p className="px-4 pt-2.5 pb-1 text-[12px] font-semibold text-[#6F6F6F]">{dq ? "Encontrados" : "Clientes recentes"}</p>
          <ul className="max-h-[280px] overflow-y-auto px-1.5 pb-1.5">
            {list.error ? <li className="px-3 py-3 text-[13.5px] text-[#FF9A8A]">Não foi possível carregar os clientes.</li> : null}
            {list.data?.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => choose(r)} className="press flex w-full items-center gap-3 rounded-[14px] px-2.5 py-2.5 text-left hover:bg-white/[0.05]">
                  <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[#2A2A2A] text-[13px] font-bold">{initials(r.name ?? "?")}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-bold">{r.name ?? "Sem nome"}</span>
                    <span className="block truncate text-[12.5px] text-[#8C8C8C]">
                      {fmtPhone(r.phone ?? r.phone_normalized) || "sem WhatsApp"} · {r.orders} {r.orders === 1 ? "pedido" : "pedidos"}
                    </span>
                  </span>
                  {value.customerId === r.id ? <Check className="size-4 text-[#FFD599]" strokeWidth={3} /> : null}
                </button>
              </li>
            ))}
            {list.data && list.data.length === 0 ? <li className="px-3 py-3 text-[13.5px] text-[#8C8C8C]">Ninguém com “{q}”.</li> : null}
          </ul>
          <button
            type="button"
            onClick={createNew}
            className="press flex h-12 w-full items-center gap-2 border-t border-white/[0.06] px-4 text-[14px] font-bold text-[#FFD599] hover:bg-white/[0.03]"
          >
            <UserPlus className="size-4" /> {q.trim() ? `Cadastrar “${q.trim()}” como cliente novo` : "Cadastrar cliente novo"}
          </button>
        </div>
      ) : value.customerId ? (
        <div className="flex items-center gap-3 rounded-[20px] bg-[#1F1F1F] p-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-full bg-[#FFD599] text-[14px] font-bold text-[#15130F]">{initials(value.name || "?")}</span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15.5px] font-bold">{value.name || "Cliente"}</p>
            <p className="truncate text-[12.5px] text-[#8C8C8C]">{value.phone || "sem WhatsApp"} · cliente cadastrado</p>
          </div>
          <button type="button" onClick={openSearch} className="press h-10 rounded-full bg-[#2A2A2A] px-4 text-[13.5px] font-bold">
            Trocar
          </button>
        </div>
      ) : creating && inlineNew ? (
        <div className="space-y-2 rounded-[20px] bg-[#1A1A1A] p-3 ring-1 ring-white/[0.06]">
          <div className="flex items-center justify-between px-1">
            <p className="flex items-center gap-1.5 text-[13px] font-bold text-[#FFD599]">
              <UserPlus className="size-4" /> Cliente novo
            </p>
            <button type="button" className="press text-[13px] font-semibold text-[#A9A9A9] hover:text-white" onClick={openSearch}>
              Buscar cadastrado
            </button>
          </div>
          <input data-slot="input-group-control" placeholder="Nome" value={value.name} onChange={(e) => onChange({ ...value, name: e.target.value })} className={cn(field, "h-12")} />
          <input
            data-slot="input-group-control"
            placeholder="WhatsApp"
            inputMode="numeric"
            value={value.phone}
            onChange={(e) => onChange({ ...value, phone: maskPhone(e.target.value) })}
            className={cn(field, "h-12")}
          />
          {dup.data?.length ? (
            <div className="adm-pop rounded-[16px] bg-[#2A2418] p-3 text-[13px]">
              <p className="font-semibold text-[#FFD599]">Esse WhatsApp já tem cadastro:</p>
              {dup.data.map((r) => (
                <button key={r.id} type="button" onClick={() => choose(r)} className="press mt-2 flex w-full items-center justify-between gap-2 rounded-[12px] bg-[#15130F] px-3 py-2.5 text-left">
                  <span className="truncate">
                    {r.name ?? "Sem nome"} · {r.orders} {r.orders === 1 ? "pedido" : "pedidos"}
                  </span>
                  <span className="shrink-0 font-bold text-[#FFD599]">Usar este</span>
                </button>
              ))}
            </div>
          ) : null}
          <p className="px-1 text-[12px] text-[#6F6F6F]">A ficha é criada ao salvar, sem duplicar se o número já existir.</p>
        </div>
      ) : (
        <button
          type="button"
          onClick={openSearch}
          className="press flex h-[52px] w-full items-center gap-2.5 rounded-[16px] bg-[#1F1F1F] px-4 text-left text-[15px] text-[#8C8C8C] transition-colors hover:bg-[#262626]"
        >
          <Search className="size-[18px]" />
          {inlineNew ? "Buscar cliente ou cadastrar novo" : "Sem cadastro vinculado · buscar ou trocar"}
        </button>
      )}
    </div>
  );
}
