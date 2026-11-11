import { useState, type ReactNode } from "react";
import { ChevronDown, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/* ------------------------------------------------------------------ *
 * Peças compartilhadas do Admin. Objetivo: uma única linguagem visual
 * (espaçamento 4/8/12/16/20/24/32, dourado só como acento, estados com
 * cores fixas) e progressive disclosure — detalhe só quando pedido.
 * Nenhuma regra de negócio vive aqui.
 * ------------------------------------------------------------------ */

/** Estados funcionais: âmbar = espera, verde = concluído, vermelho = erro. */
const STATUS_TONE: Record<string, string> = {
  pendente: "bg-[#2A2418] text-[#F5C26B]",
  aguardando: "bg-[#2A2418] text-[#F5C26B]",
  "pedido feito": "bg-[#FFD599] text-[#15130F]",
  "em rota": "bg-[#FFD599] text-[#15130F]",
  entregue: "bg-[#17251C] text-[#7FCF9F]",
  confirmado: "bg-[#17251C] text-[#7FCF9F]",
  ok: "bg-[#17251C] text-[#7FCF9F]",
  cancelado: "bg-[#2A1A18] text-[#FF9A8A]",
  erro: "bg-[#2A1A18] text-[#FF9A8A]",
};

export function AdminStatus({ status, className }: { status: string; className?: string }) {
  const tone = STATUS_TONE[status.toLowerCase()] ?? "bg-[#232323] text-[#A9A9A9]";
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-[12px] leading-5 font-bold first-letter:uppercase",
        tone,
        className,
      )}
    >
      {status}
    </span>
  );
}

/** Bloco de conteúdo: rótulo curto + corpo. Usado em listas e detalhes. */
export function AdminBlock({
  title,
  action,
  children,
  className,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("min-w-0", className)}>
      {title || action ? (
        <div className="mb-3 flex min-w-0 items-center justify-between gap-3">
          {title ? (
            <h2 className="truncate text-[17px] font-bold tracking-[-0.01em] text-white">
              {title}
            </h2>
          ) : (
            <span />
          )}
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** Cartão neutro do Admin: borda discreta, radius e padding padronizados. */
export function AdminCard({
  children,
  className,
  as: As = "div",
}: {
  children: ReactNode;
  className?: string;
  as?: "div" | "article" | "li";
}) {
  return (
    <As className={cn("rounded-[22px] bg-[#1A1A1A] p-4", className)}>{children}</As>
  );
}

export type AdminAction = {
  label: string;
  onSelect?: () => void;
  href?: string;
  icon?: ReactNode;
  danger?: boolean;
  /** insere um separador antes deste item */
  separated?: boolean;
};

/**
 * Menu "⋯": no celular abre bottom sheet com alvos grandes; no desktop,
 * dropdown. Ações perigosas ficam sempre aqui, nunca ao lado das principais.
 */
export function AdminMore({
  actions,
  label = "Mais opções",
  trigger,
  align = "end",
}: {
  actions: AdminAction[];
  label?: string;
  trigger?: ReactNode;
  align?: "start" | "end";
}) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const items = actions.filter(Boolean);
  if (items.length === 0) return null;

  const defaultTrigger = (
    <button
      type="button"
      className="press grid size-10 shrink-0 place-items-center rounded-full text-[#A9A9A9] transition-colors hover:bg-white/[0.06] hover:text-white"
      aria-label={label}
    >
      <MoreHorizontal className="size-4" strokeWidth={1.75} />
    </button>
  );

  if (isMobile) {
    return (
      <>
        <span onClick={() => setOpen(true)}>{trigger ?? defaultTrigger}</span>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent side="bottom" className="rounded-t-[28px] border-0 bg-[#121212] px-4 pt-5 pb-[calc(env(safe-area-inset-bottom,0px)+16px)]">
            <SheetHeader className="px-1 text-left">
              <SheetTitle className="text-[17px] font-bold">{label}</SheetTitle>
            </SheetHeader>
            <div className="mt-3 flex flex-col overflow-hidden rounded-[20px] bg-[#1A1A1A]">
              {items.map((a, i) =>
                a.href ? (
                  <a
                    key={i}
                    href={a.href}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => setOpen(false)}
                    className="flex min-h-[52px] items-center gap-3 border-t border-white/[0.06] px-4 text-[15px] font-semibold first:border-t-0 [&_svg]:size-[18px] [&_svg]:text-[#A9A9A9]"
                  >
                    {a.icon}
                    {a.label}
                  </a>
                ) : (
                  <button
                    key={i}
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      a.onSelect?.();
                    }}
                    className={cn(
                      "flex min-h-[52px] items-center gap-3 border-t border-white/[0.06] px-4 text-left text-[15px] font-semibold first:border-t-0 [&_svg]:size-[18px] [&_svg]:text-[#A9A9A9]",
                      a.danger && "text-[#FF9A8A] [&_svg]:text-[#FF9A8A]",
                    )}
                  >
                    {a.icon}
                    {a.label}
                  </button>
                ),
              )}
            </div>
          </SheetContent>
        </Sheet>
      </>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger ?? defaultTrigger}</DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="w-56">
        {items.map((a, i) => (
          <div key={i}>
            {a.separated ? <DropdownMenuSeparator /> : null}
            {a.href ? (
              <DropdownMenuItem asChild>
                <a href={a.href} target="_blank" rel="noreferrer">
                  {a.icon}
                  {a.label}
                </a>
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onClick={a.onSelect} className={cn(a.danger && "text-destructive")}>
                {a.icon}
                {a.label}
              </DropdownMenuItem>
            )}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Confirmação curta: título, uma linha e dois botões. Sem texto técnico. */
export function AdminConfirm({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirmar",
  danger,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-32px)] max-w-sm rounded-[28px] p-6">
        <DialogHeader className="text-left">
          <DialogTitle className="text-[20px] leading-tight font-bold tracking-[-0.02em]">{title}</DialogTitle>
          {description ? <DialogDescription className="text-[15px] leading-snug text-[#A9A9A9]">{description}</DialogDescription> : null}
        </DialogHeader>
        <DialogFooter className="mt-3 flex-row gap-2 sm:space-x-0">
          <Button
            variant="ghost"
            className="h-12 flex-1 rounded-full bg-[#1F1F1F] text-[15px] font-bold text-white hover:bg-[#262626] hover:text-white"
            onClick={() => onOpenChange(false)}
          >
            Cancelar
          </Button>
          <Button
            variant={danger ? "destructive" : "default"}
            className={cn("h-12 flex-1 rounded-full text-[15px] font-bold", danger && "bg-[#FF9A8A] text-[#2A1210] hover:bg-[#FFB0A3]")}
            onClick={() => {
              onOpenChange(false);
              onConfirm();
            }}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Estado vazio de uma linha. Sem blocos gigantes. */
export function AdminEmpty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-[22px] bg-[#161616] px-5 py-10 text-center text-[15px] leading-relaxed text-[#A9A9A9]">
      {children}
    </p>
  );
}

/** Skeleton contextual: mesma altura da linha real, nunca "0". */
export function AdminRowsSkeleton({ rows = 4, height = 92 }: { rows?: number; height?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="admin-skeleton rounded-[22px]"
          style={{ height, animationDelay: `${i * 60}ms` }}
        />
      ))}
    </div>
  );
}

/** Informação avançada (IDs, logs, payloads) recolhida por padrão. */
export function AdminTechDetails({ label = "Detalhes técnicos", children }: { label?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-[20px] bg-[#161616]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-12 w-full items-center justify-between gap-3 px-4 text-left text-[14px] font-semibold text-[#A9A9A9]"
      >
        {label}
        <ChevronDown className={cn("size-4 transition-transform duration-150", open && "rotate-180")} />
      </button>
      {open ? <div className="border-t border-white/[0.06] px-4 py-3 text-[13px] text-[#A9A9A9]">{children}</div> : null}
    </div>
  );
}

/** Par rótulo/valor alinhado, para blocos de detalhe. */
export function AdminKV({ label, value, strong }: { label: string; value: ReactNode; strong?: boolean }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-3 py-1">
      <span className="shrink-0 text-[14px] text-[#A9A9A9]">{label}</span>
      <span className={cn("min-w-0 text-right text-[14px] font-semibold text-white tabular-nums", strong && "font-bold")}>{value}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Sistema de ações do Admin. Hierarquia fixa:
 *  primário (dourado, 1 por tela) · secundário (grafite chapado)
 *  terciário (texto/ícone) · overflow "⋯" para ocasionais/destrutivas.
 * Mobile: primário largura total → secundários largura total →
 *  linha de complementares em grid. md+: linha única, secundários à
 *  esquerda do grupo e primário sempre por último, à direita.
 * Altura única 48px, gap 8px, radius pill, ícones 18px — como na loja.
 * ------------------------------------------------------------------ */

const ACTION_BASE =
  "press inline-flex h-12 min-w-0 items-center justify-center gap-2 rounded-full px-5 text-[15px] font-bold whitespace-nowrap transition-[background-color,color,opacity,transform] duration-200 disabled:pointer-events-none disabled:opacity-45 [&_svg]:size-[18px] [&_svg]:shrink-0";

type ActionBtnProps = {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  loading?: boolean;
  icon?: ReactNode;
  className?: string;
  "aria-label"?: string;
};

export function AdminPrimaryAction({ children, icon, loading, className, ...p }: ActionBtnProps) {
  return (
    <button
      type="button"
      {...p}
      disabled={p.disabled || loading}
      aria-busy={loading || undefined}
      className={cn(ACTION_BASE, "bg-[#FFD599] text-[#15130F] hover:bg-[#FFDDAA]", className)}
    >
      {icon}
      <span className="truncate">{children}</span>
    </button>
  );
}

export function AdminSecondaryAction({ children, icon, loading, className, ...p }: ActionBtnProps) {
  return (
    <button
      type="button"
      {...p}
      disabled={p.disabled || loading}
      aria-busy={loading || undefined}
      className={cn(ACTION_BASE, "adm-btn-2 bg-[#1F1F1F] text-white hover:bg-[#262626]", className)}
    >
      {icon}
      <span className="truncate">{children}</span>
    </button>
  );
}

export function AdminTertiaryAction({ children, icon, className, ...p }: ActionBtnProps) {
  return (
    <button
      type="button"
      {...p}
      className={cn(ACTION_BASE, "px-4 text-[#A9A9A9] hover:bg-white/[0.06] hover:text-white", className)}
    >
      {icon}
      <span className="truncate">{children}</span>
    </button>
  );
}

/** "Mais ···" com rótulo visível — ações ocasionais e destrutivas. */
export function AdminOverflowMenu({
  actions,
  label = "Mais",
  title = "Mais opções",
  className,
}: {
  actions: AdminAction[];
  label?: string;
  title?: string;
  className?: string;
}) {
  if (!actions.length) return null;
  return (
    <AdminMore
      label={title}
      actions={actions}
      trigger={
        <button
          type="button"
          aria-label={title}
          className={cn(ACTION_BASE, "w-full bg-[#1F1F1F] text-white hover:bg-[#262626] md:w-auto md:px-4", className)}
        >
          <span>{label}</span>
          <MoreHorizontal strokeWidth={1.75} />
        </button>
      }
    />
  );
}

/**
 * Barra de ações padrão. Passe os botões já montados; a barra decide
 * a disposição por largura. `complementary` = terciários (até 1) + overflow.
 */
export function AdminActionBar({
  primary,
  secondary,
  complementary,
  more,
  className,
}: {
  primary?: ReactNode;
  secondary?: ReactNode;
  complementary?: ReactNode;
  more?: AdminAction[];
  className?: string;
}) {
  const hasMore = !!more?.length;
  return (
    <div
      className={cn(
        "grid w-full min-w-0 grid-cols-1 gap-2 md:flex md:w-auto md:flex-wrap md:items-center md:justify-end",
        "[&>*]:w-full md:[&>*]:w-auto",
        className,
      )}
    >
      {/* Ordem visual: mobile = primário primeiro; md+ = primário à direita. */}
      {primary ? <div className="contents [&>*]:w-full md:order-last md:[&>*]:w-auto">{primary}</div> : null}
      {secondary ? <div className="contents [&>*]:w-full md:[&>*]:w-auto">{secondary}</div> : null}
      {complementary || hasMore ? (
        <div className={cn("grid min-w-0 gap-2 md:order-first md:flex md:items-center", complementary && hasMore ? "grid-cols-2" : "grid-cols-1")}>
          {complementary}
          {hasMore ? <AdminOverflowMenu actions={more!} /> : null}
        </div>
      ) : null}
    </div>
  );
}

/** Cabeçalho de seção dentro da página: título + barra de ações. */
export function AdminPageHeader({
  title,
  description,
  actions,
  className,
}: {
  title?: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-3 md:flex-row md:items-center md:justify-between", className)}>
      <div className="min-w-0">
        {title ? <h2 className="truncate text-[17px] font-bold tracking-[-0.01em] text-white">{title}</h2> : null}
        {description ? <p className="mt-0.5 text-[14px] text-[#A9A9A9]">{description}</p> : null}
      </div>
      {actions}
    </div>
  );
}
