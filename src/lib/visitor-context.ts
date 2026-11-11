/**
 * CONTEXTO LEGÍTIMO DA VISITA.
 *
 * Só o que o próprio navegador entrega de forma pública e sem permissão:
 * aparelho, navegador, sistema, tela, idioma, fuso, tema, conexão. Nada de
 * identidade oculta, impressão digital combinada, localização, texto digitado
 * ou qualquer dado privado. Campo sem resposta do navegador fica vazio —
 * nunca inventamos valor.
 */

export type VisitorContext = {
  browser: string | null;
  os: string | null;
  standalone: boolean | null;
  screen: string | null;
  viewport: string | null;
  dpr: number | null;
  touch: boolean | null;
  orientation: string | null;
  language: string | null;
  timezone: string | null;
  theme: string | null;
  connection: string | null;
  saveData: boolean | null;
  memoryGb: number | null;
  cpuCores: number | null;
};

function browserName(ua: string): string | null {
  if (!ua) return null;
  if (/edg\//i.test(ua)) return "Edge";
  if (/opr\/|opera/i.test(ua)) return "Opera";
  if (/samsungbrowser/i.test(ua)) return "Samsung Internet";
  if (/firefox|fxios/i.test(ua)) return "Firefox";
  if (/crios/i.test(ua)) return "Chrome";
  if (/chrome/i.test(ua)) return "Chrome";
  if (/safari/i.test(ua)) return "Safari";
  return null;
}

function osName(ua: string): string | null {
  if (!ua) return null;
  if (/iphone|ipod/i.test(ua)) return "iOS";
  if (/ipad/i.test(ua)) return "iPadOS";
  if (/android/i.test(ua)) return "Android";
  if (/windows/i.test(ua)) return "Windows";
  if (/mac os x/i.test(ua)) return "macOS";
  if (/linux/i.test(ua)) return "Linux";
  return null;
}

export function visitorContext(): VisitorContext | null {
  if (typeof window === "undefined") return null;
  const nav = window.navigator as Navigator & {
    connection?: { effectiveType?: string; saveData?: boolean };
    deviceMemory?: number;
    standalone?: boolean;
  };
  const ua = nav.userAgent ?? "";
  const conn = nav.connection ?? null;

  const standalone =
    typeof window.matchMedia === "function"
      ? window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true
      : (nav.standalone ?? null);

  const dark =
    typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "escuro"
        : "claro"
      : null;

  let timezone: string | null = null;
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
  } catch {
    timezone = null;
  }

  return {
    browser: browserName(ua),
    os: osName(ua),
    standalone: standalone ?? null,
    screen: window.screen ? `${window.screen.width}x${window.screen.height}` : null,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    dpr: Number.isFinite(window.devicePixelRatio) ? Number(window.devicePixelRatio.toFixed(2)) : null,
    touch: typeof nav.maxTouchPoints === "number" ? nav.maxTouchPoints > 0 : null,
    orientation: window.innerWidth > window.innerHeight ? "paisagem" : "retrato",
    language: nav.language ?? null,
    timezone,
    theme: dark,
    connection: conn?.effectiveType ?? null,
    saveData: typeof conn?.saveData === "boolean" ? conn.saveData : null,
    memoryGb: typeof nav.deviceMemory === "number" ? nav.deviceMemory : null,
    cpuCores: typeof nav.hardwareConcurrency === "number" ? nav.hardwareConcurrency : null,
  };
}
