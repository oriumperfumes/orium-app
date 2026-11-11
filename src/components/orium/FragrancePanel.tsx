/**
 * Painel administrativo "Informações olfativas": status, fontes, acordes,
 * pirâmide, novo enriquecimento e edição manual (confirma e trava a automação).
 */
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { RefreshCw, Save } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { dateBR } from "@/lib/format";
import { enrichProductFragrance, saveFragranceDetails } from "@/lib/fragrance.functions";

const STATUS_LABEL: Record<string, string> = {
  completo: "Completo",
  parcial: "Parcial",
  revisar: "Revisar",
  nao_encontrado: "Não encontrado",
  pendente: "Pendente",
  bloqueado: "Confirmado (travado)",
};

export function FragrancePanel({ productId }: { productId: string }) {
  const qc = useQueryClient();
  const enrich = useServerFn(enrichProductFragrance);
  const save = useServerFn(saveFragranceDetails);
  const [busy, setBusy] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-fragrance", productId],
    queryFn: async () => {
      const [details, accords, notes] = await Promise.all([
        supabase.from("fragrance_details").select("*").eq("product_id", productId).maybeSingle(),
        supabase.from("fragrance_accords").select("*").eq("product_id", productId).order("position"),
        supabase.from("fragrance_notes").select("*").eq("product_id", productId).order("position"),
      ]);
      return { details: details.data, accords: accords.data ?? [], notes: notes.data ?? [] };
    },
  });

  const [description, setDescription] = useState("");
  const [accords, setAccords] = useState("");
  const [top, setTop] = useState("");
  const [heart, setHeart] = useState("");
  const [base, setBase] = useState("");

  useEffect(() => {
    if (!data) return;
    setDescription(data.details?.description ?? "");
    setAccords(data.accords.map((a) => `${a.accord_name}:${Number(a.intensity).toFixed(1)}`).join(", "));
    const at = (level: string) =>
      data.notes.filter((n) => n.pyramid_level === level).map((n) => n.note_label).join(", ");
    setTop(at("TOP"));
    setHeart(at("HEART"));
    setBase(at("BASE"));
  }, [data]);

  const refetchAll = () => {
    qc.invalidateQueries({ queryKey: ["admin-fragrance", productId] });
    qc.invalidateQueries({ queryKey: ["fragrance", productId] });
  };

  const runEnrich = async () => {
    setBusy(true);
    try {
      const r = await enrich({ data: { productId, force: true } });
      toast.success(`Enriquecimento: ${STATUS_LABEL[r.status] ?? r.status}`, {
        description: `${r.accords} acordes · ${r.notes} notas · confiança ${Math.round(r.confidence * 100)}%`,
      });
      refetchAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível buscar as informações.");
    } finally {
      setBusy(false);
    }
  };

  const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

  const runSave = async () => {
    setBusy(true);
    try {
      await save({
        data: {
          productId,
          description: description.trim() || null,
          accords: list(accords).map((chunk) => {
            const [name, intensity] = chunk.split(":");
            return { name: (name ?? "").trim(), intensity: Number(intensity ?? 0.7) || 0.7 };
          }),
          top: list(top),
          heart: list(heart),
          base: list(base),
          lock: true,
        },
      });
      toast.success("Informação confirmada. A automação não vai sobrescrever.");
      refetchAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      setBusy(false);
    }
  };

  if (isLoading) return <div className="mt-6 h-40 animate-pulse rounded-2xl bg-muted" />;

  const d = data?.details;
  const status = d?.locked ? "bloqueado" : (d?.status ?? "pendente");

  return (
    <section className="mt-6 rounded-2xl border bg-card p-5 shadow-soft">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-medium">Informações olfativas</h2>
        <Button size="sm" variant="outline" className="rounded-full" disabled={busy} onClick={runEnrich}>
          <RefreshCw className={`mr-1.5 size-3.5 ${busy ? "animate-spin" : ""}`} /> Buscar novamente
        </Button>
      </div>

      <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2 lg:grid-cols-4">
        <p>
          Status: <span className="font-medium text-foreground">{STATUS_LABEL[status] ?? status}</span>
        </p>
        <p>
          Fonte principal:{" "}
          <span className="font-medium text-foreground">{d?.source_primary ?? "—"}</span>
        </p>
        <p>
          Confiança:{" "}
          <span className="font-medium text-foreground">
            {d ? `${Math.round(Number(d.confidence) * 100)}% · match ${Math.round(Number(d.external_match_score) * 100)}%` : "—"}
          </span>
        </p>
        <p>
          Último enrichment:{" "}
          <span className="font-medium text-foreground">{d?.enriched_at ? dateBR(d.enriched_at) : "—"}</span>
        </p>
      </div>

      {d?.source_conflict ? (
        <p className="mt-2 text-xs text-destructive">
          As fontes divergiram (source_conflict). Confira antes de confirmar.
        </p>
      ) : null}
      {d?.source_primary_url ? (
        <p className="mt-2 truncate text-xs">
          <a href={d.source_primary_url} target="_blank" rel="noreferrer" className="underline">
            {d.source_primary_url}
          </a>
        </p>
      ) : null}

      <div className="mt-4 space-y-3 border-t pt-4">
        <Field label="Descrição (Orium, baseada nas fontes)">
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={5} />
        </Field>
        <Field label="Acordes (nome:intensidade, separados por vírgula)">
          <Input value={accords} onChange={(e) => setAccords(e.target.value)} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Notas de saída">
            <Input value={top} onChange={(e) => setTop(e.target.value)} />
          </Field>
          <Field label="Notas de coração">
            <Input value={heart} onChange={(e) => setHeart(e.target.value)} />
          </Field>
          <Field label="Notas de fundo">
            <Input value={base} onChange={(e) => setBase(e.target.value)} />
          </Field>
        </div>
        <Button size="sm" className="rounded-full" disabled={busy} onClick={runSave}>
          <Save className="mr-1.5 size-3.5" /> Salvar como informação confirmada
        </Button>
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
