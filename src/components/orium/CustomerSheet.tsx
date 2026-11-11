/**
 * FICHA DO CLIENTE (CRM) — painel único usado em Admin → Clientes e também em
 * Admin → Negociação → Interesses recebidos.
 *
 * Uma só fonte de verdade: mesma ficha, mesmo editor, mesma exclusão. Editar ou
 * excluir aqui atualiza na hora as duas áreas.
 */
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import {
  MessageCircle,
  Loader2,
  ChevronDown,
  ChevronRight,
  Trash2,
  Pencil,
  Archive,
  ArchiveRestore,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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
import { brl, productTitle } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  crmCustomer,
  crmAddNote,
  crmDeleteNote,
  crmCustomerUpdate,
  crmCustomerArchive,
  crmCustomerDelete,
} from "@/lib/crm.functions";
import { customerJourney } from "@/lib/analytics-admin.functions";

const date = (v?: string | null) =>
  v ? new Date(v).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "2-digit" }) : "—";

const when = (v?: string | null) =>
  v
    ? new Date(v).toLocaleString("pt-BR", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

const whats = (phone?: string | null) => {
  const d = (phone ?? "").replace(/\D/g, "");
  if (d.length < 10) return null;
  return `https://wa.me/${d.startsWith("55") ? d : `55${d}`}`;
};

export function CustomerSheet({
  id,
  onClose,
  openEditor,
}: {
  id: string | null;
  onClose: () => void;
  /** Abre já com os dados do cliente expandidos (ação "Editar cliente"). */
  openEditor?: boolean;
}) {
  const detailFn = useServerFn(crmCustomer);
  const addNote = useServerFn(crmAddNote);
  const delNote = useServerFn(crmDeleteNote);
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["crm-customer", id],
    enabled: !!id,
    queryFn: () => detailFn({ data: { id: id! } }),
  });

  const link = whats(data?.customer.phone);

  return (
    <Sheet open={!!id} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="truncate">{data?.customer.name ?? "Ficha do cliente"}</SheetTitle>
          <SheetDescription>{data?.customer.phone ?? data?.customer.email ?? "sem contato"}</SheetDescription>
        </SheetHeader>

        <div className="space-y-4 px-4 pb-8">
          {isLoading ? (
            <>
              <Skeleton className="h-20 rounded-2xl" />
              <Skeleton className="h-40 rounded-2xl" />
            </>
          ) : isError || !data ? (
            <p className="text-sm text-muted-foreground">Não conseguimos abrir esta ficha agora.</p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Box label="Pedidos" value={String(data.metrics.orders_count)} />
                <Box label="Total gasto" value={brl(Number(data.metrics.total_spent))} />
                <Box label="Ticket médio" value={brl(Number(data.metrics.avg_ticket))} />
                <Box label="Última compra" value={date(data.metrics.last_order_at)} />
              </div>
              {data.metrics.orders_count > (data.metrics.confirmed_count ?? 0) ? (
                <p className="text-xs text-muted-foreground">
                  {data.metrics.orders_count - (data.metrics.confirmed_count ?? 0)} pedido(s) ainda sem confirmação — não
                  entram nos valores acima.
                </p>
              ) : null}
              {data.customer.provisional ? (
                <p className="text-xs text-muted-foreground">Cliente identificado pelo dispositivo.</p>
              ) : null}
              <JourneyBlock id={id!} />
              {data.customer.archived_at ? (
                <p className="rounded-xl border border-border/70 bg-surface-3 p-3 text-xs text-muted-foreground">
                  Cliente arquivado em {date(data.customer.archived_at)}. O histórico de pedidos continua guardado.
                </p>
              ) : null}
              {link ? (
                <Button asChild className="h-11 w-full rounded-full">
                  <a href={link} target="_blank" rel="noreferrer">
                    <MessageCircle className="size-4" /> Falar no WhatsApp
                  </a>
                </Button>
              ) : null}

              <CustomerEditor
                customer={data.customer}
                defaultOpen={!!openEditor}
                onSaved={() => {
                  void qc.invalidateQueries({ queryKey: ["crm-customer", id] });
                  void qc.invalidateQueries({ queryKey: ["crm-customers"] });
                  void qc.invalidateQueries({ queryKey: ["crm-overview"] });
                  // o nome mostrado nos interesses da Negociação vem da mesma ficha
                  void qc.invalidateQueries({ queryKey: ["negotiation-interests"] });
                }}
                onDeleted={() => {
                  void qc.invalidateQueries({ queryKey: ["crm-customers"] });
                  void qc.invalidateQueries({ queryKey: ["crm-overview"] });
                  void qc.invalidateQueries({ queryKey: ["negotiation-interests"] });
                  onClose();
                }}
              />




              <Section title={`Decants que já experimentou (${data.decants.length})`} defaultOpen>
                {data.decants.length ? (
                  <ul className="space-y-1.5 text-sm">
                    {data.decants.map((d, i) => (
                      <li key={`${d.name}-${d.ml}-${i}`} className="flex justify-between gap-3">
                        <span className="min-w-0 truncate">{productTitle(d.name)}</span>
                        <span className="shrink-0 text-muted-foreground">
                          {d.ml}ml · {d.quantity}x
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Empty>Ainda não experimentou decants.</Empty>
                )}
              </Section>

              <Section title={`Frascos já comprados (${data.bottles.length})`}>
                {data.bottles.length ? (
                  <ul className="space-y-1.5 text-sm">
                    {data.bottles.map((b, i) => (
                      <li key={`${b.name}-${i}`} className="flex justify-between gap-3">
                        <span className="min-w-0 truncate">{productTitle(b.name)}</span>
                        <span className="shrink-0 text-muted-foreground">
                          {b.volume_ml ? `${b.volume_ml}ml · ` : ""}
                          {b.quantity}x
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Empty>Nenhum frasco comprado.</Empty>
                )}
              </Section>

              {data.others.length ? (
                <Section title={`Outros produtos (${data.others.length})`}>
                  <ul className="space-y-1.5 text-sm">
                    {data.others.map((o, i) => (
                      <li key={`${o.name}-${i}`} className="flex justify-between gap-3">
                        <span className="min-w-0 truncate">{productTitle(o.name)}</span>
                        <span className="shrink-0 text-muted-foreground">{o.quantity}x</span>
                      </li>
                    ))}
                  </ul>
                </Section>
              ) : null}

              <Section title={`Favoritos (${data.favorites.length})`}>
                {data.favorites.length ? (
                  <ul className="space-y-1.5 text-sm">
                    {data.favorites.map((f) => (
                      <li key={f.product_id} className="flex justify-between gap-3">
                        <span className="min-w-0 truncate">{productTitle(f.name)}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {f.want_decant ? "quer experimentar" : "salvo"}
                          {f.in_stock ? "" : " · indisponível"}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Empty>Nenhum favorito.</Empty>
                )}
              </Section>

              <Section
                title={`Interesses em negociação (${data.negotiations?.length ?? 0})`}
                defaultOpen={(data.negotiations?.length ?? 0) > 0}
              >
                {data.negotiations?.length ? (
                  <ul className="space-y-1.5 text-sm">
                    {data.negotiations.map((n) => (
                      <li key={n.id} className="flex justify-between gap-3">
                        <Link
                          to="/negociacao/$id"
                          params={{ id: n.item_id }}
                          className="min-w-0 truncate hover:text-primary"
                        >
                          {productTitle(n.item_name)}
                        </Link>
                        <span className="shrink-0 text-xs text-muted-foreground">{date(n.created_at)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Empty>Nenhum interesse em negociação.</Empty>
                )}
              </Section>

              <Section title={`Aguardando estoque (${data.waiting.length})`}>
                {data.waiting.length ? (
                  <ul className="space-y-1.5 text-sm">
                    {data.waiting.map((w) => (
                      <li key={w.product_id} className="flex justify-between gap-3">
                        <span className="min-w-0 truncate">{productTitle(w.name)}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">{date(w.created_at)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Empty>Não está esperando nenhum perfume.</Empty>
                )}
              </Section>

              <Section title={`Carrinhos (${data.carts.length})`}>
                {data.carts.length ? (
                  <ul className="space-y-2.5">
                    {data.carts.map((c) => (
                      <li key={c.id} className="rounded-xl border border-border/70 p-3">
                        <div className="flex items-center justify-between gap-3 text-sm">
                          <span className="font-medium">
                            {c.status === "ACTIVE"
                              ? "Carrinho atual"
                              : c.status === "ABANDONED"
                                ? "Abandonado"
                                : c.status === "RECOVERED"
                                  ? "Recuperado"
                                  : "Convertido em pedido"}
                          </span>
                          <span className="tabular-nums">{brl(Number(c.estimated_total))}</span>
                        </div>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          {c.items_count} item(ns) · atividade {date(c.last_activity_at)}
                        </p>
                        <ul className="mt-1.5 space-y-1 text-xs text-muted-foreground">
                          {c.items.map((it, i) => (
                            <li key={i} className="truncate">
                              {it.quantity}x {productTitle(it.name ?? "")}{" "}
                              {it.variant === "DECANT" ? `· decant ${it.decant_ml}ml` : "· frasco"}
                            </li>
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Empty>Nenhum carrinho registrado.</Empty>
                )}
              </Section>

              <Section title={`Pedidos (${data.orders.length})`} defaultOpen>
                {data.orders.length ? (
                  <ul className="space-y-1.5 text-sm">
                    {data.orders.map((o) => (
                      <li key={o.id}>
                        <Link
                          to="/admin/pedidos"
                          search={{ pedido: o.id }}
                          onClick={onClose}
                          className="press flex items-center justify-between gap-3 rounded-xl border border-border/70 p-2.5 transition-colors hover:bg-surface-3"
                        >
                          <span className="min-w-0">
                            <span className="block truncate font-medium">
                              {o.order_number ?? o.id.slice(0, 8)}
                            </span>
                            <span className="block truncate text-[11px] text-muted-foreground">
                              {date(o.created_at)} · {o.status}
                              {o.is_confirmed ? "" : " · aguardando confirmação"}
                            </span>
                          </span>
                          <span className="flex shrink-0 items-center gap-1 tabular-nums">
                            {brl(Number(o.total))}
                            <ChevronRight className="size-4 text-muted-foreground" />
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Empty>Nenhum pedido.</Empty>
                )}
              </Section>


              <Section
                title={`Acessou recentemente (${data.recent_views?.length ?? 0})`}
                defaultOpen
              >
                {data.recent_views?.length ? (

                  <ul className="space-y-1.5 text-sm">
                    {data.recent_views.map((v) => {
                      const row = (
                        <>
                          <span className="min-w-0">
                            <span className="block truncate font-medium">{productTitle(v.name)}</span>
                            <span className="block truncate text-[11px] text-muted-foreground">
                              {v.brand ? `${v.brand} · ` : ""}
                              {when(v.last_at)}
                              {v.views > 1 ? ` · ${v.views}x` : ""}
                              {v.in_stock ? "" : " · sem estoque"}
                            </span>
                          </span>
                          {v.slug ? <ChevronRight className="size-4 shrink-0 text-muted-foreground" /> : null}
                        </>
                      );
                      return (
                        <li key={v.product_id}>
                          {v.slug ? (
                            <Link
                              to="/perfume/$slug"
                              params={{ slug: v.slug }}
                              onClick={onClose}
                              className="press flex items-center justify-between gap-3 rounded-xl border border-border/70 p-2.5 transition-colors hover:bg-surface-3"
                            >
                              {row}
                            </Link>
                          ) : (
                            <div className="flex items-center justify-between gap-3 rounded-xl border border-border/70 p-2.5">
                              {row}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <Empty>Nenhum acesso registrado ainda.</Empty>
                )}
              </Section>


              {data.viewed.length ? (
                <Section title="Perfumes que mais acessou">
                  <ul className="space-y-1.5 text-sm">
                    {data.viewed.map((v, i) => (
                      <li key={i} className="flex justify-between gap-3">
                        <span className="min-w-0 truncate">{productTitle(v.name)}</span>
                        <span className="shrink-0 text-muted-foreground">{v.views}x</span>
                      </li>
                    ))}
                  </ul>
                </Section>
              ) : null}

              <Section title={`Anotações internas (${data.notes.length})`} defaultOpen>
                <div className="space-y-2">
                  <Textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Ex.: prefere fragrâncias doces, comprou para presente…"
                    className="min-h-20 rounded-xl"
                  />
                  <Button
                    className="h-10 w-full rounded-full"
                    disabled={saving || note.trim().length < 2}
                    onClick={async () => {
                      setSaving(true);
                      try {
                        await addNote({ data: { customerId: data.customer.id, note } });
                        setNote("");
                        await qc.invalidateQueries({ queryKey: ["crm-customer", id] });
                        toast.success("Anotação salva.");
                      } catch (e) {
                        toast.error((e as Error).message);
                      } finally {
                        setSaving(false);
                      }
                    }}
                  >
                    {saving ? <Loader2 className="size-4 animate-spin" /> : "Salvar anotação"}
                  </Button>
                  <ul className="space-y-2">
                    {data.notes.map((n) => (
                      <li key={n.id} className="rounded-xl bg-surface-2 p-3 text-sm">
                        <div className="flex items-start justify-between gap-2">
                          <p className="min-w-0 break-words whitespace-pre-wrap">{n.note}</p>
                          <button
                            type="button"
                            aria-label="Remover anotação"
                            className="shrink-0 text-muted-foreground"
                            onClick={async () => {
                              await delNote({ data: { id: n.id } });
                              await qc.invalidateQueries({ queryKey: ["crm-customer", id] });
                            }}
                          >
                            <Trash2 className="size-4" />
                          </button>
                        </div>
                        <p className="mt-1 text-[11px] text-muted-foreground">{date(n.created_at)}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              </Section>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

const Box = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-xl border border-border/70 p-3">
    <p className="text-[11px] tracking-wide text-muted-foreground uppercase">{label}</p>
    <p className="mt-0.5 text-sm font-semibold">{value}</p>
  </div>
);

const Empty = ({ children }: { children: React.ReactNode }) => (
  <p className="text-sm text-muted-foreground">{children}</p>
);

function Section({
  title,
  children,
  defaultOpen,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-2xl border border-border/70 bg-card">
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-semibold">
        <span className="min-w-0 truncate">{title}</span>
        <ChevronDown className={cn("size-4 shrink-0 transition-transform duration-200", open && "rotate-180")} />
      </CollapsibleTrigger>
      <CollapsibleContent className="px-4 pb-4">{children}</CollapsibleContent>
    </Collapsible>
  );
}

/** Corrigir dados do cliente e arquivar sem apagar histórico. */
function CustomerEditor({
  customer,
  onSaved,
  onDeleted,
  defaultOpen,
}: {
  customer: { id: string; name: string | null; phone: string | null; email: string | null; archived_at: string | null };
  onSaved: () => void;
  onDeleted: () => void;
  defaultOpen?: boolean;
}) {
  const update = useServerFn(crmCustomerUpdate);
  const archive = useServerFn(crmCustomerArchive);
  const remove = useServerFn(crmCustomerDelete);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [open, setOpen] = useState(!!defaultOpen);
  const [name, setName] = useState(customer.name ?? "");
  const [phone, setPhone] = useState(customer.phone ?? "");
  const [email, setEmail] = useState(customer.email ?? "");
  const [busy, setBusy] = useState(false);
  const archived = !!customer.archived_at;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <Button variant="outline" className="h-11 w-full justify-between rounded-full">
          <span className="flex items-center gap-2">
            <Pencil className="size-4" /> Dados do cliente
          </span>
          <ChevronDown className={cn("size-4 transition-transform duration-200", open && "rotate-180")} />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-3">
        <div className="space-y-2.5 rounded-2xl border border-border/70 p-3.5">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome" className="h-11 rounded-xl" />
          <Input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="WhatsApp"
            inputMode="tel"
            className="h-11 rounded-xl"
          />
          <Input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="E-mail"
            inputMode="email"
            className="h-11 rounded-xl"
          />
          <Button
            className="h-11 w-full rounded-full"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await update({ data: { id: customer.id, name, phone, email } });
                toast.success("Dados do cliente atualizados.");
                onSaved();
              } catch (e) {
                toast.error((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : "Salvar dados"}
          </Button>
          <Button
            variant="outline"
            className="h-11 w-full rounded-full"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await archive({ data: { id: customer.id, archived: !archived } });
                toast.success(archived ? "Cliente reativado." : "Cliente arquivado.");
                onSaved();
              } catch (e) {
                toast.error((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {archived ? (
              <>
                <ArchiveRestore className="size-4" /> Reativar cliente
              </>
            ) : (
              <>
                <Archive className="size-4" /> Arquivar cliente
              </>
            )}
          </Button>
          <Button
            variant="ghost"
            className="h-11 w-full rounded-full text-destructive hover:bg-destructive/10 hover:text-destructive"
            disabled={busy}
            onClick={() => setConfirmOpen(true)}
          >
            <Trash2 className="size-4" /> Excluir cliente
          </Button>

          <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <AlertDialogContent className="max-w-[min(92vw,26rem)] rounded-2xl">
              <AlertDialogHeader>
                <AlertDialogTitle>Excluir ficha deste cliente?</AlertDialogTitle>
                <AlertDialogDescription>
                  Essa ação remove a ficha do cliente da área de Clientes. Os pedidos existentes não são apagados.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="h-11 rounded-full">Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  className="h-11 rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await remove({ data: { id: customer.id } });
                      toast.success("Ficha do cliente excluída. Os pedidos continuam salvos.");
                      onDeleted();
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
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * Jornada do cliente: de onde veio, o que buscou e o que fez a pessoa se
 * identificar. Somente equipe (a função do banco checa a permissão).
 */
function JourneyBlock({ id }: { id: string }) {
  const load = useServerFn(customerJourney);
  const { data } = useQuery({
    queryKey: ["crm-journey", id],
    queryFn: () => load({ data: { id } }),
    staleTime: 60_000,
  });
  if (!data) return null;

  const SOURCE: Record<string, string> = {
    direto: "Acesso direto",
    instagram: "Instagram",
    tiktok: "TikTok",
    google: "Google",
    whatsapp: "WhatsApp",
  };
  const TRIGGER: Record<string, string> = {
    salvar_escolhas: "Salvou as escolhas",
    ajuda_para_escolher: "Pediu ajuda para escolher",
    negociacao: "Negociação",
    aviso_estoque: "Aviso de estoque",
    checkout: "Finalização do pedido",
  };

  const bits = [
    data.first_source ? `Chegou por ${SOURCE[data.first_source] ?? data.first_source}` : null,
    data.utm_campaign ? `campanha ${data.utm_campaign}` : null,
    data.lead_trigger ? (TRIGGER[data.lead_trigger] ?? data.lead_trigger) : null,
    data.marketing_optin ? "aceitou receber novidades" : null,
  ].filter(Boolean);

  if (!bits.length && !data.searches?.length) return null;

  return (
    <div className="rounded-xl border border-border/70 bg-surface-3 p-3">
      <p className="text-xs tracking-wide text-muted-foreground uppercase">Como chegou</p>
      {bits.length ? <p className="mt-1 text-sm">{bits.join(" · ")}</p> : null}
      {data.searches?.length ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Buscou: {data.searches.slice(0, 5).map((s) => s.query).join(", ")}
        </p>
      ) : null}
      {data.help_requests?.length ? (
        <p className="mt-1 text-xs text-muted-foreground">
          Pediu ajuda em {data.help_requests.length} perfume(s).
        </p>
      ) : null}
    </div>
  );
}
