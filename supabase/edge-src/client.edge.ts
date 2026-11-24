/**
 * Cliente administrativo para a Edge Function (substitui client.server.ts do app).
 * SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são fornecidos pelo próprio Supabase à função.
 */
import { createClient } from "@supabase/supabase-js";

declare const Deno: { env: { get(name: string): string | undefined } };

const url = Deno.env.get("SUPABASE_URL");
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ausentes no ambiente da função.");

export const supabaseAdmin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
