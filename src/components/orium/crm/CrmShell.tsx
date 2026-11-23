/**
 * Moldura do CRM: um "app dentro do Admin", com menu lateral de ícones (como os CRMs
 * de referência) na identidade Orium. Todas as telas de cliente moram aqui dentro:
 * Painel, Conversas, Funil, Clientes, Ao vivo e Conversão.
 */
import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BarChart3,
  LayoutGrid,
  MessagesSquare,
  Radio,
  Route as RouteIcon,
  Users,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

export const CRM_ITEMS = [
  { to: "/admin/leads", label: "Hoje", icon: LayoutGrid },
  { to: "/admin/conversas", label: "Conversas", icon: MessagesSquare, badge: true },
  { to: "/admin/funil", label: "Funil", icon: RouteIcon },
  { to: "/admin/clientes", label: "Clientes", icon: Users },
  { to: "/admin/aovivo", label: "Ao vivo", icon: Radio },
  { to: "/admin/conversao", label: "Conversão", icon: BarChart3 },
] as const;

export const isCrmPath = (p: string) =>
  CRM_ITEMS.some((i) => p === i.to || p.startsWith(`${i.to}/`));

type Pulse = { unread: number; status: string; lastSeen: string | null };

/** Não lidas + estado da ponte, para o menu lateral. */
function usePulse() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["crm-pulse"],
    queryFn: async (): Promise<Pulse> => {
      const db = supabase as any;
      const [{ data: rows }, { data: st }] = await Promise.all([
        db.from("wa_contacts").select("unread").gt("unread", 0).limit(500),
        db.from("wa_bridge_state").select("status, last_seen").maybeSingle(),
      ]);
      return {
        unread: ((rows ?? []) as Array<{ unread: number }>).reduce(
          (s, r) => s + (r.unread ?? 0),
          0,
        ),
        status: st?.status ?? "offline",
        lastSeen: st?.last_seen ?? null,
      };
    },
    refetchInterval: 60_000,
    staleTime: 10_000,
  });
  useEffect(() => {
    const ch = supabase
      .channel("orium-crm-pulse")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "wa_contacts" },
        () => void qc.invalidateQueries({ queryKey: ["crm-pulse"] }),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "wa_bridge_state" },
        () => void qc.invalidateQueries({ queryKey: ["crm-pulse"] }),
      )
      .subscribe();
    return () => void supabase.removeChannel(ch);
  }, [qc]);
  return q.data;
}

export function bridgeOnline(p?: { status: string; lastSeen: string | null }) {
  return (
    !!p &&
    p.status === "online" &&
    !!p.lastSeen &&
    Date.now() - new Date(p.lastSeen).getTime() < 90_000
  );
}

export function CrmShell({
  title,
  action,
  children,
  flush,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  flush?: boolean;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const pulse = usePulse();
  const online = bridgeOnline(pulse);

  return (
    <div className="crm-frame -mx-4 flex min-w-0 flex-col gap-3 sm:mx-0 lg:h-[calc(100dvh-148px)] lg:min-h-[620px] lg:flex-row lg:gap-0 lg:overflow-hidden lg:rounded-[34px] lg:border lg:border-white/[0.06] lg:bg-[#141414]">
      {/* menu lateral (computador) */}
      <nav
        aria-label="CRM"
        className="hidden w-[84px] shrink-0 flex-col items-center gap-2 border-r border-white/[0.06] py-5 lg:flex"
      >
        <span className="mb-3 grid size-12 place-items-center rounded-[18px] bg-[#FFD599] text-[13px] font-black tracking-[-0.04em] text-[#15130F]">
          CRM
        </span>
        {CRM_ITEMS.map((it) => {
          const active = pathname === it.to || pathname.startsWith(`${it.to}/`);
          const Icon = it.icon;
          return (
            <Link
              key={it.to}
              to={it.to}
              title={it.label}
              aria-label={it.label}
              aria-current={active ? "page" : undefined}
              className={cn(
                "press group relative grid size-12 place-items-center rounded-[18px] transition-colors",
                active
                  ? "bg-white text-[#15130F]"
                  : "text-[#8C8C8C] hover:bg-white/[0.06] hover:text-white",
              )}
            >
              <Icon className="size-[20px]" strokeWidth={2.1} />
              {"badge" in it && pulse?.unread ? (
                <span className="absolute -top-0.5 -right-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-[#FFD599] px-1 text-[10.5px] font-bold text-[#15130F] ring-2 ring-[#141414] tabular-nums">
                  {pulse.unread > 99 ? "99+" : pulse.unread}
                </span>
              ) : null}
              <span className="pointer-events-none absolute left-[calc(100%+10px)] z-20 hidden rounded-full bg-white px-3 py-1.5 text-[12.5px] font-bold whitespace-nowrap text-[#15130F] shadow-lg group-hover:block">
                {it.label}
              </span>
            </Link>
          );
        })}
        <div
          className="mt-auto flex flex-col items-center gap-1.5"
          title={online ? "WhatsApp conectado" : "WhatsApp desconectado"}
        >
          <span
            className={cn(
              "relative grid size-11 place-items-center rounded-full",
              online ? "bg-[#7FCF9F]/12 text-[#7FCF9F]" : "bg-[#FF9A8A]/12 text-[#FF9A8A]",
            )}
          >
            <WhatsMark className="size-[19px]" />
            <span
              className={cn(
                "absolute right-0.5 bottom-0.5 size-2.5 rounded-full ring-2 ring-[#141414]",
                online ? "bg-[#7FCF9F]" : "bg-[#FF9A8A]",
              )}
            />
          </span>
          <span className="text-[10.5px] font-semibold text-[#6F6F6F]">
            {online ? "Online" : "Offline"}
          </span>
        </div>
      </nav>

      {/* abas (celular e tablet) */}
      <nav
        aria-label="CRM"
        className="adm-scroll flex gap-2 overflow-x-auto px-4 sm:px-0 lg:hidden"
      >
        {CRM_ITEMS.map((it) => {
          const active = pathname === it.to || pathname.startsWith(`${it.to}/`);
          const Icon = it.icon;
          return (
            <Link
              key={it.to}
              to={it.to}
              className={cn(
                "press inline-flex h-11 shrink-0 items-center gap-2 rounded-full px-4 text-[14px] font-bold",
                active ? "bg-white text-[#15130F]" : "bg-[#1A1A1A] text-[#A9A9A9]",
              )}
            >
              <Icon className="size-[17px]" strokeWidth={2.2} />
              {it.label}
              {"badge" in it && pulse?.unread ? (
                <span className="rounded-full bg-[#FFD599] px-1.5 text-[11px] text-[#15130F] tabular-nums">
                  {pulse.unread}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>

      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        {flush ? (
          children
        ) : (
          <div className="adm-scroll min-h-0 flex-1 overflow-y-auto px-4 sm:px-0 lg:px-7 lg:py-6">
            <header className="mb-5 flex min-w-0 items-center justify-between gap-4 lg:mb-6">
              <h1 className="truncate text-[28px] leading-none font-bold tracking-[-0.04em] lg:text-[32px]">
                {title}
              </h1>
              {action ? <div className="shrink-0">{action}</div> : null}
            </header>
            {children}
          </div>
        )}
      </section>
    </div>
  );
}

export function WhatsMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.9 9.9 0 0 0 4.74 1.21h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.83 9.83 0 0 0 12.04 2Zm0 18.15h-.01a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.23 8.23 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.25-8.24 2.2 0 4.27.86 5.83 2.42a8.18 8.18 0 0 1 2.41 5.83c0 4.54-3.7 8.24-8.24 8.24Zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.25-.64.81-.79.97-.14.17-.29.19-.54.06-.25-.12-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.02-.38.11-.51.11-.11.25-.29.37-.43.13-.15.17-.25.25-.42.08-.16.04-.31-.02-.43-.06-.13-.56-1.35-.77-1.85-.2-.48-.41-.42-.56-.43h-.48c-.17 0-.43.06-.66.31-.22.25-.86.85-.86 2.07 0 1.22.89 2.4 1.01 2.56.12.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.48-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.14-1.18-.06-.1-.22-.16-.47-.28Z" />
    </svg>
  );
}
