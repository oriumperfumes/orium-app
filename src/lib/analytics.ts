/**
 * JORNADA DO VISITANTE (captação + funil).
 *
 * Regras:
 * - todo visitante começa anônimo, com o MESMO identificador de aparelho já
 *   usado por favoritos, carrinho e CRM (`deviceId`);
 * - nada disso pode atrasar a navegação: os eventos vão em lote, em segundo
 *   plano, e qualquer falha é silenciosa;
 * - nunca mostramos nada disso ao cliente.
 */
import { deviceId } from "@/lib/promotions";
import { trackEvents } from "@/lib/analytics.functions";
import { visitorContext, type VisitorContext } from "@/lib/visitor-context";

export type AnalyticsEventName =
  | "session_started"
  | "product_view"
  | "card_clicked"
  | "product_open"
  | "product_dwell"
  | "filters_applied"
  | "decant_selected"
  | "bottle_selected"
  | "search"
  | "favorite_added"
  | "favorite_removed"
  | "cart_item_added"
  | "cart_opened"
  | "checkout_started"
  | "whatsapp_checkout_clicked"
  | "lead_identified"
  | "consultant_help_clicked"
  | "discovery_clicked"
  | "negotiation_interest"
  | "order_created";

export type TrackPayload = {
  productId?: string | null;
  variant?: "FULL" | "DECANT" | null;
  decantMl?: number | null;
  price?: number | null;
  promotionId?: string | null;
  query?: string | null;
  meta?: Record<string, string | number | boolean | null>;
};

const SESSION_KEY = "orium-session";
const SESSION_AT = "orium-session-at";
const SESSION_MAX_IDLE = 30 * 60 * 1000;

export function deviceKind(): "mobile" | "tablet" | "desktop" {
  if (typeof window === "undefined") return "desktop";
  const w = window.innerWidth;
  if (w < 640) return "mobile";
  if (w < 1024) return "tablet";
  return "desktop";
}

function sourceFromReferrer(ref: string): string | null {
  if (!ref) return null;
  try {
    const host = new URL(ref).hostname.replace(/^www\./, "");
    if (host === window.location.hostname) return null;
    if (host.includes("instagram")) return "instagram";
    if (host.includes("tiktok")) return "tiktok";
    if (host.includes("google")) return "google";
    if (host.includes("whatsapp") || host.includes("wa.me")) return "whatsapp";
    if (host.includes("facebook") || host.includes("fb.")) return "facebook";
    if (host.includes("youtube")) return "youtube";
    return host;
  } catch {
    return null;
  }
}

type SessionInfo = {
  sessionKey: string;
  isNew: boolean;
  device: string;
  source: string;
  referrer: string | null;
  landingPath: string;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  context: VisitorContext | null;
};

let cached: SessionInfo | null = null;

function readSession(): SessionInfo | null {
  if (typeof window === "undefined") return null;
  if (cached) return cached;

  let key: string | null = null;
  let isNew = false;
  try {
    const at = Number(window.sessionStorage.getItem(SESSION_AT) ?? 0);
    key = window.sessionStorage.getItem(SESSION_KEY);
    if (!key || (at && Date.now() - at > SESSION_MAX_IDLE)) {
      key = crypto.randomUUID();
      isNew = true;
    }
    window.sessionStorage.setItem(SESSION_KEY, key);
    window.sessionStorage.setItem(SESSION_AT, String(Date.now()));
  } catch {
    key = key ?? crypto.randomUUID();
    isNew = true;
  }

  const params = new URLSearchParams(window.location.search);
  const utmSource = params.get("utm_source");
  const referrer = document.referrer || null;
  // Origem nunca é inventada: sem UTM e sem referência externa, é acesso direto.
  const source = utmSource || sourceFromReferrer(referrer ?? "") || "direto";

  cached = {
    sessionKey: key,
    isNew,
    device: deviceKind(),
    source,
    referrer,
    landingPath: window.location.pathname,
    utmSource,
    utmMedium: params.get("utm_medium"),
    utmCampaign: params.get("utm_campaign"),
    utmContent: params.get("utm_content"),
    utmTerm: params.get("utm_term"),
    context: visitorContext(),
  };
  return cached;
}

type QueuedEvent = TrackPayload & { event: AnalyticsEventName; path: string };

let queue: QueuedEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let sessionSent = false;

function flush() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  const visitorId = deviceId();
  const info = readSession();
  if (!visitorId || !info || queue.length === 0) return;
  const events = queue;
  queue = [];
  const session = sessionSent
    ? null
    : {
        device: info.device,
        source: info.source,
        referrer: info.referrer,
        landingPath: info.landingPath,
        utmSource: info.utmSource,
        utmMedium: info.utmMedium,
        utmCampaign: info.utmCampaign,
        utmContent: info.utmContent,
        utmTerm: info.utmTerm,
        context: info.context,
      };
  sessionSent = true;
  void trackEvents({
    data: { visitorId, sessionKey: info.sessionKey, session, events },
  }).catch(() => {});
}

/** Ouvintes internos (painel Ao Vivo) — nunca saem do aparelho por aqui. */
type TrackListener = (event: AnalyticsEventName, payload: TrackPayload) => void;
const listeners = new Set<TrackListener>();

export function onTrack(listener: TrackListener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Registro em segundo plano — nunca bloqueia nenhuma ação do cliente. */
export function track(event: AnalyticsEventName, payload: TrackPayload = {}) {
  if (typeof window === "undefined") return;
  listeners.forEach((l) => {
    try {
      l(event, payload);
    } catch {
      /* nada do painel pode atrapalhar a navegação */
    }
  });
  queue.push({ event, path: window.location.pathname, ...payload });
  if (queue.length >= 25) return flush();
  // junta os cliques por 8 s (e manda na hora ao sair da aba): bem menos gravações no banco
  if (!timer) timer = setTimeout(flush, 8000);
}


/** Chamado uma vez por sessão, no primeiro acesso da aba. */
export function startAnalyticsSession() {
  if (typeof window === "undefined") return;
  const info = readSession();
  if (!info) return;
  track("session_started", {
    meta: { new_session: info.isNew, source: info.source, device: info.device },
  });
  const onHide = () => flush();
  window.addEventListener("pagehide", onHide);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
  return () => window.removeEventListener("pagehide", onHide);
}

export function currentSessionKey(): string | null {
  return readSession()?.sessionKey ?? null;
}

export function currentSource(): string | null {
  return readSession()?.source ?? null;
}

export function currentContext(): VisitorContext | null {
  return readSession()?.context ?? null;
}

/**
 * TEMPO DE ATENÇÃO NO PERFUME.
 *
 * Conta apenas com a aba visível (Page Visibility): sair para outro app ou
 * deixar a página em segundo plano não vira "interesse". Um único evento
 * `product_dwell` é enviado ao sair do perfume.
 */
export function watchProductDwell(productId: string) {
  if (typeof window === "undefined" || !productId) return () => {};
  let ms = 0;
  let since = document.visibilityState === "visible" ? Date.now() : 0;

  const stopClock = () => {
    if (since) ms += Date.now() - since;
    since = 0;
  };
  const onVisibility = () => {
    if (document.visibilityState === "visible") {
      if (!since) since = Date.now();
    } else {
      stopClock();
      send();
    }
  };
  let sent = 0;
  const send = () => {
    const seconds = Math.round(ms / 1000);
    if (seconds < 2 || seconds === sent) return;
    sent = seconds;
    track("product_dwell", { productId, meta: { seconds } });
  };

  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", onVisibility);

  return () => {
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("pagehide", onVisibility);
    stopClock();
    send();
  };
}
