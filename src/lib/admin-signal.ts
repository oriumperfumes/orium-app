import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

/**
 * Sinais leves do banco para as telas do Admin.
 *
 * Antes cada tela ouvia `postgres_changes` (o banco lia o log de gravações e
 * conferia permissão linha a linha para cada tela aberta — pesado demais no
 * Nano). Agora um gatilho por comando manda só "mudou <tabela>" pelo canal
 * `orium-admin` (broadcast, sem dados de cliente) e a tela busca o que precisa.
 * Um único canal para o app inteiro; cada tela só registra o que quer ouvir.
 */
export type AdminSignal =
  | "wa_contacts"
  | "wa_outbox"
  | "wa_insights"
  | "wa_bridge_state"
  | "live_sessions"
  | "live_interactions";

type Listener = (event: AdminSignal) => void;

const listeners = new Map<AdminSignal, Set<Listener>>();
let channel: RealtimeChannel | null = null;
let closeTimer: ReturnType<typeof setTimeout> | null = null;

function ensureChannel() {
  if (closeTimer) {
    clearTimeout(closeTimer);
    closeTimer = null;
  }
  if (channel) return;
  channel = supabase
    .channel("orium-admin")
    .on("broadcast", { event: "*" }, (msg: { event?: string }) => {
      const ev = msg.event as AdminSignal | undefined;
      if (!ev) return;
      for (const fn of listeners.get(ev) ?? []) {
        try {
          fn(ev);
        } catch {
          /* uma tela com erro não derruba as outras */
        }
      }
    })
    .subscribe();
}

/** Ouve um ou mais sinais; devolve a função que para de ouvir. */
export function onAdminSignal(events: AdminSignal[], fn: Listener): () => void {
  ensureChannel();
  for (const ev of events) {
    if (!listeners.has(ev)) listeners.set(ev, new Set());
    listeners.get(ev)!.add(fn);
  }
  return () => {
    for (const ev of events) listeners.get(ev)?.delete(fn);
    const empty = [...listeners.values()].every((s) => s.size === 0);
    if (empty && channel && !closeTimer) {
      // troca de tela: espera um pouco antes de fechar para não reabrir o canal à toa
      closeTimer = setTimeout(() => {
        closeTimer = null;
        if ([...listeners.values()].every((s) => s.size === 0) && channel) {
          void supabase.removeChannel(channel);
          channel = null;
        }
      }, 5_000);
    }
  };
}
