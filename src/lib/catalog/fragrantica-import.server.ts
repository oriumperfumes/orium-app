/**
 * Importação pelo link exato da Fragrantica Brasil — usa o
 * FRAGRANTICA IMPORT ENGINE V2.
 *
 * O link colado pelo Admin tem prioridade absoluta: nenhuma busca por
 * similaridade acontece aqui. Validamos o domínio, lemos exatamente aquela
 * página com todas as estratégias, validamos o resultado e devolvemos uma
 * prévia com status e completude. A gravação só acontece quando o Admin
 * confirma, passa pelo QUALITY GUARD e é feita em bloco.
 */
import {
  extractFragrantica,
  qualityGuard,
  validateFragranticaUrl,
  PARSER_VERSION,
  type Extraction,
  type ExtractionStatus,
  type ExtractedNote,
  type Level,
  type ImportDiagnostics,
} from "./fragrantica-v2.server";

type Db = { from: (t: string) => any };

export { validateFragranticaUrl, PARSER_VERSION };

const norm = (s: string) =>
  String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export type ImportPreview = {
  ok: boolean;
  error: string | null;
  url: string;
  perfumeName: string | null;
  brand: string | null;
  gender: string | null;
  concentration: string | null;
  family: string | null;
  accords: Array<{ name: string; intensity: number }>;
  top: string[];
  heart: string[];
  base: string[];
  /** Lista única quando a fonte não publica pirâmide (dados fiéis à fonte). */
  flat: string[];
  noteImages: Array<{ label: string; externalId: string; imageUrl: string; sourceUrl: string }>;
  structure: Extraction["structure"];
  status: ExtractionStatus;
  completeness: number;
  matchConfidence: number;
  issues: string[];
  strategies: Extraction["strategies"];
  strategyUsed: string | null;
  conflict: Extraction["conflict"];
  parserVersion: string;
  durationMs: number;
  httpStatus: number | null;
  description: string;
  /** "fonte" = texto fiel ao conteúdo fornecido; "orium" = redigido pela Orium. */
  descriptionSource: "fonte" | "orium";
  /** true = a origem recusou a leitura automática (SOURCE_BLOCKED). */
  blocked: boolean;
  failure: string | null;
  importMethod: "AUTO_URL" | "MANUAL_ASSISTED";
  parserRan: boolean;
  diagnostics: ImportDiagnostics | null;
  current: {
    accords: Array<{ name: string; intensity: number }>;
    top: string[];
    heart: string[];
    base: string[];
    description: string | null;
    locked: boolean;
    fragranticaUrl: string | null;
    auditedAt: string | null;
    verified: boolean;
  };
  quality: { currentScore: number; incomingScore: number; allow: boolean; reason: string | null };
  identityWarning: string | null;
};

/** Descrição própria da Orium — escrita a partir dos dados olfativos, sem copiar a fonte. */
export function buildOriumDescription(input: {
  name: string;
  brand: string | null;
  family: string | null;
  accords: string[];
  top: string[];
  heart: string[];
  base: string[];
  flat?: string[];
}): string {
  const join = (l: string[]) => {
    const list = l.slice(0, 4).map((x) => x.toLowerCase());
    if (list.length <= 1) return list[0] ?? "";
    return `${list.slice(0, -1).join(", ")} e ${list[list.length - 1]}`;
  };
  const parts: string[] = [];
  const who = [input.brand, input.name].filter(Boolean).join(" ").trim() || input.name;
  const acc = join(input.accords);
  parts.push(
    input.family
      ? `${who} é uma fragrância ${input.family.toLowerCase()}${acc ? `, marcada por acordes de ${acc}` : ""}.`
      : `${who} é uma fragrância${acc ? ` marcada por acordes de ${acc}` : ""}.`,
  );
  if (input.top.length) parts.push(`A abertura traz ${join(input.top)}.`);
  if (input.heart.length) parts.push(`No coração, ${join(input.heart)}.`);
  if (input.base.length) parts.push(`O fundo deixa ${join(input.base)} na pele.`);
  if (!input.top.length && !input.heart.length && !input.base.length && input.flat?.length) {
    parts.push(`Na composição, ${join(input.flat)}.`);
  }
  parts.push("Seleção Orium, com produto original e pronta entrega.");
  return parts.join(" ");
}

async function readCurrent(db: Db, productId: string) {
  const [{ data: acc }, { data: notes }, { data: details }] = await Promise.all([
    db.from("fragrance_accords").select("accord_name, intensity, position").eq("product_id", productId).order("position"),
    db.from("fragrance_notes").select("note_label, pyramid_level, position").eq("product_id", productId).order("position"),
    db
      .from("fragrance_details")
      .select("description, locked, verified, fragrantica_url, audited_at")
      .eq("product_id", productId)
      .maybeSingle(),
  ]);
  const list = (notes ?? []) as Array<{ note_label: string; pyramid_level: string }>;
  return {
    accords: ((acc ?? []) as Array<{ accord_name: string; intensity: number }>).map((a) => ({
      name: a.accord_name,
      intensity: Number(a.intensity),
    })),
    top: list.filter((n) => n.pyramid_level === "TOP").map((n) => n.note_label),
    heart: list.filter((n) => n.pyramid_level === "HEART").map((n) => n.note_label),
    base: list.filter((n) => n.pyramid_level === "BASE").map((n) => n.note_label),
    flat: list.filter((n) => n.pyramid_level === "NOTE").map((n) => n.note_label),
    description: (details?.description ?? null) as string | null,
    locked: !!details?.locked,
    fragranticaUrl: (details?.fragrantica_url ?? null) as string | null,
    auditedAt: (details?.audited_at ?? null) as string | null,
    verified: !!details?.verified,
  };
}

const labels = (list: ExtractedNote[]) => list.map((n) => n.label);

/** Score de identidade entre o produto da Orium e o perfume da página. */
function matchConfidence(product: { brand: string | null; canonical_name: string } | null, name: string | null): number {
  if (!product || !name) return 0;
  const ours = norm(`${product.brand ?? ""} ${product.canonical_name}`).split(" ").filter((w) => w.length > 2);
  const theirs = norm(name);
  if (!ours.length) return 0;
  const hits = ours.filter((w) => theirs.includes(w)).length;
  return Math.round((hits / ours.length) * 100);
}

/** Monta a prévia a partir de uma extração já feita (URL ou conteúdo colado). */
async function buildPreview(
  db: Db,
  productId: string,
  extraction: Extraction,
): Promise<ImportPreview> {
  const current = await readCurrent(db, productId);
  const { data: product } = await db.from("products").select("canonical_name, brand").eq("id", productId).maybeSingle();

  const top = labels(extraction.levels.TOP);
  const heart = labels(extraction.levels.HEART);
  const base = labels(extraction.levels.BASE);
  const flat = labels(extraction.flat);

  const confidence = matchConfidence(product ?? null, extraction.identity.perfumeName);
  const guard = qualityGuard(
    { accords: current.accords.length, notes: current.top.length + current.heart.length + current.base.length + current.flat.length, hasPyramid: current.top.length > 0 || current.base.length > 0 },
    { accords: extraction.accords.length, notes: top.length + heart.length + base.length + flat.length, hasPyramid: top.length > 0 || base.length > 0 },
  );

  let identityWarning: string | null = null;
  if (product && extraction.identity.perfumeName && confidence < 100) {
    identityWarning = `Fragrantica: ${extraction.identity.perfumeName} · Orium: ${[product.brand, product.canonical_name].filter(Boolean).join(" ")}`;
  }

  // Se o conteúdo fornecido tem texto descritivo, ele é a base fiel da descrição.
  const fromSource = (extraction.sourceDescription ?? "").trim();
  const useSource = fromSource.length >= 60;
  const description = useSource
    ? fromSource.slice(0, 1400)
    : buildOriumDescription({
        name: product?.canonical_name ?? extraction.identity.perfumeName ?? "Esta fragrância",
        brand: product?.brand ?? extraction.identity.brand,
        family: extraction.identity.family,
        accords: extraction.accords.map((a) => a.name),
        top,
        heart,
        base,
        flat,
      });

  return {
    ok: extraction.ok,
    error: extraction.error,
    url: extraction.url,
    perfumeName: extraction.identity.perfumeName,
    brand: extraction.identity.brand,
    gender: extraction.identity.gender,
    concentration: extraction.identity.concentration,
    family: extraction.identity.family,
    accords: extraction.accords.map((a) => ({ name: a.name, intensity: a.intensity })),
    top,
    heart,
    base,
    flat,
    noteImages: extraction.noteImages,
    structure: extraction.structure,
    status: extraction.status,
    completeness: extraction.completeness,
    matchConfidence: confidence,
    issues: extraction.issues,
    strategies: extraction.strategies,
    strategyUsed: extraction.strategyUsed,
    conflict: extraction.conflict,
    parserVersion: extraction.parserVersion,
    durationMs: extraction.durationMs,
    httpStatus: extraction.httpStatus,
    description,
    descriptionSource: useSource ? "fonte" : "orium",
    blocked: !!extraction.blocked,
    failure: extraction.failure ?? null,
    importMethod: extraction.importMethod ?? "AUTO_URL",
    parserRan: extraction.parserRan ?? extraction.ok,
    diagnostics: extraction.diagnostics ?? null,
    current,
    quality: {
      currentScore: guard.currentScore,
      incomingScore: guard.incomingScore,
      allow: guard.allow,
      reason: guard.reason,
    },
    identityWarning,
  };
}

/** Lê a página escolhida pelo Admin e devolve a prévia (não grava nada). */
export async function previewFragranticaUrl(
  db: Db,
  productId: string,
  rawUrl: string,
  opts: { force?: boolean } = {},
): Promise<ImportPreview> {
  const extraction = await extractFragrantica(rawUrl, { force: opts.force ?? false });
  return buildPreview(db, productId, extraction);
}

/**
 * IMPORTAÇÃO ASSISTIDA — interpreta o conteúdo que o Admin copiou da página.
 * Nenhuma requisição é feita ao Fragrantica aqui.
 */
export async function previewFragranticaContent(
  db: Db,
  productId: string,
  rawUrl: string,
  content: string,
): Promise<ImportPreview> {
  const { parsePastedContent } = await import("./fragrantica-paste.server");
  const url = validateFragranticaUrl(rawUrl) ?? "";
  const parsed = parsePastedContent(content, url);
  return buildPreview(db, productId, { ...parsed, httpStatus: null, fromCache: false, durationMs: 0 } as Extraction);
}

type NoteRow = { id: string; canonical_name: string; aliases: string[] | null; category: string };

async function resolveNote(db: Db, label: string, rows: NoteRow[]): Promise<NoteRow | null> {
  const k = norm(label).replace(/\s+/g, "");
  if (!k) return null;
  const hit = rows.find(
    (r) => norm(r.canonical_name).replace(/\s+/g, "") === k || (r.aliases ?? []).some((a) => norm(a).replace(/\s+/g, "") === k),
  );
  if (hit) return hit;
  const canonical = label.slice(0, 60);
  const { data } = await db
    .from("olfactory_notes")
    .insert({ canonical_name: canonical, aliases: [canonical.toLowerCase()], category: "outros" })
    .select("id, canonical_name, aliases, category")
    .maybeSingle();
  if (!data) return null;
  rows.push(data as NoteRow);
  return data as NoteRow;
}

export type ImportSections = {
  accords?: boolean;
  pyramid?: boolean;
  family?: boolean;
  description?: boolean;
};

export type ImportResult = {
  ok: boolean;
  error: string | null;
  url: string | null;
  applied: string[];
  status: ExtractionStatus | "BLOCKED" | "SOURCE_BLOCKED";
  /** Caminho usado nesta importação. */
  importMethod?: "AUTO_URL" | "MANUAL_ASSISTED";
  /** Dados técnicos da tentativa recusada, para o Admin entender o motivo. */
  diagnostics?: ImportDiagnostics | null;
  completeness: number;
  matchConfidence: number;
  issues: string[];
  quality: { currentScore: number; incomingScore: number };
};

/** Registro de diagnóstico de cada importação (para o painel de saúde). */
async function logImport(
  db: Db,
  row: Record<string, unknown>,
): Promise<void> {
  try {
    await db.from("fragrantica_import_logs").insert(row);
  } catch {
    /* diagnóstico nunca deve derrubar a importação */
  }
}

/**
 * Aplica a importação. Só grava depois de ler e validar a página inteira:
 * se algo falhar antes, nada é apagado. O QUALITY GUARD impede que um
 * resultado pior substitua dados melhores já salvos.
 */
export type ApplyOpts = {
  sections?: ImportSections;
  confirm?: boolean;
  userId?: string | null;
  force?: boolean;
  forceQuality?: boolean;
  forceFetch?: boolean;
};

/** Lê a página e aplica (caminho automático). */
export async function applyFragranticaUrl(
  db: Db,
  productId: string,
  rawUrl: string,
  opts: ApplyOpts = {},
): Promise<ImportResult> {
  const preview = await previewFragranticaUrl(db, productId, rawUrl, { force: opts.forceFetch ?? false });
  return applyPreview(db, productId, preview, opts);
}

/** Aplica a partir do conteúdo fornecido pelo Admin (importação assistida). */
export async function applyFragranticaContent(
  db: Db,
  productId: string,
  rawUrl: string,
  content: string,
  opts: ApplyOpts = {},
): Promise<ImportResult> {
  const preview = await previewFragranticaContent(db, productId, rawUrl, content);
  return applyPreview(db, productId, preview, opts);
}

/** Grava uma prévia já validada (mesmo caminho para automático e assistido). */
export async function applyPreview(
  db: Db,
  productId: string,
  preview: ImportPreview,
  opts: ApplyOpts = {},
): Promise<ImportResult> {
  const base = {
    completeness: preview.completeness,
    matchConfidence: preview.matchConfidence,
    issues: preview.issues,
    quality: { currentScore: preview.quality.currentScore, incomingScore: preview.quality.incomingScore },
  };

  const logBase = {
    product_id: productId,
    url: preview.url || null,
    http_status: preview.httpStatus,
    parser_version: preview.parserVersion,
    strategy_used: preview.strategyUsed,
    strategies: preview.strategies,
    accords_found: preview.accords.length,
    notes_found: preview.top.length + preview.heart.length + preview.base.length + preview.flat.length,
    structure: preview.structure,
    completeness: preview.completeness,
    match_confidence: preview.matchConfidence,
    duration_ms: preview.durationMs,
    issues: preview.issues,
    quality_before: preview.quality.currentScore,
    quality_after: preview.quality.incomingScore,
  };

  if (!preview.ok) {
    const status = preview.blocked ? "SOURCE_BLOCKED" : "FAILED";
    await logImport(db, { ...logBase, status, applied: false, error: preview.error });
    return {
      ok: false,
      error: preview.error,
      url: preview.blocked ? preview.url : null,
      applied: [],
      status,
      importMethod: preview.importMethod,
      diagnostics: preview.diagnostics,
      ...base,
    };
  }
  if (preview.current.locked && !opts.force) {
    await logImport(db, { ...logBase, status: "BLOCKED", applied: false, blocked_reason: "locked" });
    return {
      ok: false,
      error: "Este perfume possui informações confirmadas manualmente.",
      url: preview.url,
      applied: [],
      status: "BLOCKED",
      ...base,
    };
  }
  if (!preview.quality.allow && !opts.forceQuality) {
    await logImport(db, { ...logBase, status: "BLOCKED", applied: false, blocked_reason: preview.quality.reason });
    return {
      ok: false,
      error: preview.quality.reason,
      url: preview.url,
      applied: [],
      status: "BLOCKED",
      ...base,
    };
  }

  const s: ImportSections = { accords: true, pyramid: true, family: true, description: true, ...(opts.sections ?? {}) };
  const applied: string[] = [];

  const { data: library } = await db.from("olfactory_notes").select("id, canonical_name, aliases, category");
  const rows = (library ?? []) as NoteRow[];

  if (s.accords && preview.accords.length) {
    const accordRows = preview.accords.map((a, i) => ({
      product_id: productId,
      accord_name: a.name,
      intensity: Number(a.intensity.toFixed(3)),
      position: i,
      source: `Fragrantica Brasil (${preview.parserVersion})`,
    }));
    await db.from("fragrance_accords").delete().eq("product_id", productId);
    await db.from("fragrance_accords").insert(accordRows);
    applied.push("acordes");
  }

  const hasNotes = preview.top.length || preview.heart.length || preview.base.length || preview.flat.length;
  if (s.pyramid && hasNotes) {
    const noteRows: Array<Record<string, unknown>> = [];
    const groups: Array<[Level | "NOTE", string[]]> = [
      ["TOP", preview.top],
      ["HEART", preview.heart],
      ["BASE", preview.base],
      ["NOTE", preview.flat],
    ];
    for (const [level, list] of groups) {
      let pos = 0;
      for (const label of list) {
        const note = await resolveNote(db, label, rows);
        noteRows.push({
          product_id: productId,
          note_id: note?.id ?? null,
          note_label: note?.canonical_name ?? label,
          pyramid_level: level,
          position: pos++,
          source: `Fragrantica Brasil (${preview.parserVersion})`,
        });
      }
    }
    await db.from("fragrance_notes").delete().eq("product_id", productId);
    if (noteRows.length) await db.from("fragrance_notes").insert(noteRows);
    applied.push(preview.structure === "PYRAMID" ? "pirâmide" : "notas");

    // imagens: processo separado — falha aqui não invalida a importação
    try {
      const { data: assets } = await db.from("olfactory_note_assets").select("canonical_note_name, image_url, status");
      const have = new Map<string, { image_url: string | null; status: string }>();
      for (const a of (assets ?? []) as Array<{ canonical_note_name: string; image_url: string | null; status: string }>) {
        have.set(norm(a.canonical_note_name), { image_url: a.image_url, status: a.status });
      }
      for (const img of preview.noteImages) {
        const existing = have.get(norm(img.label));
        if (existing?.image_url && existing.status === "ok") continue;
        await db.from("olfactory_note_assets").upsert(
          {
            canonical_note_name: img.label,
            display_name: img.label,
            image_url: img.imageUrl,
            source_url: img.sourceUrl,
            source: "fragrantica.com.br",
            external_id: img.externalId,
            status: "ok",
          },
          { onConflict: "canonical_note_name" },
        );
        const note = rows.find((r) => norm(r.canonical_name) === norm(img.label));
        if (note) await db.from("olfactory_notes").update({ image_url: img.imageUrl }).eq("id", note.id).is("image_url", null);
      }
    } catch {
      /* imagens são complementares */
    }
  }

  const now = new Date().toISOString();
  const details: Record<string, unknown> = {
    product_id: productId,
    fragrantica_url: preview.url,
    fragrantica_match_confidence: preview.matchConfidence / 100,
    audit_status: opts.confirm ? "MANUALLY_VERIFIED" : preview.status === "COMPLETE" ? "VERIFIED_FRAGRANTICA" : "REVIEW_REQUIRED",
    audited_at: now,
    status: preview.status === "COMPLETE" ? "completo" : preview.status === "PARTIAL" ? "parcial" : "revisar",
    source_primary: `Fragrantica Brasil (${preview.parserVersion})`,
    source_primary_url: preview.url,
    confidence: preview.matchConfidence / 100,
    external_match_score: preview.completeness / 100,
    source_conflict: preview.conflict.detected,
    enriched_at: now,
  };
  if (s.description) {
    details['description'] = preview.description;
    applied.push("descrição");
  }
  if (s.family && preview.family) {
    details['olfactory_family'] = preview.family;
    applied.push("família olfativa");
  }
  if (opts.confirm) {
    details['locked'] = true;
    details['verified'] = true;
    details['verified_by'] = opts.userId ?? null;
  }

  await db.from("fragrance_details").upsert(details, { onConflict: "product_id" });

  await db.from("fragrance_audit_log").insert({
    product_id: productId,
    product_name: preview.perfumeName ?? productId,
    fragrantica_url: preview.url,
    match_confidence: preview.matchConfidence,
    status: opts.confirm ? "MANUALLY_VERIFIED" : preview.status === "COMPLETE" ? "VERIFIED_FRAGRANTICA" : "REVIEW_REQUIRED",
    changed: applied.length > 0,
    before: {
      accords: preview.current.accords,
      top: preview.current.top,
      heart: preview.current.heart,
      base: preview.current.base,
    },
    after: { accords: preview.accords, top: preview.top, heart: preview.heart, base: preview.base, flat: preview.flat },
    changes: applied.map((a) => `${preview.parserVersion}: ${a}`),
  });

  await logImport(db, { ...logBase, status: preview.status, applied: true });

  return { ok: true, error: null, url: preview.url, applied, status: preview.status, ...base };
}
