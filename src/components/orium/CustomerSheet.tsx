/**
 * FICHA DO CLIENTE (CRM) — painel único usado em Admin → Clientes e também em
 * Admin → Negociação → Interesses recebidos.
 *
 * Uma só fonte de verdade: mesma ficha, mesmo editor, mesma exclusão. Editar ou
 * excluir aqui atualiza na hora as duas áreas. Visual: o mesmo painel de
 * Produtos e Pedidos (SidePanel + PanelKit).
 */
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState, type ReactNode } from "react";
import { Archive, ArchiveRestore, ChevronRight, MessageCircle, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { SidePanel } from "@/components/orium/admin/orders/model";
import {
  Field,
  GoldButton,
  MiniStat,
  PanelCard,
  PanelFooter,
  PanelHeader,
  PanelScroll,
  PanelTabs,
  SoftButton,
  StatusDot,
  TextArea,
  TextInput,
} from "@/components/orium/admin/PanelKit";
import { AdminConfirm } from "@/components/orium/admin/AdminUI";
import { brl, productTitle } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  crmCustomer,
  crmAddNote,
  crmDeleteNote,
  crmCustomerUpdate,
  crmCustomerArchive,
  crmCustomerDelete,
  type CrmCustomerDetail,
} from "@/lib/crm.functions";
import { customerJourney } from "@/lib/analytics-admin.functions";

const date = (v?: string | null) =>
  v
    ? new Date(v).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "2-digit" })
    : "—";

const shortDate = (v?: string | null) =>
  v
    ? new Date(v).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" })
    : "—";

const when = (v?: string | null) =>
  v
    ? new Date(v).toLocaleString("pt-BR", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

export const whatsLink = (phone?: string | null) => {
  const d = (phone ?? "").replace(/\D/g, "");
  if (d.length < 10) return null;
  return `https://wa.me/${d.startsWith("55") ? d : `55${d}`}`;
};

/** Iniciais para o círculo do cliente ("Carmen Ribeiro" → "CR"). */
export const initialsOf = (name?: string | null) =>
  (name ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "?";

type Tab = "resumo" | "compras" | "interesses" | "notas" | "dados";

const CART_LABEL: Record<string, string> = {
  ACTIVE: "Carrinho atual",
  ABANDONED: "Abandonado",
  RECOVERED: "Recuperado",
};

export function CustomerSheet({
  id,
  onClose,
  openEditor,
  originEl,
}: {
  id: string | null;
  onClose: () => void;
  /** Abre já nos dados do cliente (ação "Editar cliente"). */
  openEditor?: boolean;
  /** linha de onde a ficha nasce (e para onde volta) */
  originEl?: HTMLElement | null;
}) {
  const detailFn = useServerFn(crmCustomer);
  const [tab, setTab] = useState<Tab>(openEditor ? "dados" : "resumo");
  // durante a saída o painel ainda mostra a última ficha aberta
  const [lastId, setLastId] = useState(id);
  if (id && id !== lastId) setLastId(id);
  const shownId = id ?? lastId;

  useEffect(() => {
    if (id) setTab(openEditor ? "dados" : "resumo");
  }, [id, openEditor]);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["crm-customer", shownId],
    enabled: !!shownId,
    queryFn: () => detailFn({ data: { id: shownId! } }),
  });

  const c = data?.customer;
  const link = whatsLink(c?.phone);
  const pending = data ? data.metrics.orders_count - (data.metrics.confirmed_count ?? 0) : 0;
  const interests = data
    ? data.favorites.length +
      data.waiting.length +
      (data.negotiations?.length ?? 0) +
      data.carts.length
    : 0;

  return (
    <SidePanel
      open={!!id}
      onClose={onClose}
      label={c?.name ?? "Ficha do cliente"}
      originEl={originEl ?? null}
    >
      <PanelHeader
        image={null}
        fallback={
          <span className="text-[18px] font-bold text-[#FFD599]">{initialsOf(c?.name)}</span>
        }
        title={c?.name ?? (isLoading ? "Carregando…" : "Cliente sem nome")}
        subtitle={c ? (c.phone ?? c.email ?? "sem contato") : " "}
        onClose={onClose}
      >
        {data ? (
          <>
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <MiniStat
                label="Total gasto"
                value={brl(Number(data.metrics.total_spent))}
                tone="gold"
                onClick={() => setTab("compras")}
              />
              <MiniStat
                label="Pedidos"
                value={String(data.metrics.orders_count)}
                onClick={() => setTab("compras")}
              />
              <MiniStat
                label="Ticket médio"
                value={brl(Number(data.metrics.avg_ticket))}
                onClick={() => setTab("compras")}
              />
              <MiniStat
                label="Última compra"
                value={shortDate(data.metrics.last_order_at)}
                onClick={() => setTab("compras")}
              />
            </div>
            <PanelTabs
              className="mt-4"
              value={tab}
              onChange={setTab}
              tabs={[
                { key: "resumo", label: "Resumo" },
                { key: "compras", label: "Compras", badge: <Count n={data.orders.length} /> },
                { key: "interesses", label: "Interesses", badge: <Count n={interests} /> },
                { key: "notas", label: "Notas", badge: <Count n={data.notes.length} /> },
                { key: "dados", label: "Dados" },
              ]}
            />
          </>
        ) : null}
      </PanelHeader>

      <PanelScroll swapKey={`${shownId}-${tab}`}>
        {isLoading ? (
          <>
            <div className="admin-skeleton h-24 rounded-[24px]" />
            <div className="admin-skeleton h-40 rounded-[24px]" />
          </>
        ) : isError || !data ? (
          <PanelCard>
            <p className="text-[14px] text-[#A9A9A9]">Não conseguimos abrir esta ficha agora.</p>
          </PanelCard>
        ) : tab === "resumo" ? (
          <Summary data={data} pending={pending} onClose={onClose} />
        ) : tab === "compras" ? (
          <Purchases data={data} onClose={onClose} />
        ) : tab === "interesses" ? (
          <Interests data={data} />
        ) : tab === "notas" ? (
          <Notes data={data} />
        ) : (
          <CustomerEditor
            key={data.customer.id}
            customer={data.customer}
            onSaved={() => setTab("resumo")}
            onDeleted={onClose}
          />
        )}
      </PanelScroll>

      {data && tab !== "dados" ? (
        <PanelFooter>
          {link ? (
            <GoldButton
              className="flex-1"
              icon={<MessageCircle className="size-[18px]" strokeWidth={2.2} />}
              onClick={() => window.open(link, "_blank", "noopener")}
            >
              Falar no WhatsApp
            </GoldButton>
          ) : (
            <p className="min-w-0 flex-1 truncate px-1 text-[13.5px] text-[#8C8C8C]">
              Sem WhatsApp cadastrado
            </p>
          )}
          <SoftButton
            icon={<Pencil />}
            onClick={() => setTab("dados")}
            aria-label="Editar dados do cliente"
          >
            Editar
          </SoftButton>
        </PanelFooter>
      ) : null}
    </SidePanel>
  );
}

function Count({ n }: { n: number }) {
  return n > 0 ? <span className="text-[12px] font-bold tabular-nums opacity-60">{n}</span> : null;
}

/** Linha de lista dentro dos cartões (nome à esquerda, detalhe à direita). */
function Line({
  title,
  sub,
  right,
  to,
}: {
  title: ReactNode;
  sub?: ReactNode;
  right?: ReactNode;
  to?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3 py-2.5">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14.5px] font-semibold text-white">{title}</span>
        {sub ? (
          <span className="mt-0.5 block truncate text-[12.5px] text-[#8C8C8C]">{sub}</span>
        ) : null}
      </span>
      {right ? (
        <span className="shrink-0 text-right text-[13px] text-[#A9A9A9] tabular-nums">{right}</span>
      ) : null}
      {to}
    </div>
  );
}

const List = ({ children }: { children: ReactNode }) => (
  <div className="divide-y divide-white/[0.06]">{children}</div>
);
const Empty = ({ children }: { children: ReactNode }) => (
  <p className="text-[14px] text-[#8C8C8C]">{children}</p>
);
const Chevron = () => <ChevronRight className="size-4 shrink-0 text-[#6F6F6F]" />;

function Summary({
  data,
  pending,
  onClose,
}: {
  data: CrmCustomerDetail;
  pending: number;
  onClose: () => void;
}) {
  const recent = data.recent_views ?? [];
  return (
    <>
      {data.customer.archived_at || pending > 0 || data.customer.provisional ? (
        <div className="flex flex-wrap gap-x-4 gap-y-2 rounded-[20px] bg-[#1A1A1A] px-4 py-3">
          {data.customer.archived_at ? (
            <StatusDot tone="off">Arquivado em {date(data.customer.archived_at)}</StatusDot>
          ) : null}
          {pending > 0 ? (
            <StatusDot tone="warn">
              {pending} {pending === 1 ? "pedido sem confirmação" : "pedidos sem confirmação"} (fora
              dos valores)
            </StatusDot>
          ) : null}
          {data.customer.provisional ? (
            <StatusDot tone="gold">Identificado pelo aparelho</StatusDot>
          ) : null}
        </div>
      ) : null}

      <JourneyCard id={data.customer.id} />

      <PanelCard
        title="Acessou recentemente"
        hint={recent.length ? "Os perfumes que abriu por último na loja." : undefined}
      >
        {recent.length ? (
          <List>
            {recent.map((v) => {
              const row = (
                <Line
                  title={productTitle(v.name)}
                  sub={[
                    v.brand,
                    when(v.last_at),
                    v.views > 1 ? `${v.views}x` : null,
                    v.in_stock ? null : "sem estoque",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  to={v.slug ? <Chevron /> : undefined}
                />
              );
              return v.slug ? (
                <Link
                  key={v.product_id}
                  to="/perfume/$slug"
                  params={{ slug: v.slug }}
                  onClick={onClose}
                  className="press block rounded-[12px] transition-colors hover:bg-white/[0.03]"
                >
                  {row}
                </Link>
              ) : (
                <div key={v.product_id}>{row}</div>
              );
            })}
          </List>
        ) : (
          <Empty>Nenhum acesso registrado ainda.</Empty>
        )}
      </PanelCard>

      {data.viewed.length ? (
        <PanelCard title="Perfumes que mais acessou">
          <Bars
            rows={data.viewed.map((v) => ({
              label: productTitle(v.name),
              value: v.views,
              display: `${v.views}x`,
            }))}
          />
        </PanelCard>
      ) : null}
    </>
  );
}

function Purchases({ data, onClose }: { data: CrmCustomerDetail; onClose: () => void }) {
  return (
    <>
      <PanelCard
        title="Pedidos"
        hint={data.orders.length ? "Toque para abrir o pedido." : undefined}
      >
        {data.orders.length ? (
          <List>
            {data.orders.map((o) => (
              <Link
                key={o.id}
                to="/admin/pedidos"
                search={{ pedido: o.id } as never}
                onClick={onClose}
                className="press block rounded-[12px] transition-colors hover:bg-white/[0.03]"
              >
                <Line
                  title={`Pedido ${o.order_number ?? o.id.slice(0, 8)}`}
                  sub={`${date(o.created_at)} · ${o.status}${o.is_confirmed ? "" : " · aguardando confirmação"}`}
                  right={<span className="font-bold text-white">{brl(Number(o.total))}</span>}
                  to={<Chevron />}
                />
              </Link>
            ))}
          </List>
        ) : (
          <Empty>Nenhum pedido ainda.</Empty>
        )}
      </PanelCard>

      <PanelCard title="Decants que já experimentou">
        {data.decants.length ? (
          <List>
            {data.decants.map((d, i) => (
              <Line
                key={`${d.name}-${d.ml}-${i}`}
                title={productTitle(d.name)}
                sub={d.brand ?? undefined}
                right={`${d.ml} ml · ${d.quantity}x`}
              />
            ))}
          </List>
        ) : (
          <Empty>Ainda não experimentou decants.</Empty>
        )}
      </PanelCard>

      <PanelCard title="Frascos comprados">
        {data.bottles.length ? (
          <List>
            {data.bottles.map((b, i) => (
              <Line
                key={`${b.name}-${i}`}
                title={productTitle(b.name)}
                sub={b.brand ?? undefined}
                right={`${b.volume_ml ? `${b.volume_ml} ml · ` : ""}${b.quantity}x`}
              />
            ))}
          </List>
        ) : (
          <Empty>Nenhum frasco comprado.</Empty>
        )}
      </PanelCard>

      {data.others.length ? (
        <PanelCard title="Outros produtos">
          <List>
            {data.others.map((o, i) => (
              <Line
                key={`${o.name}-${i}`}
                title={productTitle(o.name)}
                sub={o.brand ?? undefined}
                right={`${o.quantity}x`}
              />
            ))}
          </List>
        </PanelCard>
      ) : null}
    </>
  );
}

function Interests({ data }: { data: CrmCustomerDetail }) {
  return (
    <>
      <PanelCard title="Carrinhos">
        {data.carts.length ? (
          <div className="space-y-2">
            {data.carts.map((c) => (
              <div key={c.id} className="rounded-[18px] bg-[#232323] p-3.5">
                <div className="flex items-center justify-between gap-3">
                  <StatusDot
                    tone={
                      c.status === "ABANDONED" ? "coral" : c.status === "ACTIVE" ? "gold" : "ok"
                    }
                  >
                    {CART_LABEL[c.status] ?? "Virou pedido"}
                  </StatusDot>
                  <span className="text-[15px] font-bold tabular-nums">
                    {brl(Number(c.estimated_total))}
                  </span>
                </div>
                <p className="mt-1 text-[12.5px] text-[#8C8C8C]">
                  {c.items_count} {c.items_count === 1 ? "item" : "itens"} · mexeu em{" "}
                  {date(c.last_activity_at)}
                </p>
                <ul className="mt-2 space-y-1 text-[13px] text-[#D4D4D4]">
                  {c.items.map((it, i) => (
                    <li key={i} className="truncate">
                      {it.quantity}× {productTitle(it.name ?? "")}
                      <span className="text-[#8C8C8C]">
                        {it.variant === "DECANT" ? ` · decant ${it.decant_ml} ml` : " · frasco"}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : (
          <Empty>Nenhum carrinho registrado.</Empty>
        )}
      </PanelCard>

      <PanelCard title="Favoritos">
        {data.favorites.length ? (
          <List>
            {data.favorites.map((f) => (
              <Line
                key={f.product_id}
                title={productTitle(f.name)}
                sub={
                  [f.brand, f.in_stock ? null : "indisponível"].filter(Boolean).join(" · ") ||
                  undefined
                }
                right={
                  f.want_decant ? (
                    <StatusDot tone="gold">Quer experimentar</StatusDot>
                  ) : (
                    <StatusDot tone="off">Salvo</StatusDot>
                  )
                }
              />
            ))}
          </List>
        ) : (
          <Empty>Nenhum favorito.</Empty>
        )}
      </PanelCard>

      <PanelCard title="Esperando chegar">
        {data.waiting.length ? (
          <List>
            {data.waiting.map((w) => (
              <Line
                key={w.product_id}
                title={productTitle(w.name)}
                sub={w.brand ?? undefined}
                right={w.in_stock ? <StatusDot tone="ok">Já voltou</StatusDot> : date(w.created_at)}
              />
            ))}
          </List>
        ) : (
          <Empty>Não está esperando nenhum perfume.</Empty>
        )}
      </PanelCard>

      <PanelCard title="Interesses na Negociação">
        {data.negotiations?.length ? (
          <List>
            {data.negotiations.map((n) => (
              <Link
                key={n.id}
                to="/negociacao/$id"
                params={{ id: n.item_id }}
                className="press block rounded-[12px] hover:bg-white/[0.03]"
              >
                <Line
                  title={productTitle(n.item_name)}
                  right={date(n.created_at)}
                  to={<Chevron />}
                />
              </Link>
            ))}
          </List>
        ) : (
          <Empty>Nenhum interesse em negociação.</Empty>
        )}
      </PanelCard>
    </>
  );
}

function Notes({ data }: { data: CrmCustomerDetail }) {
  const addNote = useServerFn(crmAddNote);
  const delNote = useServerFn(crmDeleteNote);
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ["crm-customer", data.customer.id] });

  return (
    <>
      <PanelCard
        title="Nova anotação"
        hint="Só a equipe vê. Ex.: prefere doces, comprou para presente."
      >
        <TextArea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Escreva aqui"
        />
        <GoldButton
          className="mt-3 w-full"
          loading={saving}
          disabled={note.trim().length < 2}
          onClick={async () => {
            setSaving(true);
            try {
              await addNote({ data: { customerId: data.customer.id, note } });
              setNote("");
              await refresh();
              toast.success("Anotação salva.");
            } catch (e) {
              toast.error((e as Error).message);
            } finally {
              setSaving(false);
            }
          }}
        >
          Salvar anotação
        </GoldButton>
      </PanelCard>

      {data.notes.length ? (
        <div className="space-y-2">
          {data.notes.map((n) => (
            <div key={n.id} className="rounded-[20px] bg-[#1A1A1A] p-4">
              <div className="flex items-start gap-3">
                <p className="min-w-0 flex-1 text-[14.5px] leading-relaxed break-words whitespace-pre-wrap text-[#E6E6E6]">
                  {n.note}
                </p>
                <button
                  type="button"
                  aria-label="Apagar anotação"
                  className="press grid size-9 shrink-0 place-items-center rounded-full text-[#8C8C8C] transition-colors hover:bg-white/[0.06] hover:text-[#FF9A8A]"
                  onClick={async () => {
                    await delNote({ data: { id: n.id } });
                    await refresh();
                  }}
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
              <p className="mt-1.5 text-[12px] text-[#6F6F6F]">{date(n.created_at)}</p>
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}

/** Corrigir dados do cliente, arquivar sem apagar histórico ou excluir a ficha. */
function CustomerEditor({
  customer,
  onSaved,
  onDeleted,
}: {
  customer: {
    id: string;
    name: string | null;
    phone: string | null;
    email: string | null;
    archived_at: string | null;
  };
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const update = useServerFn(crmCustomerUpdate);
  const archive = useServerFn(crmCustomerArchive);
  const remove = useServerFn(crmCustomerDelete);
  const qc = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [name, setName] = useState(customer.name ?? "");
  const [phone, setPhone] = useState(customer.phone ?? "");
  const [email, setEmail] = useState(customer.email ?? "");
  const [busy, setBusy] = useState(false);
  const archived = !!customer.archived_at;

  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ["crm-customer", customer.id] }),
      qc.invalidateQueries({ queryKey: ["crm-customers"] }),
      qc.invalidateQueries({ queryKey: ["crm-overview"] }),
      // o nome mostrado nos interesses da Negociação vem da mesma ficha
      qc.invalidateQueries({ queryKey: ["negotiation-interests"] }),
    ]);

  const run = async (fn: () => Promise<unknown>, ok: string, after?: () => void) => {
    setBusy(true);
    try {
      await fn();
      await refresh();
      toast.success(ok);
      after?.();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PanelCard title="Dados do cliente">
        <div className="space-y-4">
          <Field label="Nome" htmlFor="crm-name">
            <TextInput
              id="crm-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nome"
            />
          </Field>
          <Field label="WhatsApp" htmlFor="crm-phone">
            <TextInput
              id="crm-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="(21) 99999-9999"
              inputMode="tel"
            />
          </Field>
          <Field label="E-mail" htmlFor="crm-email">
            <TextInput
              id="crm-email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="nome@email.com"
              inputMode="email"
            />
          </Field>
          <GoldButton
            className="w-full"
            loading={busy}
            onClick={() =>
              void run(
                () => update({ data: { id: customer.id, name, phone, email } }),
                "Dados do cliente atualizados.",
                onSaved,
              )
            }
          >
            Salvar dados
          </GoldButton>
        </div>
      </PanelCard>

      <PanelCard
        title="Arquivar ou excluir"
        hint="Arquivar tira da lista e guarda o histórico. Excluir apaga a ficha; os pedidos continuam salvos."
      >
        <div className="flex flex-wrap gap-2">
          <SoftButton
            disabled={busy}
            icon={archived ? <ArchiveRestore /> : <Archive />}
            onClick={() =>
              void run(
                () => archive({ data: { id: customer.id, archived: !archived } }),
                archived ? "Cliente reativado." : "Cliente arquivado.",
              )
            }
          >
            {archived ? "Reativar cliente" : "Arquivar cliente"}
          </SoftButton>
          <SoftButton
            disabled={busy}
            icon={<Trash2 />}
            className="text-[#FF9A8A]"
            onClick={() => setConfirmOpen(true)}
          >
            Excluir cliente
          </SoftButton>
        </div>
      </PanelCard>

      <AdminConfirm
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Excluir a ficha deste cliente?"
        description="A ficha sai da área de Clientes. Os pedidos dele não são apagados."
        confirmLabel="Excluir cliente"
        danger
        onConfirm={() =>
          void run(
            () => remove({ data: { id: customer.id } }),
            "Ficha excluída. Os pedidos continuam salvos.",
            onDeleted,
          )
        }
      />
    </>
  );
}

/** De onde veio, o que buscou e o que fez a pessoa se identificar. */
function JourneyCard({ id }: { id: string }) {
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
  const facts = [
    data.first_source
      ? { k: "Chegou por", v: SOURCE[data.first_source] ?? data.first_source }
      : null,
    data.utm_campaign ? { k: "Campanha", v: data.utm_campaign } : null,
    data.lead_trigger
      ? { k: "Se identificou em", v: TRIGGER[data.lead_trigger] ?? data.lead_trigger }
      : null,
    data.marketing_optin ? { k: "Novidades", v: "Aceitou receber" } : null,
    data.help_requests?.length
      ? { k: "Pediu ajuda", v: `${data.help_requests.length} perfume(s)` }
      : null,
  ].filter(Boolean) as Array<{ k: string; v: string }>;
  if (!facts.length && !data.searches?.length) return null;

  return (
    <PanelCard title="Como chegou">
      {facts.length ? (
        <dl className="grid grid-cols-2 gap-2">
          {facts.map((f) => (
            <div key={f.k} className="min-w-0 rounded-[16px] bg-[#232323] px-3.5 py-2.5">
              <dt className="truncate text-[11.5px] font-semibold text-[#8C8C8C]">{f.k}</dt>
              <dd className="mt-0.5 truncate text-[14px] font-bold">{f.v}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {data.searches?.length ? (
        <div className={cn("flex flex-wrap gap-1.5", facts.length && "mt-3")}>
          <span className="mr-1 self-center text-[12.5px] font-semibold text-[#8C8C8C]">
            Buscou
          </span>
          {data.searches.slice(0, 6).map((s, i) => (
            <span
              key={`${s.query}-${i}`}
              className="inline-flex h-7 items-center rounded-full bg-[#232323] px-3 text-[12.5px] font-semibold text-[#D4D4D4]"
            >
              {s.query}
            </span>
          ))}
        </div>
      ) : null}
    </PanelCard>
  );
}

/** Barras horizontais de uma série só (comprimento = quantidade). */
export function Bars({
  rows,
  max,
}: {
  rows: Array<{ label: string; value: number; display: string; hint?: string }>;
  max?: number;
}) {
  const top = max ?? Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-3">
      {rows.map((r, i) => (
        <li
          key={`${r.label}-${i}`}
          title={`${r.label}: ${r.hint ?? r.display}`}
          className="min-w-0"
        >
          <div className="flex min-w-0 items-baseline justify-between gap-3">
            <span className="min-w-0 truncate text-[14px] font-semibold text-[#E6E6E6]">
              {r.label}
            </span>
            <span className="shrink-0 text-[13px] text-[#A9A9A9] tabular-nums">{r.display}</span>
          </div>
          <span className="mt-1.5 block h-[6px] overflow-hidden rounded-full bg-white/[0.06]">
            <span
              className="block h-full rounded-full bg-[#FFD599] transition-[width] duration-700"
              style={{ width: `${Math.max(2, (r.value / top) * 100)}%` }}
            />
          </span>
        </li>
      ))}
    </ul>
  );
}
