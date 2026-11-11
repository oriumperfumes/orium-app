import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Central de IA — nunca devolve a chave; só estado, modelos e consumo. */

type Ctx = { supabase: any; userId: string };
async function roleOf(context: unknown) {
  const ctx = context as Ctx;
  const [{ data: staff }, { data: owner }] = await Promise.all([
    ctx.supabase.rpc("is_staff", { _user_id: ctx.userId }),
    ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "owner" }),
  ]);
  if (!staff) throw new Error("Sem permissão.");
  return { ctx, owner: Boolean(owner) };
}

export const aiStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { owner } = await roleOf(context);
    const E = await import("@/lib/ai/engine.server");
    const cfg = await E.getAiConfig(true);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const s = await E.spend();
    const { data: rows } = await db
      .from("ai_usage")
      .select("feature, model, task, profile, input_tokens, output_tokens, cost_usd, latency_ms, ok, error_code, created_at")
      .gte("created_at", s.startMonth.toISOString())
      .order("created_at", { ascending: false })
      .limit(20000);
    const today = (rows ?? []).filter((r) => new Date(r.created_at) >= s.startDay);
    const group = (list: typeof today, k: "feature" | "model") => {
      const m = new Map<string, { requests: number; tokens: number; cost: number; latency: number; n: number }>();
      for (const r of list) {
        const g = m.get(r[k]) ?? { requests: 0, tokens: 0, cost: 0, latency: 0, n: 0 };
        g.requests++;
        g.tokens += (r.input_tokens ?? 0) + (r.output_tokens ?? 0);
        g.cost += Number(r.cost_usd) || 0;
        if (r.latency_ms) (g.latency += r.latency_ms), g.n++;
        m.set(r[k], g);
      }
      return [...m.entries()].map(([name, g]) => ({ name, requests: g.requests, tokens: g.tokens, cost: g.cost, avgLatency: g.n ? Math.round(g.latency / g.n) : null })).sort((a, b) => b.cost - a.cost);
    };
    const lat = today.filter((r) => r.latency_ms);
    const { data: row } = await db.from("ai_settings").select("last_check_status, last_check_at").eq("id", true).maybeSingle();
    return {
      owner,
      keyConfigured: E.hasOpenAiKey(),
      lastCheck: row?.last_check_status ?? null,
      lastCheckAt: row?.last_check_at ?? null,
      config: { ...cfg, prices: cfg.prices },
      usage: {
        requestsToday: today.length,
        errorsToday: today.filter((r) => !r.ok).length,
        tokensToday: today.reduce((a, r) => a + (r.input_tokens ?? 0) + (r.output_tokens ?? 0), 0),
        costToday: s.today,
        costMonth: s.month,
        avgLatency: lat.length ? Math.round(lat.reduce((a, r) => a + (r.latency_ms ?? 0), 0) / lat.length) : null,
        byFeature: group(rows ?? [], "feature"),
        byModel: group(rows ?? [], "model"),
        recent: (rows ?? []).slice(0, 15).map((r: any) => ({
          at: r.created_at, feature: r.feature, task: r.task, profile: r.profile, model: r.model,
          tokens: (r.input_tokens ?? 0) + (r.output_tokens ?? 0), cost: Number(r.cost_usd) || 0, ms: r.latency_ms, ok: r.ok, error: r.error_code,
        })),
        unpricedModels: [cfg.model_copilot, cfg.model_advanced, cfg.model_economy, cfg.model_vision].filter((m) => E.estimateCost(cfg, m, 1_000_000, 1_000_000) === 0),
      },
    };
  });

export const aiTestConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await roleOf(context);
    const E = await import("@/lib/ai/engine.server");
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    let status = "connected";
    let models: string[] = [];
    let message = "Conectado à OpenAI.";
    try {
      models = (await E.listModels()).filter((m) => /^(gpt|o\d|whisper|chatgpt)/.test(m) && !/(image|tts|realtime|audio-preview|search|embedding|dall)/.test(m) || /transcribe/.test(m));
    } catch (e) {
      status = e instanceof E.AiError ? e.code : "unavailable";
      message = e instanceof Error ? e.message : "Falha ao conectar.";
    }
    await db.from("ai_settings").update({ last_check_status: status, last_check_at: new Date().toISOString() }).eq("id", true);
    return { status, message, models };
  });

export const aiSaveSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      enabled?: boolean;
      model_economy?: string;
      model_advanced?: string;
      model_voice?: string;
      model_copilot?: string;
      model_vision?: string;
      auto_route?: boolean;
      daily_limit_usd?: number | null;
      monthly_limit_usd?: number | null;
      alert_pct?: number;
      limit_policy?: "block" | "economy_only";
      prices?: Record<string, { in?: number; out?: number; min?: number }>;
    }) => {
      const out: Record<string, unknown> = {};
      const model = (m: unknown) => (typeof m === "string" && /^[\w.:-]{2,80}$/.test(m) ? m : undefined);
      if (typeof d.enabled === "boolean") out["enabled"] = d.enabled;
      if (typeof d.auto_route === "boolean") out["auto_route"] = d.auto_route;
      for (const k of ["model_economy", "model_advanced", "model_voice", "model_copilot", "model_vision"] as const) if (model(d[k])) out[k] = d[k];
      for (const k of ["daily_limit_usd", "monthly_limit_usd"] as const)
        if (k in d) out[k] = d[k] == null || !(Number(d[k]) > 0) ? null : Math.min(100000, Number(d[k]));
      if (d.alert_pct != null) out["alert_pct"] = Math.max(10, Math.min(100, Math.round(d.alert_pct)));
      if (d.limit_policy === "block" || d.limit_policy === "economy_only") out["limit_policy"] = d.limit_policy;
      if (d.prices && typeof d.prices === "object") out["prices"] = d.prices;
      return out;
    },
  )
  .handler(async ({ data, context }) => {
    const { ctx, owner } = await roleOf(context);
    if (!owner) throw new Error("Só o dono da loja pode alterar a Central de IA.");
    const { error } = await ctx.supabase
      .from("ai_settings")
      .update({ ...data, updated_at: new Date().toISOString(), updated_by: ctx.userId })
      .eq("id", true);
    if (error) throw new Error(error.message);
    const E = await import("@/lib/ai/engine.server");
    E.invalidateAiConfig();
    return { ok: true };
  });

export const aiQuickTest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { prompt: string; profile: "economy" | "advanced" | "copilot" }) => ({
    prompt: String(d.prompt ?? "").slice(0, 500),
    profile: d.profile === "advanced" ? ("advanced" as const) : d.profile === "copilot" ? ("copilot" as const) : ("economy" as const),
  }))
  .handler(async ({ data, context }) => {
    await roleOf(context);
    const E = await import("@/lib/ai/engine.server");
    const t0 = Date.now();
    try {
      const r = await E.aiJson<{ answer?: string }>({
        feature: "test",
        profile: data.profile,
        system: 'Responda em português, em no máximo 3 frases, no formato JSON {"answer":"..."}.',
        prompt: data.prompt || "Diga olá para a Orium.",
        schema: { name: "teste", schema: { type: "object", additionalProperties: false, required: ["answer"], properties: { answer: { type: "string" } } } },
      });
      const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
      const { data: last } = await db.from("ai_usage").select("model, input_tokens, output_tokens, cost_usd").eq("feature", "test").order("created_at", { ascending: false }).limit(1).maybeSingle();
      return { ok: true as const, answer: r.answer ?? "", ms: Date.now() - t0, model: last?.model ?? null, tokens: (last?.input_tokens ?? 0) + (last?.output_tokens ?? 0), cost: Number(last?.cost_usd ?? 0) };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : "Falha.", ms: Date.now() - t0 };
    }
  });
