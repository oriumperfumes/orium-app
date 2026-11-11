import { useMemo, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Gem, ImagePlus, Loader2, MoreHorizontal, Pencil, Plus, Trash2, User, X } from "lucide-react";
import { AdminShell } from "@/components/orium/AdminShell";
import { AdminEmpty, AdminMore, AdminStatus } from "@/components/orium/admin/AdminUI";
import { CustomerSheet } from "@/components/orium/CustomerSheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { crmCustomerDelete } from "@/lib/crm.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
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
  NEGOTIATION_STATUS_LABEL,
  negotiationPhoto,
  type NegotiationItem,
  type NegotiationStatus,
} from "@/lib/negotiation";
import {
  deleteNegotiationItem,
  listNegotiationAdmin,
  listNegotiationInterests,
  removeNegotiationPhoto,
  saveNegotiationItem,
  setNegotiationPhoto,
  uploadNegotiationPhoto,
} from "@/lib/negotiation.functions";
import { optimizePhoto } from "@/lib/image-optimize";
import { FragranceEditor } from "@/components/orium/FragranceEditor";
import { useVisualViewport } from "@/hooks/use-visual-viewport";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/admin/negociacao")({
  component: AdminNegotiation,
});

const STATUSES: NegotiationStatus[] = ["AVAILABLE", "NEGOTIATING", "SOLD", "HIDDEN"];

type Draft = {
  id: string | null;
  /** Ficha olfativa interna (mesmo sistema do catálogo). */
  productId: string | null;
  name: string;
  brand: string;
  volume: string;
  description: string;
  conditionNote: string;
  status: NegotiationStatus;
  showWhenNegotiating: boolean;
  imagePath: string | null;
  priority: string;
};

const emptyDraft = (): Draft => ({
  id: null,
  productId: null,
  name: "",
  brand: "",
  volume: "",
  description: "",
  conditionNote: "Praticamente cheio",
  status: "AVAILABLE",
  showWhenNegotiating: true,
  imagePath: null,
  priority: "0",
});

const toDraft = (item: NegotiationItem): Draft => ({
  id: item.id,
  productId: item.product_id ?? null,
  name: item.name,
  brand: item.brand ?? "",
  volume: item.volume_ml ? String(item.volume_ml) : "",
  description: item.description ?? "",
  conditionNote: item.condition_note,
  status: item.status,
  showWhenNegotiating: item.show_when_negotiating,
  imagePath: item.image_url,
  priority: String(item.priority ?? 0),
});

function AdminNegotiation() {
  const qc = useQueryClient();
  const list = useServerFn(listNegotiationAdmin);
  const remove = useServerFn(deleteNegotiationItem);
  const uploadPhoto = useServerFn(uploadNegotiationPhoto);
  const swapPhoto = useServerFn(setNegotiationPhoto);
  const [optimizing, setOptimizing] = useState(false);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["negotiation-admin"],
    retry: false,
    queryFn: async () => await list(),
  });

  const items = useMemo(
    () => ((data?.items ?? []) as unknown as NegotiationItem[]),
    [data],
  );

  const removeMutation = useMutation({
    mutationFn: async (id: string) => await remove({ data: { id } }),
    onSuccess: () => {
      toast.success("Item removido da Negociação.");
      void qc.invalidateQueries({ queryKey: ["negotiation-admin"] });
      void qc.invalidateQueries({ queryKey: ["negotiation-public"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /**
   * Fotos que ainda não estão otimizadas: formatos antigos (JPG/PNG) e também
   * WebP sem a versão leve do card — o servidor avisa qual versão entregou.
   */
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
        const up = await uploadPhoto({
          data: { base64: optimized.main, contentType: "image/webp", cardBase64: optimized.card },
        });
        await swapPhoto({ data: { id: item.id, path: up.path } });
        done += 1;
        saved += Math.max(0, optimized.originalBytes - optimized.mainBytes - optimized.cardBytes);
      }
      toast.success(
        done === 0
          ? "Nenhuma foto antiga para converter."
          : `${done} foto${done === 1 ? "" : "s"} convertida${done === 1 ? "" : "s"} para WebP · -${Math.round(saved / 1024)} KB`,
      );
      void qc.invalidateQueries({ queryKey: ["negotiation-admin"] });
      void qc.invalidateQueries({ queryKey: ["negotiation-public"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setOptimizing(false);
    }
  };

  return (
    <AdminShell
      title="Negociação"
      action={
        <div className="flex items-center gap-2">
          <Button className="press h-11 rounded-full px-5" onClick={() => setDraft(emptyDraft())}>
            <Plus className="size-4" /> Adicionar perfume
          </Button>
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
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-2xl bg-surface-3" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <AdminEmpty>Nenhum perfume na Negociação.</AdminEmpty>
      ) : (
        <div className="space-y-3">
          {items.map((item) => {
            const photo = negotiationPhoto(item.image_url, "card");
            return (
              <div
                key={item.id}
                className="flex gap-3 rounded-2xl border border-border/60 bg-surface-2 p-3"
              >
                <div className="size-20 shrink-0 overflow-hidden rounded-xl bg-surface-3">
                  {photo ? (
                    <img src={photo} alt={item.name} className="size-full object-cover" />
                  ) : (
                    <div className="grid size-full place-items-center text-muted-foreground">
                      <Gem className="size-5" />
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[10.5px] tracking-wide text-muted-foreground uppercase">
                    {item.brand ?? "Orium"}
                  </p>
                  <p className="truncate text-sm font-medium">{item.name}</p>
                  <div className="mt-1.5">
                    <AdminStatus status={NEGOTIATION_STATUS_LABEL[item.status].toLowerCase()} />
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <Button
                      variant="outline"
                      className="press h-9 rounded-full px-3 text-xs"
                      onClick={() => setDraft(toDraft(item))}
                    >
                      <Pencil className="size-3.5" /> Editar
                    </Button>
                    <AdminMore
                      actions={[
                        { label: "Editar", icon: <Pencil className="size-4" />, onSelect: () => setDraft(toDraft(item)) },
                        {
                          label: "Remover",
                          icon: <Trash2 className="size-4" />,
                          danger: true,
                          separated: true,
                          onSelect: () => setConfirmId(item.id),
                        },
                      ]}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <InterestList />

      <NegotiationDrawer
        draft={draft}
        setDraft={setDraft as (d: Draft) => void}
        close={() => setDraft(null)}
        refresh={() => {
          void qc.invalidateQueries({ queryKey: ["negotiation-admin"] });
          void qc.invalidateQueries({ queryKey: ["negotiation-public"] });
        }}
      />


      <AlertDialog open={confirmId !== null} onOpenChange={(o) => !o && setConfirmId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover este perfume da Negociação?</AlertDialogTitle>
            <AlertDialogDescription>
              Somente este item de Negociação será apagado. Nada do catálogo é afetado.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-full">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-full"
              onClick={() => {
                if (confirmId) removeMutation.mutate(confirmId);
                setConfirmId(null);
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

/**
 * Quem demonstrou interesse, já ligado ao CRM.
 *
 * Uma pessoa = uma ficha (mesmo `customer_id`), com todos os perfumes que ela
 * quis negociar embaixo do nome. Ver, editar e excluir usam exatamente a mesma
 * ficha e o mesmo editor de Admin → Clientes.
 */
function InterestList() {
  const load = useServerFn(listNegotiationInterests);
  const removeCustomer = useServerFn(crmCustomerDelete);
  const qc = useQueryClient();
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["negotiation-interests"],
    retry: false,
    queryFn: async () => await load(),
  });

  const groups = useMemo(() => {
    const rows = data?.interests ?? [];
    const out: Array<{
      key: string;
      customerId: string | null;
      name: string;
      archived: boolean;
      items: Array<{ id: string; item_id: string | null; item_name: string; created_at: string }>;
    }> = [];
    const index = new Map<string, number>();
    for (const r of rows) {
      const key = r.customer_id ?? `sem-ficha-${r.id}`;
      const item = {
        id: r.id,
        item_id: r.negotiation_item_id,
        item_name: r.item_name,
        created_at: r.created_at,
      };
      const at = index.get(key);
      if (at == null) {
        index.set(key, out.length);
        out.push({
          key,
          customerId: r.customer_id,
          name: r.customer_name ?? "Sem nome",
          archived: r.customer_archived,
          items: [item],
        });
      } else {
        out[at]!.items.push(item);
      }
    }
    return out;
  }, [data]);

  const when = (v: string) =>
    new Date(v).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });

  return (
    <section className="mt-8">
      <h2 className="text-sm font-semibold">Interesses recebidos</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Cada nome é a ficha real do cliente — abra, corrija ou exclua sem sair daqui.
      </p>
      {isLoading ? (
        <div className="mt-3 h-16 animate-pulse rounded-2xl bg-surface-3" />
      ) : groups.length === 0 ? (
        <p className="mt-3 rounded-2xl border border-border/60 bg-surface-2 p-4 text-sm text-muted-foreground">
          Ninguém demonstrou interesse ainda.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/60 bg-surface-2">
          {groups.map((g) => (
            <li key={g.key} className="px-3 py-2.5">
              <div className="flex items-center gap-2">
                {g.customerId ? (
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(false);
                      setOpenId(g.customerId);
                    }}
                    className="press min-w-0 flex-1 truncate text-left text-sm font-medium underline decoration-border underline-offset-4 transition-colors hover:text-primary"
                  >
                    {g.name}
                  </button>
                ) : (
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{g.name}</span>
                )}
                {g.archived ? (
                  <span className="shrink-0 text-[11px] text-muted-foreground">arquivado</span>
                ) : null}
                {g.customerId ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        aria-label={`Ações de ${g.name}`}
                        className="press grid size-10 shrink-0 place-items-center rounded-full border border-border/70 bg-surface-3 text-foreground transition-colors hover:bg-surface-2"
                      >
                        <MoreHorizontal className="size-5" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48 rounded-2xl">
                      <DropdownMenuItem
                        onClick={() => {
                          setEditing(false);
                          setOpenId(g.customerId);
                        }}
                      >
                        <User className="size-4" /> Ver cliente
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => {
                          setEditing(true);
                          setOpenId(g.customerId);
                        }}
                      >
                        <Pencil className="size-4" /> Editar cliente
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onClick={() => setConfirm({ id: g.customerId!, name: g.name })}
                      >
                        <Trash2 className="size-4" /> Excluir cliente
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </div>
              <ul className="mt-1 space-y-0.5">
                {g.items.map((it) => (
                  <li key={it.id} className="flex items-baseline gap-2 text-xs text-muted-foreground">
                    <span className="min-w-0 flex-1 truncate">{it.item_name}</span>
                    <span className="shrink-0 text-[11px]">{when(it.created_at)}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}

      {/* mesma ficha e mesmo editor de Admin → Clientes */}
      <CustomerSheet id={openId} openEditor={editing} onClose={() => setOpenId(null)} />

      <AlertDialog open={!!confirm} onOpenChange={(v) => !v && setConfirm(null)}>
        <AlertDialogContent className="max-w-[min(92vw,26rem)] rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir este cliente?</AlertDialogTitle>
            <AlertDialogDescription>
              A ficha de {confirm?.name ?? "este cliente"} sai da área de Clientes. Os pedidos já
              feitos continuam guardados.
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

/**
 * Painel inferior de cadastro/edição.
 *
 * O teclado virtual do iOS não altera o layout viewport, então a altura e a
 * posição seguem o visual viewport. Com o teclado aberto o gesto de arrastar
 * para fechar fica desativado, para o scroll do formulário não fechar o painel.
 * O rascunho vive no componente pai, portanto nada digitado é perdido.
 */
function NegotiationDrawer({
  draft,
  setDraft,
  close,
  refresh,
}: {
  draft: Draft | null;
  setDraft: (d: Draft) => void;
  close: () => void;
  refresh: () => void;
}) {
  const open = draft !== null;
  const vv = useVisualViewport(open);

  const style: React.CSSProperties = vv.supported
    ? vv.isKeyboardOpen
      ? { height: vv.height, maxHeight: vv.height, bottom: vv.keyboardOffset }
      : { maxHeight: Math.round(vv.height * 0.92) }
    : {};

  return (
    <Drawer
      open={open}
      onOpenChange={(o) => !o && close()}
      repositionInputs={false}
      dismissible={!vv.isKeyboardOpen}
    >
      <DrawerContent
        style={style}
        className={cn(
          "flex min-h-0 flex-col overflow-hidden",
          !vv.supported && "max-h-[92dvh]",
        )}
      >
        <DrawerHeader className="shrink-0 pb-2">
          <DrawerTitle>{draft?.id ? "Editar perfume" : "Adicionar perfume"}</DrawerTitle>
        </DrawerHeader>
        {draft ? (
          <NegotiationForm
            draft={draft}
            setDraft={setDraft}
            keyboardOpen={vv.isKeyboardOpen}
            onSaved={refresh}
            onDone={() => {
              close();
              refresh();
            }}
          />
        ) : null}
      </DrawerContent>
    </Drawer>
  );
}


function NegotiationForm({
  draft,
  setDraft,
  keyboardOpen,
  onSaved,
  onDone,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  keyboardOpen: boolean;
  onSaved: () => void;
  onDone: () => void;
}) {
  const save = useServerFn(saveNegotiationItem);
  const upload = useServerFn(uploadNegotiationPhoto);
  const dropPhoto = useServerFn(removeNegotiationPhoto);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [busy, setBusy] = useState<null | "photo" | "save">(null);

  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });

  const pickPhoto = async (file: File) => {
    setBusy("photo");
    try {
      // Foto do celular entra grande e em JPEG: convertemos aqui para WebP de
      // alta qualidade (principal + versão do card) antes de enviar.
      const optimized = await optimizePhoto(file);
      const res = await upload({
        data: { base64: optimized.main, contentType: "image/webp", cardBase64: optimized.card },
      });
      const old = draft.imagePath;
      set({ imagePath: res.path });
      if (old) await dropPhoto({ data: { path: old } });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const submit = async () => {
    setBusy("save");
    try {
      const res = await save({
        data: {
          id: draft.id,
          name: draft.name,
          brand: draft.brand,
          volumeMl: draft.volume ? Number(draft.volume) : null,
          description: draft.description,
          conditionNote: draft.conditionNote,
          status: draft.status,
          showWhenNegotiating: draft.showWhenNegotiating,
          imageUrl: draft.imagePath,
          priority: Number(draft.priority) || 0,
        },
      });
      set({ id: res.id, productId: res.productId ?? draft.productId });
      onSaved();
      toast.success(
        draft.productId
          ? "Perfume salvo na Negociação."
          : "Perfume salvo. Agora complete as informações olfativas abaixo.",
      );
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const photo = negotiationPhoto(draft.imagePath);

  // mantém o campo tocado visível acima do teclado, sem pulos
  const onFieldFocus = (event: React.FocusEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;
    window.setTimeout(() => {
      target.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 320);
  };



  return (
    <div
      onFocus={onFieldFocus}
      data-vaul-no-drag=""
      className={cn(
        "min-h-0 flex-1 touch-pan-y space-y-5 overflow-y-auto overscroll-contain px-4",
        keyboardOpen ? "pb-6" : "pb-[calc(1.5rem+env(safe-area-inset-bottom))]",
      )}
    >

      {/* Foto real do item — câmera ou galeria */}
      <div>
        <Label className="text-sm">Foto do perfume</Label>
        <div className="mt-2 flex items-center gap-3">
          <div className="size-24 shrink-0 overflow-hidden rounded-2xl border border-border/60 bg-surface-3">
            {photo ? (
              <img src={photo} alt="Foto do perfume" className="size-full object-cover" />
            ) : (
              <div className="grid size-full place-items-center text-muted-foreground">
                <ImagePlus className="size-5" />
              </div>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <Button
              type="button"
              variant="outline"
              className="press h-10 rounded-full px-4 text-xs"
              disabled={busy === "photo"}
              onClick={() => fileRef.current?.click()}
            >
              {busy === "photo" ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
              {photo ? "Trocar foto" : "Escolher foto"}
            </Button>
            {photo ? (
              <Button
                type="button"
                variant="ghost"
                className="press h-9 rounded-full px-4 text-xs text-muted-foreground"
                onClick={async () => {
                  const old = draft.imagePath;
                  set({ imagePath: null });
                  if (old) await dropPhoto({ data: { path: old } });
                }}
              >
                <X className="size-3.5" /> Remover foto
              </Button>
            ) : null}
          </div>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void pickPhoto(file);
          }}
        />
      </div>

      <Field label="Nome do perfume">
        <Input
          className="h-11"
          value={draft.name}
          onChange={(e) => set({ name: e.target.value })}
          placeholder="Ex.: Khamrah"
        />
      </Field>

      <Field label="Marca">
        <Input
          className="h-11"
          value={draft.brand}
          onChange={(e) => set({ brand: e.target.value })}
          placeholder="Ex.: Lattafa"
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Volume (ml)">
          <Input
            className="h-11"
            inputMode="numeric"
            value={draft.volume}
            onChange={(e) => set({ volume: e.target.value.replace(/\D/g, "") })}
            placeholder="100"
          />
        </Field>
        <Field label="Ordem (maior primeiro)">
          <Input
            className="h-11"
            inputMode="numeric"
            value={draft.priority}
            onChange={(e) => set({ priority: e.target.value.replace(/[^\d-]/g, "") })}
          />
        </Field>
      </div>

      <Field label="Estado do frasco">
        <Input
          className="h-11"
          value={draft.conditionNote}
          onChange={(e) => set({ conditionNote: e.target.value })}
          placeholder="Praticamente cheio"
        />
      </Field>

      <Field label="Situação">
        <div className="flex flex-wrap gap-2">
          {STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => set({ status: s })}
              className={
                "press h-10 rounded-full border px-4 text-xs " +
                (draft.status === s
                  ? "border-foreground bg-foreground text-background"
                  : "border-border/70 text-muted-foreground")
              }
            >
              {NEGOTIATION_STATUS_LABEL[s]}
            </button>
          ))}
        </div>
      </Field>

      {draft.status === "NEGOTIATING" ? (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4"
            checked={draft.showWhenNegotiating}
            onChange={(e) => set({ showWhenNegotiating: e.target.checked })}
          />
          Continuar aparecendo com o selo “Em negociação”
        </label>
      ) : null}

      <Field label="Descrição">
        <Textarea
          rows={4}
          value={draft.description}
          onChange={(e) => set({ description: e.target.value })}
          placeholder="Conte em poucas linhas o estado do frasco e o que faz esse perfume valer a pena."
        />
      </Field>

      {/* Informações olfativas: exatamente o mesmo sistema dos perfumes do catálogo */}
      {draft.productId ? (
        <FragranceEditor productId={draft.productId} defaultOpen allowCopyFromCatalog />
      ) : (
        <div className="rounded-2xl border border-border/60 bg-surface-2 p-4">
          <p className="text-sm font-medium">Informações olfativas</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Salve o perfume primeiro. Em seguida abre aqui o mesmo bloco dos perfumes do
            catálogo: link do Fragrantica, colar conteúdo, acordes, pirâmide e imagens das notas.
          </p>
        </div>
      )}

      <div className="space-y-2">
        <Button
          className="press h-12 w-full rounded-full text-sm font-semibold"
          disabled={busy === "save" || !draft.name.trim()}
          onClick={() => void submit()}
        >
          {busy === "save" ? <Loader2 className="size-4 animate-spin" /> : null} Salvar perfume
        </Button>
        {draft.productId ? (
          <Button
            variant="outline"
            className="press h-11 w-full rounded-full text-sm"
            onClick={onDone}
          >
            Concluir
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label className="text-sm">{label}</Label>
      <div className="mt-2">{children}</div>
    </div>
  );
}
