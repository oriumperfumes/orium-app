import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Ctx = {
  supabase: { rpc: (fn: "is_staff", args: { _user_id: string }) => Promise<{ data: unknown }> };
  userId: string;
};

const staffOnly = async (context: Ctx) => {
  const { data } = await context.supabase.rpc("is_staff", { _user_id: context.userId });
  if (!data) throw new Error("Sem permissão.");
};

/** Painel: "Buscar novamente informações olfativas" de um perfume. */
export const enrichProductFragrance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { productId: string; force?: boolean }) => data)
  .handler(async ({ data, context }) => {
    await staffOnly(context as unknown as Ctx);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { enrichFragrance } = await import("@/lib/catalog/fragrance.server");
    return enrichFragrance(db as never, data.productId, { force: data.force ?? false });
  });

/** Pesquisa de novo e devolve o resultado para comparação — não grava nada. */
export const previewFragranceResearch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { productId: string }) => data)
  .handler(async ({ data, context }) => {
    await staffOnly(context as unknown as Ctx);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { previewFragrance } = await import("@/lib/catalog/fragrance.server");
    return previewFragrance(db as never, data.productId);
  });

/** Libera (ou volta a travar) a atualização automática de um perfume. */
export const setFragranceLock = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { productId: string; locked: boolean }) => data)
  .handler(async ({ data, context }) => {
    await staffOnly(context as unknown as Ctx);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    await db
      .from("fragrance_details")
      .upsert({ product_id: data.productId, locked: data.locked }, { onConflict: "product_id" });
    return { ok: true, locked: data.locked };
  });

/** Prévia da importação a partir do link exato colado pelo Admin. */
export const previewFragranticaLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { productId: string; url: string; force?: boolean }) => data)
  .handler(async ({ data, context }) => {
    await staffOnly(context as unknown as Ctx);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { previewFragranticaUrl } = await import("@/lib/catalog/fragrantica-import.server");
    return previewFragranticaUrl(db as never, data.productId, data.url, { force: data.force ?? false });
  });

/** Aplica a importação do link escolhido pelo Admin (opcionalmente confirmando). */
export const applyFragranticaLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: {
      productId: string;
      url: string;
      sections?: { accords?: boolean; pyramid?: boolean; family?: boolean; description?: boolean };
      confirm?: boolean;
      force?: boolean;
      forceQuality?: boolean;
      forceFetch?: boolean;
    }) => data,
  )
  .handler(async ({ data, context }) => {
    await staffOnly(context as unknown as Ctx);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { applyFragranticaUrl } = await import("@/lib/catalog/fragrantica-import.server");
    return applyFragranticaUrl(db as never, data.productId, data.url, {
      sections: data.sections ?? {},
      confirm: data.confirm ?? false,
      force: data.force ?? false,
      forceQuality: data.forceQuality ?? false,
      forceFetch: data.forceFetch ?? false,
      userId: context.userId,
    });
  });

/** Prévia da importação assistida: o Admin cola o conteúdo da página. */
export const previewFragranticaPaste = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { productId: string; url: string; content: string }) => data)
  .handler(async ({ data, context }) => {
    await staffOnly(context as unknown as Ctx);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { previewFragranticaContent } = await import("@/lib/catalog/fragrantica-import.server");
    return previewFragranticaContent(db as never, data.productId, data.url, data.content ?? "");
  });

/** Aplica a importação assistida (mesma validação e confirmação do caminho automático). */
export const applyFragranticaPaste = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: {
      productId: string;
      url: string;
      content: string;
      sections?: { accords?: boolean; pyramid?: boolean; family?: boolean; description?: boolean };
      confirm?: boolean;
      force?: boolean;
      forceQuality?: boolean;
    }) => data,
  )
  .handler(async ({ data, context }) => {
    await staffOnly(context as unknown as Ctx);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { applyFragranticaContent } = await import("@/lib/catalog/fragrantica-import.server");
    return applyFragranticaContent(db as never, data.productId, data.url, data.content ?? "", {
      sections: data.sections ?? {},
      confirm: data.confirm ?? false,
      force: data.force ?? false,
      forceQuality: data.forceQuality ?? false,
      userId: context.userId,
    });
  });


/** Painel "Saúde da importação Fragrantica": métricas reais das últimas leituras. */
export const getFragranticaImportHealth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await staffOnly(context as unknown as Ctx);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { fragranticaImportHealth } = await import("@/lib/catalog/fragrantica-health.server");
    return fragranticaImportHealth(db as never);
  });

/** Reprocessa em lote (V2) os perfumes parciais — ou o catálogo inteiro. */
export const reprocessFragranticaV2 = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { scope?: "partial" | "accords-without-pyramid" | "all"; limit?: number }) => data)
  .handler(async ({ data, context }) => {
    await staffOnly(context as unknown as Ctx);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { reprocessBatch } = await import("@/lib/catalog/fragrantica-health.server");
    return reprocessBatch(db as never, data.scope ?? "partial", Math.min(15, Math.max(1, data.limit ?? 5)), context.userId);
  });

/** Histórico de importações de um perfume + restauração da versão anterior. */
export const getFragranceHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { productId: string }) => data)
  .handler(async ({ data, context }) => {
    await staffOnly(context as unknown as Ctx);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { fragranceHistory } = await import("@/lib/catalog/fragrantica-health.server");
    return fragranceHistory(db as never, data.productId);
  });

export const restoreFragranceVersion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { productId: string; logId: string }) => data)
  .handler(async ({ data, context }) => {
    await staffOnly(context as unknown as Ctx);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { restoreFragranceSnapshot } = await import("@/lib/catalog/fragrantica-health.server");
    return restoreFragranceSnapshot(db as never, data.productId, data.logId);
  });






/** Backfill do catálogo (em blocos, com cursor). */
export const backfillFragranceDetails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { cursor?: number; limit?: number; redo?: boolean }) => data)
  .handler(async ({ data, context }) => {
    await staffOnly(context as unknown as Ctx);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { backfillFragrances } = await import("@/lib/catalog/fragrance.server");
    return backfillFragrances(db as never, data.cursor ?? 0, Math.min(8, data.limit ?? 5), {
      onlyMissing: !data.redo,
    });
  });

/** Fotos das notas olfativas a partir do catálogo de notas do Fragrantica. */
export const backfillNoteImages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { limit?: number; onlyMissing?: boolean }) => data)
  .handler(async ({ data, context }) => {
    await staffOnly(context as unknown as Ctx);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { backfillNoteImages: run } = await import("@/lib/catalog/note-images.server");
    return run(db as never, Math.min(600, data.limit ?? 400), data.onlyMissing ?? false);
  });

export type FragranceEditInput = {
  productId: string;
  description: string | null;
  olfactoryFamily?: string | null;
  accords: Array<{ name: string; intensity: number }>;
  top: string[];
  heart: string[];
  base: string[];
  lock?: boolean;
};

/** Edição manual do OWNER/Admin: salva como informação confirmada e trava a automação. */
export const saveFragranceDetails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: FragranceEditInput) => data)
  .handler(async ({ data, context }) => {
    await staffOnly(context as unknown as Ctx);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { matchNote } = await import("@/lib/catalog/fragrance.server");

    const { data: library } = await db.from("olfactory_notes").select("id, canonical_name, aliases, category");
    const rows = (library ?? []) as Array<{ id: string; canonical_name: string; aliases: string[] | null; category: string }>;

    const accords = data.accords
      .map((a, i) => ({
        product_id: data.productId,
        accord_name: a.name.trim(),
        intensity: Math.max(0.2, Math.min(1, Number(a.intensity) || 0.7)),
        position: i,
        source: "Orium (equipe)",
      }))
      .filter((a) => a.accord_name.length > 1);

    const levels: Array<["TOP" | "HEART" | "BASE", string[]]> = [
      ["TOP", data.top],
      ["HEART", data.heart],
      ["BASE", data.base],
    ];
    const notes: Array<{
      product_id: string;
      note_id: string | null;
      note_label: string;
      pyramid_level: string;
      position: number;
      source: string;
    }> = [];
    for (const [level, list] of levels) {
      let pos = 0;
      for (const raw of list) {
        const label = raw.trim();
        if (label.length < 2) continue;
        let note = matchNote(label, rows);
        if (!note) {
          const { data: created } = await db
            .from("olfactory_notes")
            .insert({ canonical_name: label, aliases: [label.toLowerCase()], category: "outros" })
            .select("id, canonical_name, aliases, category")
            .maybeSingle();
          if (created) {
            note = created as typeof rows[number];
            rows.push(note);
          }
        }
        notes.push({
          product_id: data.productId,
          note_id: note?.id ?? null,
          note_label: note?.canonical_name ?? label,
          pyramid_level: level,
          position: pos++,
          source: "Orium (equipe)",
        });
      }
    }

    await db.from("fragrance_accords").delete().eq("product_id", data.productId);
    await db.from("fragrance_notes").delete().eq("product_id", data.productId);
    if (accords.length) await db.from("fragrance_accords").insert(accords);
    if (notes.length) await db.from("fragrance_notes").insert(notes);

    await db.from("fragrance_details").upsert(
      {
        product_id: data.productId,
        description: data.description?.trim() || null,
        olfactory_family: data.olfactoryFamily?.trim() || null,
        status: accords.length && notes.length ? "completo" : "parcial",
        verified: true,
        verified_by: context.userId,
        locked: data.lock ?? true,
        audit_status: "MANUALLY_VERIFIED",
        audited_at: new Date().toISOString(),
        confidence: 1,
        external_match_score: 1,
        source_conflict: false,
        enriched_at: new Date().toISOString(),
      },
      { onConflict: "product_id" },
    );

    return { ok: true };
  });

/* ------------------- Auditoria Fragrantica Brasil (sem IA) ------------------ */

/** Confere um perfume na Fragrantica Brasil. `apply: false` só mostra o comparativo. */
export const auditFragranceFragrantica = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { productId: string; apply?: boolean; force?: boolean }) => data)
  .handler(async ({ data, context }) => {
    await staffOnly(context as unknown as Ctx);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { auditProductFragrantica } = await import("@/lib/catalog/fragrantica-audit.server");
    return auditProductFragrantica(db as never, data.productId, {
      apply: data.apply ?? false,
      force: data.force ?? false,
    });
  });

/** Auditoria em lote do catálogo. */
export const runFragranceAudit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { limit?: number; force?: boolean; onlyPending?: boolean; retryFailed?: boolean }) => data)
  .handler(async ({ data, context }) => {
    await staffOnly(context as unknown as Ctx);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { runFragranticaAuditBatch } = await import("@/lib/catalog/fragrantica-audit.server");
    return runFragranticaAuditBatch(db as never, {
      limit: Math.min(20, data.limit ?? 10),
      force: data.force ?? false,
      onlyPending: data.onlyPending ?? true,
      retryFailed: data.retryFailed ?? false,
    });
  });


/** Contadores da auditoria + últimas alterações registradas. */
export const getFragranceAuditStats = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await staffOnly(context as unknown as Ctx);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");

    const { data: products } = await db
      .from("products")
      .select("id")
      .eq("product_type", "PERFUME")
      .eq("active", true);
    const { data: details } = await db
      .from("fragrance_details")
      .select("product_id, audit_status, locked");
    const { data: log } = await db
      .from("fragrance_audit_log")
      .select("product_id, product_name, status, match_confidence, changed, changes, fragrantica_url, created_at")
      .order("created_at", { ascending: false })
      .limit(30);

    const total = products?.length ?? 0;
    const ids = new Set((products ?? []).map((p) => p.id));
    const counts = { VERIFIED_FRAGRANTICA: 0, MANUALLY_VERIFIED: 0, REVIEW_REQUIRED: 0, NOT_FOUND: 0, PENDING: 0 };
    const seen = new Set<string>();
    for (const d of details ?? []) {
      if (!ids.has(d.product_id)) continue;
      seen.add(d.product_id);
      const key = (d.locked ? "MANUALLY_VERIFIED" : (d.audit_status ?? "PENDING")) as keyof typeof counts;
      if (key in counts) counts[key] += 1;
      else counts.PENDING += 1;
    }
    counts.PENDING += total - seen.size;

    return { total, counts, log: log ?? [] };
  });

/* ---------------- Fragrantica Search & Enrichment Engine V3 ---------------- */

/** Números reais do novo motor: encontrados, descrições, filas e desempenho. */
export const getEnrichmentProgress = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await staffOnly(context as unknown as Ctx);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { enrichmentProgress } = await import("@/lib/catalog/enrichment-v3.server");
    return enrichmentProgress(db as never);
  });

/** Roda um lote do motor V3 (retoma de onde parou; nunca reprocessa completos). */
export const runEnrichment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: {
      mode?: "not-found" | "partial" | "descriptions" | "missing-url" | "all";
      limit?: number;
      force?: boolean;
    }) => data,
  )
  .handler(async ({ data, context }) => {
    await staffOnly(context as unknown as Ctx);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { runEnrichmentV3 } = await import("@/lib/catalog/enrichment-v3.server");
    return runEnrichmentV3(db as never, {
      mode: data.mode ?? "all",
      limit: Math.min(120, Math.max(1, data.limit ?? 40)),
      force: data.force ?? false,
    });
  });

/* ---------------- Copiar informações olfativas de outro perfume -------------- */

export type FragranceSourceItem = {
  id: string;
  name: string;
  brand: string | null;
  volumeMl: number | null;
  concentration: string | null;
  imageUrl: string | null;
  family: string | null;
  hasDescription: boolean;
  accords: number;
  notes: number;
};

/** Busca perfumes do catálogo que já têm informação olfativa, por nome ou marca. */
export const searchFragranceSource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { q: string; excludeProductId?: string | null }) => data)
  .handler(async ({ data, context }) => {
    await staffOnly(context as unknown as Ctx);
    const term = data.q.trim();
    const empty: FragranceSourceItem[] = [];
    if (term.length < 2) return { items: empty };
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");

    const { data: rows, error } = await db
      .from("products")
      .select("id, canonical_name, brand, volume_ml, concentration, image_url, product_type")
      .neq("product_type", "NEGOCIACAO")
      .or(`canonical_name.ilike.%${term}%,brand.ilike.%${term}%`)
      .limit(40);
    if (error) throw new Error(error.message);

    const ids = (rows ?? []).map((r) => r.id).filter((id) => id !== data.excludeProductId);
    if (!ids.length) return { items: empty };

    const [{ data: details }, { data: accords }, { data: notes }] = await Promise.all([
      db.from("fragrance_details").select("product_id, olfactory_family, description").in("product_id", ids),
      db.from("fragrance_accords").select("product_id").in("product_id", ids),
      db.from("fragrance_notes").select("product_id").in("product_id", ids),
    ]);

    const count = (list: Array<{ product_id: string }> | null, id: string) =>
      (list ?? []).filter((r) => r.product_id === id).length;

    const items: FragranceSourceItem[] = (rows ?? [])
      .filter((r) => ids.includes(r.id))
      .map((r) => {
        const d = (details ?? []).find((x) => x.product_id === r.id);
        return {
          id: r.id,
          name: r.canonical_name,
          brand: r.brand,
          volumeMl: r.volume_ml,
          concentration: r.concentration,
          imageUrl: r.image_url,
          family: d?.olfactory_family ?? null,
          hasDescription: Boolean(d?.description),
          accords: count(accords, r.id),
          notes: count(notes, r.id),
        };
      })
      .filter((r) => r.accords > 0 || r.notes > 0 || r.hasDescription)
      .sort((a, b) => b.accords + b.notes - (a.accords + a.notes))
      .slice(0, 12);

    return { items };
  });

/**
 * Copia a parte olfativa de um perfume do catálogo para outro registro:
 * família, acordes, pirâmide/notas, descrição e a fonte Fragrantica.
 * Não copia preço, estoque, fornecedor, promoção nem foto — só o perfil olfativo.
 * As imagens das notas vêm da biblioteca compartilhada, então acompanham as notas.
 */
export const copyFragranceFrom = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { fromProductId: string; toProductId: string }) => {
    if (!data.fromProductId || !data.toProductId) throw new Error("Escolha o perfume de origem.");
    if (data.fromProductId === data.toProductId) throw new Error("Escolha outro perfume.");
    return data;
  })
  .handler(async ({ data, context }) => {
    await staffOnly(context as unknown as Ctx);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");

    const [{ data: details }, { data: accords }, { data: notes }] = await Promise.all([
      db.from("fragrance_details").select("*").eq("product_id", data.fromProductId).maybeSingle(),
      db.from("fragrance_accords").select("*").eq("product_id", data.fromProductId).order("position"),
      db.from("fragrance_notes").select("*").eq("product_id", data.fromProductId).order("position"),
    ]);

    if (!details && !(accords ?? []).length && !(notes ?? []).length)
      throw new Error("Esse perfume ainda não tem informações olfativas para copiar.");

    await db.from("fragrance_accords").delete().eq("product_id", data.toProductId);
    await db.from("fragrance_notes").delete().eq("product_id", data.toProductId);

    if ((accords ?? []).length)
      await db.from("fragrance_accords").insert(
        (accords ?? []).map((a, i) => ({
          product_id: data.toProductId,
          accord_name: a.accord_name,
          intensity: a.intensity,
          position: i,
          source: "Copiado do catálogo",
        })),
      );

    if ((notes ?? []).length)
      await db.from("fragrance_notes").insert(
        (notes ?? []).map((n, i) => ({
          product_id: data.toProductId,
          note_id: n.note_id,
          note_label: n.note_label,
          pyramid_level: n.pyramid_level,
          position: i,
          source: "Copiado do catálogo",
        })),
      );

    await db.from("fragrance_details").upsert(
      {
        product_id: data.toProductId,
        description: details?.description ?? null,
        olfactory_family: details?.olfactory_family ?? null,
        fragrantica_url: details?.fragrantica_url ?? null,
        source_primary: details?.source_primary ?? "Copiado do catálogo",
        source_primary_url: details?.source_primary_url ?? null,
        status: (accords ?? []).length && (notes ?? []).length ? "completo" : "parcial",
        verified: true,
        verified_by: context.userId,
        locked: true,
        audit_status: "MANUALLY_VERIFIED",
        audited_at: new Date().toISOString(),
        confidence: 1,
        external_match_score: 1,
        source_conflict: false,
        enriched_at: new Date().toISOString(),
      },
      { onConflict: "product_id" },
    );

    return {
      ok: true,
      accords: (accords ?? []).length,
      notes: (notes ?? []).length,
      family: details?.olfactory_family ?? null,
    };
  });
