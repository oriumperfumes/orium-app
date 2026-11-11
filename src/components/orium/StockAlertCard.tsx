import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { BellRing, Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { subscribeBackInStock, cancelBackInStock } from "@/lib/relationship.functions";
import { visitorId } from "@/lib/product-views";

/**
 * AVISE-ME QUANDO VOLTAR.
 * Aparece somente quando o perfume está indisponível. Quem está logado pede
 * com um toque; visitante informa apenas o WhatsApp. Um aviso por pessoa.
 */
/** Telefone brasileiro normalizado (só dígitos, com DDD). null quando inválido. */
function normalizePhone(raw: string): string | null {
  const d = raw.replace(/\D/g, "").replace(/^0+/, "");
  const n = d.startsWith("55") && d.length > 11 ? d.slice(2) : d;
  if (!/^[1-9]{2}9?[0-9]{8}$/.test(n)) return null;
  return n;
}

export function StockAlertCard({ productId, name }: { productId: string; name: string }) {
  const [contact, setContact] = useState("");
  const [done, setDone] = useState(false);
  const subscribe = useServerFn(subscribeBackInStock);
  const cancel = useServerFn(cancelBackInStock);

  const ask = useMutation({
    mutationFn: async () => {
      const phone = normalizePhone(contact);
      if (!phone) throw new Error("Informe um WhatsApp válido com DDD.");
      return subscribe({ data: { productId, anonymousId: visitorId(), phone } });
    },
    onSuccess: (r) => {
      setDone(true);
      toast.success(r.already ? "Você já está na lista de avisos" : "Pronto! Vamos avisar você quando voltar.");
    },
    onError: (e: Error) => toast.error(e.message || "Não conseguimos registrar o aviso agora."),
  });

  const undo = useMutation({
    mutationFn: async () => cancel({ data: { productId, anonymousId: visitorId() } }),
    onSuccess: () => {
      setDone(false);
      toast.success("Aviso cancelado.");
    },
  });

  if (done) {
    return (
      <div className="rounded-2xl border border-border/70 bg-surface-2 p-4">
        <p className="flex items-center gap-2 text-sm font-medium">
          <Check className="size-4 text-emerald-500" /> Vamos avisar você quando {name} voltar.
        </p>
        <button
          type="button"
          onClick={() => undo.mutate()}
          className="mt-2 text-xs text-muted-foreground underline underline-offset-4"
        >
          Não quero mais ser avisado
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border/70 bg-surface-2 p-4">
      <p className="flex items-center gap-2 text-sm font-semibold">
        <BellRing className="size-4" /> Avise-me quando voltar
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        Este perfume está indisponível. Te avisamos assim que ele voltar — sem mensagem repetida.
      </p>
      <div className="mt-3 flex flex-col gap-2">
        <Input
          inputMode="tel"
          autoComplete="tel"
          placeholder="Seu WhatsApp"
          value={contact}
          onChange={(e) => setContact(e.target.value)}
          className="h-11 rounded-full"
        />
        <Button
          className="h-11 w-full rounded-full"
          onClick={() => ask.mutate()}
          disabled={ask.isPending || !normalizePhone(contact)}
        >
          {ask.isPending ? "Registrando…" : "Quero ser avisado"}
        </Button>
      </div>
    </div>
  );
}
