import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, Search, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AdminPrimaryAction, AdminSecondaryAction } from "@/components/orium/admin/AdminUI";
import { analyzeSupplierUrl, createSupplierFromUrl } from "@/lib/supplier-hub.functions";
import { brl } from "@/lib/format";
import { PRIORITY_LABEL } from "@/lib/supplier-lead";

type Analysis = Awaited<ReturnType<typeof analyzeSupplierUrl>>;
const LEVEL: Record<string, string> = { disponiveis: "Disponíveis", parciais: "Parcialmente disponíveis", indisponiveis: "Indisponíveis" };

export function AddSupplierDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; onCreated?: (id: string) => void }) {
  const analyze = useServerFn(analyzeSupplierUrl);
  const create = useServerFn(createSupplierFromUrl);
  const qc = useQueryClient();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Analysis | null>(null);
  const [name, setName] = useState("");
  const [priority, setPriority] = useState<"reference" | "secondary" | "preferred">("reference");
  const [showAll, setShowAll] = useState(false);

  const run = async () => {
    setBusy(true);
    setResult(null);
    try {
      const r = await analyze({ data: { url } });
      setResult(r);
      if ("suggestedName" in r && r.suggestedName) setName(r.suggestedName);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao analisar.");
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!result || !("aid" in result) || !result.aid) return;
    setBusy(true);
    try {
      const { id } = await create({ data: { url, name, aid: result.aid, priority } });
      toast.success("Fornecedor integrado. Rode a primeira sincronização para importar o catálogo.");
      qc.invalidateQueries({ queryKey: ["admin-suppliers"] });
      onCreated?.(id);
      onOpenChange(false);
      setResult(null);
      setUrl("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar.");
    } finally {
      setBusy(false);
    }
  };

  const a = result && "totalProcessed" in result ? result : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] w-[calc(100vw-1.5rem)] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Adicionar fornecedor</DialogTitle>
          <DialogDescription>Cole o endereço do site. A análise usa somente dados públicos.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input inputMode="url" placeholder="https://fornecedor.kyte.site" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && url && run()} />
          <AdminPrimaryAction className="w-full" onClick={run} disabled={!url || busy} loading={busy && !a} icon={busy && !a ? <Loader2 className="animate-spin" /> : <Search />}>
            {busy && !a ? "Analisando site…" : "Analisar site"}
          </AdminPrimaryAction>
        </div>

        {result && !a ? <p className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm">{result.message}</p> : null}

        {a ? (
          <div className="space-y-3">
            <div className="rounded-2xl border border-border/60 bg-muted/20 p-4 text-sm">
              <div className="flex items-center gap-2 font-medium">
                {a.ok ? <CheckCircle2 className="size-4 text-primary" /> : <TriangleAlert className="size-4 text-destructive" />}
                {a.ok ? "Fornecedor identificado" : "Leitura não concluída"}
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                <dt className="text-muted-foreground">Plataforma</dt><dd>{a.platform === "kyte" ? "Kyte" : "Desconhecida"}</dd>
                <dt className="text-muted-foreground">Conexão</dt><dd>{a.ok ? "Funcionando" : "Com falha"}</dd>
                <dt className="text-muted-foreground">Produtos lidos</dt><dd>{a.totalProcessed}{a.hiddenBySource ? ` (+${a.hiddenBySource} ocultos pela loja)` : ""}</dd>
                <dt className="text-muted-foreground">Preços</dt><dd>{LEVEL[a.prices]} ({a.withPrice})</dd>
                <dt className="text-muted-foreground">Imagens</dt><dd>{LEVEL[a.images]} ({a.withImage})</dd>
                <dt className="text-muted-foreground">Estoque informado</dt><dd>{a.stockControlled} de {a.totalProcessed}</dd>
                <dt className="text-muted-foreground">Feeds</dt><dd className="break-words">{Object.entries(a.feeds).map(([k, v]) => `${k.replace("feed/", "")}: ${v}`).join(" · ") || "—"}</dd>
                <dt className="text-muted-foreground">Método</dt><dd className="break-words">{a.method}</dd>
              </dl>
              {a.categories.length ? <p className="mt-3 text-xs text-muted-foreground">Categorias: {a.categories.map((c) => `${c.name} (${c.count})`).join(" · ")}</p> : null}
              <p className="mt-2 text-xs text-muted-foreground">{a.message}</p>
              {a.existing ? <p className="mt-2 text-xs text-destructive">Já cadastrado como “{a.existing.name}”.</p> : null}
            </div>

            {a.sample.length ? (
              <div className="rounded-2xl border border-border/60">
                <button type="button" className="w-full px-4 py-3 text-left text-sm font-medium" onClick={() => setShowAll((v) => !v)}>
                  {showAll ? "Ocultar produtos" : "Visualizar produtos"} ({a.sample.length} de amostra)
                </button>
                {showAll ? (
                  <ul className="divide-y divide-border/60 border-t border-border/60">
                    {a.sample.map((p) => (
                      <li key={p.url ?? p.name} className="flex min-w-0 items-center gap-3 px-4 py-2 text-xs">
                        {p.image ? <img src={p.image} alt="" loading="lazy" className="size-10 shrink-0 rounded-lg object-cover" /> : <div className="size-10 shrink-0 rounded-lg bg-muted" />}
                        <div className="min-w-0 flex-1">
                          <p className="truncate">{p.name}</p>
                          <p className="text-muted-foreground">{p.category ?? "Sem categoria"}{p.concentration ? ` · ${p.concentration}` : ""}</p>
                        </div>
                        <span className="shrink-0 font-medium">{p.price != null ? brl(p.price) : "sem preço"}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}

            {a.ok && !a.existing ? (
              <div className="space-y-3 rounded-2xl border border-border/60 p-4">
                <div className="space-y-1.5">
                  <Label htmlFor="sup-name">Nome do fornecedor</Label>
                  <Input id="sup-name" value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Prioridade inicial</Label>
                  <div className="grid grid-cols-3 gap-2">
                    {(["reference", "secondary", "preferred"] as const).map((p) => (
                      <button key={p} type="button" onClick={() => setPriority(p)} className={`h-11 rounded-full border px-2 text-xs ${priority === p ? "border-primary bg-primary/15 text-foreground" : "border-border/60 text-muted-foreground"}`}>
                        {PRIORITY_LABEL[p]}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">Novos fornecedores entram sem alterar preço público nem disponibilidade. Ajuste depois em Gerenciar.</p>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <AdminSecondaryAction onClick={() => onOpenChange(false)}>Cancelar</AdminSecondaryAction>
                  <AdminPrimaryAction onClick={confirm} disabled={busy || !name.trim()} loading={busy}>Confirmar integração</AdminPrimaryAction>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
