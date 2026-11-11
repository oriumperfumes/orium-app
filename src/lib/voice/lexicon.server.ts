/**
 * Vocabulário prioritário para o reconhecimento de fala: poucos nomes, os mais
 * prováveis (estoque local, disponíveis, produto da tela, comandos). Nunca o
 * catálogo inteiro. Cache em memória de 5 minutos.
 */
let cache: { names: string[]; at: number } | null = null;
const TTL = 5 * 60 * 1000;

export async function voiceLexicon(db: any, extra: string[] = []): Promise<string[]> {
  if (!cache || Date.now() - cache.at > TTL) {
    const [local, avail, cmds] = await Promise.all([
      db.from("products").select("canonical_name, brand").eq("active", true).gt("local_stock", 0).limit(40),
      db.from("products").select("canonical_name, brand").eq("active", true).eq("in_stock", true).eq("catalog_eligible", true).order("updated_at", { ascending: false }).limit(60),
      db.from("copilot_commands").select("name").eq("active", true).limit(20),
    ]);
    const names = new Set<string>();
    for (const r of [...(local.data ?? []), ...(avail.data ?? [])] as any[]) {
      if (r.canonical_name) names.add(r.canonical_name);
      if (r.brand) names.add(r.brand);
    }
    for (const c of (cmds.data ?? []) as any[]) if (c.name) names.add(c.name);
    cache = { names: Array.from(names).slice(0, 90), at: Date.now() };
  }
  return Array.from(new Set([...extra.filter(Boolean), ...cache.names])).slice(0, 90);
}
