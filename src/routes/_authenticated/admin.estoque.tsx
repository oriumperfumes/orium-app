import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import {
  CircleDollarSign,
  Minus,
  Package,
  Plus,
  Search,
  Tag,
  Trash2,
  Wallet,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { AdminShell } from "@/components/orium/AdminShell";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import {
  stockAdjust,
  stockClearAll,
  stockMoves,
  stockSearch,
  stockSetTracked,
  storeStock,
} from "@/lib/store-stock.functions";
import { RestockSheet, type RestockTarget } from "@/components/orium/admin/RestockSheet";
import { brl } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PxKpi, PxKpiRow, PxNote, PxSeg, pxInputClass } from "@/components/orium/admin/PricingUI";
import { Money, StoreSupplies } from "@/components/orium/admin/StoreSupplies";

type Part = "perfumes" | "itens";

export const Route = createFileRoute("/_authenticated/admin/estoque")({
  validateSearch: (
    s: Record<string, unknown>,
  ): { add?: true | undefined; parte?: Part | undefined } => ({
    add: s["add"] === true || s["add"] === "true" ? true : undefined,
    parte: s["parte"] === "itens" ? "itens" : s["parte"] === "perfumes" ? "perfumes" : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Gerenciamento da loja — Orium Admin" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: EstoquePage,
});

type Pick = {
  id: string;
  name: string;
  brand: string | null;
  image_url: string | null;
  volume_ml: number | null;
  units: number;
  tracked: boolean;
};

/** Gerenciamento: perfumes lacrados da loja física e os itens que a loja usa. */
function EstoquePage() {
  const { add, parte } = Route.useSearch();
  const navigate = useNavigate({ from: "/admin/estoque" });
  const part: Part = add ? "perfumes" : (parte ?? "perfumes");
  return (
    <AdminShell title="Gerenciamento">
      <PxSeg
        label="O que gerenciar"
        value={part}
        onChange={(p) => void navigate({ search: { parte: p }, replace: true })}
        options={[
          { value: "perfumes", label: "Perfumes da loja" },
          { value: "itens", label: "Itens da loja" },
        ]}
        className="mb-5 w-full sm:w-[420px] [&>button]:text-[15px] lg:mb-6"
      />
      <div key={part} className="admin-in">
        {part === "itens" ? <StoreSupplies /> : <PerfumeStock add={!!add} />}
      </div>
    </AdminShell>
  );
}

function PerfumeStock({ add }: { add: boolean }) {
  const loadStock = useServerFn(storeStock);
  const search = useServerFn(stockSearch);
  const clearAll = useServerFn(stockClearAll);
  const qc = useQueryClient();
  const [clearOpen, setClearOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [clearing, setClearing] = useState(false);
  const stock = useQuery({ queryKey: ["store-stock"], queryFn: () => loadStock() });
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [pick, setPick] = useState<Pick | null>(null);
  const [repor, setRepor] = useState<RestockTarget | null>(null);
  const trackedIds = new Set((stock.data?.items ?? []).map((i) => i.id));

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 220);
    return () => clearTimeout(t);
  }, [q]);

  const results = useQuery({
    queryKey: ["stock-search", debounced],
    queryFn: ({ signal: _s }) => search({ data: { q: debounced } }),
    enabled: debounced.trim().length >= 2,
  });

  const s = stock.data;
  const searching = debounced.trim().length >= 2;

  const clearEntireStock = async () => {
    if (confirmation !== "LIMPAR ESTOQUE" || clearing) return;
    setClearing(true);
    try {
      const result = await clearAll({ data: { confirmation } });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["store-stock"] }),
        qc.invalidateQueries({ queryKey: ["stock-search"] }),
        qc.invalidateQueries({ queryKey: ["ready-to-deliver"] }),
        qc.invalidateQueries({ queryKey: ["admin-dashboard"] }),
        qc.invalidateQueries({ queryKey: ["catalog"] }),
        qc.invalidateQueries({ queryKey: ["product"] }),
      ]);
      setClearOpen(false);
      setConfirmation("");
      toast.success(
        `Estoque limpo: ${result.products} produtos retirados e ${result.units} frascos zerados.`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível limpar o estoque.");
    } finally {
      setClearing(false);
    }
  };

  return (
    <>
      <div className="space-y-5 lg:space-y-6">
        <PxKpiRow>
          <PxKpi
            hero
            i={0}
            label="Custo do estoque"
            icon={<Wallet className="size-[18px]" strokeWidth={2.2} />}
            loading={stock.isPending}
            value={<Money v={s?.cost ?? 0} />}
            foot="O que a loja pagou nos frascos"
          />
          <PxKpi
            i={1}
            label="Frascos lacrados"
            icon={<Package className="size-[18px]" strokeWidth={2.2} />}
            loading={stock.isPending}
            value={String(s?.units ?? 0)}
            foot={`${s?.products ?? 0} perfumes`}
          />
          <PxKpi
            i={2}
            label="Valor de venda"
            icon={<CircleDollarSign className="size-[18px]" strokeWidth={2.2} />}
            loading={stock.isPending}
            value={<Money v={s?.sale_value ?? 0} />}
            foot="Se vender tudo pelo preço do site"
          />
          <PxKpi
            i={3}
            label="Para repor"
            icon={<Tag className="size-[18px]" strokeWidth={2.2} />}
            loading={stock.isPending}
            value={String(s?.alerts?.length ?? 0)}
            foot="Com 1 frasco ou nenhum"
          />
        </PxKpiRow>
        {s && s.missing_cost > 0 ? (
          <PxNote tone="warning">
            {s.missing_cost} {s.missing_cost === 1 ? "perfume está" : "perfumes estão"} sem custo
            cadastrado e entram como R$ 0.
          </PxNote>
        ) : null}

        <div className="adm-rise relative" style={{ ["--i" as string]: 1 }}>
          <Search className="pointer-events-none absolute top-1/2 left-4 size-[18px] -translate-y-1/2 text-[#8C8C8C]" />
          <input
            autoFocus={add}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Procurar perfume para adicionar"
            aria-label="Procurar perfume para adicionar"
            className={cn(pxInputClass, "pr-11 pl-11")}
          />
          {q ? (
            <button
              type="button"
              aria-label="Limpar"
              onClick={() => setQ("")}
              className="press absolute top-1/2 right-2 grid size-9 -translate-y-1/2 place-items-center rounded-full text-muted-foreground"
            >
              <X className="size-4" />
            </button>
          ) : null}
        </div>

        {searching ? (
          <section className="space-y-2">
            {results.isPending ? (
              [0, 1, 2].map((i) => <div key={i} className="admin-skeleton h-16 rounded-2xl" />)
            ) : (results.data?.length ?? 0) === 0 ? (
              <p className="px-1 text-sm text-muted-foreground">Nenhum perfume encontrado.</p>
            ) : (
              results.data!.map((r: any) => (
                <Row
                  key={r.id}
                  name={r.canonical_name ?? r.raw_name}
                  brand={r.brand}
                  image={r.image_url}
                  units={r.local_stock ?? 0}
                  onClick={() =>
                    setPick({
                      id: r.id,
                      name: r.canonical_name ?? r.raw_name,
                      brand: r.brand,
                      image_url: r.image_url,
                      volume_ml: r.volume_ml,
                      units: r.local_stock ?? 0,
                      tracked: trackedIds.has(r.id),
                    })
                  }
                />
              ))
            )}
          </section>
        ) : (
          <section className="space-y-2">
            <h2 className="px-1 text-[15px] font-bold text-[#D4D4D4]">Perfumes na loja</h2>
            {stock.isPending ? (
              [0, 1, 2].map((i) => <div key={i} className="admin-skeleton h-16 rounded-2xl" />)
            ) : (s?.items.length ?? 0) === 0 ? (
              <div className="dash-card p-6 text-center text-[14.5px] text-[#A9A9A9]">
                Nenhum perfume no estoque ainda. Procure acima para adicionar.
              </div>
            ) : (
              s!.items.map((it, i) => (
                <Row
                  key={it.id}
                  i={i}
                  name={it.name ?? "—"}
                  brand={it.brand}
                  image={it.image_url}
                  units={it.units}
                  inRestock={it.restock_qty}
                  onRepor={() =>
                    setRepor({
                      id: it.id,
                      name: it.name ?? "Perfume",
                      units: it.units,
                      restockQty: it.restock_qty,
                    })
                  }
                  onClick={() =>
                    setPick({
                      id: it.id,
                      name: it.name ?? "—",
                      brand: it.brand,
                      image_url: it.image_url,
                      volume_ml: it.volume_ml,
                      units: it.units,
                      tracked: true,
                    })
                  }
                />
              ))
            )}
          </section>
        )}
        {!searching && !stock.isPending && (s?.items.length ?? 0) > 0 ? (
          <button
            type="button"
            className="press mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl border border-destructive/35 text-[13px] font-medium text-destructive"
            onClick={() => {
              setConfirmation("");
              setClearOpen(true);
            }}
          >
            <Trash2 className="size-4" aria-hidden="true" />
            Limpar todo o estoque da loja
          </button>
        ) : null}
      </div>

      <Drawer open={clearOpen} onOpenChange={(open) => !clearing && setClearOpen(open)}>
        <DrawerContent className="px-5 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <div className="mx-auto w-full max-w-md">
            <DrawerTitle className="pt-3 text-lg font-semibold">
              Limpar estoque da loja?
            </DrawerTitle>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Esta ação zera as unidades de todos os perfumes no estoque físico e remove os produtos
              da lista de acompanhamento. Atualmente há {s?.items.length ?? 0} produtos na lista e{" "}
              {s?.units ?? 0} frascos.
            </p>
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              Não apaga perfumes do catálogo, pedidos, fornecedores, lista de reposição nem
              histórico de movimentações. Liberações manuais de disponibilidade são preservadas.
            </p>
            <label htmlFor="clear-stock-confirm" className="mt-5 block text-sm font-medium">
              Para confirmar, digite LIMPAR ESTOQUE
            </label>
            <input
              id="clear-stock-confirm"
              autoComplete="off"
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              className="adm-card mt-2 h-12 w-full !rounded-2xl px-4 text-base outline-none focus:border-destructive"
              placeholder="LIMPAR ESTOQUE"
              disabled={clearing}
            />
            <Button
              variant="destructive"
              className="mt-4 h-12 w-full rounded-full"
              disabled={clearing || confirmation !== "LIMPAR ESTOQUE"}
              aria-busy={clearing}
              onClick={() => void clearEntireStock()}
            >
              {clearing ? "Limpando estoque…" : "Confirmar limpeza total"}
            </Button>
            <Button
              variant="outline"
              className="mt-2 h-11 w-full rounded-full"
              disabled={clearing}
              onClick={() => setClearOpen(false)}
            >
              Cancelar
            </Button>
          </div>
        </DrawerContent>
      </Drawer>

      <AdjustDrawer pick={pick} onClose={() => setPick(null)} />
      <RestockSheet target={repor} onClose={() => setRepor(null)} />
    </>
  );
}

function Row({
  name,
  brand,
  image,
  units,
  inRestock,
  i = 0,
  onClick,
  onRepor,
}: {
  name: string;
  brand: string | null;
  image: string | null;
  units: number;
  inRestock?: number;
  i?: number;
  onClick: () => void;
  onRepor?: () => void;
}) {
  const status = units >= 2 ? "Em estoque" : units === 1 ? "Última unidade" : "Sem estoque";
  const tone =
    units >= 2 ? "text-muted-foreground" : units === 1 ? "text-warning" : "text-destructive";
  const alert = units <= 1;
  return (
    <div
      className={cn(
        "adm-rise flex w-full min-w-0 items-center gap-3 rounded-[22px] bg-[#1A1A1A] p-3",
        onRepor &&
          alert &&
          (units === 0
            ? "ring-1 ring-[#FF9A8A]/30 ring-inset"
            : "ring-1 ring-[#F5C26B]/30 ring-inset"),
      )}
      style={{ ["--i" as string]: Math.min(i, 8) + 2 }}
    >
      <button
        type="button"
        onClick={onClick}
        className="press flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        <div className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-[16px] bg-white">
          {image ? (
            <img src={image} alt="" loading="lazy" className="size-full object-contain" />
          ) : (
            <Package className="size-5 text-muted-foreground" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold">{name}</p>
          <p className="truncate text-[12px] text-muted-foreground">{brand ?? "—"}</p>
          {onRepor ? (
            <p className={cn("truncate text-[12px] font-medium", tone)}>
              {units} {units === 1 ? "frasco" : "frascos"} · {status}
              {inRestock ? (
                <span className="font-normal text-muted-foreground">
                  {" "}
                  · na reposição ({inRestock})
                </span>
              ) : null}
            </p>
          ) : (
            <p className="truncate text-[12px] text-muted-foreground">{units} un. na loja</p>
          )}
        </div>
      </button>
      {onRepor && alert ? (
        <button
          type="button"
          onClick={onRepor}
          className={cn(
            "press inline-flex min-h-10 shrink-0 items-center justify-center rounded-full px-4 text-[13px] font-medium",
            inRestock ? "btn-glass text-muted-foreground" : "btn-cta bg-gold text-gold-foreground",
          )}
        >
          Repor
        </button>
      ) : null}
    </div>
  );
}

function AdjustDrawer({ pick, onClose }: { pick: Pick | null; onClose: () => void }) {
  const adjust = useServerFn(stockAdjust);
  const setTracked = useServerFn(stockSetTracked);
  const loadMoves = useServerFn(stockMoves);
  const qc = useQueryClient();
  const [units, setUnits] = useState(0);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (pick) {
      setUnits(pick.units);
      setNote("");
    }
  }, [pick]);

  const moves = useQuery({
    queryKey: ["stock-moves", pick?.id],
    queryFn: () => loadMoves({ data: { productId: pick!.id } }),
    enabled: !!pick,
  });

  const save = async () => {
    if (!pick) return;
    setBusy(true);
    try {
      if (!pick.tracked) await setTracked({ data: { productId: pick.id, tracked: true } });
      if (units !== pick.units)
        await adjust({ data: { productId: pick.id, mode: "set", quantity: units, note } });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["store-stock"] }),
        qc.invalidateQueries({ queryKey: ["stock-search"] }),
        qc.invalidateQueries({ queryKey: ["admin-dashboard"] }),
      ]);
      toast.success("Estoque salvo.");
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não consegui salvar.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (
      !pick ||
      !window.confirm(`Remover ${pick.name} do Estoque? O perfume deixa de ser monitorado.`)
    )
      return;
    setBusy(true);
    try {
      await setTracked({ data: { productId: pick.id, tracked: false } });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["store-stock"] }),
        qc.invalidateQueries({ queryKey: ["admin-dashboard"] }),
      ]);
      toast.success("Removido do estoque.");
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não consegui remover.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer open={!!pick} onOpenChange={(o) => !o && onClose()}>
      <DrawerContent className="px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        {pick ? (
          <div className="mx-auto w-full max-w-md">
            <DrawerTitle className="pt-3 text-lg leading-tight font-semibold">
              {pick.name}
            </DrawerTitle>
            <p className="text-sm text-muted-foreground">{pick.brand ?? ""}</p>

            <p className="mt-5 text-[12px] font-medium tracking-[0.1em] text-muted-foreground uppercase">
              Frascos lacrados na loja
            </p>
            <div className="mt-2 flex items-center gap-3">
              <button
                type="button"
                aria-label="Tirar uma unidade"
                disabled={units <= 0}
                onClick={() => setUnits((u) => Math.max(0, u - 1))}
                className="btn-glass press grid size-12 place-items-center rounded-full border disabled:opacity-40"
              >
                <Minus className="size-5" />
              </button>
              <input
                inputMode="numeric"
                value={units}
                onChange={(e) => setUnits(Number(e.target.value.replace(/\D/g, "") || 0))}
                className="adm-card h-12 min-w-0 flex-1 !rounded-2xl text-center text-2xl font-bold tabular-nums outline-none"
              />
              <button
                type="button"
                aria-label="Adicionar uma unidade"
                onClick={() => setUnits((u) => u + 1)}
                className="btn-glass press grid size-12 place-items-center rounded-full border"
              >
                <Plus className="size-5" />
              </button>
            </div>

            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={200}
              placeholder="Observação (opcional) — ex.: chegou da KL"
              className="adm-card mt-3 h-12 w-full !rounded-2xl px-4 text-base outline-none"
            />

            <Button
              size="lg"
              className="mt-4 w-full"
              disabled={busy}
              aria-busy={busy}
              onClick={save}
            >
              {busy ? "Salvando…" : pick.tracked ? "Salvar estoque" : "Adicionar ao estoque"}
            </Button>
            {pick.tracked ? (
              <button
                type="button"
                disabled={busy || units > 0}
                onClick={remove}
                className="press mt-2 w-full py-2 text-[13px] text-muted-foreground disabled:opacity-50"
              >
                {units > 0 ? "Zere o estoque para remover da lista" : "Remover do estoque"}
              </button>
            ) : null}

            {moves.data?.length ? (
              <div className="mt-4 max-h-40 space-y-1 overflow-y-auto border-t border-border/50 pt-3 text-[12px] text-muted-foreground">
                {moves.data.map((m: any, i: number) => (
                  <p key={i} className="truncate">
                    {new Date(m.created_at).toLocaleString("pt-BR", {
                      day: "2-digit",
                      month: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}{" "}
                    · {m.delta > 0 ? `+${m.delta}` : m.delta}
                    un. ({m.before_qty} → {m.after_qty}){m.reason ? ` · ${m.reason}` : ""}
                  </p>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </DrawerContent>
    </Drawer>
  );
}
