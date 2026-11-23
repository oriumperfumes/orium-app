/**
 * Painel lateral do cliente no CRM, pensado como um passo a passo:
 * 1) o que fazer agora, 2) a mensagem (com versões prontas), 3) do que ele gosta
 * (com foto), 4) quem é ele em números simples. Um botão principal: enviar.
 */
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, MessageCircle, Send, UserRound, X } from "lucide-react";
import { toast } from "sonner";
import { CustomerSheet, whatsLink } from "@/components/orium/CustomerSheet";
import { SidePanel } from "@/components/orium/admin/orders/model";
import { PanelFooter, PanelScroll } from "@/components/orium/admin/PanelKit";
import { Avatar, TEMP, fmtPhone } from "@/components/orium/crm/shared";
import { TASKS, factsOf, interestsOf, messageOptions, taskOf, type Lead } from "@/lib/crm-intel";
import { waOpenForCustomer, waSend } from "@/lib/crm-wa.functions";
import { cn } from "@/lib/utils";

/** "Feito hoje" fica só neste aparelho e zera a cada dia. */
const doneKey = () => `orium-crm-done-${new Date().toISOString().slice(0, 10)}`;
export function useDoneToday() {
  const [done, setDone] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    try {
      setDone(new Set(JSON.parse(localStorage.getItem(doneKey()) ?? "[]") as string[]));
    } catch {
      /* sem armazenamento: começa vazio */
    }
  }, []);
  const toggle = (id: string, value?: boolean) =>
    setDone((cur) => {
      const next = new Set(cur);
      if (value ?? !next.has(id)) next.add(id);
      else next.delete(id);
      try {
        localStorage.setItem(doneKey(), JSON.stringify([...next]));
      } catch {
        /* ignora */
      }
      return next;
    });
  return { done, toggle };
}

export function LeadPanel({
  lead,
  originEl,
  onClose,
  done,
  onDone,
}: {
  lead: Lead | null;
  originEl: HTMLElement | null;
  onClose: () => void;
  done?: boolean;
  onDone?: (v: boolean) => void;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const options = useMemo(() => (lead ? messageOptions(lead) : []), [lead]);
  const [opt, setOpt] = useState(0);
  const [msg, setMsg] = useState("");
  const [ficha, setFicha] = useState<string | null>(null);
  useEffect(() => {
    setOpt(0);
    setMsg(options[0]?.text ?? "");
  }, [lead?.id, options]);

  const send = useMutation({
    mutationFn: async () => {
      const { jid } = await waOpenForCustomer({ data: { customerId: lead!.id } });
      await waSend({ data: { jid, body: msg } });
      return jid;
    },
    onSuccess: () => {
      toast.success(`Mensagem enviada para ${lead?.name?.split(" ")[0] ?? "o cliente"}`);
      onDone?.(true);
      void qc.invalidateQueries({ queryKey: ["wa-inbox"] });
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não foi possível enviar"),
  });
  const openChat = useMutation({
    mutationFn: () => waOpenForCustomer({ data: { customerId: lead!.id } }),
    onSuccess: ({ jid }) => void navigate({ to: "/admin/conversas", search: { jid } as never }),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Sem celular válido"),
  });

  const l = lead;
  const task = l ? taskOf(l) : null;
  const phoneOk = !!whatsLink(l?.phone);
  const facts = l ? factsOf(l) : [];
  const interests = l ? interestsOf(l) : [];
  const t = l ? TEMP[l.temp] : null;

  return (
    <>
      <SidePanel open={!!l} onClose={onClose} label={l?.name ?? "Cliente"} originEl={originEl}>
        {l && t ? (
          <>
            <header className="shrink-0 px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-4 lg:px-6 lg:pt-6">
              <div className="flex items-start gap-3.5">
                <Avatar
                  name={l.name}
                  score={l.score}
                  temp={l.temp}
                  size={60}
                  gold={l.orders_count > 0}
                />
                <div className="min-w-0 flex-1 pt-1">
                  <h2 className="truncate text-[21px] leading-tight font-bold tracking-[-0.03em]">
                    {l.name ?? "Sem nome"}
                  </h2>
                  <p className="mt-1 flex min-w-0 items-center gap-2 text-[13.5px] text-[#A9A9A9]">
                    <span
                      className="inline-flex items-center gap-1.5 font-bold"
                      style={{ color: t.ring === "#5A5A5A" ? "#A9A9A9" : t.ring }}
                    >
                      <span className="size-2 rounded-full" style={{ background: t.ring }} />
                      {t.label}
                    </span>
                    <span className="truncate">{fmtPhone(l.phone) || "Sem celular"}</span>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Fechar"
                  className="press grid size-10 shrink-0 place-items-center rounded-full bg-[#1F1F1F] text-[#D4D4D4] hover:text-white"
                >
                  <X className="size-[18px]" />
                </button>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2">
                <QuickBtn
                  icon={<MessageCircle />}
                  label="Conversa"
                  disabled={!phoneOk}
                  loading={openChat.isPending}
                  onClick={() => openChat.mutate()}
                />
                <QuickBtn icon={<UserRound />} label="Ficha" onClick={() => setFicha(l.id)} />
                <QuickBtn
                  icon={<Copy />}
                  label="Número"
                  disabled={!l.phone}
                  onClick={() => {
                    void navigator.clipboard?.writeText(l.phone ?? "");
                    toast.success("Número copiado");
                  }}
                />
              </div>
            </header>

            <PanelScroll swapKey={l.id}>
              <div className="space-y-6 px-5 pb-6 lg:px-6">
                {/* 1. o que fazer */}
                <Step n={1} title="O que fazer agora">
                  <div className="rounded-[22px] border border-[#FFD599]/25 bg-[#FFD599]/[0.06] p-4">
                    <p className="text-[18px] leading-tight font-bold tracking-[-0.02em] text-[#FFD599]">
                      {task ? TASKS[task].title : l.action.title}
                    </p>
                    <p className="mt-1 text-[14px] text-[#D4D4D4]">{l.action.why}</p>
                    {l.reasons.length ? (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {l.reasons.slice(0, 4).map((r) => (
                          <span
                            key={r}
                            className="rounded-full bg-white/[0.06] px-2.5 py-1 text-[12px] font-semibold text-[#D4D4D4]"
                          >
                            {r}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </Step>

                {/* 2. mensagem */}
                <Step n={2} title="Mensagem" hint="Escolha uma versão e ajuste se quiser">
                  <div className="adm-scroll -mx-1 mb-2.5 flex gap-1.5 overflow-x-auto px-1">
                    {options.map((o, i) => (
                      <button
                        key={o.label}
                        type="button"
                        aria-pressed={opt === i}
                        onClick={() => {
                          setOpt(i);
                          setMsg(o.text);
                        }}
                        className={cn(
                          "press h-9 shrink-0 rounded-full px-3.5 text-[13px] font-bold",
                          opt === i
                            ? "bg-white text-[#15130F]"
                            : "bg-[#1F1F1F] text-[#A9A9A9] hover:text-white",
                        )}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                  <textarea
                    value={msg}
                    onChange={(e) => setMsg(e.target.value)}
                    rows={5}
                    className="w-full resize-none rounded-[20px] bg-[#1A1A1A] p-4 text-[15px] leading-relaxed outline-none focus:ring-2 focus:ring-[#FFD599]/40"
                  />
                </Step>

                {/* 3. do que gosta */}
                {interests.length ? (
                  <Step n={3} title="Do que ele gosta">
                    <div className="grid grid-cols-2 gap-2">
                      {interests.map((it) => (
                        <div
                          key={it.key}
                          className="flex min-w-0 items-center gap-2.5 rounded-[18px] bg-[#1A1A1A] p-2"
                        >
                          <span className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-[14px] bg-white">
                            {it.image_url ? (
                              <img
                                src={it.image_url}
                                alt=""
                                loading="lazy"
                                className="size-full object-contain"
                              />
                            ) : null}
                          </span>
                          <span className="min-w-0">
                            <span className="line-clamp-2 text-[12.5px] leading-tight font-bold">
                              {it.name}
                            </span>
                            <span
                              className={cn(
                                "mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-bold",
                                it.tone === "gold"
                                  ? "bg-[#FFD599] text-[#15130F]"
                                  : it.tone === "green"
                                    ? "bg-[#7FCF9F]/20 text-[#7FCF9F]"
                                    : "bg-white/[0.07] text-[#A9A9A9]",
                              )}
                            >
                              {it.tag}
                            </span>
                          </span>
                        </div>
                      ))}
                    </div>
                  </Step>
                ) : null}

                {/* 4. quem é */}
                <Step n={interests.length ? 4 : 3} title="Quem é">
                  <dl className="grid grid-cols-2 gap-2">
                    {facts.map((f) => (
                      <div
                        key={f.label}
                        className="min-w-0 rounded-[18px] bg-[#1A1A1A] px-3.5 py-3"
                      >
                        <dt className="truncate text-[12px] font-semibold text-[#8C8C8C]">
                          {f.label}
                        </dt>
                        <dd
                          className={cn(
                            "mt-0.5 truncate font-bold tracking-[-0.01em]",
                            f.strong ? "text-[18px] text-[#FFD599]" : "text-[15px]",
                          )}
                        >
                          {f.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </Step>
              </div>
            </PanelScroll>

            <PanelFooter>
              {onDone ? (
                <button
                  type="button"
                  onClick={() => {
                    onDone(!done);
                    if (!done) onClose();
                  }}
                  className={cn(
                    "press inline-flex h-12 shrink-0 items-center gap-2 rounded-full px-5 text-[14px] font-bold",
                    done
                      ? "bg-[#7FCF9F]/15 text-[#7FCF9F]"
                      : "bg-[#1F1F1F] text-[#D4D4D4] hover:text-white",
                  )}
                >
                  <Check className="size-4" />
                  {done ? "Feito" : "Marcar feito"}
                </button>
              ) : null}
              <button
                type="button"
                disabled={!phoneOk || !msg.trim() || send.isPending}
                onClick={() => send.mutate()}
                className="press inline-flex h-12 min-w-0 flex-1 items-center justify-center gap-2 rounded-full bg-[#FFD599] px-5 text-[15px] font-bold text-[#15130F] disabled:opacity-40"
              >
                <Send className="size-[18px]" />
                {send.isPending ? "Enviando…" : phoneOk ? "Enviar no WhatsApp" : "Sem celular"}
              </button>
            </PanelFooter>
          </>
        ) : null}
      </SidePanel>
      <CustomerSheet id={ficha} onClose={() => setFicha(null)} />
    </>
  );
}

function Step({
  n,
  title,
  hint,
  children,
}: {
  n: number;
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="mb-2.5 flex items-center gap-2.5">
        <span className="grid size-6 shrink-0 place-items-center rounded-full bg-white/[0.08] text-[12px] font-bold text-[#D4D4D4] tabular-nums">
          {n}
        </span>
        <h3 className="text-[15px] font-bold">{title}</h3>
        {hint ? <span className="truncate text-[12.5px] text-[#6F6F6F]">{hint}</span> : null}
      </div>
      {children}
    </section>
  );
}

function QuickBtn({
  icon,
  label,
  onClick,
  disabled,
  loading,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      className="press flex h-14 flex-col items-center justify-center gap-1 rounded-[18px] bg-[#1A1A1A] text-[12px] font-bold text-[#D4D4D4] hover:bg-[#202020] hover:text-white disabled:opacity-40 [&_svg]:size-[18px]"
    >
      {icon}
      {label}
    </button>
  );
}
