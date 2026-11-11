import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { CepAddress, ShippingQuote } from "@/lib/shipping.server";

type StaffCtx = { supabase: { rpc: (fn: "is_staff", args: { _user_id: string }) => Promise<{ data: unknown }> }; userId: string };

/** Só owner/admin mexem na integração de frete. */
const staffOnly = async (context: unknown) => {
  const ctx = context as StaffCtx;
  const { data } = await ctx.supabase.rpc("is_staff", { _user_id: ctx.userId });
  if (!data) throw new Error("Sem permissão.");
};


/** Preenchimento de endereço pelo CEP (ViaCEP). */
export const fetchAddressByCep = createServerFn({ method: "POST" })
  .inputValidator((data: { cep: string }) => data)
  .handler(async ({ data }): Promise<CepAddress | null> => {
    const { lookupCep } = await import("@/lib/shipping.server");
    return lookupCep(data.cep);
  });

/** Cotação real de frete para o carrinho. */
export const quoteCartShipping = createServerFn({ method: "POST" })
  .inputValidator(
    (data: { cep: string; items: Array<{ productId: string; quantity: number; decantMl?: number | null }> }) => data,
  )
  .handler(async ({ data }): Promise<ShippingQuote> => {
    const { quoteShipping } = await import("@/lib/shipping.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const items = (data.items ?? [])
      .filter((i) => i.productId && Number(i.quantity) > 0)
      .map((i) => ({ productId: i.productId, quantity: Math.min(999, Math.floor(Number(i.quantity))) }));
    if (!items.length) return { ok: false, reason: "PROVIDER_ERROR", message: "Carrinho vazio." };
    return quoteShipping(supabaseAdmin, data.cep, items);
  });

/** Situação da configuração de entregas (usado no painel e no carrinho). */
export const getShippingStatus = createServerFn({ method: "GET" }).handler(async () => {
  const { loadShippingSettings, onlyDigits, loadProviderToken } = await import("@/lib/shipping.server");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const settings = await loadShippingSettings(supabaseAdmin);

  const provider = settings?.provider ?? "none";
  const token = provider === "none" ? null : await loadProviderToken(provider);
  return {
    provider,
    hasOrigin: onlyDigits(settings?.origin_cep ?? "").length === 8,
    hasToken: Boolean(token),
    city: settings?.city ?? "Itaguaí",
    state: settings?.state ?? "RJ",
    localCities: settings?.local_delivery_cities ?? [],
  };
});

/** Painel: status da integração de frete — nunca devolve o token, só os 4 últimos dígitos. */
export const getShippingIntegration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await staffOnly(context);
    const { loadShippingSettings, loadProviderToken, providerLabel, onlyDigits } = await import("@/lib/shipping.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const settings = await loadShippingSettings(supabaseAdmin);
    const provider = settings?.provider ?? "none";
    const token = provider === "none" ? null : await loadProviderToken(provider);
    const { data: secret } = await supabaseAdmin
      .from("integration_secrets")
      .select("last4, updated_at")
      .eq("provider", provider)
      .maybeSingle();
    const last4 = secret?.last4 ?? (token ? token.slice(-4) : null);
    return {
      provider,
      providerLabel: providerLabel(provider),
      hasToken: Boolean(token),
      masked: last4 ? `••••••••••••${last4}` : null,
      tokenUpdatedAt: secret?.updated_at ?? null,
      hasOrigin: onlyDigits(settings?.origin_cep ?? "").length === 8,
      lastTestAt: settings?.last_test_at ?? null,
      lastTestOk: settings?.last_test_ok ?? null,
      lastTestMessage: settings?.last_test_message ?? null,
      lastQuoteAt: settings?.last_quote_at ?? null,
      status: !settings || provider === "none" ? "nao-configurado" : token ? (settings.last_test_ok === false ? "erro" : "conectado") : "nao-configurado",
    };
  });

/** Salva/atualiza o token do agregador no cofre do servidor. */
export const saveShippingToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { provider: string; token: string }) => data)
  .handler(async ({ data, context }) => {
    await staffOnly(context);
    const provider = (data.provider ?? "").trim().toLowerCase();
    const token = (data.token ?? "").trim();
    if (!provider || provider === "none") throw new Error("Escolha o provedor de frete antes de salvar o token.");
    if (token.length < 12) throw new Error("Token muito curto: confira se copiou a credencial completa.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("integration_secrets").upsert(
      {
        provider,
        token,
        last4: token.slice(-4),
        updated_by: context.userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "provider" },
    );
    if (error) throw new Error("Não foi possível guardar o token com segurança.");
    await supabaseAdmin
      .from("shipping_settings")
      .update({ provider, token_last4: token.slice(-4), last_test_at: null, last_test_ok: null, last_test_message: null })
      .eq("id", true);
    await supabaseAdmin.from("activity_logs").insert({
      user_id: context.userId,
      action: "token de frete atualizado",
      entity: "integration_secrets",
      entity_id: provider,
    });
    return { ok: true, masked: `••••••••••••${token.slice(-4)}` };
  });

/** Remove a integração: apaga o token do cofre e volta para retirada/entrega local. */
export const removeShippingIntegration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { provider: string }) => data)
  .handler(async ({ data, context }) => {
    await staffOnly(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("integration_secrets").delete().eq("provider", (data.provider ?? "").toLowerCase());
    await supabaseAdmin
      .from("shipping_settings")
      .update({ provider: "none", token_last4: null, last_test_at: null, last_test_ok: null, last_test_message: null })
      .eq("id", true);
    await supabaseAdmin.from("activity_logs").insert({
      user_id: context.userId,
      action: "integração de frete removida",
      entity: "integration_secrets",
      entity_id: data.provider ?? null,
    });
    return { ok: true };
  });

/** Testa a comunicação real com o agregador usando o token salvo. */
export const testShippingConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await staffOnly(context);
    const { testProviderConnection } = await import("@/lib/shipping.server");
    return testProviderConnection();
  });

