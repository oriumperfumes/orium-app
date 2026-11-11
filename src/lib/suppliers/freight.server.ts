import { addBusinessDays, todayBrasilia } from "@/lib/supplier-lead";
import { buildSupplyPackages } from "./freight";

const digits = (v: unknown) => String(v ?? "").replace(/\D/g, "");

export type SupplyFreightResult =
  | {
      ok: true;
      originCep: string;
      destinationCep: string;
      units: number;
      volumes: number;
      weightKg: number;
      options: Array<{ service: string; carrier: string; price: number; days: number | null; arrival: string | null }>;
    }
  | { ok: false; reason: "PICKUP" | "NO_ORIGIN" | "NO_DESTINATION" | "MISSING_PACKAGE" | "NO_TOKEN" | "NO_SERVICE" | "PROVIDER_ERROR"; message: string; missing?: string[] };

/** CEP onde a Orium recebe mercadorias (próprio, ou o CEP cadastrado da loja). */
export async function receivingCep(db: any): Promise<string | null> {
  const { data } = await db.from("shipping_settings").select("receiving_cep, origin_cep").maybeSingle();
  const cep = digits(data?.receiving_cep) || digits(data?.origin_cep);
  return cep.length === 8 ? cep : null;
}

/**
 * Cotação real de abastecimento: origem = CEP do FORNECEDOR, destino = Orium.
 * Uma consulta pela remessa inteira (soma dos volumes), nunca uma por perfume.
 */
export async function quoteSupplyFreight(db: any, supplierId: string, units: number, opts: { declaredValue?: number | null } = {}): Promise<SupplyFreightResult> {
  const { data: s } = await db
    .from("suppliers")
    .select("id, name, supply_mode, origin_cep, freight_services, pkg_height_cm, pkg_width_cm, pkg_length_cm, unit_weight_g, units_per_package, declared_value")
    .eq("id", supplierId)
    .maybeSingle();
  if (!s) throw new Error("Fornecedor não encontrado.");
  if (s.supply_mode === "pickup") return { ok: false, reason: "PICKUP", message: "Retirada própria: não há frete de transportadora. Use o custo de deslocamento." };
  const origin = digits(s.origin_cep);
  if (origin.length !== 8) return { ok: false, reason: "NO_ORIGIN", message: `Informe o CEP real de origem de ${s.name}.`, missing: ["CEP de origem"] };
  const destination = await receivingCep(db);
  if (!destination) return { ok: false, reason: "NO_DESTINATION", message: "Cadastre o CEP da Orium (Configurações → Entregas) ou o CEP de recebimento.", missing: ["CEP da Orium"] };
  const pk = buildSupplyPackages(s, Math.round(units));
  if (!pk.ok) return { ok: false, reason: "MISSING_PACKAGE", message: `Faltam dados da encomenda: ${pk.missing.join(", ")}.`, missing: pk.missing };

  const { superfreteQuote, describeProviderError } = await import("@/lib/shipping.server");
  const declared = opts.declaredValue ?? (s.declared_value != null ? Number(s.declared_value) : 0);
  const insurancePer = pk.packages.length ? declared / pk.packages.length : 0;
  try {
    // um pedido por volume distinto (volumes iguais cotados uma vez e multiplicados)
    const byShape = new Map<string, { pkg: (typeof pk.packages)[number]; count: number }>();
    for (const p of pk.packages) {
      const k = JSON.stringify(p);
      const cur = byShape.get(k);
      if (cur) cur.count++;
      else byShape.set(k, { pkg: p, count: 1 });
    }
    const totals = new Map<string, { service: string; carrier: string; price: number; days: number | null; n: number }>();
    for (const { pkg, count } of byShape.values()) {
      const opts2 = await superfreteQuote({ originCep: origin, destinationCep: destination, pkg, insuranceValue: insurancePer, services: s.freight_services ?? undefined });
      for (const o of opts2) {
        const t = totals.get(o.providerServiceId) ?? { service: o.service, carrier: o.carrier, price: 0, days: o.days, n: 0 };
        t.price += o.price * count;
        t.days = Math.max(t.days ?? 0, o.days ?? 0) || null;
        t.n++;
        totals.set(o.providerServiceId, t);
      }
    }
    const options = [...totals.values()]
      .filter((t) => t.n === byShape.size)
      .map((t) => ({ service: t.service, carrier: t.carrier, price: Math.round(t.price * 100) / 100, days: t.days, arrival: t.days != null ? addBusinessDays(todayBrasilia(), t.days) : null }))
      .sort((a, b) => a.price - b.price);
    if (!options.length) return { ok: false, reason: "NO_SERVICE", message: "A SuperFrete não devolveu nenhum serviço para essa origem/embalagem. Registre a cotação do fornecedor." };
    return { ok: true, originCep: origin, destinationCep: destination, units, volumes: pk.packages.length, weightKg: pk.totalWeightKg, options };
  } catch (e) {
    if ((e as { code?: string })?.code === "NO_TOKEN") return { ok: false, reason: "NO_TOKEN", message: "A conta SuperFrete não está conectada. Registre a cotação do fornecedor." };
    console.error("[frete-abastecimento]", e instanceof Error ? e.message : e);
    return { ok: false, reason: "PROVIDER_ERROR", message: `${describeProviderError(e)} Você pode registrar a cotação enviada pelo fornecedor.` };
  }
}

/** Frete da remessa para N unidades a partir do que está CADASTRADO (sem consulta externa). */
export function shipmentFreightFromData(
  s: { supply_mode?: string | null; shipping_cost?: number | null; travel_cost?: number | null },
  latestQuote: { price: number; units: number | null; source: string; status: string; created_at: string } | null,
): { amount: number | null; source: "pickup" | "travel" | "quote" | "fixed" | "unknown"; label: string } {
  if (s.supply_mode === "pickup") {
    const t = s.travel_cost != null ? Number(s.travel_cost) : null;
    return t != null && t > 0
      ? { amount: t, source: "travel", label: `Deslocamento R$ ${t.toFixed(2)} por viagem` }
      : { amount: 0, source: "pickup", label: "Retirada própria (sem deslocamento registrado)" };
  }
  if (latestQuote) {
    const who = latestQuote.source === "superfrete" ? "SuperFrete" : "informado pelo fornecedor";
    return { amount: Number(latestQuote.price), source: "quote", label: `Frete ${who}${latestQuote.units ? ` (${latestQuote.units} un.)` : ""}${latestQuote.status === "confirmed" ? " · confirmado" : " · estimado"}` };
  }
  if (s.shipping_cost != null) return { amount: Number(s.shipping_cost), source: "fixed", label: `Frete cadastrado R$ ${Number(s.shipping_cost).toFixed(2)}` };
  return { amount: null, source: "unknown", label: "Frete a consultar" };
}
