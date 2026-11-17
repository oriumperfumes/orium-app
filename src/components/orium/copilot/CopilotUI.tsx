import type { ReactNode } from "react";
import { Check, Loader2, Mic, X } from "lucide-react";
import { cn } from "@/lib/utils";

/** Superfície padrão de todo card gerado por ferramenta do Copilot: nunca passa da largura da conversa. */
export function CopilotActionCard({ className, done, children }: { className?: string; done?: boolean; children: ReactNode }) {
  return (
    <div className={cn("copilot-card cp-card copilot-msg-in w-full min-w-0 max-w-md rounded-[24px] p-4", done && "copilot-card-done", className)}>
      {children}
    </div>
  );
}

const secondary =
  "press inline-flex h-11 min-w-0 items-center justify-center gap-2 rounded-full bg-[#232323] px-3 text-[14px] font-semibold text-white transition-colors hover:bg-[#2E2E2E] disabled:opacity-50";

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
    <div className="mt-5 grid w-full min-w-0 gap-2">
      <button
        type="button"
        className="press inline-flex h-12 w-full min-w-0 items-center justify-center gap-2 rounded-full bg-[#FFD599] px-4 text-[15px] font-bold text-[#15130F] transition-colors hover:bg-[#FFDDAA] disabled:opacity-50"
        onClick={onConfirm}
        disabled={disabled}
      >
        {busy ? <Loader2 className="size-[18px] shrink-0 animate-spin" /> : <Check className="size-[18px] shrink-0" strokeWidth={2.6} />}
        <span className="truncate">{busy ? "Executando…" : confirmLabel}</span>
      </button>
      <div className={cn("grid min-w-0 gap-2", onCorrect ? "grid-cols-2" : "grid-cols-1")}>
        <button type="button" className={secondary} disabled={disabled} onClick={onCancel}>
          <X className="size-4 shrink-0" /> <span className="truncate">Cancelar</span>
        </button>
        {onCorrect ? (
          <button type="button" className={secondary} disabled={disabled} onClick={onCorrect} aria-label="Corrigir falando">
            <Mic className="size-4 shrink-0 text-[#FFD599]" /> <span className="truncate">Corrigir</span>
          </button>
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
        <p className="truncate text-[14.5px] font-semibold">{title}</p>
        {subtitle ? <p className="truncate text-[12.5px] text-[#8C8C8C]">{subtitle}</p> : null}
      </div>
      {trailing ? <span className="shrink-0 text-sm tabular-nums">{trailing}</span> : null}
    </div>
  );
}

/** Conteúdo de mensagem: quebra palavras longas, tabelas/código rolam dentro de si mesmos. */
export const copilotMessageContentClass =
  "min-w-0 max-w-full break-words [overflow-wrap:anywhere] [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto [&_img]:max-w-full [&_img]:h-auto";
