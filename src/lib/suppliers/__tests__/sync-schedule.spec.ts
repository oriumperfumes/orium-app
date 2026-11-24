import { describe, it, expect } from "vitest";
import { decideSupplier, pickNext, type SyncCandidate } from "@/lib/suppliers/sync-schedule";
import { remainingSubrequests, usedSubrequests, withSubrequestBudget } from "@/lib/suppliers/subrequests.server";

const NOW = Date.parse("2026-11-15T12:00:00Z");
const iso = (minAgo: number) => new Date(NOW - minAgo * 60_000).toISOString();
const base = (o: Partial<SyncCandidate> = {}): SyncCandidate => ({
  id: "1", name: "Loja", slug: "loja", sync_interval_minutes: 180,
  last_successful_sync_at: iso(200), last_sync_at: iso(200), sync_cursor: null, sync_status: "ok",
  sync_locked_at: null, sync_run_started_at: null, auto_sync: true, priority: "secondary", ...o,
});

describe("decideSupplier", () => {
  it("preserva fornecedor pausado ou inativo", () => {
    expect(decideSupplier(base({ auto_sync: false }), NOW)).toEqual({ action: "skip", reason: "sincronizacao-automatica-pausada" });
    expect(decideSupplier(base({ priority: "inactive" }), NOW)).toEqual({ action: "skip", reason: "sincronizacao-automatica-pausada" });
    expect(decideSupplier(base({ auto_sync: false }), NOW, { force: true }).action).toBe("start");
  });
  it("respeita o intervalo do fornecedor, com folga de 5 min para o job de 3 h", () => {
    expect(decideSupplier(base({ last_successful_sync_at: iso(120) }), NOW)).toEqual({ action: "skip", reason: "fora-do-intervalo" });
    expect(decideSupplier(base({ last_successful_sync_at: iso(176) }), NOW).action).toBe("start");
  });
  it("tenta cada fornecedor uma vez por abertura do job de 3 h, mesmo após erro", () => {
    const since = NOW - 60_000;
    expect(decideSupplier(base({ last_sync_at: iso(0.5), sync_status: "erro" }), NOW, { since })).toEqual({ action: "skip", reason: "ciclo-ja-tentado" });
    expect(decideSupplier(base(), NOW, { since }).action).toBe("start");
  });
  it("retoma o ciclo parcial do cursor salvo", () => {
    expect(decideSupplier(base({ sync_status: "parcial", sync_cursor: 90, last_sync_at: iso(1), sync_locked_at: iso(1) }), NOW)).toEqual({ action: "resume", cursor: 90 });
  });
  it("não duplica rodada em andamento, mas retoma rodada que travou", () => {
    const lockedNow = new Date(NOW - 30_000).toISOString();
    expect(decideSupplier(base({ sync_status: "sincronizando", sync_cursor: 30, sync_locked_at: lockedNow, last_sync_at: iso(5) }), NOW)).toEqual({ action: "skip", reason: "rodada-em-andamento" });
    const stale = new Date(NOW - 10 * 60_000).toISOString();
    expect(decideSupplier(base({ sync_status: "sincronizando", sync_cursor: 30, sync_locked_at: stale, last_sync_at: iso(20) }), NOW)).toEqual({ action: "resume", cursor: 30 });
  });
  it("ciclo com mais de 3 h vira falha (não fica sincronizando)", () => {
    const d = decideSupplier(base({ sync_status: "sincronizando", sync_cursor: 30, sync_locked_at: iso(10), last_sync_at: iso(20), sync_run_started_at: iso(200) }), NOW);
    expect(d.action).toBe("interrupted");
  });
  it("retomada vem antes de um novo ciclo", () => {
    const resume = base({ id: "r", sync_status: "parcial", sync_cursor: 60, last_sync_at: iso(2), sync_locked_at: iso(2) });
    const due = base({ id: "d", last_sync_at: iso(500) });
    expect(pickNext([due, resume], NOW).next?.s.id).toBe("r");
    expect(pickNext([base({ auto_sync: false })], NOW).next).toBeNull();
  });
});

describe("orçamento de chamadas", () => {
  it("conta só os fetch feitos dentro da requisição", async () => {
    const real = globalThis.fetch;
    globalThis.fetch = (async () => new Response("ok")) as typeof fetch;
    try {
      expect(remainingSubrequests()).toBe(Number.POSITIVE_INFINITY);
      const used = await withSubrequestBudget(10, async () => {
        await fetch("https://exemplo.test/a");
        await fetch("https://exemplo.test/b");
        expect(remainingSubrequests()).toBe(8);
        return usedSubrequests();
      });
      expect(used).toBe(2);
      await fetch("https://exemplo.test/fora");
      expect(remainingSubrequests()).toBe(Number.POSITIVE_INFINITY);
    } finally {
      globalThis.fetch = real;
    }
  });
});
