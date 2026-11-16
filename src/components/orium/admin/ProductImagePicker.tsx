import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertTriangle, Check, ImagePlus, Loader2, RotateCcw, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { checkProductImage, productImageOptions, setProductImage } from "@/lib/product-image.functions";
import { uploadProductPhoto } from "@/lib/manual-product.functions";
import { optimizePhoto } from "@/lib/image-optimize";
import { isOriumPhoto } from "@/lib/product-img";
import { optimizeRemoteImage } from "@/lib/image-pipeline";
import { cn } from "@/lib/utils";

type Choice = { kind: "supplier"; url: string; offerId: string; label: string } | { kind: "upload"; url: string; label: string };

export function ProductImagePicker({ productId, name }: { productId: string; name: string }) {
  const qc = useQueryClient();
  const load = useServerFn(productImageOptions);
  const save = useServerFn(setProductImage);
  const check = useServerFn(checkProductImage);
  const upload = useServerFn(uploadProductPhoto);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);

  const key = ["product-image", productId];
  const { data } = useQuery({ queryKey: key, queryFn: () => load({ data: { productId } }), staleTime: 15_000 });
  const cur = data?.current;

  // confere a foto manual uma vez por abertura
  useEffect(() => {
    if (cur && cur.mode !== "auto") {
      void check({ data: { productId } }).then((r) => {
        if (r.broken !== cur.broken) void qc.invalidateQueries({ queryKey: key });
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur?.mode, cur?.manualUrl]);

  const sourceLabel =
    cur?.mode === "upload" ? "Imagem enviada pelo Admin" : cur?.mode === "supplier" ? cur.supplier ?? "Fornecedor" : "Automática";

  const apply = async (mode: "auto" | "supplier" | "upload", c?: Choice | null) => {
    setBusy(true);
    try {
      // foto de fornecedor entra no pipeline: o público recebe a versão da Orium
      if (mode === "supplier" && c?.url && !isOriumPhoto(c.url)) {
        const t = toast.loading("Processando imagem…");
        const r = await optimizeRemoteImage(c.url);
        if (r.ok) toast.success(`✓ Imagem otimizada (${Math.round(r.before / 1024)}KB → ${Math.round(r.card / 1024)}KB no card)`, { id: t });
        else toast.warning(`Foto salva sem otimizar: ${r.error}`, { id: t });
      }
      await save({
        data: { productId, mode, url: c?.url ?? null, offerId: c?.kind === "supplier" ? c.offerId : null },
      });
      toast.success(mode === "auto" ? "Imagem voltou para o automático." : "Imagem principal atualizada.");
      setOpen(false);
      setChoice(null);
      await qc.invalidateQueries();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar a imagem.");
    } finally {
      setBusy(false);
    }
  };

  const pickFile = async (file: File) => {
    setUploading(true);
    const t = toast.loading("Processando imagem…");
    try {
      const optimized = await optimizePhoto(file);
      const res = await upload({ data: { base64: optimized.main, contentType: "image/webp", cardBase64: optimized.card, thumbBase64: optimized.thumb } });
      setChoice({ kind: "upload", url: res.url, label: "Upload manual" });
      toast.success("✓ Imagem otimizada", { id: t });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível enviar a foto.", { id: t });
    } finally {
      setUploading(false);
    }
  };

  const preview = choice?.url ?? cur?.url ?? null;

  return (
    <div>
      <p className="text-[16px] font-bold">Foto</p>
      <div className="mt-3 flex items-center gap-4">
        <div className="size-28 shrink-0 overflow-hidden rounded-[20px] bg-[#232323]">
          {cur?.url ? (
            <img src={cur.url} alt={name} className="size-full object-contain" />
          ) : (
            <div className="grid size-full place-items-center text-muted-foreground">
              <ImagePlus className="size-5" />
            </div>
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <p className="text-[13px] text-[#8C8C8C]">
            Fonte: <span className="font-semibold text-white">{sourceLabel}</span>
          </p>
          {cur?.broken ? (
            <p className="flex items-center gap-1.5 text-xs text-destructive">
              <AlertTriangle className="size-3.5" /> Imagem selecionada indisponível
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="ghost" className="press h-11 rounded-full bg-[#232323] px-5 text-[13.5px] font-semibold text-white hover:bg-[#2C2C2C] hover:text-white" onClick={() => setOpen(true)}>
              Trocar imagem
            </Button>
            {cur && cur.mode !== "auto" ? (
              <Button
                type="button"
                variant="ghost"
                className="press h-10 rounded-full px-3 text-xs text-muted-foreground"
                disabled={busy}
                onClick={() => void apply("auto")}
              >
                <RotateCcw className="size-3.5" /> Voltar para automático
              </Button>
            ) : null}
          </div>
        </div>
      </div>
      <p className="mt-3 text-[12.5px] text-[#6F6F6F]">A foto escolhida à mão continua valendo em todas as sincronizações.</p>

      <Dialog open={open} onOpenChange={(v) => (setOpen(v), v ? null : setChoice(null))}>
        <DialogContent className="max-h-[92dvh] w-[calc(100vw-2rem)] max-w-lg overflow-y-auto rounded-[24px] p-4 sm:p-5">
          <DialogHeader>
            <DialogTitle className="text-left text-base">Fotos disponíveis</DialogTitle>
          </DialogHeader>

          <div className="mx-auto aspect-square w-full max-w-[280px] overflow-hidden rounded-2xl border border-border/60 bg-surface-3">
            {preview ? (
              <img src={preview} alt={name} className="size-full object-contain" />
            ) : (
              <div className="grid size-full place-items-center text-muted-foreground">
                <ImagePlus className="size-6" />
              </div>
            )}
          </div>
          <p className="text-center text-xs text-muted-foreground">
            {choice ? `Selecionada: ${choice.label}` : `Atual: ${sourceLabel}`}
          </p>

          <div className="grid grid-cols-3 gap-2">
            {(data?.options ?? []).map((o) => {
              const active = choice?.url === o.url;
              return (
                <button
                  key={o.key}
                  type="button"
                  onClick={() => setChoice({ kind: "supplier", url: o.url, offerId: o.offerId, label: o.supplier })}
                  className={cn(
                    "press relative min-w-0 overflow-hidden rounded-xl border bg-surface-3 text-left transition-colors",
                    active ? "border-primary ring-2 ring-primary/40" : "border-border/60",
                  )}
                >
                  <img src={o.url} alt={o.supplier} loading="lazy" className="aspect-square w-full object-contain" />
                  <span className="block truncate px-2 py-1.5 text-[11px] text-muted-foreground">{o.supplier}</span>
                  {cur?.url === o.url && cur.mode !== "auto" ? (
                    <Check className="absolute top-1.5 right-1.5 size-4 rounded-full bg-primary p-0.5 text-primary-foreground" />
                  ) : null}
                </button>
              );
            })}
            <button
              type="button"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
              className={cn(
                "press grid aspect-square min-w-0 place-items-center rounded-xl border border-dashed text-center text-[11px] text-muted-foreground",
                choice?.kind === "upload" ? "border-primary text-foreground" : "border-border/70",
              )}
            >
              <span className="flex flex-col items-center gap-1.5 px-2">
                {uploading ? <Loader2 className="size-5 animate-spin" /> : <Upload className="size-5" />}
                Enviar imagem própria
              </span>
            </button>
          </div>
          {!data?.options.length ? (
            <p className="text-xs text-muted-foreground">Nenhum fornecedor deste perfume tem foto. Envie uma imagem própria.</p>
          ) : null}

          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void pickFile(f);
            }}
          />

          <Button
            type="button"
            className="h-12 w-full rounded-full"
            disabled={!choice || busy}
            onClick={() => choice && void apply(choice.kind, choice)}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            Usar esta imagem
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
