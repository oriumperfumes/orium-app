import type { ReactNode } from "react";
import { Check, Loader2, Mic, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Superfície padrão de todo card gerado por ferramenta do Copilot: nunca passa da largura da conversa. */
export function CopilotActionCard({ className, done, children }: { className?: string; done?: boolean; children: ReactNode }) {
  return (
    <div className={cn("copilot-card copilot-msg-in w-full min-w-0 max-w-md rounded-2xl p-4", done && "copilot-card-done", className)}>
      {children}
    </div>
  );
}

/** Ações de confirmação: principal dourada em largura total; secundárias em grade igual abaixo. */
export function CopilotConfirmationActions({
  confirmLabel,
  busy,
  disabled,
  onConfirm,
  onCancel,
  onCorrect,
}: {
  confirmLabel: string;
  busy: boolean;
  disabled: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  onCorrect?: (() => void) | undefined;
}) {
  return (
    <div className="mt-4 grid w-full min-w-0 gap-2">
      <Button className="h-11 w-full min-w-0 rounded-full" onClick={onConfirm} disabled={disabled}>
        {busy ? <Loader2 className="size-4 shrink-0 animate-spin" /> : <Check className="size-4 shrink-0" />}
        <span className="truncate">{busy ? "Executando…" : confirmLabel}</span>
      </Button>
      <div className={cn("grid min-w-0 gap-2", onCorrect ? "grid-cols-2" : "grid-cols-1")}>
        <Button variant="outline" className="h-11 min-w-0 rounded-full px-3" disabled={disabled} onClick={onCancel}>
          <X className="size-4 shrink-0" /> <span className="truncate">Cancelar</span>
        </Button>
        {onCorrect ? (
          <Button variant="outline" className="h-11 min-w-0 rounded-full px-3" disabled={disabled} onClick={onCorrect} aria-label="Corrigir falando">
            <Mic className="size-4 shrink-0" /> <span className="truncate">Corrigir</span>
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** Linha de produto: imagem fixa, textos que encolhem, valor à direita sem empurrar o layout. */
export function CopilotProductResult({
  image,
  title,
  subtitle,
  trailing,
}: {
  image?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      {image}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{title}</p>
        {subtitle ? <p className="truncate text-xs text-muted-foreground">{subtitle}</p> : null}
      </div>
      {trailing ? <span className="shrink-0 text-sm tabular-nums">{trailing}</span> : null}
    </div>
  );
}

/** Conteúdo de mensagem: quebra palavras longas, tabelas/código rolam dentro de si mesmos. */
export const copilotMessageContentClass =
  "min-w-0 max-w-full break-words [overflow-wrap:anywhere] [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto [&_img]:max-w-full [&_img]:h-auto";
