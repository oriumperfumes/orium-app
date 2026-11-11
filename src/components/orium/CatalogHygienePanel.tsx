import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { AlertTriangle, Check, Merge, Search, Unlink, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SEGMENT_LABEL, type BrandSegment } from "@/lib/catalog/brand-segment";
import {
  decideDuplicate,
  getHygieneMetrics,
  listBrandSegments,
  listDuplicateCandidates,
  listMerges,
  runBrandPositioning,
  runDuplicateCleanup,
  setBrandSegment,
  splitMerge,
} from "@/lib/hygiene.functions";

/**
 * Higiene do catálogo: possíveis duplicados para revisar e posicionamento das marcas.
 * A regra de marca vale SOMENTE para perfumes — body splash, cremes e pastas seguem no ar.
 */
export function CatalogHygienePanel() {
  const qc = useQueryClient();
  const [running, setRunning] = useState<"" | "dup" | "brand">("");
  const [log, setLog] = useState<string | null>(null);
  const [brandsOpen, setBrandsOpen] = useState(false);
  const [busca, setBusca] = useState("");

  const metricsFn = useServerFn(getHygieneMetrics);
  const dupFn = useServerFn(runDuplicateCleanup);
  const brandFn = useServerFn(runBrandPositioning);
  const listFn = useServerFn(listDuplicateCandidates);
  const decideFn = useServerFn(decideDuplicate);
  const brandListFn = useServerFn(listBrandSegments);
  const setSegmentFn = useServerFn(setBrandSegment);
  const mergesFn = useServerFn(listMerges);
  const splitFn = useServerFn(splitMerge);

  const { data: metrics } = useQuery({
    queryKey: ["hygiene-metrics"],
    queryFn: () => metricsFn({ data: undefined as never }),
    retry: false,
  });

  const { data: pares } = useQuery({
    queryKey: ["hygiene-duplicates"],
    queryFn: () => listFn({ data: undefined as never }),
    retry: false,
  });

  const { data: marcas } = useQuery({
    queryKey: ["hygiene-brands"],
    queryFn: () => brandListFn({ data: undefined as never }),
    enabled: brandsOpen,
    retry: false,
  });

  const { data: unificacoes } = useQuery({
    queryKey: ["hygiene-merges"],
    queryFn: () => mergesFn({ data: undefined as never }),
    retry: false,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["hygiene-metrics"] });
    qc.invalidateQueries({ queryKey: ["hygiene-duplicates"] });
    qc.invalidateQueries({ queryKey: ["hygiene-brands"] });
    qc.invalidateQueries({ queryKey: ["hygiene-merges"] });
    qc.invalidateQueries({ queryKey: ["maintenance-data"] });
  };

  const separar = async (id: string) => {
    try {
      const r = await splitFn({ data: { id } });
      if (!r.ok) {
        toast.error(r.motivo ?? "Não foi possível separar.");
        return;
      }
      toast.success(`${r.nome} voltou a ser um produto separado.`);
      refresh();
    } catch {
      toast.error("Não foi possível separar agora.");
    }
  };

  const runDup = async () => {
    setRunning("dup");
    setLog("Procurando perfumes repetidos…");
    try {
      const r = await dupFn({ data: { maxMerges: 150 } });
      setLog(
        `${r.analisados} produtos analisados · ${r.unificados} repetidos unificados · ` +
          `${r.paraRevisar} para você conferir · ${r.fotosComparadas} fotos comparadas`,
      );
      toast.success("Revisão de repetidos concluída.");
      refresh();
    } catch {
      toast.error("Não foi possível concluir agora.");
    } finally {
      setRunning("");
    }
  };

  const runBrand = async () => {
    setRunning("brand");
    setLog("Classificando marcas…");
    try {
      const r = await brandFn({ data: undefined as never });
      setLog(
        `${r.marcas} marcas · ${r.designer} designer · ${r.ocultados} perfumes retirados · ` +
          `${r.restaurados} devolvidos · ${r.semClassificacao} sem classificação`,
      );
      toast.success("Posicionamento aplicado.");
      refresh();
    } catch {
      toast.error("Não foi possível concluir agora.");
    } finally {
      setRunning("");
    }
  };

  const decidir = async (id: string, action: "merge" | "keep", keepId?: string) => {
    try {
      await decideFn({ data: keepId ? { id, action, keepId } : { id, action } });
      toast.success(action === "merge" ? "Produtos unificados." : "Mantivemos separados.");
      refresh();
    } catch {
      toast.error("Não foi possível salvar agora.");
    }
  };

  const alterarMarca = async (
    brandId: string,
    patch: { segment?: BrandSegment; allowPerfumes?: boolean },
  ) => {
    try {
      await setSegmentFn({ data: { brandId, ...patch } });
      toast.success("Marca atualizada.");
      refresh();
    } catch {
      toast.error("Não foi possível atualizar a marca.");
    }
  };

  const marcasFiltradas = (marcas ?? []).filter((m) =>
    busca.trim() ? m.name.toLowerCase().includes(busca.trim().toLowerCase()) : true,
  );

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border bg-card p-5 shadow-soft">
        <h2 className="text-sm font-semibold">Limpeza do catálogo</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Une perfumes repetidos entre fornecedores e mantém no ar só o que combina com a Orium.
          Volumes, concentrações e versões diferentes continuam produtos separados. Body splash,
          cremes, pastas e hidratantes nunca são retirados por causa da marca.
        </p>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Metric label="Perfumes" value={metrics?.perfumes} />
          <Metric label="No ar" value={metrics?.ativos} />
          <Metric label="Fora por marca" value={metrics?.ocultosDesigner} />
          <Metric label="Para conferir" value={metrics?.pendentes} />
          <Metric label="Já unificados" value={metrics?.unificados} />
          <Metric label="Marcas sem classificação" value={metrics?.marcasSemClassificacao} />
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            className="press h-11 rounded-full px-6"
            disabled={running !== ""}
            onClick={runDup}
          >
            {running === "dup" ? "Revisando…" : "Procurar repetidos"}
          </Button>
          <Button
            variant="outline"
            className="press h-11 rounded-full px-6"
            disabled={running !== ""}
            onClick={runBrand}
          >
            {running === "brand" ? "Aplicando…" : "Aplicar posicionamento"}
          </Button>
          <Button
            variant="ghost"
            className="press h-11 rounded-full px-5"
            onClick={() => setBrandsOpen((v) => !v)}
          >
            {brandsOpen ? "Fechar marcas" : "Marcas"}
          </Button>
        </div>
        {log ? <p className="mt-3 text-xs text-muted-foreground">{log}</p> : null}
      </section>

      {brandsOpen ? (
        <section className="rounded-2xl border bg-card p-5 shadow-soft">
          <h2 className="text-sm font-semibold">Marcas</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Escolha o tipo da marca e se os perfumes dela aparecem no catálogo.
          </p>
          <label className="mt-3 flex h-11 items-center gap-2 rounded-full border bg-background px-4">
            <Search className="size-4 text-muted-foreground" />
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar marca"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none"
            />
          </label>
          <ul className="mt-3 divide-y">
            {marcasFiltradas.slice(0, 80).map((m) => (
              <li key={m.id} className="py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{m.name}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {m.perfumes} perfumes · {m.outros} outros produtos
                      {m.reviewed ? " · definido por você" : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {(["ARABIC", "NICHE", "DESIGNER", "UNKNOWN"] as BrandSegment[]).map((seg) => (
                      <button
                        key={seg}
                        onClick={() => alterarMarca(m.id, { segment: seg })}
                        className={`h-9 rounded-full border px-3 text-xs transition-colors ${
                          m.segment === seg
                            ? "border-foreground bg-foreground text-background"
                            : "bg-background"
                        }`}
                      >
                        {SEGMENT_LABEL[seg]}
                      </button>
                    ))}
                    <button
                      onClick={() => alterarMarca(m.id, { allowPerfumes: !m.allowPerfumes })}
                      className={`h-9 rounded-full border px-3 text-xs transition-colors ${
                        m.allowPerfumes ? "bg-background" : "border-destructive/40 text-destructive"
                      }`}
                    >
                      {m.allowPerfumes ? "Perfumes no ar" : "Perfumes fora"}
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          {marcasFiltradas.length === 0 ? (
            <p className="pt-3 text-sm text-muted-foreground">Nenhuma marca encontrada.</p>
          ) : null}
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Perfumes já unidos</h2>
        <p className="text-xs text-muted-foreground">
          Se dois perfumes diferentes da mesma linha foram unidos (Yara e Yara Elixir, por
          exemplo), separe aqui. As ofertas dos fornecedores voltam para o perfume certo e nada do
          produto que ficou é apagado.
        </p>
        {(unificacoes ?? []).length === 0 ? (
          <p className="rounded-2xl border bg-card p-5 text-sm text-muted-foreground">
            Nenhuma unificação registrada.
          </p>
        ) : (
          <ul className="divide-y rounded-2xl border bg-card">
            {(unificacoes ?? []).map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {m.nomeUnido} <span className="text-muted-foreground">→</span> {m.nomeAtual}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {m.marca ?? "sem marca"} ·{" "}
                    {new Date(m.quando).toLocaleDateString("pt-BR")}
                    {m.suspeito ? ` · versões diferentes: ${m.diferencaVersao.join(", ")}` : ""}
                  </p>
                </div>
                {m.suspeito ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2.5 py-1 text-[11px] font-medium text-destructive">
                    <AlertTriangle className="size-3" /> conferir
                  </span>
                ) : null}
                <Button
                  size="sm"
                  variant={m.suspeito ? "default" : "outline"}
                  className="press rounded-full"
                  onClick={() => separar(m.id)}
                >
                  <Unlink className="size-4" /> Separar
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-semibold">Possíveis duplicados</h2>
        {(pares ?? []).length === 0 ? (
          <p className="rounded-2xl border bg-card p-5 text-sm text-muted-foreground">
            Nenhum possível duplicado esperando decisão.
          </p>
        ) : null}
        {(pares ?? []).map((p) => (
          <div key={p.id} className="rounded-2xl border bg-card p-5 shadow-soft">
            <p className="text-xs text-muted-foreground">
              Semelhança {Math.round(p.score * 100)}% ·{" "}
              {Object.entries(p.signals)
                .map(([k, v]) => `${k}: ${String(v)}`)
                .join(" · ")}
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {[p.a, p.b].map((side) => (
                <div key={side.id} className="rounded-xl bg-muted/50 p-4">
                  <div className="flex gap-3">
                    {side.image ? (
                      <img
                        src={side.image}
                        alt={side.name}
                        loading="lazy"
                        className="size-16 shrink-0 rounded-lg object-cover"
                      />
                    ) : null}
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{side.name}</p>
                      <p className="text-xs text-muted-foreground">{side.brand ?? "sem marca"}</p>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {side.concentration ?? "—"} ·{" "}
                        {side.volumeMl ? `${side.volumeMl}ml` : "sem volume"} · {side.offers}{" "}
                        ofertas · {side.inStock ? "disponível" : "indisponível"}
                        {side.locked ? " · confirmado por você" : ""}
                      </p>
                      <Link
                        to="/perfume/$slug"
                        params={{ slug: side.slug }}
                        className="mt-1 inline-block text-[11px] underline decoration-dotted"
                      >
                        Ver página
                      </Link>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    className="press mt-3 w-full rounded-full"
                    onClick={() => decidir(p.id, "merge", side.id)}
                  >
                    <Merge className="size-4" /> Manter este e unir
                  </Button>
                </div>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                className="rounded-full"
                onClick={() => decidir(p.id, "keep")}
              >
                <X className="size-4" /> São produtos diferentes
              </Button>
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                <Check className="size-3" /> a decisão fica salva e o par não volta
              </span>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="rounded-xl bg-muted/50 p-3">
      <p className="text-lg font-semibold tabular-nums">{value ?? "—"}</p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}
