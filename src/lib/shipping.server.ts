/**
 * Frete real da Orium via agregador (SuperFrete ou Melhor Envio).
 * Nada de tabela fictícia: se não houver cotação real, devolvemos erro e o carrinho
 * oferece cotar pelo WhatsApp. Token fica só no servidor.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type Db = SupabaseClient<Database>;

export type ShippingOption = {
  service: string;
  carrier: string;
  price: number;
  days: number | null;
  providerServiceId: string;
};

export type ShippingQuote =
  | { ok: true; provider: string; options: ShippingOption[]; package: PackageSpec; originCep: string }
  | { ok: false; reason: "NO_ORIGIN" | "NO_PROVIDER" | "PROVIDER_ERROR" | "INVALID_CEP"; message: string };

export type PackageSpec = { weightKg: number; heightCm: number; widthCm: number; lengthCm: number };

export const onlyDigits = (v: string) => (v ?? "").replace(/\D/g, "");

/**
 * Empacotamento simplificado e seguro: soma os pesos reais (ou o padrão configurado)
 * e empilha os frascos em camadas de 6, respeitando os mínimos dos Correios.
 */
export function buildPackage(
  items: Array<{ quantity: number; weightG: number | null; heightCm: number | null; widthCm: number | null; lengthCm: number | null }>,
  defaults: { itemWeightG: number; packageWeightG: number; heightCm: number; widthCm: number; lengthCm: number },
): PackageSpec {
  const units = items.reduce((s, i) => s + i.quantity, 0) || 1;
  const grams =
    items.reduce((s, i) => s + (i.weightG ?? defaults.itemWeightG) * i.quantity, 0) + defaults.packageWeightG;

  const width = Math.max(defaults.widthCm, ...items.map((i) => i.widthCm ?? 0));
  const length = Math.max(defaults.lengthCm, ...items.map((i) => i.lengthCm ?? 0));
  const unitHeight = Math.max(defaults.heightCm, ...items.map((i) => i.heightCm ?? 0));
  const layers = Math.ceil(units / 6);

  return {
    weightKg: Number(Math.max(0.3, grams / 1000).toFixed(3)),
    heightCm: Math.min(100, Math.max(2, Math.round(unitHeight * layers))),
    widthCm: Math.min(100, Math.max(11, Math.round(width))),
    lengthCm: Math.min(100, Math.max(16, Math.round(length))),
  };
}

class ProviderError extends Error {
  status: number;
  constructor(status: number, label: string) {
    super(`${label} respondeu ${status}`);
    this.status = status;
  }
}

type Adapter = (args: { originCep: string; destinationCep: string; pkg: PackageSpec; token: string; insuranceValue?: number; services?: string }) => Promise<ShippingOption[]>;

const superfrete: Adapter = async ({ originCep, destinationCep, pkg, token, insuranceValue, services }) => {
  const res = await fetch("https://api.superfrete.com/api/v0/calculator", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "Orium Perfumes (contato@oriumperfumes.com)",
    },
    body: JSON.stringify({
      from: { postal_code: originCep },
      to: { postal_code: destinationCep },
      services: services || "1,2,17",
      options: { own_hand: false, receipt: false, insurance_value: insuranceValue ?? 0, use_insurance_value: (insuranceValue ?? 0) > 0 },
      package: {
        height: pkg.heightCm,
        width: pkg.widthCm,
        length: pkg.lengthCm,
        weight: pkg.weightKg,
      },
    }),
  });
  if (!res.ok) throw new ProviderError(res.status, "SuperFrete");
  const json = (await res.json()) as Array<{
    id: number | string;
    name: string;
    price?: string | number;
    delivery_time?: number | string;
    company?: { name?: string };
    error?: string;
  }>;
  return (Array.isArray(json) ? json : [])
    .filter((s) => !s.error && s.price != null && Number(s.price) > 0)
    .map((s) => ({
      service: s.name,
      carrier: s.company?.name ?? "Correios",
      price: Number(Number(s.price).toFixed(2)),
      days: s.delivery_time != null ? Number(s.delivery_time) : null,
      providerServiceId: String(s.id),
    }));
};

const melhorenvio: Adapter = async ({ originCep, destinationCep, pkg, token }) => {
  const res = await fetch("https://melhorenvio.com.br/api/v2/me/shipment/calculate", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "Orium Perfumes (contato@oriumperfumes.com)",
    },
    body: JSON.stringify({
      from: { postal_code: originCep },
      to: { postal_code: destinationCep },
      package: {
        height: pkg.heightCm,
        width: pkg.widthCm,
        length: pkg.lengthCm,
        weight: pkg.weightKg,
      },
    }),
  });
  if (!res.ok) throw new ProviderError(res.status, "Melhor Envio");
  const json = (await res.json()) as Array<{
    id: number | string;
    name: string;
    price?: string | number;
    delivery_time?: number | string;
    company?: { name?: string };
    error?: string;
  }>;
  return (Array.isArray(json) ? json : [])
    .filter((s) => !s.error && s.price != null && Number(s.price) > 0)
    .map((s) => ({
      service: s.name,
      carrier: s.company?.name ?? "Correios",
      price: Number(Number(s.price).toFixed(2)),
      days: s.delivery_time != null ? Number(s.delivery_time) : null,
      providerServiceId: String(s.id),
    }));
};

const ADAPTERS: Record<string, { run: Adapter; envKey: string; label: string }> = {
  superfrete: { run: superfrete, envKey: "SUPERFRETE_TOKEN", label: "SuperFrete" },
  melhorenvio: { run: melhorenvio, envKey: "MELHORENVIO_TOKEN", label: "Melhor Envio" },
};

export const PROVIDER_LABEL: Record<string, string> = {
  none: "Nenhum",
  superfrete: "SuperFrete",
  melhorenvio: "Melhor Envio",
  frenet: "Frenet",
  outro: "Outro",
};

export function providerLabel(provider?: string | null) {
  return PROVIDER_LABEL[provider ?? "none"] ?? (provider ?? "Nenhum");
}

/**
 * Credencial do agregador: fica só no servidor (cofre no banco, com o segredo do
 * ambiente como reserva). Nunca é devolvida para o navegador.
 */
export async function loadProviderToken(provider: string): Promise<string | null> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("integration_secrets")
      .select("token")
      .eq("provider", provider)
      .maybeSingle();
    if (data?.token) return data.token;
  } catch (err) {
    console.error("[frete] cofre indisponível", err instanceof Error ? err.message : err);
  }
  const envKey = ADAPTERS[provider]?.envKey;
  const fromEnv = envKey ? process.env[envKey] : undefined;
  return fromEnv && fromEnv.trim() ? fromEnv.trim() : null;
}

/**
 * Cotação SuperFrete com origem/destino explícitos (frete de abastecimento
 * fornecedor → Orium). Independente do provedor/origem usados para clientes.
 */
export async function superfreteQuote(args: { originCep: string; destinationCep: string; pkg: PackageSpec; insuranceValue?: number; services?: string }) {
  const token = await loadProviderToken("superfrete");
  if (!token) throw Object.assign(new Error("Nenhum token SuperFrete salvo."), { code: "NO_TOKEN" });
  return superfrete({ ...args, token });
}

/** Mensagem útil (sem expor o segredo) para cada falha do agregador. */
export function describeProviderError(err: unknown): string {
  const status = (err as { status?: number })?.status;
  if (status === 401) return "Token inválido: o serviço não reconheceu a credencial.";
  if (status === 403) return "Token sem permissão ou expirado.";
  if (status === 429) return "Muitas consultas seguidas. Tente de novo em alguns minutos.";
  if (status && status >= 500) return "O serviço de frete está indisponível agora.";
  if (status === 400 || status === 422) return "O serviço recusou os dados enviados (confira o CEP de origem e a embalagem).";
  return "Falha de comunicação com o serviço de frete.";
}

export async function loadShippingSettings(db: Db) {
  const { data } = await db.from("shipping_settings").select("*").maybeSingle();
  return data;
}

/** Testa de verdade a comunicação com o agregador usando o token salvo. */
export async function testProviderConnection(): Promise<{ ok: boolean; message: string; provider: string }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const settings = await loadShippingSettings(supabaseAdmin);
  const provider = settings?.provider ?? "none";
  const adapter = ADAPTERS[provider];
  const stamp = async (ok: boolean, message: string) => {
    await supabaseAdmin
      .from("shipping_settings")
      .update({ last_test_at: new Date().toISOString(), last_test_ok: ok, last_test_message: message })
      .eq("id", true);
    return { ok, message, provider };
  };

  if (!adapter) return stamp(false, "Escolha um provedor compatível (SuperFrete ou Melhor Envio) e salve.");
  const originCep = onlyDigits(settings?.origin_cep ?? "");
  if (originCep.length !== 8) return stamp(false, "Cadastre o CEP de origem da Orium antes de testar.");
  const token = await loadProviderToken(provider);
  if (!token) return stamp(false, "Nenhum token salvo para este provedor.");

  try {
    const options = await adapter.run({
      originCep,
      // CEP público usado apenas como destino de teste da comunicação.
      destinationCep: "01001000",
      pkg: {
        weightKg: Math.max(0.3, ((settings?.item_weight_g ?? 400) + (settings?.package_weight_g ?? 100)) / 1000),
        heightCm: settings?.height_cm ?? 12,
        widthCm: settings?.width_cm ?? 15,
        lengthCm: settings?.length_cm ?? 20,
      },
      token,
    });
    if (!options.length) {
      return stamp(false, `${adapter.label} respondeu, mas não devolveu nenhum serviço para o teste.`);
    }
    return stamp(true, `Conexão com ${adapter.label} funcionando corretamente.`);
  } catch (err) {
    console.error("[frete] teste de conexão falhou", err instanceof Error ? err.message : err);
    return stamp(false, describeProviderError(err));
  }
}

/** Cotação real: PAC/SEDEX (e demais serviços que o agregador devolver). */
export async function quoteShipping(
  db: Db,
  destinationCepRaw: string,
  items: Array<{ productId: string; quantity: number; decantMl?: number | null }>,
): Promise<ShippingQuote> {
  const destinationCep = onlyDigits(destinationCepRaw);
  if (destinationCep.length !== 8) {
    return { ok: false, reason: "INVALID_CEP", message: "Informe um CEP válido de 8 dígitos." };
  }

  const settings = await loadShippingSettings(db);
  const originCep = onlyDigits(settings?.origin_cep ?? "");
  if (originCep.length !== 8) {
    return {
      ok: false,
      reason: "NO_ORIGIN",
      message: "O CEP de origem da Orium ainda não foi configurado no painel (Configurações → Entregas).",
    };
  }

  const adapter = ADAPTERS[settings?.provider ?? "none"];
  const token = adapter ? await loadProviderToken(settings?.provider ?? "none") : null;
  if (!adapter || !token) {
    return {
      ok: false,
      reason: "NO_PROVIDER",
      message: "A integração de frete ainda não está configurada. Fale com a Orium pelo WhatsApp.",
    };
  }


  const ids = items.map((i) => i.productId);
  const { data: products } = await db
    .from("products")
    .select("id, weight_g, height_cm, width_cm, length_cm")
    .in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);

  const pkg = buildPackage(
    items.map((i) => {
      const p = (products ?? []).find((x) => x.id === i.productId);
      // decant: frasquinho de vidro leve (vidro + líquido), sem a caixa do perfume
      if (i.decantMl) {
        return { quantity: i.quantity, weightG: 20 + i.decantMl * 2, heightCm: 9, widthCm: 2, lengthCm: 2 };
      }
      return {
        quantity: i.quantity,
        weightG: p?.weight_g ?? null,
        heightCm: p?.height_cm == null ? null : Number(p.height_cm),
        widthCm: p?.width_cm == null ? null : Number(p.width_cm),
        lengthCm: p?.length_cm == null ? null : Number(p.length_cm),
      };
    }),
    {
      itemWeightG: settings?.item_weight_g ?? 400,
      packageWeightG: settings?.package_weight_g ?? 100,
      heightCm: settings?.height_cm ?? 12,
      widthCm: settings?.width_cm ?? 15,
      lengthCm: settings?.length_cm ?? 20,
    },
  );

  try {
    const options = await adapter.run({ originCep, destinationCep, pkg, token });
    if (!options.length) {
      return { ok: false, reason: "PROVIDER_ERROR", message: "Nenhum serviço de envio disponível para este CEP." };
    }
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin
        .from("shipping_settings")
        .update({ last_quote_at: new Date().toISOString() })
        .eq("id", true);
    } catch {
      // registrar a data da cotação é opcional; nunca derruba o carrinho
    }
    return { ok: true, provider: adapter.label, options: options.sort((a, b) => a.price - b.price), package: pkg, originCep };
  } catch (err) {
    console.error("[frete] cotação falhou", err instanceof Error ? err.message : err);
    return {
      ok: false,
      reason: "PROVIDER_ERROR",
      message: "Não conseguimos calcular o frete automaticamente agora. Fale com a Orium pelo WhatsApp para cotarmos para você.",
    };
  }
}

export type CepAddress = {
  cep: string;
  street: string;
  district: string;
  city: string;
  state: string;
};

/** Consulta de endereço pelo CEP (ViaCEP) apenas para preencher o formulário. */
export async function lookupCep(cepRaw: string): Promise<CepAddress | null> {
  const cep = onlyDigits(cepRaw);
  if (cep.length !== 8) return null;
  try {
    const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
    if (!res.ok) return null;
    const json = (await res.json()) as {
      erro?: boolean | string;
      logradouro?: string;
      bairro?: string;
      localidade?: string;
      uf?: string;
    };
    if (json.erro) return null;
    return {
      cep,
      street: json.logradouro ?? "",
      district: json.bairro ?? "",
      city: json.localidade ?? "",
      state: json.uf ?? "",
    };
  } catch {
    return null;
  }
}
