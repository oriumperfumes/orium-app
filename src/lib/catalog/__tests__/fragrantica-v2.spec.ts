import { describe, expect, it } from "vitest";
import {
  extractFromHtml,
  normalizeNoteLabel,
  qualityGuard,
  validateFragranticaUrl,
  PARSER_VERSION,
} from "../fragrantica-v2.server";

const URL_OK = "https://www.fragrantica.com.br/perfume/Marca/Perfume-1.html";

const accordsBlock = `
<div>Principais Acordes</div>
<div style="width: 100%;"><span class="truncate">amadeirado</span></div>
<div style="width: 72.5%;"><span class="truncate">âmbar</span></div>
<div style="width: 41%;"><span class="truncate">baunilha</span></div>
`;

const noteLink = (slug: string, id: number, alt: string) =>
  `<a href="https://www.fragrantica.com.br/notas/${slug}-${id}.html"><img alt="${alt}" src="x"/><div>${alt}</div></a>`;

/** Caso A — pirâmide completa no elemento de camadas. */
const caseA = `<html><body>${accordsBlock}
<meta property="og:title" content="Teste Um Marca perfume - a nova fragrância"/>
<pyramid-level-new notes="top">${noteLink("Bergamota", 75, "Bergamota")}${noteLink("Limao", 76, "Limão")}</pyramid-level-new>
<pyramid-level-new notes="middle">${noteLink("Jasmim", 77, "Jasmim")}</pyramid-level-new>
<pyramid-level-new notes="base">${noteLink("Almiscar", 78, "Almíscar")}${noteLink("Fava-Tonka", 79, "Fava Tonka")}</pyramid-level-new>
</body></html>`;

/** Caso B — camadas anunciadas por títulos em português. */
const caseB = `<html><body>${accordsBlock}
<h3>Notas de Topo</h3><div>${noteLink("Bergamota", 75, "Bergamota")}</div>
<h3>Notas de Coração</h3><div>${noteLink("Rosa", 80, "Rosa")}</div>
<h3>Notas de Fundo</h3><div>${noteLink("Sandalo", 81, "Sândalo")}</div>
</body></html>`;

/** Caso C — camadas em containers com data-level. */
const caseC = `<html><body>${accordsBlock}
<div data-level="top">${noteLink("Cardamomo", 90, "Cardamomo")}</div>
<div data-level="heart">${noteLink("Lavanda", 91, "Lavanda")}</div>
<div data-level="base">${noteLink("Baunilha", 92, "Baunilha")}</div>
</body></html>`;

/** Caso D — apenas texto corrido descrevendo a pirâmide. */
const caseD = `<html><body>${accordsBlock}
<p>As notas de topo são Bergamota e Pimenta Rosa; as notas de coração são Íris;
as notas de fundo são Âmbar e Patchouli.</p>
</body></html>`;

/** Caso E — a fonte publica somente uma lista única de notas. */
const caseE = `<html><body>${accordsBlock}
<pyramid-level-new notes="ingredients">${noteLink("Folha-de-Figo", 101, "Folha de Figo")}${noteLink("Nectar-de-Figo", 102, "Néctar de Figo")}${noteLink("Jasmim-Manga", 103, "Jasmim Manga")}</pyramid-level-new>
</body></html>`;

/** Caso F — página sem acordes e sem notas. */
const caseF = `<html><body><h1>Página vazia</h1></body></html>`;

/** Caso G — notas hospedadas no domínio beta. */
const caseG = `<html><body>${accordsBlock}
<pyramid-level-new notes="top"><a href="https://beta.fragrantica.com.br/notas/Pera-110.html"><img alt="Pera"/></a></pyramid-level-new>
<pyramid-level-new notes="base"><a href="https://beta.fragrantica.com.br/notas/Ambar-111.html"><img alt="Âmbar"/></a></pyramid-level-new>
</body></html>`;

const labels = (list: Array<{ label: string }>) => list.map((n) => n.label);

describe("validação de URL", () => {
  it("aceita apenas páginas de perfume da Fragrantica Brasil", () => {
    expect(validateFragranticaUrl(URL_OK)).toBe(URL_OK);
    expect(validateFragranticaUrl("https://exemplo.com/perfume/x.html")).toBeNull();
    expect(validateFragranticaUrl("http://www.fragrantica.com.br/perfume/x.html")).toBeNull();
    expect(validateFragranticaUrl("https://www.fragrantica.com.br/notas/Rosa-1.html")).toBeNull();
  });
});

describe("normalização de notas", () => {
  it("canoniza e guarda o rótulo da fonte", () => {
    expect(normalizeNoteLabel("vanilla")).toEqual({ label: "Baunilha", sourceLabel: "vanilla" });
    expect(normalizeNoteLabel("Tonka Bean")?.label).toBe("Fava Tonka");
  });
  it("rejeita texto que não é nota", () => {
    expect(normalizeNoteLabel("1")).toBeNull();
    expect(normalizeNoteLabel("")).toBeNull();
    expect(normalizeNoteLabel("x".repeat(60))).toBeNull();
  });
});

describe("estratégias de extração", () => {
  it("A: pirâmide no elemento de camadas", () => {
    const r = extractFromHtml(caseA, URL_OK);
    expect(r.structure).toBe("PYRAMID");
    expect(labels(r.levels.TOP)).toEqual(["Bergamota", "Limão"]);
    expect(labels(r.levels.HEART)).toEqual(["Jasmim"]);
    expect(labels(r.levels.BASE)).toEqual(["Almíscar", "Fava Tonka"]);
    expect(r.accords.map((a) => a.name)).toContain("Amadeirado");
    expect(r.accords[0]!.intensity).toBeGreaterThan(r.accords[1]!.intensity);
    expect(r.status).toBe("COMPLETE");
    expect(r.parserVersion).toBe(PARSER_VERSION);
    expect(r.noteImages.every((i) => i.imageUrl.includes("/o."))).toBe(true);
  });

  it("B: camadas por títulos em português", () => {
    const r = extractFromHtml(caseB, URL_OK);
    expect(r.structure).toBe("PYRAMID");
    expect(labels(r.levels.TOP)).toEqual(["Bergamota"]);
    expect(labels(r.levels.HEART)).toEqual(["Rosa"]);
    expect(labels(r.levels.BASE)).toEqual(["Sândalo"]);
  });

  it("C: camadas por containers", () => {
    const r = extractFromHtml(caseC, URL_OK);
    expect(labels(r.levels.TOP)).toEqual(["Cardamomo"]);
    expect(labels(r.levels.HEART)).toEqual(["Lavanda"]);
    expect(labels(r.levels.BASE)).toEqual(["Baunilha"]);
  });

  it("D: pirâmide descrita em texto corrido", () => {
    const r = extractFromHtml(caseD, URL_OK);
    expect(labels(r.levels.TOP)).toContain("Bergamota");
    expect(labels(r.levels.HEART)).toContain("Íris");
    expect(labels(r.levels.BASE).length).toBeGreaterThan(0);
  });

  it("E: lista única não é convertida em pirâmide inventada", () => {
    const r = extractFromHtml(caseE, URL_OK);
    expect(r.structure).toBe("FLAT");
    expect(r.levels.TOP).toHaveLength(0);
    expect(labels(r.flat)).toEqual(["Folha de Figo", "Néctar de Figo", "Jasmim Manga"]);
    expect(r.issues.join(" ")).toContain("lista única");
  });

  it("F: página vazia falha de forma explícita", () => {
    const r = extractFromHtml(caseF, URL_OK);
    expect(r.status).toBe("FAILED");
    expect(r.structure).toBe("NONE");
    expect(r.completeness).toBeLessThan(40);
  });

  it("G: notas do domínio beta são lidas", () => {
    const r = extractFromHtml(caseG, URL_OK);
    expect(labels(r.levels.TOP)).toEqual(["Pera"]);
    expect(labels(r.levels.BASE)).toEqual(["Âmbar"]);
  });
});

describe("regressão e proteções", () => {
  it("não duplica notas repetidas e preserva a ordem", () => {
    const html = caseA.replace("</pyramid-level-new>", `${noteLink("Bergamota", 75, "bergamota")}</pyramid-level-new>`);
    const r = extractFromHtml(html, URL_OK);
    expect(labels(r.levels.TOP)).toEqual(["Bergamota", "Limão"]);
  });

  it("quality guard impede substituir dado melhor por pior", () => {
    const worse = qualityGuard(
      { accords: 8, notes: 12, hasPyramid: true },
      { accords: 3, notes: 2, hasPyramid: false },
    );
    expect(worse.allow).toBe(false);
    expect(worse.reason).toBeTruthy();
    const better = qualityGuard(
      { accords: 0, notes: 0, hasPyramid: false },
      { accords: 5, notes: 9, hasPyramid: true },
    );
    expect(better.allow).toBe(true);
  });

  it("acordes sem pirâmide ficam como PARTIAL quando a fonte anuncia camadas", () => {
    const html = `<html><body>${accordsBlock}<h3>Notas de Topo</h3><div>sem links</div></body></html>`;
    const r = extractFromHtml(html, URL_OK);
    expect(["PARTIAL", "FAILED"]).toContain(r.status);
    expect(r.status).not.toBe("COMPLETE");
  });
});
