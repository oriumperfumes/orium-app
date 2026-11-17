/**
 * ORIUM AI ENGINE — única porta de saída para IA no app.
 * Usa a chave OpenAI do servidor (OPENAI_API_KEY). Nunca troca de provedor
 * sozinho, nunca registra texto do cliente nem a chave.
 */
import { createOpenAI } from "@ai-sdk/openai";

/** economy = Comandos rápidos · copilot = Copilot principal · advanced = Raciocínio avançado/análises */
export type AiProfile = "economy" | "copilot" | "advanced" | "voice" | "vision";
export type AiFeature =
  | "copilot"
  | "voice_stt"
  | "purchase_intent"
  | "catalog_identity"
  | "catalog_research"
  | "fragrance"
  | "test";

export type AiConfig = {
  enabled: boolean;
  model_economy: string;
  model_advanced: string;
  model_voice: string;
  model_copilot: string;
  model_vision: string;
  auto_route: boolean;
  daily_limit_usd: number | null;
  monthly_limit_usd: number | null;
  alert_pct: number;
  limit_policy: "block" | "economy_only";
  prices: Record<string, { in?: number; out?: number; min?: number }>;
};

export class AiError extends Error {
  constructor(
    public code: "not_configured" | "disabled" | "invalid_key" | "no_quota" | "rate_limited" | "unavailable" | "budget" | "bad_request",
    message: string,
    public status = 502,
  ) {
    super(message);
  }
}

const OPENAI = "https://api.openai.com/v1";

/** A chave como foi colada pode vir com espaço, quebra de linha ou aspas: limpa antes de usar. */
const cleanKey = (raw: string | undefined) => (raw ?? "").replace(/^[\s"'`]+|[\s"'`]+$/g, "").replace(/\s+/g, "");

export function openaiKey(): string {
  const k = cleanKey(process.env["OPENAI_API_KEY"]);
  if (!k) throw new AiError("not_configured", "A IA ainda não está conectada. Cadastre a chave da OpenAI na Central de IA.", 503);
  return k;
}
export const hasOpenAiKey = () => Boolean(cleanKey(process.env["OPENAI_API_KEY"]));

let cache: { at: number; cfg: AiConfig } | null = null;
async function db() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export async function getAiConfig(fresh = false): Promise<AiConfig> {
  if (!fresh && cache && Date.now() - cache.at < 30_000) return cache.cfg;
  const { data } = await (await db()).from("ai_settings").select("*").eq("id", true).maybeSingle();
  const cfg: AiConfig = {
    enabled: data?.enabled ?? true,
    model_economy: data?.model_economy ?? "gpt-5-mini",
    model_advanced: data?.model_advanced ?? "gpt-5",
    model_voice: data?.model_voice ?? "gpt-4o-transcribe",
    model_copilot: (data as any)?.model_copilot ?? data?.model_economy ?? "gpt-5-mini",
    model_vision: (data as any)?.model_vision ?? (data as any)?.model_copilot ?? "gpt-5-mini",
    auto_route: (data as any)?.auto_route ?? true,
    daily_limit_usd: data?.daily_limit_usd != null ? Number(data.daily_limit_usd) : null,
    monthly_limit_usd: data?.monthly_limit_usd != null ? Number(data.monthly_limit_usd) : null,
    alert_pct: data?.alert_pct ?? 80,
    limit_policy: (data?.limit_policy as AiConfig["limit_policy"]) ?? "block",
    prices: (data?.prices as AiConfig["prices"]) ?? {},
  };
  cache = { at: Date.now(), cfg };
  return cfg;
}
export const invalidateAiConfig = () => (cache = null);

function priceFor(cfg: AiConfig, model: string) {
  const exact = cfg.prices[model];
  if (exact) return exact;
  // usa o prefixo mais longo conhecido (ex.: gpt-5-mini-2025-08-07 → gpt-5-mini)
  // só sufixo de data conta (gpt-5-mini-2025-08-07 → gpt-5-mini); gpt-5.4-mini NÃO herda o preço do gpt-5
  const k = Object.keys(cfg.prices).filter((p) => model.startsWith(p) && /^-\d{4}-\d{2}-\d{2}$/.test(model.slice(p.length))).sort((a, b) => b.length - a.length)[0];
  return (k ? cfg.prices[k] : undefined) ?? {};
}

export function estimateCost(cfg: AiConfig, model: string, inTok: number, outTok: number, audioSec = 0) {
  const p = priceFor(cfg, model);
  return ((p.in ?? 0) * inTok + (p.out ?? 0) * outTok) / 1_000_000 + ((p.min ?? 0) * audioSec) / 60;
}

export async function spend() {
  const now = new Date();
  const day = new Date(now.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  const offset = now.getTime() - day.getTime();
  const startDay = new Date(new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime() + offset);
  const startMonth = new Date(new Date(day.getFullYear(), day.getMonth(), 1).getTime() + offset);
  const { data } = await (await db())
    .from("ai_usage")
    .select("cost_usd, created_at")
    .gte("created_at", startMonth.toISOString())
    .limit(50000);
  let today = 0;
  let month = 0;
  for (const r of data ?? []) {
    const c = Number(r.cost_usd) || 0;
    month += c;
    if (new Date(r.created_at) >= startDay) today += c;
  }
  return { today, month, startDay, startMonth };
}

/** Decide o modelo e aplica liga/desliga e orçamento antes de qualquer chamada. */
export async function prepare(profile: AiProfile) {
  const key = openaiKey();
  const cfg = await getAiConfig();
  if (!cfg.enabled) throw new AiError("disabled", "A IA está desligada na Central de IA.", 503);
  let effective = profile;
  if (cfg.daily_limit_usd != null || cfg.monthly_limit_usd != null) {
    const s = await spend();
    const over =
      (cfg.daily_limit_usd != null && s.today >= cfg.daily_limit_usd) ||
      (cfg.monthly_limit_usd != null && s.month >= cfg.monthly_limit_usd);
    if (over) {
      if (cfg.limit_policy === "block" || profile === "voice")
        throw new AiError("budget", "O limite de gastos com IA foi atingido. Ajuste na Central de IA.", 429);
      effective = "economy";
    }
  }
  const model =
    effective === "voice" ? cfg.model_voice
    : effective === "advanced" ? cfg.model_advanced
    : effective === "copilot" ? cfg.model_copilot
    : effective === "vision" ? cfg.model_vision
    : cfg.model_economy;
  return { key, cfg, model, profile: effective };
}

export const isReasoningModel = (m: string) => /^(gpt-5|gpt-6|o\d)/.test(m) && !/chat-latest/.test(m);

export type RoutedTask = "navigation" | "price_lookup" | "operation" | "conversation" | "analysis" | "strategy";
/**
 * ORIUM INTELLIGENT MODEL ROUTER — classifica a tarefa e escolhe o perfil.
 * Qualidade adequada → confiabilidade → velocidade → custo. Com a seleção
 * automática desligada, tudo vai para o Copilot principal.
 */
export function routeTask(utterance: string | null, auto = true): { task: RoutedTask; profile: AiProfile; effort: "low" | "medium" } {
  const u = (utterance ?? "").toLowerCase();
  const pick = (task: RoutedTask, profile: AiProfile, effort: "low" | "medium" = "low") => ({ task, profile: auto ? profile : "copilot", effort: auto ? effort : "low" });
  if (/estrat[eé]gi|campanha|plano|planej|por que|porque|aconselh|recomend|tend[eê]ncia|melhorar|aumentar (as )?vendas|diagn[oó]stic/.test(u)) return pick("strategy", "advanced", "medium");
  if (/analis|análise|relat[oó]rio|desempenho|oportunidad|margens?\b.*(todos|geral|mês|mes)|compar[ae]/.test(u) || u.length > 260) return pick("analysis", "advanced", "medium");
  if (/^(abre|abrir|vai para|ir para|mostra a tela|volta para)\b/.test(u) && u.length < 60) return pick("navigation", "economy");
  if (/(quanto (custa|está|esta|fica|sai)|qual (o )?pre[cç]o|pre[cç]o d|tem (no )?estoque|quantos? .* estoque)/.test(u) && u.length < 140) return pick("price_lookup", "economy");
  if (/registr|vend[ia]|cria|criar|muda|altera|coloca|adiciona|tira|zera|apaga|esconde|libera|cupom|promo|pedido|sinal/.test(u)) return pick("operation", "copilot");
  return pick("conversation", "copilot");
}

export async function recordUsage(u: {
  feature: AiFeature;
  profile: AiProfile;
  model: string;
  input_tokens?: number;
  output_tokens?: number;
  audio_seconds?: number;
  latency_ms?: number;
  ok?: boolean;
  error_code?: string | null;
  task?: string | null;
}) {
  try {
    const cfg = await getAiConfig();
    const cost = estimateCost(cfg, u.model, u.input_tokens ?? 0, u.output_tokens ?? 0, u.audio_seconds ?? 0);
    await (await db()).from("ai_usage").insert({
      feature: u.feature,
      profile: u.profile,
      model: u.model,
      input_tokens: Math.round(u.input_tokens ?? 0),
      output_tokens: Math.round(u.output_tokens ?? 0),
      audio_seconds: u.audio_seconds ?? 0,
      cost_usd: cost,
      latency_ms: u.latency_ms ?? null,
      ok: u.ok ?? true,
      error_code: u.error_code ?? null,
      task: u.task ?? null,
    });
  } catch (e) {
    console.error("ai-engine: falha ao registrar uso", e instanceof Error ? e.message : "erro");
  }
}

export async function mapOpenAIError(res: Response): Promise<AiError> {
  let code = "";
  let detail = "";
  try {
    const j = (await res.json()) as { error?: { code?: string; type?: string; message?: string } };
    code = j.error?.code ?? j.error?.type ?? "";
    // a OpenAI mascara a chave nas mensagens (sk-...abcd); corta por segurança
    detail = (j.error?.message ?? "").replace(/sk-[\w-]{6,}/g, "sk-…").slice(0, 160);
  } catch {
    /* sem corpo */
  }
  if (res.status === 401) return new AiError("invalid_key", "A chave da OpenAI é inválida ou foi revogada.", 401);
  if (res.status === 429 && /quota|billing/.test(code)) return new AiError("no_quota", "A conta da OpenAI está sem saldo ou atingiu o limite de gastos.", 402);
  if (res.status === 429) return new AiError("rate_limited", "Muitos pedidos à OpenAI agora. Tente em alguns segundos.", 429);
  if (res.status === 404) return new AiError("bad_request", "O modelo escolhido não está disponível na sua conta OpenAI.", 400);
  if (res.status >= 500) return new AiError("unavailable", "A OpenAI está indisponível no momento. Tente de novo.", 503);
  return new AiError("bad_request", `A OpenAI recusou o pedido (${res.status}${code ? ` · ${code}` : ""})${detail ? `: ${detail}` : "."}`, 400);
}

/** Provedor para o AI SDK (Copilot com ferramentas). */
export function sdkProvider(key: string) {
  return createOpenAI({ apiKey: key });
}

export function reasoningOptions(model: string, effort: "low" | "medium" = "low") {
  return isReasoningModel(model)
    ? { openai: { forceReasoning: true, reasoningEffort: effort, store: false } }
    : { openai: { store: false } };
}

/** Chamada curta que devolve JSON (classificação, extração, identificação). */
export async function aiJson<T = unknown>(opts: {
  feature: AiFeature;
  profile?: AiProfile;
  system?: string;
  prompt: string;
  schema?: { name: string; schema: Record<string, unknown> };
}): Promise<T> {
  const p = await prepare(opts.profile ?? "economy");
  const t0 = Date.now();
  const body: Record<string, unknown> = {
    model: p.model,
    input: opts.prompt,
    store: false,
    text: {
      format: opts.schema
        ? { type: "json_schema", name: opts.schema.name, strict: true, schema: opts.schema.schema }
        : { type: "json_object" },
    },
  };
  if (opts.system) body["instructions"] = opts.system;
  if (isReasoningModel(p.model)) body["reasoning"] = { effort: "low" };
  let res: Response;
  try {
    res = await fetch(`${OPENAI}/responses`, {
      method: "POST",
      headers: { Authorization: `Bearer ${p.key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    await recordUsage({ feature: opts.feature, profile: p.profile, model: p.model, ok: false, error_code: "network", latency_ms: Date.now() - t0 });
    throw new AiError("unavailable", "Não consegui falar com a OpenAI. Tente de novo.", 503);
  }
  if (!res.ok) {
    const err = await mapOpenAIError(res);
    await recordUsage({ feature: opts.feature, profile: p.profile, model: p.model, ok: false, error_code: err.code, latency_ms: Date.now() - t0 });
    throw err;
  }
  const j = (await res.json()) as {
    output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  await recordUsage({
    feature: opts.feature,
    profile: p.profile,
    model: p.model,
    input_tokens: j.usage?.input_tokens ?? 0,
    output_tokens: j.usage?.output_tokens ?? 0,
    latency_ms: Date.now() - t0,
  });
  const text = (j.output ?? [])
    .flatMap((o) => (o.type === "message" ? o.content ?? [] : []))
    .map((c) => (c.type === "output_text" ? c.text ?? "" : ""))
    .join("");
  return JSON.parse(text || "{}") as T;
}

/** Transcrição de voz em pt-BR com dica de vocabulário. */
export async function aiTranscribe(file: File, prompt?: string): Promise<string> {
  const p = await prepare("voice");
  const t0 = Date.now();
  const form = new FormData();
  form.append("model", p.model);
  form.append("file", file, file.name || "fala.wav");
  form.append("response_format", "json");
  form.append("language", "pt");
  if (prompt) form.append("prompt", prompt);
  // WAV 16 kHz mono 16 bits ≈ 32 kB/s — estimativa de duração para custo
  const audioSec = file.size / 32000;
  let res: Response;
  try {
    res = await fetch(`${OPENAI}/audio/transcriptions`, { method: "POST", headers: { Authorization: `Bearer ${p.key}` }, body: form });
  } catch {
    await recordUsage({ feature: "voice_stt", profile: "voice", model: p.model, ok: false, error_code: "network", latency_ms: Date.now() - t0 });
    throw new AiError("unavailable", "Não consegui falar com a OpenAI. Tente de novo.", 503);
  }
  if (!res.ok) {
    const err = await mapOpenAIError(res);
    await recordUsage({ feature: "voice_stt", profile: "voice", model: p.model, ok: false, error_code: err.code, latency_ms: Date.now() - t0 });
    throw err;
  }
  const j = (await res.json()) as { text?: string };
  await recordUsage({ feature: "voice_stt", profile: "voice", model: p.model, audio_seconds: audioSec, latency_ms: Date.now() - t0 });
  return (j.text ?? "").trim();
}

/** Lista modelos da conta (valida a chave). */
export async function listModels(key = openaiKey()) {
  const res = await fetch(`${OPENAI}/models`, { headers: { Authorization: `Bearer ${key}` } });
  if (!res.ok) throw await mapOpenAIError(res);
  const j = (await res.json()) as { data?: Array<{ id: string }> };
  return (j.data ?? []).map((m) => m.id).sort();
}
