/**
 * Captura curta: nome + WhatsApp, sem senha e sem formulário grande.
 * O teclado do celular é acompanhado pelo viewport visível (nada fica preso).
 */
import { useEffect, useRef, useState } from "react";
import { Heart, Loader2, Lock, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { cn } from "@/lib/utils";
import { isValidPhoneBR, maskPhone } from "@/lib/format";
import { useVisualViewport } from "@/hooks/use-visual-viewport";
import type { CaptureRequest, Lead } from "@/lib/lead";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCart } from "@/lib/cart";
import { useFavorites } from "@/lib/favorites";
import { imgVariant } from "@/lib/product-img";
import { PopIcon, ThumbStack } from "@/components/orium/PopCard";

export function LeadCaptureSheet({
  request,
  lead,
  onOpenChange,
  onSubmit,
}: {
  request: CaptureRequest | null;
  lead: Lead | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: { name: string; phone: string; marketingOptin: boolean }) => Promise<void>;
}) {
  const open = !!request;
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [optin, setOptin] = useState(false);
  const [saving, setSaving] = useState(false);
  const nameRef = useRef<HTMLInputElement | null>(null);
  const vv = useVisualViewport(open);
  const keyboardOffset = open ? vv.keyboardOffset : 0;

  useEffect(() => {
    if (!open) {
      setSaving(false);
      return;
    }
    setName(lead?.name ?? "");
    setPhone(lead?.phone ? maskPhone(lead.phone) : "");
    // só no computador o cursor já entra no campo; no celular o teclado abrindo
    // durante a animação da folha fazia a tela pular
    if (!window.matchMedia("(pointer: fine)").matches) return;
    const t = setTimeout(() => nameRef.current?.focus({ preventScroll: true }), 320);
    return () => clearTimeout(t);
  }, [open, lead]);

  // Folha travada: a página de trás não rola (nem carrega mais produtos) enquanto ela está aberta.
  useEffect(() => {
    if (!open) return;
    const html = document.documentElement;
    const body = document.body;
    const prev = { h: html.style.overflow, b: body.style.overflow, o: html.style.overscrollBehavior };
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    html.style.overscrollBehavior = "none";
    return () => {
      html.style.overflow = prev.h;
      body.style.overflow = prev.b;
      html.style.overscrollBehavior = prev.o;
    };
  }, [open]);

  const cleanName = name.trim();
  const canSave = cleanName.length >= 2 && isValidPhoneBR(phone) && !saving;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      await onSubmit({ name: cleanName, phone: phone.replace(/\D/g, ""), marketingOptin: optin });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não conseguimos salvar agora. Tente de novo.");
      setSaving(false);
    }
  };

  const toWhatsApp = /whats/i.test(request?.cta ?? "");

  // salvar escolhas: o topo mostra os perfumes do próprio cliente
  const saveTrigger = request?.trigger === "salvar_escolhas";
  const cart = useCart();
  const favorites = useFavorites();
  const favIds = favorites.entries.slice(0, 3).map((e) => e.productId);
  const { data: favImages } = useQuery({
    queryKey: ["save-prompt-thumbs", favIds.join(",")],
    enabled: open && saveTrigger && favIds.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await supabase.from("products").select("id, image_url").in("id", favIds);
      const byId = new Map((data ?? []).map((r) => [r.id, r.image_url as string | null]));
      return favIds.map((id) => byId.get(id)).filter(Boolean) as string[];
    },
  });
  const thumbs = Array.from(new Set([...(favImages ?? []), ...(cart.items.map((i) => i.image).filter(Boolean) as string[])]))
    .map((u) => imgVariant(u, "thumb") ?? u)
    .slice(0, 3);
  const itemCount = new Set([...favorites.entries.map((e) => e.productId), ...cart.items.map((i) => i.productId)]).size;

  return (
    <Drawer open={open} onOpenChange={onOpenChange} repositionInputs={false}>
      <DrawerContent
        className={cn(
          "lead-sheet max-h-[92dvh] overflow-y-auto overscroll-contain px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] text-white",
        )}
        style={{
          paddingBottom: keyboardOffset
            ? `calc(1.25rem + env(safe-area-inset-bottom) + ${keyboardOffset}px)`
            : undefined,
          maxHeight: vv.isKeyboardOpen && vv.height ? `${vv.height - 24}px` : undefined,
        }}
      >
        <DrawerHeader className="ls-in px-0 pt-5 pb-0 text-left">
          <div className="mb-4">
            {saveTrigger && thumbs.length ? (
              <ThumbStack images={thumbs} more={Math.max(0, itemCount - thumbs.length)} />
            ) : (
              <PopIcon>
                {toWhatsApp ? <MessageCircle className="size-[20px]" strokeWidth={2.2} /> : <Heart className="size-[20px]" fill="currentColor" strokeWidth={0} />}
              </PopIcon>
            )}
          </div>
          <DrawerTitle className="text-[26px] leading-[1.12] font-bold tracking-[-0.025em] text-white">
            {request?.title ?? "Salve suas escolhas na Orium"}
          </DrawerTitle>
        </DrawerHeader>
        <p className="ls-in mt-2 text-[15px] leading-relaxed text-[#A9A9A9]" style={{ "--ls-d": "40ms" } as React.CSSProperties}>
          {request?.subtitle ?? "Guarde seus favoritos e sacola para não perder depois."}
        </p>

        <form
          className="mt-6"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          {/* nome e WhatsApp num cartão só, como no login e na finalização */}
          <div className="ls-in overflow-hidden rounded-[20px] bg-[#1C1C1C]" style={{ "--ls-d": "80ms" } as React.CSSProperties}>
            <label className="ls-row block px-4 pt-3 pb-2.5" htmlFor="lead-name">
              <span className="block text-[12.5px] font-semibold text-[#8C8C8C]">Nome</span>
              <input
                id="lead-name"
                ref={nameRef}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Como você gosta de ser chamado"
                autoComplete="name"
                enterKeyHint="next"
                className="ls-input"
              />
            </label>
            <span aria-hidden className="mx-4 block h-px bg-white/[0.07]" />
            <label className="ls-row block px-4 pt-3 pb-2.5" htmlFor="lead-phone">
              <span className="block text-[12.5px] font-semibold text-[#8C8C8C]">WhatsApp</span>
              <input
                id="lead-phone"
                value={phone}
                onChange={(e) => setPhone(maskPhone(e.target.value))}
                placeholder="(21) 99999-9999"
                autoComplete="tel"
                inputMode="tel"
                enterKeyHint="go"
                className="ls-input tabular-nums"
              />
            </label>
          </div>

          <p className="ls-in mt-3 flex items-start gap-2 px-1 text-[12.5px] leading-relaxed text-[#8C8C8C]" style={{ "--ls-d": "120ms" } as React.CSSProperties}>
            <Lock className="mt-[3px] size-3.5 shrink-0" strokeWidth={2.2} />
            <span>
              {request?.benefit ?? "Assim seus favoritos e sacola ficam vinculados ao seu atendimento na Orium."}{" "}
              Usamos seu WhatsApp só para esse atendimento.
            </span>
          </p>

          <button
            type="button"
            role="switch"
            aria-checked={optin}
            onClick={() => setOptin((v) => !v)}
            className="ls-in press mt-4 flex w-full items-center gap-3 rounded-[18px] bg-[#1C1C1C] px-4 py-3.5 text-left"
            style={{ "--ls-d": "160ms" } as React.CSSProperties}
          >
            <span className="min-w-0 flex-1 text-[14px] leading-snug text-white">
              Receber novidades e ofertas
              <span className="block text-[12px] text-[#8C8C8C]">Opcional · dá para sair quando quiser</span>
            </span>
            <span
              aria-hidden
              className={cn(
                "relative h-[30px] w-[50px] shrink-0 rounded-full transition-colors duration-300",
                optin ? "bg-[#FFD599]" : "bg-[#3A3A3A]",
              )}
            >
              <span
                className={cn(
                  "absolute top-[3px] left-[3px] size-6 rounded-full bg-white shadow-[0_2px_6px_rgba(0,0,0,0.35)] transition-transform duration-300 ease-[var(--ease-orium)]",
                  optin && "translate-x-5",
                )}
              />
            </span>
          </button>

          <button
            type="submit"
            disabled={!canSave}
            className={cn(
              "ls-in press mt-5 flex h-[56px] w-full items-center justify-center gap-2 rounded-full text-[16px] font-bold transition-colors duration-300",
              canSave ? "bg-[#FFD599] text-[#15130F] hover:bg-[#FFDDAA]" : "bg-[#2A2A2A] text-[#7A7A7A]",
            )}
            style={{ "--ls-d": "200ms" } as React.CSSProperties}
          >
            {saving ? (
              <Loader2 className="size-[18px] animate-spin" />
            ) : toWhatsApp ? (
              <MessageCircle className="size-[18px]" strokeWidth={2.4} />
            ) : null}
            {request?.cta ?? "Salvar"}
          </button>
        </form>
      </DrawerContent>
    </Drawer>
  );
}
