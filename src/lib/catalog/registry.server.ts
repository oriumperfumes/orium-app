/**
 * Base de identidades confirmadas (perfume_identity_registry + perfume_aliases).
 *
 * Depois que a identidade de um perfume é descoberta, ela fica salva aqui com as
 * grafias (aliases) que os fornecedores usam. Na próxima sincronização o produto
 * é reconhecido pela grafia e NÃO precisa de nova pesquisa externa.
 */
import { cleanText } from "@/lib/suppliers/normalize.server";
import { normalizeName } from "@/lib/format";
import type { Gender } from "@/lib/catalog/classify";

type Db = Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"];

export const aliasKey = (s: string) =>
  cleanText(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");

/** Chave de identidade: marca + nome oficial, sem ruído. */
export const identityKey = (brand: string | null, name: string) => aliasKey(`${brand ?? ""} ${name}`);

export type RegistryHit = {
  id: string;
  canonical_name: string;
  brand_id: string | null;
  brand_name: string | null;
  concentration: string | null;
  volume_ml: number | null;
  gender: string | null;
  external_reference_url: string | null;
  confidence: number;
  verified: boolean;
  source: string;
};

/** Procura a identidade já conhecida por grafia do fornecedor ou pelo nome normalizado. */
export async function lookupRegistry(db: Db, candidates: string[]): Promise<RegistryHit | null> {
  const keys = Array.from(new Set(candidates.map(aliasKey).filter((k) => k.length > 3)));
  if (!keys.length) return null;

  const { data: alias } = await db
    .from("perfume_aliases")
    .select("registry_id")
    .in("alias_key", keys)
    .limit(1)
    .maybeSingle();

  if (alias?.registry_id) {
    const { data } = await db
      .from("perfume_identity_registry")
      .select(
        "id, canonical_name, brand_id, brand_name, concentration, volume_ml, gender, external_reference_url, confidence, verified, source",
      )
      .eq("id", alias.registry_id)
      .maybeSingle();
    if (data) return data as RegistryHit;
  }

  const { data } = await db
    .from("perfume_identity_registry")
    .select(
      "id, canonical_name, brand_id, brand_name, concentration, volume_ml, gender, external_reference_url, confidence, verified, source",
    )
    .in("normalized_name", keys)
    .limit(1)
    .maybeSingle();
  return (data as RegistryHit | null) ?? null;
}

/** Salva/atualiza a identidade descoberta e registra as grafias equivalentes. */
export async function saveRegistry(
  db: Db,
  entry: {
    name: string;
    brandId: string | null;
    brandName: string | null;
    concentration?: string | null;
    volumeMl?: number | null;
    gender?: Gender | null;
    referenceUrl?: string | null;
    sources?: unknown;
    source: string;
    confidence: number;
    verified?: boolean;
    verifiedBy?: string | null;
    aliases?: string[];
  },
) {
  const normalized = identityKey(entry.brandName, entry.name);
  if (!normalized) return null;

  const payload = {
    normalized_name: normalized,
    canonical_name: cleanText(entry.name),
    brand_id: entry.brandId,
    brand_name: entry.brandName,
    concentration: entry.concentration ?? null,
    volume_ml: entry.volumeMl ?? null,
    gender: entry.gender ?? null,
    external_reference_url: entry.referenceUrl ?? null,
    sources: (entry.sources ?? []) as never,
    source: entry.source,
    confidence: entry.confidence,
    verified: entry.verified ?? false,
    verified_by: entry.verifiedBy ?? null,
    updated_at: new Date().toISOString(),
  };

  const { data } = await db
    .from("perfume_identity_registry")
    .upsert(payload, { onConflict: "normalized_name" })
    .select("id")
    .maybeSingle();
  const id = data?.id;
  if (!id) return null;

  const aliasList = Array.from(
    new Set(
      [entry.name, `${entry.brandName ?? ""} ${entry.name}`, ...(entry.aliases ?? [])]
        .map((a) => cleanText(a))
        .filter((a) => aliasKey(a).length > 3),
    ),
  ).slice(0, 12);

  for (const alias of aliasList) {
    await db
      .from("perfume_aliases")
      .upsert({ registry_id: id, alias, alias_key: aliasKey(alias), source: entry.source }, { onConflict: "alias_key" });
    // grafia sem ruído comercial também vira alias
    const soft = normalizeName(alias);
    if (soft && aliasKey(soft) !== aliasKey(alias) && aliasKey(soft).length > 3) {
      await db
        .from("perfume_aliases")
        .upsert({ registry_id: id, alias: soft, alias_key: aliasKey(soft), source: entry.source }, { onConflict: "alias_key" });
    }
  }
  return id;
}
