/**
 * Fotos das notas olfativas — fonte única: catálogo de notas do Fragrantica
 * (https://www.fragrantica.com.br/notas/).
 *
 * Fluxo: baixa o catálogo de notas, casa a nota canônica da Orium com a nota
 * exata do catálogo (nome idêntico normalizado ou alias explícito), abre a
 * imagem grande daquela nota (`o.<id>.jpg`, com fallback para a menor) e grava
 * na biblioteca única `olfactory_note_assets` + em `olfactory_notes.image_url`.
 *
 * Nada de busca genérica na internet, nada de IA, nada de match aproximado:
 * sem nota exata no Fragrantica a nota fica `NOTE_IMAGE_REVIEW_REQUIRED`.
 */

type Db = { from: (t: string) => any };

const CATALOG_URL = "https://www.fragrantica.com.br/notas/";
const CATALOG_EN_URL = "https://www.fragrantica.com/notes/";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36";

export const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * Variações de idioma/escrita da Orium → nome exato da nota no Fragrantica.
 * Só entram equivalências seguras (mesma matéria-prima), nunca aproximações.
 */
const ALIASES: Record<string, string> = {
  // inglês → português
  ginger: "Gengibre",
  vanilla: "Baunilha",
  "tonka bean": "Fava Tonka",
  saffron: "Açafrão",
  cinnamon: "Canela",
  bergamot: "Bergamota",
  lemon: "Limão",
  lavender: "Lavanda",
  rose: "Rosa",
  jasmine: "Jasmim",
  coffee: "Café",
  tobacco: "Tabaco",
  cedar: "Cedro",
  cedarwood: "Cedro",
  sandalwood: "Sândalo",
  musk: "Almíscar",
  "white musk": "Almíscar branco",
  amber: "Âmbar",
  ambergris: "Ambregris",
  leather: "Couro",
  honey: "Mel",
  caramel: "Caramelo",
  coconut: "Coco",
  almond: "Amêndoa",
  pineapple: "Abacaxi",
  apple: "Maçã",
  peach: "Pêssego",
  plum: "Ameixa",
  raspberry: "Framboesa",
  strawberry: "Morango",
  blackberry: "Amora",
  blackcurrant: "Groselha preta",
  "black currant": "Groselha preta",
  grapefruit: "Toranja",
  tangerine: "Tangerina",
  orange: "Laranja",
  lime: "Lima",
  mint: "Hortelã",
  peppermint: "Hortelã",
  basil: "Manjericão",
  thyme: "Tomilho",
  rosemary: "Alecrim",
  sage: "Esclárea",
  "clary sage": "Esclárea",
  patchouly: "Patchouli",
  "oak moss": "Musgo de carvalho",
  oakmoss: "Musgo de carvalho",
  incense: "Incenso",
  frankincense: "Olíbano",
  myrrh: "Mirra",
  benzoin: "Benjoim",
  labdanum: "Ládano",
  "pink pepper": "Pimenta Rosa",
  "black pepper": "Pimento",
  pepper: "Pimento",
  nutmeg: "Noz-moscada",
  cardamom: "Cardamomo",
  clove: "Cravinho",
  cocoa: "Cacau",
  "green tea": "Chá verde",
  "black tea": "Chá preto",
  fig: "Figo",
  pear: "Pera",
  melon: "Melão",
  watermelon: "Melão",
  lychee: "Lichia",
  litchi: "Lichia",
  mango: "Manga",
  "passion fruit": "Maracujá",
  rhubarb: "Ruibarbo",
  juniper: "Zimbro",
  "juniper berries": "Bagos de zimbro",
  cypress: "Cipreste",
  pine: "Pinho",
  "sea salt": "Sal",
  seaweed: "Algas",
  suede: "Camurça",
  "iso e super": "Iso E Super",
  agarwood: "Agarwood (Oud)",
  oud: "Agarwood (Oud)",
  "madeira de oud": "Agarwood (Oud)",
  vetivert: "Vetiver",
  praline: "Pralinê",
  "ylang ylang": "Ylang-ylang",
  "orange blossom": "Flor de Laranjeira",
  violet: "Violeta",
  iris: "Íris",
  lily: "Lírio",
  peony: "Peônia",
  gardenia: "Gardênia",
  tuberose: "Tuberosa",
  geranium: "Gerânio",
  vodka: "Vodka",
  rum: "Rum",
  // variações internas da Orium
  citrinos: "Cítricos",
  helitropo: "Heliotrópio",
  mandarinha: "Mandarina",
  "mandarin": "Mandarina",
  litchi_pt: "Lichia",
  mirabelle: "Ameixa Mirabelle",
  cyclamen: "Cíclame",
  rhubarb_pt: "Ruibarbo",
  vidoeiro: "Bétula",
  junípero: "Zimbro",
  junipero: "Zimbro",
  cravo: "Cravinho",
  menta: "Hortelã",
  castaña: "Chestnut",
  castanha: "Chestnut",
  "baunilha bourbon": "Vanilla",
  "uísque bourbon": "Whiskey",
  "óleo de cypriol": "Cypriol Oil or Nagarmotha",
  "óleo de cipriol ou nagarmota": "Cypriol Oil or Nagarmotha",
  cipriol: "Cypriol Oil or Nagarmotha",
  cypriol: "Cypriol Oil or Nagarmotha",
  nagarmota: "Cypriol Oil or Nagarmotha",
  // português → inglês (notas básicas que só constam no catálogo em inglês)
  gengibre: "Ginger",
  baunilha: "Vanilla",
  limão: "Lemon",
  tabaco: "Tobacco",
  sal: "Salt",
  figo: "Fig",
  açúcar: "Sugar",
  abeto: "Fir",
  ácer: "Maple",
  "água do mar": "Sea Water",
  "alcaçuz preto": "Licorice",
  alcaçuz: "Licorice",
  "aloe vera": "Aloe Vera",
  amberwood: "Amberwood",
  "ambrar cinzento": "Ambergris",
  ambregris: "Ambergris",
  bétula: "Birch",
  birch: "Birch",
  vidoeiro_en: "Birch",
  cíclame: "Cyclamen",
  citron: "Citron",
  cominho: "Cumin",
  cravinho: "Clove",
  davan: "Davana",
  davana: "Davana",
  elemi: "Elemi",
  esclárea: "Clary Sage",
  feto: "Fern",
  frangipani: "Frangipani",
  freesia: "Freesia",
  frésia: "Freesia",
  funcho: "Fennel",
  kumquat: "Kumquat",
  lactonas: "Lactones",
  mamão: "Papaya",
  marshmallow: "Marshmallow",
  "óleo de cade": "Cade Oil",
  "óleo de monoi": "Monoi Oil",
  opoponax: "Opoponax",
  orris: "Orris Root",
  petitgrain: "Petitgrain",
  pimento: "Black Pepper",
  pinho: "Pine Tree",
  pitahaya: "Dragon Fruit",
  pivoônia: "Peony",
  "flor de tiaré": "Tiare Flower",
  "folhas verdes": "Green Leaves",
  sorvete: "Ice Cream",
  uísque: "Whiskey",
  whisky: "Whiskey",
  "notas marinhas": "Sea Notes",
  "flor de pereira": "Pear Blossom",
  "chá preto": "Chá",
  "chá verde": "Chá",
  cacau: "Semente de Cacau",
  chocolate: "Chocolate Amargo",
  "almíscar branco": "Musk",
  uva: "Grapes",
  musgo: "Oakmoss",
  "bagos de zimbro": "Bagas de zimbro ou junipero",
  lavandim: "Lavanda",
  resina: "Resins",
  "resina de abeto": "Resins",
  "flor branca": "White Flowers",
  incensado: "Incenso",
  pitaya: "Pitahaya",
};


export type CatalogNote = { name: string; url: string; id: string; thumb: string };

let cache: Map<string, CatalogNote> | null = null;

async function fetchCatalogHtml(url: string): Promise<string> {
  let html = "";
  for (let attempt = 1; attempt <= 5 && !html; attempt += 1) {
    try {
      const res = await fetch(url, {
        headers: {
          "user-agent": UA,
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-language": "pt-BR,pt;q=0.9,en;q=0.8",
        },
        signal: AbortSignal.timeout(30000),
      });
      if (res.ok) html = await res.text();
    } catch {
      /* tenta de novo */
    }
    if (!html) await new Promise((r) => setTimeout(r, 2500 * attempt));
  }
  return html;
}

function indexCatalog(html: string, base: string, map: Map<string, CatalogNote>) {
  const re = new RegExp(
    `<a href="(${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^"]+)"[\\s\\S]{0,400}?<img src="(https://fimgs\\.net/mdimg/sastojci/m\\.(\\d+)\\.jpg[^"]*)"[\\s\\S]{0,800}?alt="([^"]*)"`,
    "g",
  );
  let count = 0;
  for (const m of html.matchAll(re)) {
    const [, url, thumb, id, name] = m;
    if (!url || !thumb || !id || !name) continue;
    const key = norm(name);
    count += 1;
    if (!map.has(key)) map.set(key, { name, url, id, thumb });
  }
  return count;
}

/**
 * Índice do catálogo de notas do Fragrantica. Usa o catálogo em português e
 * complementa com o catálogo em inglês (algumas matérias-primas básicas só
 * aparecem lá) — sempre a mesma nota, só o rótulo muda de idioma.
 */
export async function loadFragranticaNotes(): Promise<Map<string, CatalogNote>> {
  if (cache) return cache;
  const map = new Map<string, CatalogNote>();
  const pt = await fetchCatalogHtml(CATALOG_URL);
  indexCatalog(pt, "https://www.fragrantica.com.br/notas/", map);
  const en = await fetchCatalogHtml(CATALOG_EN_URL);
  indexCatalog(en, "https://www.fragrantica.com/notes/", map);
  if (map.size < 200) throw new Error("Catálogo de notas do Fragrantica veio incompleto");
  cache = map;
  return map;
}


/** Encontra a nota EXATA no catálogo (nome idêntico ou alias explícito). */
const NORM_ALIASES = new Map<string, string>(Object.entries(ALIASES).map(([k, v]) => [norm(k), v]));
/** Equivalência inversa (pt ⇄ en), útil quando só um dos catálogos tem a nota. */
const REVERSE_ALIASES = new Map<string, string>(
  Object.entries(ALIASES).map(([k, v]) => [norm(v), k]),
);

export function matchCatalogNote(canonicalName: string, catalog: Map<string, CatalogNote>) {
  const key = norm(canonicalName);
  const direct = catalog.get(key);
  if (direct) return direct;
  const alias = NORM_ALIASES.get(key);
  if (alias) {
    const viaAlias = catalog.get(norm(alias));
    if (viaAlias) return viaAlias;
  }
  const reverse = REVERSE_ALIASES.get(key);
  if (reverse) {
    const viaReverse = catalog.get(norm(reverse));
    if (viaReverse) return viaReverse;
  }
  return null;
}


/** Imagem grande da página da nota; cai para a menor se a grande não existir. */
export async function bestNoteImage(note: CatalogNote): Promise<string> {
  const big = `https://fimgs.net/mdimg/sastojci/o.${note.id}.jpg`;
  try {
    const head = await fetch(big, { method: "HEAD", headers: { "user-agent": UA }, signal: AbortSignal.timeout(15000) });
    if (head.ok) return big;
  } catch {
    /* usa a menor */
  }
  return (note.thumb.split("?")[0] ?? note.thumb);
}

export type NoteAssetResult = {
  canonical: string;
  image_url: string | null;
  source_url: string | null;
  status: "ok" | "NOTE_IMAGE_REVIEW_REQUIRED";
};

/** Resolve (e guarda) o asset de uma nota canônica. */
export async function resolveNoteAsset(
  db: Db,
  canonicalName: string,
  catalog: Map<string, CatalogNote>,
): Promise<NoteAssetResult> {
  const hit = matchCatalogNote(canonicalName, catalog);
  if (!hit) {
    await db.from("olfactory_note_assets").upsert(
      {
        canonical_note_name: canonicalName,
        display_name: canonicalName,
        image_url: null,
        source_url: null,
        source: "FRAGRANTICA",
        status: "NOTE_IMAGE_REVIEW_REQUIRED",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "canonical_note_name" },
    );
    return { canonical: canonicalName, image_url: null, source_url: null, status: "NOTE_IMAGE_REVIEW_REQUIRED" };
  }

  const image = await bestNoteImage(hit);
  await db.from("olfactory_note_assets").upsert(
    {
      canonical_note_name: canonicalName,
      display_name: hit.name,
      image_url: image,
      source_url: hit.url,
      source: "FRAGRANTICA",
      external_id: hit.id,
      status: "ok",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "canonical_note_name" },
  );
  return { canonical: canonicalName, image_url: image, source_url: hit.url, status: "ok" };
}

/** Compatibilidade: imagem de uma nota avulsa. */
export async function findNoteImage(canonicalName: string): Promise<string | null> {
  const catalog = await loadFragranticaNotes();
  const hit = matchCatalogNote(canonicalName, catalog);
  return hit ? bestNoteImage(hit) : null;
}

/**
 * Backfill completo: revisa TODAS as notas canônicas (inclusive as que já têm
 * imagem de outra origem) e aplica a foto do Fragrantica.
 */
export async function backfillNoteImages(db: Db, limit = 400, onlyMissing = false) {
  const catalog = await loadFragranticaNotes();

  let q = db.from("olfactory_notes").select("id, canonical_name, image_url").order("canonical_name").limit(limit);
  if (onlyMissing) q = q.is("image_url", null);
  const { data } = await q;

  const rows = (data ?? []) as Array<{ id: string; canonical_name: string; image_url: string | null }>;
  let filled = 0;
  let pending = 0;

  for (const n of rows) {
    const r = await resolveNoteAsset(db, n.canonical_name, catalog);
    if (r.status !== "ok" || !r.image_url) {
      pending += 1;
      // Imagem antiga de fonte não autorizada sai do ar; melhor placeholder limpo.
      if (n.image_url) await db.from("olfactory_notes").update({ image_url: null }).eq("id", n.id);
      continue;
    }
    if (n.image_url !== r.image_url) {
      await db.from("olfactory_notes").update({ image_url: r.image_url }).eq("id", n.id);
    }
    filled += 1;
    await new Promise((r2) => setTimeout(r2, 120));
  }

  return { scanned: rows.length, filled, pending };
}
