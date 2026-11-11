/**
 * PWA da Orium — instalação, execução standalone e notificações.
 *
 * A PWA é a Orium inteira (Home, catálogo, produto, favoritos, carrinho,
 * negociação e painel). A opção de instalar é oferecida somente para
 * ADMIN/OWNER, mas o app instalado abre sempre na Home.
 *
 * Nada é registrado no editor/preview: Service Worker é estado do navegador e
 * não pode servir versão antiga durante o desenvolvimento.
 */
import { useCallback, useEffect, useRef, useState } from "react";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const SW_URL = "/sw.js";

function blockedHost(hostname: string) {
  return (
    hostname.startsWith("id-preview--") ||
    hostname.startsWith("preview--") ||
    hostname === "lovableproject.com" ||
    hostname.endsWith(".lovableproject.com") ||
    hostname === "lovableproject-dev.com" ||
    hostname.endsWith(".lovableproject-dev.com") ||
    hostname === "beta.lovable.dev" ||
    hostname.endsWith(".beta.lovable.dev")
  );
}

export function canUseServiceWorker() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return false;
  if (!import.meta.env.PROD) return false;
  if (window.top !== window.self) return false;
  if (blockedHost(window.location.hostname)) return false;
  if (new URL(window.location.href).searchParams.get("sw") === "off") return false;
  return true;
}

/** Registra (ou remove, quando o contexto não permite) o Service Worker. */
export async function registerAppServiceWorker() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return null;
  if (!canUseServiceWorker()) {
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.allSettled(
        regs.filter((r) => r.active?.scriptURL?.endsWith(SW_URL)).map((r) => r.unregister()),
      );
    } catch {
      /* nada a fazer */
    }
    return null;
  }
  try {
    const reg = await navigator.serviceWorker.register(SW_URL, { scope: "/", updateViaCache: "none" });
    void reg.update();
    return reg;
  } catch {
    return null;
  }
}

/** Rodando como aplicativo instalado (Android/PC e também iOS). */
export function isStandalone() {
  if (typeof window === "undefined") return false;
  const iosStandalone = (window.navigator as unknown as { standalone?: boolean }).standalone === true;
  return (
    iosStandalone ||
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches ||
    window.matchMedia("(display-mode: minimal-ui)").matches
  );
}

export function isIOS() {
  if (typeof window === "undefined") return false;
  const ua = navigator.userAgent;
  // iPadOS 13+ se apresenta como Macintosh: só é iPad se tiver toque.
  const iPadLike = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  return /iPad|iPhone|iPod/.test(ua) || iPadLike;
}

export type PwaPlatform = "ios" | "android" | "windows" | "desktop";

/** iPhone/iPad rodando no Safari (único navegador do iOS que instala na Tela de Início). */
export function isIOSSafari() {
  if (!isIOS()) return false;
  const ua = navigator.userAgent;
  // Chrome/Firefox/Edge no iOS usam WebKit, mas se identificam com estas marcas.
  return !/CriOS|FxiOS|EdgiOS|OPiOS|Instagram|FBAN|FBAV|Line\//i.test(ua);
}

export type IosDevice = "iphone" | "ipad";

export function iosDevice(): IosDevice {
  if (typeof window === "undefined") return "iphone";
  const ua = navigator.userAgent;
  const iPadLike = /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  return iPadLike ? "ipad" : "iphone";
}

/**
 * Onde fica o botão Compartilhar neste Safari: no iPhone ele está na barra
 * inferior (iOS 15+); em iPhones com iOS antigo e no iPad fica na barra
 * superior. Serve apenas para mostrar a instrução no lugar certo.
 */
export function iosShareBarPosition(): "bottom" | "top" {
  if (typeof window === "undefined") return "bottom";
  if (iosDevice() === "ipad") return "top";
  const major = Number(/OS (\d+)[._]/.exec(navigator.userAgent)?.[1] ?? "15");
  return major >= 15 ? "bottom" : "top";
}


type UaData = { platform?: string; mobile?: boolean };

/**
 * Plataforma para escolher o texto de instalação. O caminho nativo NUNCA
 * depende disto (é decidido por `beforeinstallprompt`); isto serve apenas para
 * mostrar a instrução certa quando o prompt nativo não existe.
 */
export function pwaPlatform(): PwaPlatform {
  if (typeof window === "undefined") return "desktop";
  const uaData = (navigator as unknown as { userAgentData?: UaData }).userAgentData;
  const hinted = (uaData?.platform ?? "").toLowerCase();
  if (hinted.includes("android")) return "android";
  if (hinted.includes("windows")) return "windows";
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return "android";
  if (isIOS()) return "ios";
  if (/Windows/i.test(ua)) return "windows";
  return "desktop";
}

export function deviceLabel() {
  if (typeof window === "undefined") return "Dispositivo";
  const ua = navigator.userAgent;
  const os = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Macintosh/.test(ua)
          ? "Mac"
          : /Windows/.test(ua)
            ? "Windows"
            : "Navegador";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /CriOS|Chrome/.test(ua)
      ? "Chrome"
      : /Firefox/.test(ua)
        ? "Firefox"
        : "Safari";
  return `${os} · ${browser}`;
}

/**
 * Estado de instalação deste dispositivo. No iOS não existe
 * `beforeinstallprompt`: lá o caminho é o passo a passo do Compartilhar.
 */
export function usePwaInstall() {
  const [installed, setInstalled] = useState(false);
  const [ready, setReady] = useState(false);
  const promptEvent = useRef<InstallPromptEvent | null>(null);
  const [hasPrompt, setHasPrompt] = useState(false);
  const [platform, setPlatform] = useState<PwaPlatform>("desktop");

  useEffect(() => {
    setInstalled(isStandalone());
    setPlatform(pwaPlatform());
    setReady(true);


    const onPrompt = (event: Event) => {
      event.preventDefault();
      promptEvent.current = event as InstallPromptEvent;
      setHasPrompt(true);
    };
    const onInstalled = () => {
      setInstalled(true);
      setHasPrompt(false);
      promptEvent.current = null;
    };
    const mq = window.matchMedia("(display-mode: standalone)");
    const onDisplay = () => setInstalled(isStandalone());

    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    mq.addEventListener("change", onDisplay);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
      mq.removeEventListener("change", onDisplay);
    };
  }, []);

  const install = useCallback(async () => {
    const event = promptEvent.current;
    if (!event) return "unsupported" as const;
    await event.prompt();
    const choice = await event.userChoice;
    if (choice.outcome === "accepted") {
      setHasPrompt(false);
      promptEvent.current = null;
      setInstalled(true);
      return "accepted" as const;
    }
    return "dismissed" as const;
  }, []);

  return { installed, ready, hasPrompt, install, platform, ios: platform === "ios" };
}

/* ---------------- Web Push (somente equipe) ---------------- */

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

export function pushSupported() {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export async function currentPushEndpoint(): Promise<string | null> {
  if (!pushSupported()) return null;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    return sub?.endpoint ?? null;
  } catch {
    return null;
  }
}

export type SubscribeResult =
  | { ok: true; endpoint: string; p256dh: string; auth: string }
  | { ok: false; reason: "unsupported" | "denied" | "failed" | "no-key" };

/** Só depois de uma ação explícita do Admin: nunca ao abrir o app. */
export async function subscribeToPush(publicKey: string | null): Promise<SubscribeResult> {
  if (!pushSupported()) return { ok: false, reason: "unsupported" };
  if (!publicKey) return { ok: false, reason: "no-key" };
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return { ok: false, reason: "denied" };
  try {
    const reg = (await navigator.serviceWorker.getRegistration()) ?? (await registerAppServiceWorker());
    if (!reg) return { ok: false, reason: "failed" };
    await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    const sub =
      existing ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      }));
    const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return { ok: false, reason: "failed" };
    return { ok: true, endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

export async function unsubscribeFromPush(): Promise<string | null> {
  if (!pushSupported()) return null;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return null;
    const endpoint = sub.endpoint;
    await sub.unsubscribe();
    return endpoint;
  } catch {
    return null;
  }
}

/** Saudação curta por horário de São Paulo. */
export function timeGreeting(now = new Date()) {
  const hour = Number(
    new Intl.DateTimeFormat("pt-BR", {
      hour: "numeric",
      hour12: false,
      timeZone: "America/Sao_Paulo",
    }).format(now),
  );
  if (hour < 12) return "Bom dia";
  if (hour < 18) return "Boa tarde";
  return "Boa noite";
}

const NAME_KEY = "orium-welcome-name";

/** Primeiro nome real da pessoa (nunca e-mail), guardado para abrir rápido. */
export function rememberWelcomeName(name: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (name) window.localStorage.setItem(NAME_KEY, name);
    else window.localStorage.removeItem(NAME_KEY);
  } catch {
    /* modo privado */
  }
}

export function storedWelcomeName(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(NAME_KEY);
  } catch {
    return null;
  }
}
