import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  CircleCheck,
  ExternalLink,
  EyeOff,
  Gem,
  Handshake,
  ImagePlus,
  Link2,
  Loader2,
  PenLine,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  Sparkles,
  Trash2,
  User,
  Users,
  X,
} from "lucide-react";
import { AdminShell } from "@/components/orium/AdminShell";
import { AdminConfirm, AdminMore } from "@/components/orium/admin/AdminUI";
import { CustomerSheet } from "@/components/orium/CustomerSheet";
import { crmCustomerDelete } from "@/lib/crm.functions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  conditionFromMl,
  NEGOTIATION_STATUS_LABEL,
  negotiationLevel,
  negotiationPhoto,
  type NegotiationItem,
  type NegotiationStatus,
} from "@/lib/negotiation";
import {
  deleteNegotiationItem,
  listNegotiationAdmin,
  listNegotiationInterests,
  listNegotiationSales,
  removeNegotiationPhoto,
  saveNegotiationItem,
  saveNegotiationSale,
  searchCatalogForNegotiation,
  setNegotiationPhoto,
  uploadNegotiationPhoto,
  type NegotiationCatalogHit,
  type NegotiationSale,
} from "@/lib/negotiation.functions";
import { SaleCard } from "@/components/orium/admin/negotiation/SaleCard";
import { salePayload, saleStatusText, saleToDraft, type SaleDraft } from "@/lib/negotiation-sale";
import { brl } from "@/lib/format";
import { copyFragranceFrom } from "@/lib/fragrance.functions";
import { optimizePhoto } from "@/lib/image-optimize";
import { imgVariant } from "@/lib/product-img";
import { FragranceEditor } from "@/components/orium/FragranceEditor";
import { SidePanel } from "@/components/orium/admin/orders/model";
import { ItemMenuButton, ItemMenuZone, useItemMenu, type ItemMenuSpec, type MenuPos } from "@/components/orium/admin/ItemMenu";
import {
  ChoiceCards,
  Field,
  GoldButton,
  PanelCard,
  PanelFooter,
  PanelHeader,
  PanelScroll,
  PhotoField,
  SoftButton,
  StatusDot,
  TextArea,
  TextInput,
  ToggleRow,
} from "@/components/orium/admin/PanelKit";
import { AnimatedNumber } from "@/components/orium/admin/motion";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/admin/negociacao")({
  head: () => ({ meta: [{ title: "Negociação — Orium Admin" }, { name: "robots", content: "noindex" }] }),
  component: AdminNegotiation,
});

/* ------------------------------------------------------------------ *
 * NEGOCIAÇÃO — perfumes da própria Orium, deslacrados, negociados um a um.
 *  1. Quatro números que também filtram (disponíveis, negociando, vendidos,
 *     interessados).
 *  2. Vitrine em cartões com foto grande; tocar abre o perfume, "⋯" / botão
 *     direito / segurar abre o menu (trocar situação sem abrir nada).
 *  3. Interesses recebidos, já ligados ao CRM.
 * "Adicionar" começa pelo catálogo (nome, marca, foto e ficha olfativa vêm
 * prontos) ou do zero. Nada aqui toca catálogo, estoque ou preço.
 * ------------------------------------------------------------------ */

const STATUS_META: Record<NegotiationStatus, { tone: "ok" | "gold" | "off" | "coral"; icon: ReactNode; hint: string }> = {
  AVAILABLE: { tone: "ok", icon: <CircleCheck />, hint: "Aparece na loja" },
  NEGOTIATING: { tone: "gold", icon: <Handshake />, hint: "Alguém está conversando" },
  SOLD: { tone: "coral", icon: <BadgeCheck />, hint: "Sai da vitrine" },
  HIDDEN: { tone: "off", icon: <EyeOff />, hint: "Só você vê" },
};
const STATUSES: NegotiationStatus[] = ["AVAILABLE", "NEGOTIATING", "SOLD", "HIDDEN"];
/** prioridade usada pelo "Fixar no começo" (a ordem é a maior primeiro) */
const PINNED = 10;

type Draft = {
  id: string | null;
  productId: string | null;
  name: string;
  brand: string;
  volume: string;
  /** ml que ainda restam no frasco */
  remaining: string;
  description: string;
  conditionNote: string;
  status: NegotiationStatus;
  showWhenNegotiating: boolean;
  imagePath: string | null;
  priority: number;
  /** perfume do catálogo de onde veio (para copiar a ficha olfativa ao salvar) */
  source: NegotiationCatalogHit | null;
};

const emptyDraft = (): Draft => ({
  id: null,
  productId: null,
  name: "",
  brand: "",
  volume: "",
  remaining: "",
  description: "",
  conditionNote: "Praticamente cheio",
  status: "AVAILABLE",
  showWhenNegotiating: true,
  imagePath: null,
  priority: 0,
  source: null,
});

const toDraft = (item: NegotiationItem): Draft => ({
  id: item.id,
  productId: item.product_id ?? null,
  name: item.name,
  brand: item.brand ?? "",
  volume: item.volume_ml ? String(item.volume_ml) : "",
  remaining: item.remaining_ml != null ? String(item.remaining_ml) : "",
  description: item.description ?? "",
  conditionNote: item.condition_note,
  status: item.status,
  showWhenNegotiating: item.show_when_negotiating,
  imagePath: item.image_url,
  priority: item.priority ?? 0,
  source: null,
});

const draftPayload = (d: Draft) => ({
  id: d.id,
  name: d.name,
  brand: d.brand,
  volumeMl: d.volume ? Number(d.volume) : null,
  remainingMl: d.remaining ? Number(d.remaining) : null,
  description: d.description,
  // com os ml preenchidos, o estado é calculado (98 de 100 → "Praticamente cheio")
  conditionNote: d.remaining && d.volume && Number(d.volume) > 0 ? conditionFromMl(Math.min(Number(d.remaining), Number(d.volume)), Number(d.volume)) : d.conditionNote,
  status: d.status,
  showWhenNegotiating: d.showWhenNegotiating,
  imageUrl: d.imagePath,
  priority: d.priority,
});

type Filter = "ALL" | NegotiationStatus | "INTEREST";

/** `markDirty`: abre já com mudança pendente (ex.: "Vendido" escolhido no menu, falta preencher a venda). */
type PanelState = { draft: Draft; origin: HTMLElement | null; startAt: "pick" | "form"; markDirty?: boolean };

function AdminNegotiation() {
  const qc = useQueryClient();
  const list = useServerFn(listNegotiationAdmin);
  const loadInterests = useServerFn(listNegotiationInterests);
  const remove = useServerFn(deleteNegotiationItem);
  const save = useServerFn(saveNegotiationItem);
  const uploadPhoto = useServerFn(uploadNegotiationPhoto);
  const swapPhoto = useServerFn(setNegotiationPhoto);
  const [optimizing, setOptimizing] = useState(false);

  const [panel, setPanel] = useState<PanelState | null>(null);
  const [confirm, setConfirm] = useState<NegotiationItem | null>(null);
  const [filter, setFilter] = useState<Filter>("ALL");
  const menu = useItemMenu();

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["negotiation-admin"] });
    void qc.invalidateQueries({ queryKey: ["negotiation-sales"] });
    void qc.invalidateQueries({ queryKey: ["negotiation-public"] });
  };

  const { data, isLoading } = useQuery({
    queryKey: ["negotiation-admin"],
    retry: false,
    queryFn: async () => await list(),
  });
  const items = useMemo(() => (data?.items ?? []) as unknown as NegotiationItem[], [data]);

  const interests = useQuery({
    queryKey: ["negotiation-interests"],
    retry: false,
    queryFn: async () => await loadInterests(),
  });
  const interestByItem = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of interests.data?.interests ?? []) {
      if (r.negotiation_item_id) m.set(r.negotiation_item_id, (m.get(r.negotiation_item_id) ?? 0) + 1);
    }
    return m;
  }, [interests.data]);
  const people = useMemo(
    () => new Set((interests.data?.interests ?? []).map((r) => r.customer_id ?? r.id)).size,
    [interests.data],
  );

  const loadSales = useServerFn(listNegotiationSales);
  const salesQuery = useQuery({
    queryKey: ["negotiation-sales"],
    retry: false,
    queryFn: async () => await loadSales(),
  });
  const saleByItem = useMemo(() => new Map((salesQuery.data?.sales ?? []).map((x) => [x.item_id, x])), [salesQuery.data]);
  /** quanto ainda falta receber das peças vendidas (só itens hoje em "Vendido") */
  const receivable = useMemo(() => {
    let due = 0;
    let open = 0;
    for (const i of items) {
      if (i.status !== "SOLD") continue;
      const sale = saleByItem.get(i.id);
      if (!sale) continue;
      const d = saleStatusText(sale).due;
      if (d > 0) {
        due += d;
        open += 1;
      }
    }
    return { due: Math.round(due * 100) / 100, open };
  }, [items, saleByItem]);

  const counts = useMemo(() => {
    const c: Record<NegotiationStatus, number> = { AVAILABLE: 0, NEGOTIATING: 0, SOLD: 0, HIDDEN: 0 };
    for (const i of items) c[i.status] += 1;
    return c;
  }, [items]);

  const shown = useMemo(() => {
    if (filter === "ALL") return items;
    if (filter === "INTEREST") return items.filter((i) => (interestByItem.get(i.id) ?? 0) > 0);
    return items.filter((i) => i.status === filter);
  }, [items, filter, interestByItem]);

  const removeMutation = useMutation({
    mutationFn: async (id: string) => await remove({ data: { id } }),
    onSuccess: () => {
      toast.success("Perfume removido da Negociação.");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /** troca rápida (situação, fixar) sem abrir o perfume */
  const quickSave = async (item: NegotiationItem, patch: Partial<Draft>, ok: string) => {
    try {
      await save({ data: draftPayload({ ...toDraft(item), ...patch }) });
      toast.success(ok);
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  /* fotos antigas (JPG/PNG ou WebP sem a versão do card) — mesma regra de antes */
  const withPhoto = items.filter((i) => i.image_url);
  const { data: needsFix } = useQuery({
    queryKey: ["negotiation-photo-variants", withPhoto.map((i) => i.image_url).join("|")],
    enabled: withPhoto.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const ids: string[] = [];
      for (const item of withPhoto) {
        if (!/\.webp$/i.test(item.image_url!)) {
          ids.push(item.id);
          continue;
        }
        const url = negotiationPhoto(item.image_url, "card");
        if (!url) continue;
        try {
          const res = await fetch(url, { method: "GET", cache: "no-store" });
          if (res.headers.get("x-orium-variant") !== "card") ids.push(item.id);
        } catch {
          /* rede instável: tenta de novo depois */
        }
      }
      return ids;
    },
  });
  const pending = withPhoto.filter((i) => (needsFix ?? []).includes(i.id));
  const optimizeOld = async () => {
    setOptimizing(true);
    let done = 0;
    let saved = 0;
    try {
      for (const item of pending) {
        const url = negotiationPhoto(item.image_url);
        if (!url) continue;
        const res = await fetch(url);
        if (!res.ok) continue;
        const blob = await res.blob();
        const optimized = await optimizePhoto(blob);
        const up = await uploadPhoto({ data: { base64: optimized.main, contentType: "image/webp", cardBase64: optimized.card } });
        await swapPhoto({ data: { id: item.id, path: up.path } });
        done += 1;
        saved += Math.max(0, optimized.originalBytes - optimized.mainBytes - optimized.cardBytes);
      }
      toast.success(
        done === 0
          ? "Nenhuma foto antiga para converter."
          : `${done} foto${done === 1 ? "" : "s"} convertida${done === 1 ? "" : "s"} para WebP · -${Math.round(saved / 1024)} KB`,
      );
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setOptimizing(false);
    }
  };

  const openItem = (item: NegotiationItem, origin: HTMLElement | null, patch?: Partial<Draft>) =>
    setPanel({ draft: { ...toDraft(item), ...patch }, origin, startAt: "form", markDirty: !!patch });
  const openNew = (origin: HTMLElement | null, startAt: "pick" | "form" = "pick") => setPanel({ draft: emptyDraft(), origin, startAt });

  const itemMenu = (item: NegotiationItem, pos: MenuPos) => {
    const n = interestByItem.get(item.id) ?? 0;
    const pinned = (item.priority ?? 0) > 0;
    const spec: ItemMenuSpec = {
      image: negotiationPhoto(item.image_url, "card"),
      title: item.name,
      subtitle: (
        <>
          <span className="truncate">{item.brand ?? "Orium"}</span>
          {n ? (
            <>
              <span className="text-[#3A3A3A]">·</span>
              <span className="shrink-0 font-semibold text-[#FFD599]">
                {n} interessado{n === 1 ? "" : "s"}
              </span>
            </>
          ) : null}
        </>
      ),
      quick: [
        { key: "edit", label: "Editar", icon: <Pencil />, onSelect: () => openItem(item, document.querySelector(`[data-item-id="${item.id}"]`)) },
        { key: "view", label: "Ver na loja", icon: <ExternalLink />, href: `/negociacao/${item.id}`, disabled: item.status === "HIDDEN" },
        {
          key: "copy",
          label: "Copiar link",
          icon: <Link2 />,
          onSelect: () => {
            void navigator.clipboard
              ?.writeText(`${window.location.origin}/negociacao/${item.id}`)
              .then(() => toast.success("Link copiado."))
              .catch(() => toast.error("Não foi possível copiar."));
          },
        },
      ],
      choicesLabel: "Situação",
      choices: STATUSES.map((s) => ({
        key: s,
        label: NEGOTIATION_STATUS_LABEL[s],
        icon: STATUS_META[s].icon,
        active: item.status === s,
        // "Vendido" pede para quem, por quanto e quanto já pagou: abre o perfume já na venda
        onSelect: () =>
          s === "SOLD"
            ? item.status === "SOLD"
              ? openItem(item, document.querySelector(`[data-item-id="${item.id}"]`))
              : openItem(item, document.querySelector(`[data-item-id="${item.id}"]`), { status: "SOLD" })
            : void quickSave(item, { status: s }, `${item.name}: ${NEGOTIATION_STATUS_LABEL[s].toLowerCase()}.`),
      })),
      main: [
        {
          key: "pin",
          label: pinned ? "Tirar do começo da vitrine" : "Fixar no começo da vitrine",
          icon: pinned ? <PinOff /> : <Pin />,
          onSelect: () => void quickSave(item, { priority: pinned ? 0 : PINNED }, pinned ? "Voltou para a ordem normal." : "Fixado no começo da vitrine."),
        },
      ],
      danger: [{ key: "del", label: "Remover da Negociação", icon: <Trash2 />, danger: true, onSelect: () => setConfirm(item) }],
    };
    menu.open(pos, spec, item.id);
  };

  const tiles: Array<{ key: Filter; label: string; value: number; icon: ReactNode }> = [
    { key: "AVAILABLE", label: "Disponíveis", value: counts.AVAILABLE, icon: <CircleCheck className="size-[18px]" strokeWidth={2.2} /> },
    { key: "NEGOTIATING", label: "Negociando", value: counts.NEGOTIATING, icon: <Handshake className="size-[18px]" strokeWidth={2.2} /> },
    { key: "SOLD", label: "Vendidos", value: counts.SOLD, icon: <BadgeCheck className="size-[18px]" strokeWidth={2.2} /> },
    { key: "INTEREST", label: people === 1 ? "Interessado" : "Interessados", value: people, icon: <Users className="size-[18px]" strokeWidth={2.2} /> },
  ];

  return (
    <AdminShell
      title="Negociação"
      description="Perfumes da Orium, deslacrados, negociados um a um pelo WhatsApp."
      action={
        <div className="flex items-center gap-2">
          <GoldButton icon={<Plus className="size-[18px]" strokeWidth={2.6} />} className="h-12" onClick={(e) => openNew(e.currentTarget)}>
            Adicionar perfume
          </GoldButton>
          {pending.length > 0 ? (
            <AdminMore
              label="Mais ações"
              actions={[
                {
                  label: optimizing ? "Otimizando fotos…" : `Otimizar ${pending.length} foto${pending.length === 1 ? "" : "s"}`,
                  icon: optimizing ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />,
                  onSelect: () => void optimizeOld(),
                },
              ]}
            />
          ) : null}
        </div>
      }
    >
      {/* 1 · números que filtram */}
      <section className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4" aria-label="Resumo">
        {tiles.map((t, i) => {
          const on = filter === t.key;
          return (
            <button
              key={t.key}
              type="button"
              aria-pressed={on}
              onClick={() => setFilter(on ? "ALL" : t.key)}
              className={cn(
                "pk-stat adm-rise press flex min-h-[118px] flex-col rounded-[28px] p-5 text-left",
                on ? "bg-white text-[#15130F]" : t.key === "INTEREST" && t.value > 0 ? "dash-hero" : "dash-card hover:bg-[#202020]",
              )}
              style={{ ["--i" as string]: i }}
            >
              <span className="flex w-full items-start justify-between gap-2">
                <span className={cn("text-[15px]", on || (t.key === "INTEREST" && t.value > 0) ? "font-semibold opacity-75" : "text-[#A9A9A9]")}>{t.label}</span>
                <span className={cn("dash-ico", on && "!bg-[#15130F]/[0.08] !text-[#15130F]")}>{t.icon}</span>
              </span>
              <span className="mt-auto text-[34px] leading-none font-bold tracking-[-0.045em]">
                {isLoading ? "—" : <AnimatedNumber value={t.value} />}
              </span>
              {t.key === "SOLD" && receivable.open > 0 ? (
                <span className={cn("mt-1.5 truncate text-[12.5px] font-semibold tabular-nums", on ? "text-[#8A5A00]" : "text-[#FFD599]")}>
                  A receber {brl(receivable.due)}
                </span>
              ) : null}
            </button>
          );
        })}
      </section>

      {filter !== "ALL" ? (
        <div className="adm-fade mt-4 flex items-center gap-2 text-[14px] text-[#A9A9A9]">
          Mostrando <span className="font-semibold text-white">{shown.length}</span>
          {filter === "INTEREST" ? "com interessados" : NEGOTIATION_STATUS_LABEL[filter as NegotiationStatus].toLowerCase()}
          <button type="button" onClick={() => setFilter("ALL")} className="press ml-1 inline-flex h-8 items-center gap-1 rounded-full bg-[#1F1F1F] px-3 text-[13px] font-semibold text-white hover:bg-[#2A2A2A]">
            <X className="size-3.5" /> Ver todos
          </button>
        </div>
      ) : null}

      {/* 2 · vitrine */}
      <div className="mt-4">
        {isLoading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:gap-4 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="admin-skeleton aspect-[4/5.6] rounded-[26px]" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyShowcase onCatalog={(el) => openNew(el, "pick")} onBlank={(el) => openNew(el, "form")} />
        ) : shown.length === 0 ? (
          <div className="dash-card p-8 text-center text-[15px] text-[#A9A9A9]">Nada por aqui com esse filtro.</div>
        ) : (
          <ItemMenuZone
            onOpen={(id, pos) => {
              const it = items.find((x) => x.id === id);
              if (it) itemMenu(it, pos);
            }}
          >
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:gap-4 xl:grid-cols-4">
              {shown.map((item, i) => (
                <ShowcaseTile
                  key={item.id}
                  item={item}
                  i={i}
                  interested={interestByItem.get(item.id) ?? 0}
                  sale={saleByItem.get(item.id) ?? null}
                  onOpen={(el) => openItem(item, el)}
                  onMenu={(pos) => itemMenu(item, pos)}
                />
              ))}
              <button
                type="button"
                onClick={(e) => openNew(e.currentTarget)}
                className="pk-tile pk-in press flex min-h-[220px] flex-col items-center justify-center gap-3 border-2 border-dashed border-white/[0.08] !bg-transparent p-4 text-center text-[#8C8C8C] hover:!bg-[#161616] hover:text-white"
                style={{ ["--i" as string]: shown.length }}
              >
                <span className="grid size-12 place-items-center rounded-full bg-[#1F1F1F] text-white">
                  <Plus className="size-5" />
                </span>
                <span className="text-[14px] font-semibold">Adicionar perfume</span>
              </button>
            </div>
          </ItemMenuZone>
        )}
      </div>

      {/* 3 · interesses */}
      <InterestList data={interests.data?.interests} loading={interests.isLoading} items={items} onOpenItem={(it) => openItem(it, null)} />

      <NegotiationPanel
        state={panel}
        sales={saleByItem}
        onClose={() => setPanel(null)}
        onSaved={refresh}
        onDelete={(id) => {
          const it = items.find((x) => x.id === id);
          if (it) setConfirm(it);
        }}
      />

      {menu.node}

      <AlertDialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent className="max-w-[min(92vw,26rem)] rounded-[28px]">
          <AlertDialogHeader>
            <AlertDialogTitle>Remover “{confirm?.name}” da Negociação?</AlertDialogTitle>
            <AlertDialogDescription>
              Só este item sai da vitrine de Negociação. Nada do catálogo é afetado e os interesses continuam no CRM.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11 rounded-full">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="h-11 rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (confirm) removeMutation.mutate(confirm.id);
                if (confirm && panel?.draft.id === confirm.id) setPanel(null);
                setConfirm(null);
              }}
            >
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminShell>
  );
}

/* ─────────────── vitrine ─────────────── */

function ShowcaseTile({
  item,
  i,
  interested,
  sale,
  onOpen,
  onMenu,
}: {
  item: NegotiationItem;
  i: number;
  interested: number;
  /** venda registrada (só aparece quando o item está Vendido) */
  sale: NegotiationSale | null;
  onOpen: (el: HTMLElement) => void;
  onMenu: (pos: MenuPos) => void;
}) {
  const photo = negotiationPhoto(item.image_url, "card");
  const meta = STATUS_META[item.status];
  const faded = item.status === "SOLD" || item.status === "HIDDEN";
  return (
    <article
      data-item-id={item.id}
      role="button"
      tabIndex={0}
      aria-label={`Abrir ${item.name}`}
      onClick={(e) => onOpen(e.currentTarget)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(e.currentTarget);
        }
      }}
      className="pk-tile pk-in flex flex-col p-2"
      style={{ ["--i" as string]: i }}
    >
      <div className="relative aspect-[4/5] overflow-hidden rounded-[20px] bg-[#232323]">
        {photo ? (
          <img src={photo} alt={item.name} loading="lazy" className={cn("pk-tile-img size-full object-cover", faded && "opacity-45 grayscale")} />
        ) : (
          <div className="grid size-full place-items-center text-[#6F6F6F]">
            <Gem className="size-7" strokeWidth={1.6} />
          </div>
        )}
        {(item.priority ?? 0) > 0 ? (
          <span className="absolute bottom-2.5 left-2.5 grid size-7 place-items-center rounded-full bg-black/70 text-[#FFD599]" title="Fixado no começo">
            <Pin className="size-3.5" />
          </span>
        ) : null}
        <ItemMenuButton size="sm" label={`Opções de ${item.name}`} onOpen={onMenu} className="pk-reveal absolute top-2 right-2 !bg-black/70 hover:!bg-black/85" />
        {interested ? (
          <span className="absolute right-2.5 bottom-2.5 inline-flex h-7 items-center gap-1 rounded-full bg-[#FFD599] px-2.5 text-[12px] font-bold text-[#15130F] tabular-nums">
            <Users className="size-3.5" strokeWidth={2.4} /> {interested}
          </span>
        ) : null}
      </div>
      <div className="min-w-0 px-2 pt-3 pb-2">
        <p className="truncate text-[11.5px] font-semibold tracking-[0.06em] text-[#8C8C8C] uppercase">{item.brand ?? "Orium"}</p>
        <p className="mt-0.5 truncate text-[15.5px] leading-tight font-bold tracking-[-0.01em]">{item.name}</p>
        <p className="mt-1 truncate text-[12.5px] text-[#8C8C8C]">{(() => {
            const lvl = negotiationLevel(item);
            return [lvl.ml != null ? `${lvl.ml} de ${item.volume_ml} ml` : item.volume_ml ? `${item.volume_ml} ml` : null, lvl.label].filter(Boolean).join(" · ");
          })()}</p>
        <StatusDot tone={meta.tone} className="mt-2.5">
          {NEGOTIATION_STATUS_LABEL[item.status]}
          {item.status === "SOLD" && sale?.customer_name ? ` · ${sale.customer_name}` : ""}
        </StatusDot>
        {item.status === "SOLD" ? (
          sale ? (
            <p
              className={cn(
                "mt-1.5 truncate text-[12.5px] font-semibold tabular-nums",
                saleStatusText(sale).tone === "ok" ? "text-[#7FCF9F]" : saleStatusText(sale).tone === "gold" ? "text-[#FFD599]" : "text-[#FF9A8A]",
              )}
            >
              {brl(sale.sale_price)} · {saleStatusText(sale).label}
            </p>
          ) : (
            <p className="mt-1.5 truncate text-[12.5px] font-semibold text-[#8C8C8C]">Sem dados da venda</p>
          )
        ) : null}
      </div>
    </article>
  );
}

function EmptyShowcase({ onCatalog, onBlank }: { onCatalog: (el: HTMLElement) => void; onBlank: (el: HTMLElement) => void }) {
  return (
    <div className="dash-card adm-rise flex flex-col items-center px-6 py-12 text-center">
      <span className="grid size-16 place-items-center rounded-full bg-[#232323] text-[#FFD599]">
        <Gem className="size-7" strokeWidth={1.8} />
      </span>
      <h2 className="mt-4 text-[22px] font-bold tracking-[-0.02em]">A vitrine está vazia</h2>
      <p className="mt-1 max-w-sm text-[15px] text-[#A9A9A9]">Coloque aqui um perfume deslacrado para negociar. Começar pelo catálogo traz nome, foto e notas prontos.</p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <GoldButton icon={<Search className="size-[18px]" />} onClick={(e) => onCatalog(e.currentTarget)}>
          Escolher do catálogo
        </GoldButton>
        <SoftButton icon={<PenLine />} onClick={(e) => onBlank(e.currentTarget)}>
          Do zero
        </SoftButton>
      </div>
    </div>
  );
}

/* ─────────────── janela do perfume ─────────────── */

function NegotiationPanel({
  state,
  sales,
  onClose,
  onSaved,
  onDelete,
}: {
  state: PanelState | null;
  sales: Map<string, NegotiationSale>;
  onClose: () => void;
  onSaved: () => void;
  onDelete: (id: string) => void;
}) {
  // mantém o conteúdo enquanto a janela anima a saída
  const [last, setLast] = useState(state);
  if (state && state !== last) setLast(state);
  const s = state ?? last;
  const [dirty, setDirty] = useState(false);
  const [askDiscard, setAskDiscard] = useState(false);
  const close = () => (dirty ? setAskDiscard(true) : onClose());
  const done = () => {
    setDirty(false);
    onClose();
  };
  return (
    <>
      <SidePanel open={!!state} onClose={close} label="Perfume da Negociação" originEl={state?.origin ?? null}>
        {s ? (
          <PanelBody
            key={s.draft.id ?? `novo-${String(s.startAt)}`}
            initial={s.draft}
            sale={s.draft.id ? (sales.get(s.draft.id) ?? null) : null}
            markDirty={!!s.markDirty}
            startAt={s.startAt}
            onClose={close}
            onDirty={setDirty}
            onSaved={onSaved}
            onDelete={onDelete}
          />
        ) : null}
      </SidePanel>
      <AdminConfirm
        open={askDiscard}
        onOpenChange={setAskDiscard}
        title="Sair sem salvar?"
        description="As mudanças neste perfume ainda não foram salvas."
        confirmLabel="Sair sem salvar"
        danger
        onConfirm={done}
      />
    </>
  );
}

function PanelBody({
  initial,
  sale,
  markDirty,
  startAt,
  onClose,
  onDirty,
  onSaved,
  onDelete,
}: {
  initial: Draft;
  /** venda já registrada deste item (ou null) */
  sale: NegotiationSale | null;
  markDirty: boolean;
  startAt: "pick" | "form";
  onClose: () => void;
  onDirty: (v: boolean) => void;
  onSaved: () => void;
  onDelete: (id: string) => void;
}) {
  const qc = useQueryClient();
  const save = useServerFn(saveNegotiationItem);
  const saveSale = useServerFn(saveNegotiationSale);
  const upload = useServerFn(uploadNegotiationPhoto);
  const dropPhoto = useServerFn(removeNegotiationPhoto);
  const copyFragrance = useServerFn(copyFragranceFrom);

  const [draft, setDraft] = useState<Draft>(initial);
  const [step, setStep] = useState<"pick" | "form">(initial.id ? "form" : startAt);
  const [busy, setBusy] = useState<null | "photo" | "save">(null);
  // venda e pagamento: só contam quando a situação é "Vendido"
  const [saleDraft, setSaleDraft] = useState<SaleDraft>(() => saleToDraft(sale));
  const [savedPaid, setSavedPaid] = useState(sale?.amount_paid ?? 0);
  const snapshot = (d: Draft, sd: SaleDraft) => JSON.stringify([draftPayload(d), d.status === "SOLD" ? sd : null]);
  const [saved, setSaved] = useState(() => (markDirty ? "" : snapshot(initial, saleToDraft(sale))));
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const setSale = (patch: Partial<SaleDraft>) => setSaleDraft((d) => ({ ...d, ...patch }));
  const dirty = snapshot(draft, saleDraft) !== saved;
  const salePending = draft.status === "SOLD" && salePayload(draft.id ?? "novo", saleDraft, savedPaid) == null;
  useEffect(() => {
    // novo perfume só conta como "não salvo" depois que algo foi preenchido
    onDirty(dirty && !!(draft.id || draft.name.trim() || draft.imagePath));
  }, [dirty, draft.id, draft.name, draft.imagePath, onDirty]);

  const sendPhoto = async (file: Blob) => {
    setBusy("photo");
    try {
      const optimized = await optimizePhoto(file);
      const res = await upload({ data: { base64: optimized.main, contentType: "image/webp", cardBase64: optimized.card } });
      const old = draft.imagePath;
      set({ imagePath: res.path });
      // a foto antiga só sai do armazenamento se ainda não foi salva no item
      if (old && old !== initial.imagePath) await dropPhoto({ data: { path: old } });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  /** Veio do catálogo: preenche e copia a foto para a Negociação (WebP). */
  const fromCatalog = async (hit: NegotiationCatalogHit) => {
    setDraft((d) => ({ ...d, name: hit.name, brand: hit.brand ?? "", volume: hit.volumeMl ? String(hit.volumeMl) : "", source: hit }));
    setStep("form");
    const url = imgVariant(hit.imageUrl, "full");
    if (!url) return;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error("foto");
      await sendPhoto(await res.blob());
    } catch {
      toast.info("Não deu para copiar a foto do catálogo. Envie uma foto do frasco.");
    }
  };

  const submit = async () => {
    // "Vendido" precisa de valor; sem ele a peça sairia da vitrine sem registro nenhum
    const salePay = draft.status === "SOLD" ? salePayload(draft.id ?? "novo", saleDraft, savedPaid) : null;
    if (draft.status === "SOLD" && !salePay) {
      toast.error("Informe por quanto a peça foi vendida e quanto já foi pago.");
      return;
    }
    setBusy("save");
    try {
      const res = await save({ data: draftPayload(draft) });
      const productId = res.productId ?? draft.productId;
      let soldAs: NegotiationSale | null = null;
      if (salePay) {
        const out = await saveSale({ data: { ...salePay, itemId: res.id } });
        soldAs = out.sale;
        setSavedPaid(out.sale.amount_paid);
      }
      let copied = false;
      // primeira vez a partir do catálogo: a ficha olfativa vem junto
      if (!draft.id && draft.source?.hasFragrance && productId) {
        try {
          await copyFragrance({ data: { fromProductId: draft.source.id, toProductId: productId } });
          copied = true;
          void qc.invalidateQueries();
        } catch {
          /* sem ficha para copiar: segue só com o cadastro */
        }
      }
      const next = { ...draft, id: res.id, productId, source: draft.id ? draft.source : null };
      const nextSale = soldAs ? saleToDraft(soldAs) : saleDraft;
      setDraft(next);
      setSaleDraft(nextSale);
      setSaved(snapshot(next, nextSale));
      onSaved();
      toast.success(
        soldAs
          ? saleStatusText(soldAs).due > 0
            ? `Venda salva. ${saleStatusText(soldAs).label}.`
            : "Venda salva e paga por completo."
          : draft.id ? "Alterações salvas." : copied ? "Perfume na vitrine, com as notas do catálogo." : "Perfume na vitrine. Complete as notas abaixo, se quiser.",
      );
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (step === "pick")
    return <CatalogPicker onPick={(h) => void fromCatalog(h)} onBlank={() => setStep("form")} onClose={onClose} />;

  const photo = negotiationPhoto(draft.imagePath);
  const pinned = draft.priority > 0;

  return (
    <>
      <PanelHeader
        image={negotiationPhoto(draft.imagePath, "card")}
        fallback={<Gem className="size-5" />}
        title={draft.name.trim() || "Novo perfume"}
        subtitle={
          draft.id ? (
            <StatusDot tone={STATUS_META[draft.status].tone}>
              {NEGOTIATION_STATUS_LABEL[draft.status]}
              {draft.brand ? ` · ${draft.brand}` : ""}
            </StatusDot>
          ) : (
            "Na vitrine de Negociação"
          )
        }
        onClose={onClose}
        right={
          !draft.id ? (
            <button
              type="button"
              onClick={() => setStep("pick")}
              className="press hidden h-10 items-center gap-1.5 rounded-full bg-[#1F1F1F] px-3.5 text-[13px] font-semibold text-[#D4D4D4] hover:bg-[#2A2A2A] sm:inline-flex"
            >
              <Search className="size-4" /> Catálogo
            </button>
          ) : null
        }
      />

      <PanelScroll>
        {draft.source ? (
          <div className="adm-pop flex items-center gap-3 rounded-[20px] bg-[#1A1813] p-3 pr-2 ring-1 ring-[#FFD599]/25">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[#FFD599] text-[#15130F]">
              <Sparkles className="size-4" />
            </span>
            <p className="min-w-0 flex-1 text-[13px] leading-snug text-[#D4D4D4]">
              Do catálogo: <b className="text-white">{draft.source.name}</b>.{" "}
              {draft.source.hasFragrance ? "Acordes e notas vêm junto ao salvar." : "Ele ainda não tem notas no catálogo."}
            </p>
            <button
              type="button"
              aria-label="Não usar o perfume do catálogo"
              onClick={() => set({ source: null })}
              className="press grid size-9 shrink-0 place-items-center rounded-full text-[#8C8C8C] hover:bg-white/[0.06] hover:text-white"
            >
              <X className="size-4" />
            </button>
          </div>
        ) : null}

        <PanelCard title="O perfume">
          <div className="grid gap-4 sm:grid-cols-[180px_1fr]">
            <div className="mx-auto w-full max-w-[220px] sm:max-w-none">
            <PhotoField
              url={photo}
              busy={busy === "photo"}
              aspect="portrait"
              onFile={(f) => void sendPhoto(f)}
              onRemove={() => {
                const old = draft.imagePath;
                set({ imagePath: null });
                if (old && old !== initial.imagePath) void dropPhoto({ data: { path: old } });
              }}
            />
            </div>
            <div className="min-w-0 space-y-3">
              <Field label="Nome">
                <TextInput value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="Ex.: Khamrah" autoFocus={!draft.id && !draft.source} />
              </Field>
              <Field label="Marca">
                <TextInput value={draft.brand} onChange={(e) => set({ brand: e.target.value })} placeholder="Ex.: Lattafa" />
              </Field>
            </div>
          </div>
        </PanelCard>

        <RemainingCard
          volume={draft.volume}
          remaining={draft.remaining}
          legacy={draft.conditionNote}
          onVolume={(v) => set({ volume: v })}
          onRemaining={(v) => set({ remaining: v })}
        />

        <PanelCard title="Situação">
          <ChoiceCards
            columns={2}
            value={draft.status}
            onChange={(v) => set({ status: v })}
            options={STATUSES.map((s) => ({ value: s, label: NEGOTIATION_STATUS_LABEL[s], hint: STATUS_META[s].hint, icon: STATUS_META[s].icon }))}
          />
          {draft.status === "NEGOTIATING" ? (
            <div className="adm-pop mt-3">
              <ToggleRow
                label="Continuar na vitrine"
                hint="Com o selo “Em negociação”, para quem chegar depois."
                checked={draft.showWhenNegotiating}
                onChange={(v) => set({ showWhenNegotiating: v })}
              />
            </div>
          ) : null}
          <div className="mt-2 border-t border-white/[0.06] pt-2">
            <ToggleRow
              icon={<Pin />}
              label="Fixar no começo da vitrine"
              hint="Aparece antes dos outros."
              checked={pinned}
              onChange={(v) => set({ priority: v ? Math.max(PINNED, initial.priority) : 0 })}
            />
          </div>
        </PanelCard>

        {draft.status === "SOLD" ? (
          <SaleCard draft={saleDraft} onChange={setSale} savedPaid={savedPaid} itemName={draft.name.trim()} />
        ) : null}

        <PanelCard title="Descrição" hint="Poucas linhas: o estado do frasco e por que vale a pena.">
          <TextArea value={draft.description} onChange={(e) => set({ description: e.target.value })} placeholder="Ex.: Usado duas vezes, guardado na caixa, longe da luz." />
        </PanelCard>

        {draft.productId ? (
          <div className="min-w-0"><FragranceEditor productId={draft.productId} defaultOpen allowCopyFromCatalog /></div>
        ) : (
          <PanelCard tone="flat" title="Notas e acordes" hint={draft.source?.hasFragrance ? "Vêm do catálogo assim que você salvar." : "Depois de salvar, abre aqui o mesmo editor do catálogo: Fragrantica, acordes e pirâmide."} />
        )}
      </PanelScroll>

      <PanelFooter>
        {draft.id ? (
          <SoftButton aria-label="Remover da Negociação" icon={<Trash2 className="text-[#FF9A8A]" />} className="w-[52px] px-0" onClick={() => onDelete(draft.id!)} />
        ) : (
          <SoftButton icon={<ArrowLeft />} className="w-[52px] px-0 sm:hidden" aria-label="Voltar ao catálogo" onClick={() => setStep("pick")} />
        )}
        {draft.id && !dirty ? (
          <SoftButton className="flex-1" onClick={onClose}>
            Concluir
          </SoftButton>
        ) : (
          <GoldButton
            className="flex-1"
            loading={busy === "save"}
            disabled={!draft.name.trim() || busy === "photo" || salePending || (!!draft.remaining && !!draft.volume && Number(draft.remaining) > Number(draft.volume))} onClick={() => void submit()}>
            {draft.status === "SOLD" ? "Salvar venda" : draft.id ? "Salvar alterações" : "Colocar na vitrine"}
          </GoldButton>
        )}
      </PanelFooter>
    </>
  );
}

/* ─────────────── quanto tem no frasco ─────────────── */

/**
 * Tamanho do frasco + quantos ml restam. O estado ("Praticamente cheio",
 * "Metade"...) e a barra saem sozinhos — é o mesmo que a loja mostra.
 */
function RemainingCard({
  volume,
  remaining,
  legacy,
  onVolume,
  onRemaining,
}: {
  volume: string;
  remaining: string;
  legacy: string;
  onVolume: (v: string) => void;
  onRemaining: (v: string) => void;
}) {
  const vol = Number(volume) || 0;
  const rem = remaining === "" ? null : Number(remaining);
  const over = rem != null && vol > 0 && rem > vol;
  const ok = rem != null && vol > 0 && !over;
  const pct = ok ? Math.max(2, Math.round((rem! / vol) * 100)) : 0;
  const label = ok ? conditionFromMl(rem!, vol) : null;
  return (
    <PanelCard title="Quanto tem no frasco" hint="Digite os ml que ainda restam. O estado aparece sozinho na loja.">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Frasco de">
          <TextInput inputMode="numeric" suffix="ml" value={volume} onChange={(e) => onVolume(e.target.value.replace(/\D/g, ""))} placeholder="100" />
        </Field>
        <Field label="Ainda tem">
          <TextInput
            inputMode="numeric"
            suffix="ml"
            value={remaining}
            onChange={(e) => onRemaining(e.target.value.replace(/\D/g, ""))}
            placeholder={vol ? String(Math.round(vol * 0.95)) : "95"}
          />
        </Field>
      </div>
      <div className="mt-4 rounded-[18px] bg-[#232323] p-4">
        <div className="flex items-baseline justify-between gap-3">
          <span className={cn("text-[15px] font-bold", over ? "text-[#FF9A8A]" : label ? "text-white" : "text-[#6F6F6F]")}>
            {over ? "Passou do tamanho do frasco" : (label ?? (legacy ? `Hoje: ${legacy}` : "Preencha os dois campos"))}
          </span>
          {ok ? (
            <span className="text-[14px] text-[#A9A9A9] tabular-nums">
              <b className="text-[17px] text-white">{rem} ml</b> de {vol} ml
            </span>
          ) : null}
        </div>
        <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-[#2E2E2E]">
          <div className="h-full rounded-full bg-[#FFD599] transition-[width] duration-500 ease-[var(--ease-orium)]" style={{ width: `${pct}%` }} />
        </div>
      </div>
    </PanelCard>
  );
}

/* ─────────────── escolher do catálogo ─────────────── */

function CatalogPicker({ onPick, onBlank, onClose }: { onPick: (h: NegotiationCatalogHit) => void; onBlank: () => void; onClose: () => void }) {
  const search = useServerFn(searchCatalogForNegotiation);
  const [term, setTerm] = useState("");
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const t = setTimeout(() => setQ(term.trim()), 260);
    return () => clearTimeout(t);
  }, [term]);
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 320);
    return () => clearTimeout(t);
  }, []);

  const { data, isFetching, isError, refetch } = useQuery({
    queryKey: ["negotiation-catalog-search", q],
    enabled: q.length >= 2,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
    queryFn: async () => await search({ data: { q } }),
  });
  const hits = q.length >= 2 ? (data?.items ?? []) : [];

  return (
    <>
      <PanelHeader title="Adicionar perfume" subtitle="Comece pelo catálogo: nome, foto e notas vêm prontos." onClose={onClose}>
        <div className="mt-4 flex h-14 items-center gap-3 rounded-full bg-[#1F1F1F] px-5 transition-colors focus-within:bg-[#262626]">
          {isFetching ? <Loader2 className="size-5 shrink-0 animate-spin text-[#8C8C8C]" /> : <Search className="size-5 shrink-0 text-[#8C8C8C]" />}
          <input
            ref={inputRef}
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Procure por nome ou marca"
            aria-label="Procurar no catálogo"
            className="pk-field h-full min-w-0 flex-1 bg-transparent text-[16px] text-white outline-none placeholder:text-[#6F6F6F]"
          />
          {term ? (
            <button type="button" onClick={() => setTerm("")} aria-label="Limpar" className="press grid size-8 place-items-center rounded-full text-[#8C8C8C] hover:bg-white/[0.06] hover:text-white">
              <X className="size-4" />
            </button>
          ) : null}
        </div>
      </PanelHeader>

      <PanelScroll swapKey={q.length >= 2 ? "r" : "e"}>
        {q.length < 2 ? (
          <div className="flex flex-col items-center px-4 py-10 text-center">
            <span className="grid size-14 place-items-center rounded-full bg-[#1A1A1A] text-[#FFD599]">
              <Search className="size-6" />
            </span>
            <p className="mt-4 text-[16px] font-bold">Qual perfume vai para a vitrine?</p>
            <p className="mt-1 max-w-xs text-[14px] text-[#8C8C8C]">Digite pelo menos duas letras. Ex.: “khamrah”, “club de nuit”, “lattafa”.</p>
          </div>
        ) : isError && !hits.length ? (
          <div className="px-4 py-10 text-center">
            <p className="text-[16px] font-bold">Não deu para buscar agora</p>
            <p className="mt-1 text-[14px] text-[#8C8C8C]">Confira a internet e tente de novo, ou preencha do zero.</p>
            <SoftButton className="mt-4 h-11" onClick={() => void refetch()}>
              Tentar de novo
            </SoftButton>
          </div>
        ) : hits.length === 0 && !isFetching ? (
          <div className="px-4 py-10 text-center">
            <p className="text-[16px] font-bold">Nada no catálogo com “{q}”</p>
            <p className="mt-1 text-[14px] text-[#8C8C8C]">Sem problema: preencha do zero.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {hits.map((h, i) => (
              <button
                key={h.id}
                type="button"
                onClick={() => onPick(h)}
                className="pk-tile pk-in press flex flex-col p-1.5 text-left"
                style={{ ["--i" as string]: i }}
              >
                <span className="relative block aspect-square overflow-hidden rounded-[18px] bg-[#232323]">
                  {h.imageUrl ? (
                    <img src={imgVariant(h.imageUrl, "card") ?? ""} alt={h.name} loading="lazy" className="pk-tile-img size-full object-cover" />
                  ) : (
                    <span className="grid size-full place-items-center text-[#6F6F6F]">
                      <Gem className="size-6" strokeWidth={1.6} />
                    </span>
                  )}
                  {h.hasFragrance ? (
                    <span className="absolute bottom-2 left-2 inline-flex h-6 items-center gap-1 rounded-full bg-black/70 px-2 text-[11px] font-semibold text-[#FFD599]">
                      <Sparkles className="size-3" /> com notas
                    </span>
                  ) : null}
                </span>
                <span className="block min-w-0 px-1.5 pt-2.5 pb-1.5">
                  <span className="block truncate text-[11px] font-semibold tracking-[0.06em] text-[#8C8C8C] uppercase">{h.brand ?? "—"}</span>
                  <span className="mt-0.5 block truncate text-[14px] leading-tight font-bold">{h.name}</span>
                  <span className="mt-0.5 block truncate text-[12px] text-[#8C8C8C]">{[h.volumeMl ? `${h.volumeMl} ml` : null, h.concentration].filter(Boolean).join(" · ") || " "}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </PanelScroll>

      <PanelFooter>
        <button
          type="button"
          onClick={onBlank}
          className="press group flex h-[52px] w-full items-center gap-3 rounded-full bg-[#1F1F1F] pr-3 pl-5 text-left transition-colors hover:bg-[#2A2A2A]"
        >
          <PenLine className="size-[18px] text-[#A9A9A9]" />
          <span className="min-w-0 flex-1 text-[15px] font-semibold">Não está no catálogo? Preencher do zero</span>
          <span className="grid size-9 place-items-center rounded-full bg-[#2E2E2E] transition-transform duration-300 group-hover:translate-x-0.5">
            <ArrowRight className="size-4" />
          </span>
        </button>
      </PanelFooter>
    </>
  );
}

/* ─────────────── interesses ─────────────── */

type InterestRow = {
  id: string;
  negotiation_item_id: string | null;
  item_name: string;
  customer_name: string | null;
  customer_id: string | null;
  customer_archived: boolean;
  created_at: string;
};

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("") || "?";

/**
 * Quem demonstrou interesse, já ligado ao CRM. Uma pessoa = uma ficha (mesmo
 * `customer_id`), com os perfumes embaixo do nome. Ver, editar e excluir usam a
 * mesma ficha e o mesmo editor de Admin → Clientes.
 */
function InterestList({
  data,
  loading,
  items,
  onOpenItem,
}: {
  data: InterestRow[] | undefined;
  loading: boolean;
  items: NegotiationItem[];
  onOpenItem: (it: NegotiationItem) => void;
}) {
  const removeCustomer = useServerFn(crmCustomerDelete);
  const qc = useQueryClient();
  const menu = useItemMenu();
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const groups = useMemo(() => {
    const out: Array<{ key: string; customerId: string | null; name: string; archived: boolean; items: Array<{ id: string; item_id: string | null; item_name: string; created_at: string }> }> = [];
    const index = new Map<string, number>();
    for (const r of data ?? []) {
      const key = r.customer_id ?? `sem-ficha-${r.id}`;
      const item = { id: r.id, item_id: r.negotiation_item_id, item_name: r.item_name, created_at: r.created_at };
      const at = index.get(key);
      if (at == null) {
        index.set(key, out.length);
        out.push({ key, customerId: r.customer_id, name: r.customer_name ?? "Sem nome", archived: r.customer_archived, items: [item] });
      } else out[at]!.items.push(item);
    }
    return out;
  }, [data]);

  const when = (v: string) =>
    new Date(v).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).replace(".", "");

  const openMenu = (g: (typeof groups)[number], pos: MenuPos) =>
    menu.open(
      pos,
      {
        title: g.name,
        subtitle: `${g.items.length} perfume${g.items.length === 1 ? "" : "s"} de interesse`,
        main: [
          { key: "ver", label: "Ver cliente", icon: <User />, onSelect: () => (setEditing(false), setOpenId(g.customerId)) },
          { key: "editar", label: "Editar cliente", icon: <Pencil />, onSelect: () => (setEditing(true), setOpenId(g.customerId)) },
        ],
        danger: [{ key: "del", label: "Excluir cliente", icon: <Trash2 />, danger: true, onSelect: () => setConfirm({ id: g.customerId!, name: g.name }) }],
      },
      g.key,
    );

  return (
    <section className="mt-10">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-[22px] font-bold tracking-[-0.02em]">Interesses recebidos</h2>
          <p className="mt-0.5 text-[14px] text-[#8C8C8C]">Cada nome é a ficha real do cliente.</p>
        </div>
      </div>
      {loading ? (
        <div className="admin-skeleton mt-4 h-24 rounded-[24px]" />
      ) : groups.length === 0 ? (
        <div className="dash-card mt-4 flex items-center gap-3 p-5 text-[15px] text-[#A9A9A9]">
          <span className="grid size-10 place-items-center rounded-full bg-[#232323]">
            <Users className="size-[18px]" />
          </span>
          Ninguém demonstrou interesse ainda.
        </div>
      ) : (
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {groups.map((g, i) => (
            <article key={g.key} data-item-id={g.key} className="pk-row pk-in flex gap-3.5 p-4" style={{ ["--i" as string]: i }} onClick={() => g.customerId && (setEditing(false), setOpenId(g.customerId))}>
              <span className="grid size-11 shrink-0 place-items-center rounded-full bg-[#FFD599] text-[15px] font-bold text-[#15130F]">{initials(g.name)}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="min-w-0 flex-1 truncate text-[16px] font-bold">{g.name}</p>
                  {g.archived ? <span className="shrink-0 rounded-full bg-[#232323] px-2 py-0.5 text-[11px] text-[#8C8C8C]">arquivado</span> : null}
                  {g.customerId ? <ItemMenuButton size="sm" label={`Ações de ${g.name}`} onOpen={(pos) => openMenu(g, pos)} /> : null}
                </div>
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {g.items.map((it) => {
                    const target = items.find((x) => x.id === it.item_id);
                    return (
                      <li key={it.id}>
                        <button
                          type="button"
                          disabled={!target}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (target) onOpenItem(target);
                          }}
                          className="press inline-flex h-8 max-w-full items-center gap-2 rounded-full bg-[#232323] pr-3 pl-3 text-[12.5px] transition-colors enabled:hover:bg-[#2C2C2C] disabled:cursor-default"
                        >
                          <span className="truncate font-semibold text-white">{it.item_name}</span>
                          <span className="shrink-0 text-[#8C8C8C]">{when(it.created_at)}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </article>
          ))}
        </div>
      )}

      {menu.node}
      {/* mesma ficha e mesmo editor de Admin → Clientes */}
      <CustomerSheet id={openId} openEditor={editing} onClose={() => setOpenId(null)} />

      <AlertDialog open={!!confirm} onOpenChange={(v) => !v && setConfirm(null)}>
        <AlertDialogContent className="max-w-[min(92vw,26rem)] rounded-[28px]">
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir este cliente?</AlertDialogTitle>
            <AlertDialogDescription>
              A ficha de {confirm?.name ?? "este cliente"} sai da área de Clientes. Os pedidos já feitos continuam guardados.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11 rounded-full">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              className="h-11 rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                if (!confirm) return;
                setBusy(true);
                try {
                  await removeCustomer({ data: { id: confirm.id } });
                  toast.success("Ficha do cliente excluída. Os pedidos continuam salvos.");
                  await qc.invalidateQueries({ queryKey: ["negotiation-interests"] });
                  void qc.invalidateQueries({ queryKey: ["crm-customers"] });
                  void qc.invalidateQueries({ queryKey: ["crm-overview"] });
                  setConfirm(null);
                } catch (e) {
                  toast.error((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Excluir cliente
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
