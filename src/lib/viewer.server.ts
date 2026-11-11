/**
 * Identidade confiável do visitante — só no servidor.
 *
 * A identidade NUNCA vem do corpo da requisição: ela é lida do token da
 * sessão enviado no cabeçalho. Assim ninguém pode registrar pedidos,
 * carrinhos ou fichas de cliente no nome de outra pessoa.
 */
import { getRequestHeader } from "@tanstack/react-start/server";

export async function verifiedViewerId(): Promise<string | null> {
  let header = "";
  try {
    header = getRequestHeader("authorization") ?? "";
  } catch {
    return null;
  }
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token || token.split(".").length !== 3) return null;
  try {
    const { publicServerClient } = await import("@/lib/supabase-public.server");
    const { data } = await publicServerClient().auth.getUser(token);
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}
