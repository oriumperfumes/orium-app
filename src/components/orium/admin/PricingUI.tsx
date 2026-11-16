import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ *
 * Peças visuais da Precificação, na mesma linguagem do Início e de
 * Pedidos: cartões #1A1A1A de 28px (`dash-card`), o número principal em
 * dourado (`dash-hero`), ícone redondo (`dash-ico`), blocos internos
 * #232323 de 22px, pílulas com o selecionado em branco e ação principal
 * dourada. Só apresentação: nenhuma regra de preço vive aqui.
 * ------------------------------------------------------------------ */

/** Número do topo (igual ao Início): rótulo, ícone redondo e valor grande. */
export function PxKpi({
  label,
  icon,
  value,
  foot,
  hero,
  loading,
  className,
  i = 0,
  onClick,
  ariaLabel,
}: {
  label: string;
  icon: ReactNode;
  value: ReactNode;
  foot?: ReactNode;
  hero?: boolean;
  loading?: boolean;
  className?: string;
  i?: number;
  /** cartão clicável (abre a edição) */
  onClick?: () => void;
  ariaLabel?: string;
}) {
  const Tag = onClick ? "button" : "article";
  return (
    <Tag
      {...(onClick ? { type: "button" as const, onClick, "aria-label": ariaLabel } : {})}
      className={cn(
        "adm-rise flex min-h-[148px] min-w-0 flex-col p-5 text-left lg:min-h-[164px] lg:p-6",
        hero ? "dash-hero" : "dash-card",
        onClick && "press transition-colors hover:bg-[#1F1F1F] [&.dash-hero]:hover:bg-[#FFDDAA]",
        className,
      )}
      style={{ ["--i" as string]: i }}
    >
      <div className="flex items-start justify-between gap-3">
        <p
          className={cn(
            "min-w-0 text-[15px] lg:text-[16px]",
            hero ? "font-semibold text-[#15130F]/75" : "text-[#A9A9A9]",
          )}
        >
          {label}
        </p>
        <span className="dash-ico">{icon}</span>
      </div>
      <div className="mt-auto min-w-0 pt-3">
        {loading ? (
          <div className={cn("admin-skeleton h-9 w-24 rounded-[12px]", hero && "opacity-40")} />
        ) : (
          <p
            className={cn(
              "truncate leading-none font-bold tracking-[-0.045em] tabular-nums",
              hero ? "text-[clamp(1.9rem,3vw,2.6rem)]" : "text-[clamp(1.5rem,2.3vw,2.05rem)]",
            )}
          >
            {value}
          </p>
        )}
        {foot ? (
          <div
            className={cn(
              "mt-2 min-h-5 truncate text-[13px]",
              hero ? "text-[#15130F]/65" : "text-[#8C8C8C]",
            )}
          >
            {foot}
          </div>
        ) : null}
      </div>
    </Tag>
  );
}

/** Linha de quatro números, como no Início. */
export function PxKpiRow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section className={cn("grid grid-cols-2 gap-3 lg:gap-4 xl:grid-cols-4", className)}>
      {children}
    </section>
  );
}

/** Cartão grande (dash-card) com entrada em cascata. */
export function PxCard({
  children,
  className,
  i = 0,
}: {
  children: ReactNode;
  className?: string;
  i?: number;
}) {
  return (
    <section
      className={cn("dash-card adm-rise flex min-w-0 flex-col", className)}
      style={{ ["--i" as string]: i }}
    >
      {children}
    </section>
  );
}

export function PxCardHead({
  title,
  sub,
  icon,
  children,
}: {
  title: string;
  sub?: ReactNode;
  icon?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-start gap-3 px-5 pt-5 pb-4 lg:px-6 lg:pt-6">
      {icon ? <span className="dash-ico">{icon}</span> : null}
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-[18px] font-bold tracking-[-0.015em]">{title}</h2>
        {sub ? <p className="mt-0.5 text-[13.5px] leading-snug text-[#8C8C8C]">{sub}</p> : null}
      </div>
      {children ? (
        <div className="ml-auto flex shrink-0 items-center gap-1.5">{children}</div>
      ) : null}
    </div>
  );
}

export function PxCardBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("min-w-0 px-5 pb-5 lg:px-6 lg:pb-6", className)}>{children}</div>;
}

/** Bloco interno #232323. */
export function PxTile({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("min-w-0 rounded-[22px] bg-[#232323] p-4", className)}>{children}</div>;
}

/** Número pequeno dentro de um cartão. */
export function PxStat({
  label,
  value,
  note,
  tone,
  className,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  tone?: "gold" | "warning" | "danger" | "good";
  className?: string;
}) {
  return (
    <div className={cn("min-w-0 rounded-[20px] bg-[#232323] p-4", className)}>
      <p className="truncate text-[13px] text-[#A9A9A9]">{label}</p>
      <p
        className={cn(
          "mt-1.5 truncate text-[20px] leading-tight font-bold tracking-[-0.02em] tabular-nums",
          tone === "gold" && "text-[#FFD599]",
          tone === "warning" && "text-[#F5C26B]",
          tone === "danger" && "text-[#FF9A8A]",
          tone === "good" && "text-[#7FCF9F]",
        )}
      >
        {value}
      </p>
      {note ? <p className="mt-1 truncate text-[12px] text-[#8C8C8C]">{note}</p> : null}
    </div>
  );
}

/** Estado de campanha (promoção, combo, cupom). */
const STATUS: Record<string, string> = {
  ativa: "bg-[#17251C] text-[#7FCF9F]",
  ativo: "bg-[#17251C] text-[#7FCF9F]",
  agendada: "bg-[#2A2418] text-[#F5C26B]",
  agendado: "bg-[#2A2418] text-[#F5C26B]",
  pausada: "bg-[#232323] text-[#A9A9A9]",
  pausado: "bg-[#232323] text-[#A9A9A9]",
  encerrada: "bg-[#2A1A18] text-[#FF9A8A]",
  encerrado: "bg-[#2A1A18] text-[#FF9A8A]",
};
export function PxStatus({ status, className }: { status: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-bold first-letter:uppercase",
        STATUS[status] ?? "bg-[#232323] text-[#A9A9A9]",
        className,
      )}
    >
      {status === "ativa" || status === "ativo" ? (
        <span aria-hidden className="size-1.5 rounded-full bg-current" />
      ) : null}
      {status}
    </span>
  );
}

/** Etiqueta neutra (tamanho, visibilidade, escopo). */
export function PxTag({ children, gold }: { children: ReactNode; gold?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex h-7 min-w-0 max-w-full shrink-0 items-center truncate rounded-full px-3 text-[12.5px] font-semibold",
        gold ? "bg-[#FFD599] text-[#15130F]" : "bg-[#232323] text-[#D4D4D4]",
      )}
    >
      {children}
    </span>
  );
}

/** Escolha única em pílula (selecionado = branco). */
export function PxSeg<T extends string | number>({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: ReactNode }>;
  label: string;
  className?: string;
}) {
  return (
    <div
      className={cn("adm-seg [&>button]:min-h-[44px]", className)}
      role="group"
      aria-label={label}
    >
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className="press"
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Marcar/desmarcar (tamanhos de decant). */
export function PxChip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "press h-[48px] min-w-0 flex-1 rounded-full text-[15px] font-bold transition-colors duration-200",
        on ? "bg-white text-[#15130F]" : "bg-[#232323] text-[#A9A9A9] hover:text-white",
      )}
    >
      {children}
    </button>
  );
}

/** Rótulo + campo + dica. */
export function PxField({
  label,
  htmlFor,
  hint,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0 space-y-2", className)}>
      <label htmlFor={htmlFor} className="block text-[14px] font-semibold text-[#D4D4D4]">
        {label}
      </label>
      {children}
      {hint ? <div className="text-[13px] leading-snug text-[#8C8C8C]">{hint}</div> : null}
    </div>
  );
}

/** Campo de texto no estilo do Admin (pílula #232323, foco dourado). */
export const pxInputClass =
  "h-[52px] w-full min-w-0 rounded-[18px] border-0 bg-[#232323] px-4 text-[16px] text-white outline-none placeholder:text-[#6F6F6F] focus:ring-2 focus:ring-[#FFD599]/50 [color-scheme:dark]";

export function PxInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { className, ...rest } = props;
  return (
    <input data-slot="input-group-control" {...rest} className={cn(pxInputClass, className)} />
  );
}

/** Linha com chave liga/desliga. */
export function PxSwitchRow({
  title,
  hint,
  checked,
  onChange,
  className,
}: {
  title: string;
  hint?: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  className?: string;
}) {
  return (
    <label
      className={cn(
        "flex min-w-0 cursor-pointer items-center justify-between gap-4 rounded-[20px] bg-[#232323] px-4 py-3.5",
        className,
      )}
    >
      <span className="min-w-0">
        <span className="block text-[15px] font-semibold">{title}</span>
        {hint ? (
          <span className="mt-0.5 block text-[13px] leading-snug text-[#8C8C8C]">{hint}</span>
        ) : null}
      </span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

/** Ação principal dourada (como "Novo pedido"). */
export function PxPrimary({
  children,
  icon,
  loading,
  className,
  ...p
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon?: ReactNode; loading?: boolean }) {
  return (
    <button
      type="button"
      {...p}
      disabled={p.disabled || loading}
      className={cn(
        "press inline-flex h-[54px] items-center justify-center gap-2 rounded-full bg-[#FFD599] px-7 text-[15px] font-bold text-[#15130F] transition-colors hover:bg-[#FFDDAA] disabled:opacity-40",
        className,
      )}
    >
      {loading ? <Loader2 className="size-[18px] animate-spin" /> : icon}
      {children}
    </button>
  );
}

/** Ação secundária (pílula escura). */
export function PxSecondary({
  children,
  icon,
  className,
  ...p
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon?: ReactNode }) {
  return (
    <button
      type="button"
      {...p}
      className={cn(
        "press inline-flex h-11 items-center justify-center gap-2 rounded-full bg-[#262626] px-5 text-[14px] font-bold text-white transition-colors hover:bg-[#2E2E2E] disabled:opacity-40",
        className,
      )}
    >
      {icon}
      {children}
    </button>
  );
}

/** Folha de baixo com título grande e rodapé fixo para a ação. */
export function PxSheet({
  open,
  onClose,
  title,
  description,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent
        side="bottom"
        className="flex max-h-[92vh] flex-col gap-0 rounded-t-[30px] border-0 bg-[#121212] p-0 text-white sm:mx-auto sm:max-w-[640px]"
      >
        <SheetHeader className="shrink-0 px-5 pt-6 pb-2 text-left sm:px-7">
          <SheetTitle className="text-[26px] leading-tight font-bold tracking-[-0.03em] text-white">
            {title}
          </SheetTitle>
          {description ? (
            <SheetDescription className="text-[14.5px] leading-snug text-[#A9A9A9]">
              {description}
            </SheetDescription>
          ) : (
            <SheetDescription className="sr-only">{title}</SheetDescription>
          )}
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-3 pb-6 sm:px-7">{children}</div>
        {footer ? (
          <div className="shrink-0 border-t border-white/[0.06] bg-[#121212] px-5 pt-3 pb-[calc(env(safe-area-inset-bottom,0px)+16px)] sm:px-7">
            {footer}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

/** Seção de formulário dentro da folha. */
export function PxSection({
  title,
  help,
  children,
  className,
}: {
  title?: string;
  help?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("min-w-0 space-y-3 rounded-[24px] bg-[#1A1A1A] p-4 sm:p-5", className)}>
      {title ? (
        <div className="flex min-w-0 items-center gap-1.5">
          <h3 className="text-[16px] font-bold tracking-[-0.01em]">{title}</h3>
          {help}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** Aviso curto (abaixo do custo, cupom inválido...). */
export function PxNote({
  tone = "muted",
  children,
}: {
  tone?: "muted" | "warning" | "danger" | "good";
  children: ReactNode;
}) {
  return (
    <p
      className={cn(
        "rounded-[18px] px-4 py-3 text-[13.5px] leading-snug",
        tone === "muted" && "bg-[#232323] text-[#A9A9A9]",
        tone === "warning" && "bg-[#2A2418] text-[#F5C26B]",
        tone === "danger" && "bg-[#2A1A18] text-[#FF9A8A]",
        tone === "good" && "bg-[#17251C] text-[#7FCF9F]",
      )}
    >
      {children}
    </p>
  );
}

/**
 * Janela de edição curta (uma regra por vez): ícone + título, prévia dourada
 * com o resultado ao vivo, campos e ações fixas no rodapé. No computador fica
 * no centro da tela; no celular ocupa a largura com margem.
 */
export function PxDialog({
  open,
  onClose,
  icon,
  title,
  description,
  preview,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  icon?: ReactNode;
  title: string;
  description?: string;
  preview?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** janela larga (várias regras lado a lado) */
  wide?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        className={cn(
          "flex max-h-[calc(100svh-2rem)] flex-col gap-0 overflow-hidden rounded-[32px] border-0 bg-[#121212] p-0 text-white sm:p-0 [&>button:last-child]:top-6 [&>button:last-child]:right-6 [&>button:last-child]:grid [&>button:last-child]:size-10 [&>button:last-child]:place-items-center [&>button:last-child]:rounded-full [&>button:last-child]:bg-[#232323] [&>button:last-child]:opacity-100",
          wide ? "max-w-[920px]" : "max-w-[540px]",
        )}
      >
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="flex min-w-0 items-center gap-3 px-6 pt-6 pr-20">
            {icon ? <span className="dash-ico">{icon}</span> : null}
            <div className="min-w-0">
              <DialogTitle className="text-[24px] leading-tight font-bold tracking-[-0.03em] text-white">
                {title}
              </DialogTitle>
              <DialogDescription
                className={cn("text-[14px] leading-snug text-[#A9A9A9]", !description && "sr-only")}
              >
                {description ?? title}
              </DialogDescription>
            </div>
          </div>
          {preview ? <div className="px-6 pt-5">{preview}</div> : null}
          <div className="min-w-0 space-y-4 px-6 pt-5 pb-6">{children}</div>
        </div>
        {footer ? (
          <div className="shrink-0 border-t border-white/[0.06] px-6 pt-4 pb-[calc(env(safe-area-inset-bottom,0px)+20px)]">
            {footer}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** Prévia dourada do resultado de uma regra (como o cartão principal do Início). */
export function PxPreview({
  label,
  value,
  foot,
}: {
  label: string;
  value: ReactNode;
  foot?: ReactNode;
}) {
  return (
    <div className="dash-hero min-w-0 p-5">
      <p className="text-[14px] font-semibold text-[#15130F]/70">{label}</p>
      <div className="mt-2 text-[34px] leading-none font-bold tracking-[-0.045em] tabular-nums">
        {value}
      </div>
      {foot ? <p className="mt-2 text-[13.5px] leading-snug text-[#15130F]/70">{foot}</p> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Criação em passos (promoção, cupom, combo): uma pergunta por vez à
 * esquerda e, à direita, a prévia do que o cliente vê + o resumo, que
 * mudam enquanto se digita. No celular a prévia fica no topo, compacta.
 * ------------------------------------------------------------------ */

export type PxStep = { key: string; label: string; hint?: string };

export function PxWizard({
  open,
  onClose,
  title,
  steps,
  step,
  onStep,
  preview,
  summary,
  children,
  onNext,
  canNext = true,
  finishLabel,
  busy,
  freeNav,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  steps: PxStep[];
  step: number;
  onStep: (i: number) => void;
  preview: ReactNode;
  summary?: Array<{ label: string; value: ReactNode }>;
  children: ReactNode;
  /** chamado no último passo */
  onNext: () => void;
  /** o passo atual está completo */
  canNext?: boolean;
  finishLabel: string;
  busy?: boolean;
  /** edição: pode pular entre passos à vontade */
  freeNav?: boolean;
}) {
  const last = step === steps.length - 1;
  const current = steps[step]!;
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="flex max-h-[calc(100svh-2rem)] max-w-[980px] flex-col gap-0 overflow-hidden rounded-[32px] border-0 bg-[#121212] p-0 text-white sm:p-0 lg:grid lg:grid-cols-[minmax(0,1fr)_380px] [&>button:last-child]:top-5 [&>button:last-child]:right-5 [&>button:last-child]:grid [&>button:last-child]:size-10 [&>button:last-child]:place-items-center [&>button:last-child]:rounded-full [&>button:last-child]:bg-[#232323] [&>button:last-child]:opacity-100">
        {/* coluna do formulário */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col lg:max-h-[calc(100svh-2rem)]">
          <div className="shrink-0 px-6 pt-6 pr-20 lg:pr-6">
            <DialogTitle className="text-[26px] leading-tight font-bold tracking-[-0.03em] text-white">
              {title}
            </DialogTitle>
            <DialogDescription className="sr-only">{title}</DialogDescription>

            {/* passos: barra de progresso + nomes */}
            <ol
              className="mt-4 grid gap-2"
              style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}
            >
              {steps.map((s, i) => {
                const done = i < step;
                const on = i === step;
                const reachable = freeNav || i <= step;
                return (
                  <li key={s.key} className="min-w-0">
                    <button
                      type="button"
                      disabled={!reachable}
                      onClick={() => onStep(i)}
                      className="group w-full min-w-0 text-left disabled:cursor-default"
                      aria-current={on ? "step" : undefined}
                    >
                      <span className="block h-1.5 overflow-hidden rounded-full bg-[#2A2A2A]">
                        <span
                          className="block h-full rounded-full bg-[#FFD599] transition-[width] duration-[var(--motion-standard)] ease-[var(--ease-orium)]"
                          style={{ width: done || on ? "100%" : "0%" }}
                        />
                      </span>
                      <span
                        className={cn(
                          "mt-2 block truncate text-[12.5px] font-semibold transition-colors",
                          on
                            ? "text-white"
                            : done
                              ? "text-[#A9A9A9] group-hover:text-white"
                              : "text-[#5F5F5F]",
                        )}
                      >
                        {s.label}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>

          {/* prévia compacta no celular */}
          <div className="shrink-0 px-6 pt-4 lg:hidden">{preview}</div>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-6 pb-6">
            <div key={current.key} className="ord-slide min-w-0 space-y-5">
              <div>
                <p className="text-[13px] font-semibold text-[#8C8C8C]">
                  Passo {step + 1} de {steps.length}
                </p>
                <h3 className="mt-0.5 text-[21px] leading-tight font-bold tracking-[-0.02em]">
                  {current.label}
                </h3>
                {current.hint ? (
                  <p className="mt-1 text-[14px] leading-snug text-[#A9A9A9]">{current.hint}</p>
                ) : null}
              </div>
              {children}
            </div>
          </div>

          <div className="flex shrink-0 gap-2 border-t border-white/[0.06] px-6 pt-4 pb-[calc(env(safe-area-inset-bottom,0px)+20px)]">
            {step > 0 ? (
              <PxSecondary className="h-[54px] px-6" onClick={() => onStep(step - 1)}>
                Voltar
              </PxSecondary>
            ) : (
              <PxSecondary className="h-[54px] px-6" onClick={onClose}>
                Cancelar
              </PxSecondary>
            )}
            <PxPrimary
              className="flex-1"
              loading={busy}
              disabled={!canNext}
              onClick={() => (last ? onNext() : onStep(step + 1))}
            >
              {last ? finishLabel : "Continuar"}
            </PxPrimary>
          </div>
        </div>

        {/* coluna da prévia (computador) */}
        <aside className="hidden min-h-0 flex-col gap-4 overflow-y-auto bg-[#0C0C0C] p-6 pt-20 lg:flex">
          <p className="text-[13px] font-semibold text-[#8C8C8C]">Como o cliente vê</p>
          {preview}
          {summary?.length ? (
            <div className="rounded-[22px] bg-[#1A1A1A] p-4">
              <p className="mb-2 text-[13px] font-semibold text-[#8C8C8C]">Resumo</p>
              <dl className="space-y-2">
                {summary.map((r) => (
                  <div
                    key={r.label}
                    className="flex min-w-0 items-baseline justify-between gap-3 text-[14px]"
                  >
                    <dt className="shrink-0 text-[#A9A9A9]">{r.label}</dt>
                    <dd className="min-w-0 truncate text-right font-semibold">{r.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}
        </aside>
      </DialogContent>
    </Dialog>
  );
}

/** Atalhos de valor (10%, 15%...; 7 dias...). O selecionado fica branco. */
export function PxQuick<T extends string | number>({
  options,
  value,
  onPick,
}: {
  options: Array<{ value: T; label: ReactNode }>;
  value: T | null | undefined;
  onPick: (v: T) => void;
}) {
  return (
    <div className="flex min-w-0 flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onPick(o.value)}
          className={cn(
            "press h-10 shrink-0 rounded-full px-4 text-[14px] font-bold tabular-nums transition-colors duration-200",
            value === o.value
              ? "bg-white text-[#15130F]"
              : "bg-[#232323] text-[#D4D4D4] hover:bg-[#2C2C2C]",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Valor de input datetime-local daqui a N dias, às 23:59 (relógio do aparelho). */
export function pxEndInDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T23:59`;
}

/** "17/11 às 23:59" a partir do valor de um input datetime-local. */
export function pxShortDate(v: string): string {
  if (!v) return "";
  const [date, time] = v.split("T");
  const [, m, d] = (date ?? "").split("-");
  return `${d}/${m}${time ? ` às ${time}` : ""}`;
}
