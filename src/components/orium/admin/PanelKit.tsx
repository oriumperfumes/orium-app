import { forwardRef, useEffect, useMemo, useRef, useState, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";
import { Camera, Check, ChevronDown, ImagePlus, Loader2, Plus, Search, Trash2, X } from "lucide-react";
import { PillTrack } from "@/components/orium/admin/motion";
import { PanelClose } from "@/components/orium/admin/orders/model";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ *
 * PEÇAS DAS JANELAS DO ADMIN (Produtos, Negociação, Adicionar produto)
 *
 * Mesma linguagem do Início e dos Pedidos: painel #121212, cartões
 * #1A1A1A arredondados, controles #232323 que clareiam no foco, branco =
 * selecionado, dourado só na ação principal. Movimento só com
 * --ease-orium (classes .ui-* / .pk-* em styles.css).
 * ------------------------------------------------------------------ */

/* ── topo da janela ─────────────────────────────────────────────── */

export function PanelHeader({
  image,
  fallback,
  title,
  subtitle,
  onClose,
  right,
  children,
}: {
  image?: string | null;
  fallback?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  right?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="shrink-0 px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-3 lg:px-6 lg:pt-6">
      <div className="flex min-w-0 items-center gap-3.5">
        {image !== undefined ? (
          <span className="pk-thumb grid size-14 shrink-0 place-items-center overflow-hidden rounded-[18px] bg-[#1F1F1F] text-[#6F6F6F]">
            {image ? <img src={image} alt="" className="size-full object-cover" /> : (fallback ?? <ImagePlus className="size-5" />)}
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[20px] leading-tight font-bold tracking-[-0.025em]">{title}</h2>
          {subtitle ? <div className="mt-1 truncate text-[13.5px] text-[#8C8C8C]">{subtitle}</div> : null}
        </div>
        {right}
        <PanelClose onClose={onClose} />
      </div>
      {children}
    </header>
  );
}

/** Abas com a pílula branca que desliza (mesma do Início). */
export function PanelTabs<T extends string>({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: Array<{ key: T; label: string; badge?: ReactNode }>;
  value: T;
  onChange: (t: T) => void;
  className?: string;
}) {
  return (
    <div className={cn("-mx-5 overflow-x-auto px-5 [scrollbar-width:none] lg:-mx-6 lg:px-6", className)}>
      <PillTrack activeKey={value} label="Seções" className="flex w-max gap-1 rounded-full bg-[#1A1A1A] p-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            aria-pressed={value === t.key}
            onClick={() => onChange(t.key)}
            className={cn(
              "press relative z-[1] inline-flex h-10 items-center gap-1.5 rounded-full px-4 text-[14px] font-semibold whitespace-nowrap transition-colors duration-200",
              value === t.key ? "text-[#15130F]" : "text-[#A9A9A9] hover:text-white",
            )}
          >
            {t.label}
            {t.badge}
          </button>
        ))}
      </PillTrack>
    </div>
  );
}

/** Corpo rolável da janela; troca de aba entra suave. */
export function PanelScroll({ children, swapKey, className }: { children: ReactNode; swapKey?: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: 0 });
  }, [swapKey]);
  return (
    <div ref={ref} className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-6 lg:px-6", className)}>
      <div key={swapKey} className="ui-view-in min-w-0 space-y-3">
        {children}
      </div>
    </div>
  );
}

export function PanelFooter({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <footer
      className={cn(
        "pk-footer flex shrink-0 items-center gap-2 border-t border-white/[0.06] bg-[#121212] px-5 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] lg:px-6 lg:pb-5",
        className,
      )}
    >
      {children}
    </footer>
  );
}

/* ── botões ─────────────────────────────────────────────────────── */

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean; icon?: ReactNode };

export function GoldButton({ loading, icon, children, className, disabled, ...p }: BtnProps) {
  return (
    <button
      type="button"
      {...p}
      disabled={disabled || loading}
      className={cn(
        "press inline-flex h-[52px] min-w-0 items-center justify-center gap-2 rounded-full bg-[#FFD599] px-6 text-[15px] font-bold text-[#15130F] transition-[background-color,opacity] duration-200 hover:bg-[#FFDDAA] disabled:opacity-40",
        className,
      )}
    >
      {loading ? <Loader2 className="size-[18px] animate-spin" /> : icon}
      <span className="truncate">{children}</span>
    </button>
  );
}

export function SoftButton({ loading, icon, children, className, disabled, ...p }: BtnProps) {
  return (
    <button
      type="button"
      {...p}
      disabled={disabled || loading}
      className={cn(
        "press inline-flex h-[52px] min-w-0 items-center justify-center gap-2 rounded-full bg-[#1F1F1F] px-5 text-[15px] font-semibold text-white transition-colors duration-200 hover:bg-[#2A2A2A] disabled:opacity-40 [&_svg]:size-[18px]",
        className,
      )}
    >
      {loading ? <Loader2 className="animate-spin" /> : icon}
      {children ? <span className="truncate">{children}</span> : null}
    </button>
  );
}

/* ── cartões e campos ───────────────────────────────────────────── */

export function PanelCard({
  title,
  hint,
  icon,
  right,
  children,
  className,
  tone = "card",
}: {
  title?: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  right?: ReactNode;
  children?: ReactNode;
  className?: string;
  tone?: "card" | "flat";
}) {
  return (
    <section className={cn("min-w-0 rounded-[24px] p-4 sm:p-5", tone === "card" ? "bg-[#1A1A1A]" : "border border-white/[0.07]", className)}>
      {title || right ? (
        <div className="mb-4 flex min-w-0 items-start gap-3">
          {icon ? <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[#232323] text-[#D4D4D4] [&_svg]:size-[17px]">{icon}</span> : null}
          <div className="min-w-0 flex-1">
            {title ? <h3 className="text-[16px] leading-tight font-bold tracking-[-0.01em]">{title}</h3> : null}
            {hint ? <p className="mt-1 text-[13px] leading-snug text-[#8C8C8C]">{hint}</p> : null}
          </div>
          {right}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function Field({
  label,
  hint,
  children,
  className,
  htmlFor,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
  htmlFor?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <label htmlFor={htmlFor} className="mb-2 block text-[13px] font-semibold text-[#A9A9A9]">
        {label}
      </label>
      {children}
      {hint ? <p className="mt-1.5 text-[12.5px] leading-snug text-[#6F6F6F]">{hint}</p> : null}
    </div>
  );
}

const fieldCls =
  "pk-field w-full min-w-0 rounded-[16px] bg-[#232323] px-4 text-[16px] text-white outline-none transition-colors duration-200 placeholder:text-[#6F6F6F] hover:bg-[#262626] focus:bg-[#2A2A2A] disabled:opacity-50";

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { prefix?: string; suffix?: string }>(
  function TextInput({ className, prefix, suffix, ...p }, ref) {
    if (!prefix && !suffix) return <input ref={ref} {...p} className={cn(fieldCls, "h-12", className)} />;
    return (
      <div className="relative min-w-0">
        {prefix ? <span className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-[15px] font-semibold text-[#8C8C8C]">{prefix}</span> : null}
        <input ref={ref} {...p} className={cn(fieldCls, "h-12 tabular-nums", prefix && "pl-11", suffix && "pr-12", className)} />
        {suffix ? <span className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 text-[14px] text-[#8C8C8C]">{suffix}</span> : null}
      </div>
    );
  },
);

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function TextArea(
  { className, ...p },
  ref,
) {
  return <textarea ref={ref} {...p} className={cn(fieldCls, "min-h-[112px] resize-y py-3 leading-relaxed", className)} />;
});

/** Escolha única em pílulas (branco = escolhido), com a pílula deslizando. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  full,
  disabled,
}: {
  options: Array<{ value: T; label: ReactNode }>;
  value: T | null | undefined;
  onChange: (v: T) => void;
  full?: boolean;
  disabled?: boolean;
}) {
  return (
    <PillTrack
      activeKey={value ?? "none"}
      className={cn("flex max-w-full gap-1 overflow-x-auto rounded-full bg-[#232323] p-1 [scrollbar-width:none]", full ? "w-full" : "w-max", disabled && "pointer-events-none opacity-50")}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "press relative z-[1] inline-flex h-10 min-w-0 items-center justify-center gap-1.5 rounded-full px-4 text-[14px] font-semibold whitespace-nowrap transition-colors duration-200 [&_svg]:size-4",
            full && "flex-1",
            value === o.value ? "text-[#15130F]" : "text-[#A9A9A9] hover:text-white",
          )}
        >
          {o.label}
        </button>
      ))}
    </PillTrack>
  );
}

/** Cartões grandes de escolha (ícone, nome e uma linha de explicação). */
export function ChoiceCards<T extends string>({
  options,
  value,
  onChange,
  columns = 3,
}: {
  options: Array<{ value: T; label: string; hint?: string; icon?: ReactNode }>;
  value: T;
  onChange: (v: T) => void;
  columns?: 2 | 3;
}) {
  return (
    <div role="radiogroup" className={cn("grid gap-2", columns === 3 ? "grid-cols-3" : "grid-cols-2")}>
      {options.map((o) => {
        const on = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={cn(
              "pk-choice press relative flex min-w-0 flex-col items-start gap-2 rounded-[20px] p-3.5 text-left",
              on ? "bg-white text-[#15130F]" : "bg-[#232323] text-white hover:bg-[#2A2A2A]",
            )}
          >
            {o.icon ? (
              <span className={cn("grid size-9 place-items-center rounded-full [&_svg]:size-[18px]", on ? "bg-[#15130F] text-[#FFD599]" : "bg-[#2E2E2E] text-[#D4D4D4]")}>
                {o.icon}
              </span>
            ) : null}
            <span className="block text-[14.5px] leading-tight font-bold">{o.label}</span>
            {o.hint ? <span className={cn("block text-[12px] leading-snug", on ? "text-[#15130F]/65" : "text-[#8C8C8C]")}>{o.hint}</span> : null}
            <span
              aria-hidden
              className={cn(
                "absolute top-3 right-3 grid size-5 place-items-center rounded-full transition-[transform,opacity] duration-300",
                on ? "scale-100 bg-[#15130F] text-white opacity-100" : "scale-50 opacity-0",
              )}
            >
              <Check className="size-3" strokeWidth={3} />
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Interruptor (sim/não) em linha, com título e explicação curta. */
export function ToggleRow({
  label,
  hint,
  checked,
  onChange,
  disabled,
  icon,
}: {
  label: ReactNode;
  hint?: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  icon?: ReactNode;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="press flex w-full min-w-0 items-center gap-3 rounded-[18px] px-1 py-2 text-left disabled:opacity-50"
    >
      {icon ? <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[#232323] text-[#D4D4D4] [&_svg]:size-[17px]">{icon}</span> : null}
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] leading-tight font-semibold">{label}</span>
        {hint ? <span className="mt-0.5 block text-[12.5px] leading-snug text-[#8C8C8C]">{hint}</span> : null}
      </span>
      <span aria-hidden className={cn("pk-switch relative h-7 w-12 shrink-0 rounded-full", checked ? "bg-[#FFD599]" : "bg-[#333]")}>
        <span className={cn("pk-knob absolute top-1 left-1 size-5 rounded-full", checked ? "translate-x-5 bg-[#15130F]" : "bg-[#BDBDBD]")} />
      </span>
    </button>
  );
}

/** Pílulas de atalho (ex.: "EDP", "Praticamente cheio"). */
export function QuickChips({
  options,
  value,
  onPick,
}: {
  options: string[];
  value: string;
  onPick: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = value.trim().toLowerCase() === o.toLowerCase();
        return (
          <button
            key={o}
            type="button"
            aria-pressed={on}
            onClick={() => onPick(o)}
            className={cn(
              "press h-9 rounded-full px-3.5 text-[13px] font-semibold transition-colors duration-200",
              on ? "bg-white text-[#15130F]" : "bg-[#232323] text-[#A9A9A9] hover:bg-[#2A2A2A] hover:text-white",
            )}
          >
            {o}
          </button>
        );
      })}
    </div>
  );
}

/* ── marca ─────────────────────────────────────────────────────── */

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

/**
 * Marca: mostra a escolhida; tocar abre a busca. Se a marca não existe,
 * oferece "Criar marca …" (o servidor cria na hora de salvar).
 */
export function BrandPicker({
  brands,
  brandId,
  newBrandName,
  onChange,
  allowEmpty,
}: {
  brands: Array<{ id: string; canonical_name: string }>;
  brandId: string | null;
  newBrandName: string;
  onChange: (v: { brandId: string | null; newBrandName: string }) => void;
  allowEmpty?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const current = brands.find((b) => b.id === brandId)?.canonical_name ?? (newBrandName.trim() || null);

  const list = useMemo(() => {
    const t = norm(term);
    const found = t ? brands.filter((b) => norm(b.canonical_name).includes(t)) : brands;
    // começa com o termo primeiro
    return [...found].sort((a, b) => Number(norm(b.canonical_name).startsWith(t)) - Number(norm(a.canonical_name).startsWith(t))).slice(0, 30);
  }, [brands, term]);
  const exact = brands.some((b) => norm(b.canonical_name) === norm(term));

  if (!open)
    return (
      <button
        type="button"
        onClick={() => {
          setTerm("");
          setOpen(true);
        }}
        className="press flex h-12 w-full min-w-0 items-center gap-3 rounded-[16px] bg-[#232323] px-4 text-left transition-colors duration-200 hover:bg-[#2A2A2A]"
      >
        <span className={cn("min-w-0 flex-1 truncate text-[16px]", current ? "font-semibold text-white" : "text-[#6F6F6F]")}>
          {current ?? "Escolher marca"}
        </span>
        {!brandId && newBrandName.trim() ? <span className="shrink-0 rounded-full bg-[#2E2E2E] px-2 py-0.5 text-[11px] font-bold text-[#FFD599]">nova</span> : null}
        <ChevronDown className="size-4 shrink-0 text-[#8C8C8C]" />
      </button>
    );

  const pick = (v: { brandId: string | null; newBrandName: string }) => {
    onChange(v);
    setOpen(false);
  };

  return (
    <div className="adm-pop overflow-hidden rounded-[18px] bg-[#232323]">
      <div className="flex items-center gap-2 px-4">
        <Search className="size-4 shrink-0 text-[#8C8C8C]" />
        <input
          ref={inputRef}
          autoFocus
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
            if (e.key === "Enter") {
              e.preventDefault();
              const first = list[0];
              if (first && norm(first.canonical_name).startsWith(norm(term))) pick({ brandId: first.id, newBrandName: "" });
              else if (term.trim()) pick({ brandId: null, newBrandName: term.trim() });
            }
          }}
          placeholder="Procurar marca…"
          className="pk-field h-12 min-w-0 flex-1 bg-transparent text-[16px] text-white outline-none placeholder:text-[#6F6F6F]"
        />
        <button type="button" onClick={() => setOpen(false)} aria-label="Fechar busca de marca" className="press grid size-8 place-items-center rounded-full text-[#8C8C8C] hover:bg-white/[0.06] hover:text-white">
          <X className="size-4" />
        </button>
      </div>
      <div className="max-h-60 overflow-y-auto overscroll-contain border-t border-white/[0.06] p-1.5">
        {term.trim() && !exact ? (
          <button
            type="button"
            onClick={() => pick({ brandId: null, newBrandName: term.trim() })}
            className="press flex h-11 w-full items-center gap-2.5 rounded-[12px] px-3 text-left text-[14.5px] font-semibold text-[#FFD599] hover:bg-white/[0.05]"
          >
            <Plus className="size-4" /> Criar marca “{term.trim()}”
          </button>
        ) : null}
        {allowEmpty ? (
          <button
            type="button"
            onClick={() => pick({ brandId: null, newBrandName: "" })}
            className="press flex h-11 w-full items-center rounded-[12px] px-3 text-left text-[14.5px] text-[#A9A9A9] hover:bg-white/[0.05]"
          >
            Sem marca
          </button>
        ) : null}
        {list.map((b) => (
          <button
            key={b.id}
            type="button"
            onClick={() => pick({ brandId: b.id, newBrandName: "" })}
            className={cn(
              "press flex h-11 w-full items-center gap-2 rounded-[12px] px-3 text-left text-[14.5px] hover:bg-white/[0.05]",
              b.id === brandId ? "font-bold text-white" : "text-[#D4D4D4]",
            )}
          >
            <span className="min-w-0 flex-1 truncate">{b.canonical_name}</span>
            {b.id === brandId ? <Check className="size-4 shrink-0" /> : null}
          </button>
        ))}
        {!list.length && !term.trim() ? <p className="px-3 py-3 text-[13px] text-[#8C8C8C]">Carregando marcas…</p> : null}
      </div>
    </div>
  );
}

/* ── foto ──────────────────────────────────────────────────────── */

/**
 * Foto grande: arrastar e soltar (computador), câmera ou galeria (celular).
 * Quem usa decide o que fazer com o arquivo (otimizar + enviar).
 */
export function PhotoField({
  url,
  busy,
  onFile,
  onRemove,
  aspect = "square",
  label = "Foto do perfume",
  extra,
}: {
  url: string | null;
  busy?: boolean;
  onFile: (f: File) => void;
  onRemove?: () => void;
  aspect?: "square" | "portrait";
  label?: string;
  extra?: ReactNode;
}) {
  const gallery = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const take = (f: File | undefined | null) => {
    if (f && f.type.startsWith("image/")) onFile(f);
  };
  return (
    <div className="min-w-0">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          take(e.dataTransfer.files?.[0]);
        }}
        className={cn(
          "pk-photo group relative w-full overflow-hidden rounded-[22px] bg-[#232323]",
          aspect === "portrait" ? "aspect-[4/5]" : "aspect-square",
          over && "pk-photo-over",
        )}
      >
        {url ? (
          <img key={url} src={url} alt={label} className="pk-photo-img size-full object-cover" />
        ) : (
          <button
            type="button"
            onClick={() => gallery.current?.click()}
            className="press flex size-full flex-col items-center justify-center gap-3 px-4 text-center text-[#8C8C8C] transition-colors duration-200 hover:text-white"
          >
            <span className="grid size-14 place-items-center rounded-full bg-[#2E2E2E] text-white">
              <ImagePlus className="size-6" />
            </span>
            <span className="text-[14px] leading-snug font-semibold">
              <span className="hidden sm:inline">Arraste a foto aqui</span>
              <span className="sm:hidden">Toque para escolher a foto</span>
              <span className="mt-0.5 block text-[12.5px] font-normal text-[#6F6F6F]">ela é otimizada antes de enviar</span>
            </span>
          </button>
        )}
        {busy ? (
          <div className="absolute inset-0 grid place-items-center bg-black/55">
            <Loader2 className="size-6 animate-spin text-white" />
          </div>
        ) : null}
        {url && onRemove && !busy ? (
          <button
            type="button"
            onClick={onRemove}
            aria-label="Remover foto"
            className="press absolute top-2.5 right-2.5 grid size-9 place-items-center rounded-full bg-black/60 text-white opacity-100 transition-opacity hover:bg-black/80 sm:opacity-0 sm:group-hover:opacity-100"
          >
            <Trash2 className="size-4" />
          </button>
        ) : null}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => camera.current?.click()}
          className="press inline-flex h-11 items-center justify-center gap-2 rounded-full bg-[#1F1F1F] text-[13.5px] font-semibold text-white transition-colors hover:bg-[#2A2A2A] disabled:opacity-40"
        >
          <Camera className="size-4" /> Câmera
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => gallery.current?.click()}
          className="press inline-flex h-11 items-center justify-center gap-2 rounded-full bg-[#1F1F1F] text-[13.5px] font-semibold text-white transition-colors hover:bg-[#2A2A2A] disabled:opacity-40"
        >
          <ImagePlus className="size-4" /> {url ? "Trocar" : "Galeria"}
        </button>
      </div>
      {extra}
      <input
        ref={gallery}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          take(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <input
        ref={camera}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          take(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </div>
  );
}

/* ── pequenos ───────────────────────────────────────────────────── */

/** Selo de situação: ponto colorido + texto. */
export function StatusDot({ tone, children, className }: { tone: "ok" | "warn" | "off" | "gold" | "coral"; children: ReactNode; className?: string }) {
  const dot = { ok: "#7FCF9F", warn: "#F2C46D", off: "#6F6F6F", gold: "#FFD599", coral: "#FF9A8A" }[tone];
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5 text-[12.5px] font-semibold text-[#D4D4D4]", className)}>
      <span className="size-1.5 shrink-0 rounded-full" style={{ background: dot }} />
      <span className="truncate">{children}</span>
    </span>
  );
}

/** Número pequeno de resumo no topo da janela (toca para ir à seção). */
export function MiniStat({ label, value, onClick, tone }: { label: string; value: ReactNode; onClick?: () => void; tone?: "gold" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "press min-w-0 flex-1 rounded-[18px] px-3.5 py-2.5 text-left transition-colors duration-200",
        tone === "gold" ? "bg-[#FFD599] text-[#15130F]" : "bg-[#1A1A1A] hover:bg-[#202020]",
      )}
    >
      <span className={cn("block truncate text-[11.5px] font-semibold", tone === "gold" ? "text-[#15130F]/65" : "text-[#8C8C8C]")}>{label}</span>
      <span className="mt-0.5 block truncate text-[16px] leading-tight font-bold tracking-[-0.02em] tabular-nums">{value}</span>
    </button>
  );
}
