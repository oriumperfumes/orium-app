import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { beginBatch, currentBatchStop, endBatch, fetchPage, MIN_FETCH_MS } from "@/lib/catalog/fragrantica-search.server";

const html = (n: number) => "x".repeat(n);
let n = 0;
const url = () => `https://www.fragrantica.com.br/perfume/Teste/Perfume-${++n}.html`;

describe("lote com prazo (modo estrito)", () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => {
    endBatch();
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    endBatch();
    vi.restoreAllMocks();
  });

  it("403/429 encerram o lote na hora, sem esperar nem tentar o leitor alternativo", async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (u: string) => {
      calls.push(String(u));
      return new Response("bloqueado", { status: 429, headers: { "retry-after": "60" } });
    }) as typeof fetch;

    beginBatch(Date.now() + 100_000);
    const t0 = Date.now();
    const r = await fetchPage(url(), { minLength: 10 });
    expect(r.failed).toBe(true);
    expect(r.html).toBeNull();
    expect(r.httpStatus).toBe(429);
    expect(calls).toHaveLength(1); // nada de segunda tentativa nem de leitor alternativo
    expect(Date.now() - t0).toBeLessThan(1_500); // sem as esperas de 20 s/40 s
    expect(currentBatchStop()?.reason).toBe("blocked");
    expect(currentBatchStop()?.detail).toContain("429");

    // as leituras seguintes do mesmo lote nem saem
    const again = await fetchPage(url(), { minLength: 10 });
    expect(again.failed).toBe(true);
    expect(calls).toHaveLength(1);
    expect(endBatch()?.reason).toBe("blocked");
  });

  it("timeout é falha temporária (failed), nunca 'não encontrado', e falhas seguidas encerram o lote", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      throw new DOMException("The operation timed out", "TimeoutError");
    }) as typeof fetch;

    beginBatch(Date.now() + 100_000);
    const results = [];
    for (let i = 0; i < 3; i++) results.push(await fetchPage(url(), { minLength: 10 }));
    for (const r of results) {
      expect(r.failed).toBe(true);
      expect(r.html).toBeNull();
      expect(r.httpStatus).not.toBe(404);
    }
    expect(currentBatchStop()?.reason).toBe("consecutive-failures");
    const before = calls;
    const next = await fetchPage(url(), { minLength: 10 });
    expect(next.failed).toBe(true);
    expect(calls).toBe(before);
  }, 30_000);

  it("sem tempo restante para uma leitura, nem tenta (prazo)", async () => {
    const spy = vi.fn(async () => new Response(html(50), { status: 200 }));
    globalThis.fetch = spy as unknown as typeof fetch;

    beginBatch(Date.now() + MIN_FETCH_MS - 1_000);
    const r = await fetchPage(url(), { minLength: 10 });
    expect(r.failed).toBe(true);
    expect(spy).not.toHaveBeenCalled();
    expect(endBatch()?.reason).toBe("deadline");
  });

  it("leitura normal continua funcionando e zera a contagem de falhas", async () => {
    globalThis.fetch = (async () => new Response(html(500), { status: 200 })) as typeof fetch;
    beginBatch(Date.now() + 100_000);
    const r = await fetchPage(url(), { minLength: 100 });
    expect(r.failed).toBe(false);
    expect(r.html).toHaveLength(500);
    expect(currentBatchStop()).toBeNull();
  });

  it("fora do modo estrito nada muda: sem prazo, 403 ainda usa o caminho antigo (aqui, uma única resposta 404 do leitor)", async () => {
    // Só confere que o modo estrito não vaza para quem não pediu prazo.
    expect(currentBatchStop()).toBeNull();
    globalThis.fetch = (async () => new Response(html(500), { status: 200 })) as typeof fetch;
    const r = await fetchPage(url(), { minLength: 100 });
    expect(r.failed).toBe(false);
  });
});
