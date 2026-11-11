import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Search, Loader2, Pencil, Merge, Trash2, Plus, ArrowRightLeft, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { AdminMore } from "@/components/orium/admin/AdminUI";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ChipGroup } from "@/components/orium/ChipGroup";
import { cn } from "@/lib/utils";
import { BrandSegmentPanel, SEGMENT_NAME, segmentTone } from "@/components/orium/BrandSegmentPanel";
import { setBrandsSegmentBulk } from "@/lib/catalog-eligibility.functions";
import type { BrandSegment } from "@/lib/catalog/brand-segment";
import {
  listBrands,
  renameBrand,
  moveBrandProducts,
  mergeBrands,
  deleteBrand,
  deleteEmptyBrands,
  createBrand,

  listBrandDuplicates,
  ignoreBrandDuplicate,
  type BrandRow,
} from "@/lib/brands.functions";

const TYPE_LABEL: Record<string, string> = {
  BODY_SPLASH: "Body Splash",
  HIDRATANTE: "Hidratante",
  PASTA: "Pasta",
  KIT: "Kit",
  OUTRO: "Outro",
};
const typeLabel = (t: string) => TYPE_LABEL[t] ?? t.charAt(0) + t.slice(1).toLowerCase().replace(/_/g, " ");

type Filter = "all" | "public" | "nopublic" | "empty";
type Category = "all" | "perfume" | "other";

function status(b: BrandRow) {
  if (b.total === 0) return { label: "Vazia", tone: "bg-muted text-muted-foreground" };
  if (b.publicos === 0) return { label: "Sem produtos públicos", tone: "bg-amber-500/15 text-amber-600 dark:text-amber-400" };
  return { label: "Ativa", tone: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" };
}

/** Escolha de marca por busca — usada em mover e mesclar. */
function BrandPicker({
  brands,
  exclude,
  value,
  onChange,
}: {
  brands: BrandRow[];
  exclude: string;
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const [term, setTerm] = useState("");
  const list = useMemo(() => {
    const k = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    return brands
      .filter((b) => b.id !== exclude && (!term.trim() || k(b.canonical_name).includes(k(term.trim()))))
      .slice(0, 40);
  }, [brands, exclude, term]);
  const chosen = brands.find((b) => b.id === value) ?? null;

  if (chosen) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/40 px-3 py-3">
        <span className="min-w-0 truncate text-sm font-medium">{chosen.canonical_name}</span>
        <Button variant="ghost" size="sm" className="shrink-0" onClick={() => onChange(null)}>
          <X className="size-4" /> Trocar
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Buscar marca de destino"
          className="h-11 pl-9"
        />
      </div>
      <div className="max-h-64 divide-y divide-border overflow-y-auto rounded-xl border border-border">
        {list.length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">Nenhuma marca encontrada.</p>
        ) : (
          list.map((b) => (
            <button
              key={b.id}
              onClick={() => onChange(b.id)}
              className="press flex min-h-12 w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm hover:bg-muted/60"
            >
              <span className="min-w-0 truncate">{b.canonical_name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{b.total} prod.</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

export function BrandsManager() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [category, setCategory] = useState<Category>("all");

  const [editing, setEditing] = useState<BrandRow | null>(null);
  const [editName, setEditName] = useState("");
  const [moving, setMoving] = useState<BrandRow | null>(null);
  const [merging, setMerging] = useState<BrandRow | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [removing, setRemoving] = useState<BrandRow | null>(null);
  const [purging, setPurging] = useState(false);

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [segFilter, setSegFilter] = useState<"all" | BrandSegment>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const doBulk = useServerFn(setBrandsSegmentBulk);

  const fetchBrands = useServerFn(listBrands);
  const fetchDuplicates = useServerFn(listBrandDuplicates);
  const doRename = useServerFn(renameBrand);
  const doMove = useServerFn(moveBrandProducts);
  const doMerge = useServerFn(mergeBrands);
  const doDelete = useServerFn(deleteBrand);
  const doDeleteEmpty = useServerFn(deleteEmptyBrands);
  const doCreate = useServerFn(createBrand);

  const doIgnore = useServerFn(ignoreBrandDuplicate);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-brands", q, filter, category],
    queryFn: () => fetchBrands({ data: { q, filter, category } }),
  });
  const { data: dups } = useQuery({
    queryKey: ["admin-brand-duplicates"],
    queryFn: () => fetchDuplicates({ data: {} as never }),
  });

  const brands = (data?.brands ?? []).filter((b) => segFilter === "all" || b.segment === segFilter);
  const all = useQuery({
    queryKey: ["admin-brands", "", "all", "all"],
    queryFn: () => fetchBrands({ data: { q: "", filter: "all", category: "all" } }),
  }).data?.brands ?? brands;
  const emptyCount = all.filter((b) => Number(b.total) === 0).length;


  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["admin-brands"] }),
      qc.invalidateQueries({ queryKey: ["admin-brand-duplicates"] }),
      qc.invalidateQueries({ queryKey: ["catalog-facets"] }),
    ]);
  };

  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    try {
      toast.success(await fn());
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível concluir.");
    } finally {
      setBusy(false);
    }
  };

  const closeAll = () => {
    setEditing(null);
    setMoving(null);
    setMerging(null);
    setTarget(null);
  };

  return (
    <div className="space-y-6">
      <BrandSegmentPanel />
      {/* sugestões de duplicadas */}
      {dups?.pairs?.length ? (
        <section className="rounded-2xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold">Marcas parecidas ({dups.pairs.length})</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Sugestões apenas — nada é unido sem a sua confirmação.
          </p>
          <ul className="mt-3 space-y-2">
            {dups.pairs.map((p) => (
              <li
                key={`${p.a_id}:${p.b_id}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-muted/40 px-3 py-2.5"
              >
                <span className="min-w-0 text-sm">
                  <strong className="font-medium">{p.a_name}</strong>{" "}
                  <span className="text-muted-foreground">({p.a_products})</span> ·{" "}
                  <strong className="font-medium">{p.b_name}</strong>{" "}
                  <span className="text-muted-foreground">({p.b_products})</span>
                  <span className="block text-xs text-muted-foreground">{p.reason}</span>
                </span>
                <span className="flex shrink-0 gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const from = all.find((b) => b.id === (p.a_products <= p.b_products ? p.a_id : p.b_id));
                      if (from) {
                        setMerging(from);
                        setTarget(p.a_products <= p.b_products ? p.b_id : p.a_id);
                      }
                    }}
                  >
                    <Merge className="size-4" /> Mesclar
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await doIgnore({ data: { aId: p.a_id, bId: p.b_id } });
                        return "Par ignorado.";
                      })
                    }
                  >
                    Ignorar
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* busca e filtros */}
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar marca"
              className="h-11 pl-9"
            />
          </div>
          <Button className="h-11" onClick={() => setCreating(true)}>
            <Plus className="size-4" /> Nova marca
          </Button>
          <Button
            variant="outline"
            className="h-11 text-destructive"
            disabled={emptyCount === 0}
            onClick={() => setPurging(true)}
          >
            <Trash2 className="size-4" /> Excluir marcas vazias
            {emptyCount > 0 ? ` (${emptyCount})` : ""}
          </Button>

        </div>

        <ChipGroup
          wrap
          label="Status da marca"
          value={filter}
          onChange={setFilter}
          chipClassName="min-h-11 px-4 text-sm"
          options={[
            { value: "all", label: "Todas" },
            { value: "public", label: "Com produtos públicos" },
            { value: "nopublic", label: "Sem produtos públicos" },
            { value: "empty", label: "Vazias" },
          ]}
        />
        <ChipGroup
          wrap
          label="Segmento"
          value={segFilter}
          onChange={setSegFilter}
          chipClassName="min-h-11 px-4 text-sm"
          options={[
            { value: "all", label: "Todos" },
            { value: "ARABIC", label: "Árabes" },
            { value: "DESIGNER", label: "Designer" },
            { value: "NICHE", label: "Nicho" },
            { value: "UNKNOWN", label: "Desconhecidos" },
          ]}
        />
        {selected.size > 0 ? (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-muted/40 p-3">
            <span className="text-sm font-medium">{selected.size} selecionada{selected.size === 1 ? "" : "s"} · Alterar segmento:</span>
            {(["ARABIC", "DESIGNER", "NICHE", "UNKNOWN"] as BrandSegment[]).map((sg) => (
              <Button
                key={sg}
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const r = await doBulk({ data: { ids: [...selected], segment: sg } });
                    setSelected(new Set());
                    return `${r.updated} marcas agora são ${SEGMENT_NAME[sg]}. Perfumes reavaliados.`;
                  })
                }
              >
                {SEGMENT_NAME[sg]}
              </Button>
            ))}
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Limpar</Button>
          </div>
        ) : null}
        <ChipGroup
          wrap
          label="Tipo de produto"
          value={category}
          onChange={setCategory}
          chipClassName="min-h-11 px-4 text-sm"
          options={[
            { value: "all", label: "Tudo" },
            { value: "perfume", label: "Perfumes" },
            { value: "other", label: "Outros produtos" },
          ]}
        />

      </div>

      {/* lista */}
      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 rounded-2xl" />
          ))}
        </div>
      ) : brands.length === 0 ? (
        <p className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
          Nenhuma marca encontrada com esses filtros.
        </p>
      ) : (
        <ul className="space-y-2">
          {brands.map((b) => {
            const st = status(b);
            return (
              <li key={b.id} className="rounded-2xl border border-border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <label className="flex min-w-0 items-start gap-3">
                    <input
                      type="checkbox"
                      className="mt-1 size-5 shrink-0 accent-primary"
                      aria-label={`Selecionar ${b.canonical_name}`}
                      checked={selected.has(b.id)}
                      onChange={(e) =>
                        setSelected((prev) => {
                          const n = new Set(prev);
                          if (e.target.checked) n.add(b.id);
                          else n.delete(b.id);
                          return n;
                        })
                      }
                    />
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-medium">{b.canonical_name}</span>
                        <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", segmentTone(b.segment))}>
                          {SEGMENT_NAME[(b.segment as BrandSegment) ?? "UNKNOWN"]}
                        </span>
                      </span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {b.total} produto{b.total === 1 ? "" : "s"} · {b.publicos} público{b.publicos === 1 ? "" : "s"}
                      </span>
                    </span>
                  </label>
                  <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium", st.tone)}>
                    {st.label}
                  </span>
                </div>

                <div className="mt-3 flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="min-h-10 rounded-full px-4"
                    onClick={() => {
                      setEditing(b);
                      setEditName(b.canonical_name);
                    }}
                  >
                    <Pencil className="size-4" /> Editar
                  </Button>
                  <AdminMore
                    actions={[
                      {
                        label: "Mover produtos",
                        icon: <ArrowRightLeft className="size-4" />,
                        onSelect: () => {
                          if (b.total === 0) return;
                          setMoving(b);
                          setTarget(null);
                        },
                      },
                      {
                        label: "Mesclar",
                        icon: <Merge className="size-4" />,
                        onSelect: () => {
                          setMerging(b);
                          setTarget(null);
                        },
                      },
                      {
                        label: "Excluir",
                        icon: <Trash2 className="size-4" />,
                        danger: true,
                        separated: true,
                        onSelect: () => setRemoving(b),
                      },
                    ]}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* editar nome */}
      <Sheet open={Boolean(editing)} onOpenChange={(o) => !o && closeAll()}>
        <SheetContent side="bottom" className="rounded-t-3xl">
          <SheetHeader>
            <SheetTitle>Editar marca</SheetTitle>
            <SheetDescription>
              O nome novo é aplicado a todos os produtos vinculados. O nome antigo continua reconhecido na
              sincronização.
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="h-12" autoFocus />
            <p className="text-xs text-muted-foreground">
              {editing?.total ?? 0} produto(s) receberão o nome novo.
            </p>
            <Button
              className="h-12 w-full"
              disabled={busy || editName.trim().length < 2}
              onClick={() =>
                void run(async () => {
                  const out = await doRename({ data: { brandId: editing!.id, name: editName.trim() } });
                  closeAll();
                  return `Marca salva como ${out.name} · ${out.products} produto(s) atualizados.`;
                })
              }
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : null} Salvar
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* mover produtos */}
      <Sheet open={Boolean(moving)} onOpenChange={(o) => !o && closeAll()}>
        <SheetContent side="bottom" className="rounded-t-3xl">
          <SheetHeader>
            <SheetTitle>Mover produtos</SheetTitle>
            <SheetDescription>
              {moving?.total ?? 0} produto(s) de {moving?.canonical_name} passarão para a marca escolhida.
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <BrandPicker brands={all} exclude={moving?.id ?? ""} value={target} onChange={setTarget} />
            <Button
              className="h-12 w-full"
              disabled={busy || !target}
              onClick={() =>
                void run(async () => {
                  const out = await doMove({ data: { fromId: moving!.id, toId: target! } });
                  closeAll();
                  return `${out.moved} produto(s) agora usam ${out.to}.`;
                })
              }
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : null} Confirmar
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* mesclar */}
      <Sheet open={Boolean(merging)} onOpenChange={(o) => !o && closeAll()}>
        <SheetContent side="bottom" className="rounded-t-3xl">
          <SheetHeader>
            <SheetTitle>Mesclar marcas</SheetTitle>
            <SheetDescription>
              {merging?.canonical_name} será removida. Produtos, apelidos e ofertas dos fornecedores continuam
              intactos na marca correta.
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <BrandPicker brands={all} exclude={merging?.id ?? ""} value={target} onChange={setTarget} />
            {target && merging ? (
              <p className="rounded-xl bg-muted/50 px-3 py-2.5 text-sm">
                {merging.total} produto(s) passarão de <strong>{merging.canonical_name}</strong> para{" "}
                <strong>{all.find((b) => b.id === target)?.canonical_name}</strong>.
              </p>
            ) : null}
            <Button
              className="h-12 w-full"
              disabled={busy || !target}
              onClick={() =>
                void run(async () => {
                  const out = await doMerge({ data: { fromId: merging!.id, toId: target! } });
                  closeAll();
                  return `${out.from} unida a ${out.to} · ${out.moved} produto(s).`;
                })
              }
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : null} Confirmar mesclagem
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* nova marca */}
      <Sheet open={creating} onOpenChange={(o) => !o && setCreating(false)}>
        <SheetContent side="bottom" className="rounded-t-3xl">
          <SheetHeader>
            <SheetTitle>Nova marca</SheetTitle>
            <SheetDescription>Se o nome já existir, usamos a marca existente em vez de duplicar.</SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Nome da marca"
              className="h-12"
              autoFocus
            />
            <Button
              className="h-12 w-full"
              disabled={busy || newName.trim().length < 2}
              onClick={() =>
                void run(async () => {
                  const out = await doCreate({ data: { name: newName.trim() } });
                  setCreating(false);
                  setNewName("");
                  return out.existed ? `A marca ${out.name} já existia — usamos ela.` : `Marca ${out.name} criada.`;
                })
              }
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : null} Criar
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* excluir */}
      <AlertDialog open={Boolean(removing)} onOpenChange={(o) => !o && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir {removing?.canonical_name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {removing && removing.total > 0
                ? `Esta marca tem ${removing.total} produto(s). Mova ou mescle os produtos antes de excluir.`
                : "A marca será removida. Nenhum produto é afetado."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy || (removing?.total ?? 0) > 0}
              onClick={() =>
                void run(async () => {
                  const out = await doDelete({ data: { brandId: removing!.id } });
                  setRemoving(null);
                  return `Marca ${out.name} excluída.`;
                })
              }
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* excluir todas as marcas vazias */}
      <AlertDialog open={purging} onOpenChange={(o) => !o && setPurging(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir todas as marcas sem produtos?</AlertDialogTitle>
            <AlertDialogDescription>
              {emptyCount} marca{emptyCount === 1 ? "" : "s"} ser{emptyCount === 1 ? "á" : "ão"} removida
              {emptyCount === 1 ? "" : "s"}. Marcas com qualquer produto vinculado não são afetadas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy || emptyCount === 0}
              onClick={(e) => {
                e.preventDefault();
                void run(async () => {
                  const out = await doDeleteEmpty({ data: {} as never });
                  setPurging(false);
                  const base = `${out.deleted} marca${out.deleted === 1 ? "" : "s"} vazia${out.deleted === 1 ? "" : "s"} excluída${out.deleted === 1 ? "" : "s"}.`;
                  return out.failed.length ? `${base} ${out.failed.length} não pôde ser removida.` : base;
                });
              }}
            >
              {busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
              {busy ? "Excluindo..." : "Excluir marcas vazias"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
}
