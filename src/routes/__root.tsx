import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  useRouterState,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/lib/auth";
import { CartProvider } from "@/lib/cart";
import { FavoritesProvider } from "@/lib/favorites";
import { CartPersistence } from "@/components/orium/CartPersistence";
import { KitProvider } from "@/lib/kit";
import { KitSheetMount } from "@/components/orium/kit-mount";
import { BottomNav } from "@/components/orium/BottomNav";
import { AccountScreenMount } from "@/components/orium/account-shared";

import { AppSplash } from "@/components/orium/AppSplash";
import { registerAppServiceWorker } from "@/lib/pwa";
import { LeadProvider } from "@/lib/lead";
import { SaveChoicesPrompt } from "@/components/orium/SaveChoicesPrompt";
import { VersionUpdatePrompt } from "@/components/orium/VersionUpdatePrompt";
import { DecantComboCelebration } from "@/components/orium/DecantCombo";
import { startAnalyticsSession } from "@/lib/analytics";
import { LiveProvider } from "@/lib/live";


import appCss from "../styles.css?url";
import { catalogPrefetchScript, supabaseOrigin } from "@/lib/catalog-prefetch";

import { reportLovableError } from "../lib/lovable-error-reporting";

const FONT_CSS = "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400..800&display=swap";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="display text-6xl">404</h1>
        <h2 className="mt-4 text-xl font-semibold">Página não encontrada</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          O endereço que você acessou não existe ou foi movido.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-full bg-primary px-5 py-2 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90"
          >
            Voltar ao catálogo
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight">Esta página não carregou</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Algo deu errado. Tente novamente ou volte ao início.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-full bg-primary px-5 py-2 text-sm font-medium text-primary-foreground"
          >
            Tentar novamente
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-full border border-input px-5 py-2 text-sm font-medium"
          >
            Início
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover, interactive-widget=resizes-content" },
      { title: "Orium Perfumes" },
      { name: "description", content: "Perfumes importados no varejo e atacado." },
      { property: "og:site_name", content: "Orium Perfumes" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "application-name", content: "Orium" },
      { name: "apple-mobile-web-app-title", content: "Orium" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "theme-color", content: "#0a0a0a" },
      { name: "color-scheme", content: "dark" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      // ?v acompanha a versão dos ícones: força o navegador a reler o manifest.
      { rel: "manifest", href: "/manifest.webmanifest?v=5" },
      { rel: "apple-touch-icon", sizes: "180x180", href: "/icons/apple-touch-icon-v4.png" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      // fonte variável (um arquivo para 400–800); o CSS chega sem travar a primeira pintura
      { rel: "preload", as: "style", href: FONT_CSS },
      { rel: "icon", type: "image/png", sizes: "64x64", href: "/icons/orium-favicon-64-v4.png" },
      { rel: "icon", type: "image/png", sizes: "192x192", href: "/icons/orium-icon-192-v4.png" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

const SUPABASE_ORIGIN = supabaseOrigin();
const CATALOG_PREFETCH = catalogPrefetchScript();

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" className="dark" style={{ colorScheme: "dark" }} suppressHydrationWarning>
      <head>
        <HeadContent />
        {/* banco já conectado e 1ª página do catálogo pedida antes do app baixar */}
        {SUPABASE_ORIGIN ? <link rel="preconnect" href={SUPABASE_ORIGIN} crossOrigin="anonymous" /> : null}
        {CATALOG_PREFETCH ? <script suppressHydrationWarning dangerouslySetInnerHTML={{ __html: CATALOG_PREFETCH }} /> : null}
        <script
          dangerouslySetInnerHTML={{
            // sem zoom: pinça (o iOS ignora user-scalable), Ctrl+roda e Ctrl +/-/0 no computador; o duplo toque sai pelo touch-action no CSS
            __html: `(function(){var o={passive:false};function n(e){e.preventDefault()}document.addEventListener('gesturestart',n,o);document.addEventListener('gesturechange',n,o);document.addEventListener('touchmove',function(e){if(e.touches&&e.touches.length>1)e.preventDefault()},o);window.addEventListener('wheel',function(e){if(e.ctrlKey)e.preventDefault()},o);window.addEventListener('keydown',function(e){if((e.ctrlKey||e.metaKey)&&['+','-','=','0'].indexOf(e.key)>-1)e.preventDefault()})})()`,
          }}
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var l=document.createElement('link');l.rel='stylesheet';l.href='${FONT_CSS}';document.head.appendChild(l)})()`,
          }}
        />
        <noscript>
          <link rel="stylesheet" href={FONT_CSS} />
        </noscript>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{localStorage.removeItem('orium-theme')}catch(e){}
try{var s=(navigator.standalone===true)||matchMedia('(display-mode: standalone)').matches||matchMedia('(display-mode: fullscreen)').matches||matchMedia('(display-mode: minimal-ui)').matches;var seen=false;try{seen=sessionStorage.getItem('orium-opened')==='1'}catch(e){}try{var nv=performance.getEntriesByType('navigation')[0];if(nv&&nv.type==='reload')seen=true}catch(e){}try{if(document.referrer&&new URL(document.referrer).origin===location.origin)seen=true}catch(e){}if(s&&!seen){document.documentElement.classList.add('orium-booting');setTimeout(function(){document.documentElement.classList.remove('orium-booting')},4000)}}catch(e){}`,
          }}
        />

      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

/** Marca o painel no <html>: estilos de loja (ex.: gavetas flutuantes no computador) não valem lá. */
function AreaMarker() {
  const admin = useRouterState({ select: (s) => s.location.pathname.startsWith("/admin") });
  useEffect(() => {
    document.documentElement.classList.toggle("is-admin", admin);
  }, [admin]);
  return null;
}

/**
 * Só monta depois que a página carregou e o navegador ficou livre: a presença
 * "Ao vivo" (chamada ao servidor + conexão em tempo real) não disputa a rede
 * com o catálogo nos primeiros segundos.
 */
function AfterLoad({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let idle = 0;
    let t: ReturnType<typeof setTimeout> | undefined;
    const go = () => {
      t = setTimeout(() => {
        const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
        if (ric) idle = ric(() => setReady(true), { timeout: 2000 });
        else setReady(true);
      }, 1500);
    };
    if (document.readyState === "complete") go();
    else window.addEventListener("load", go, { once: true });
    return () => {
      window.removeEventListener("load", go);
      if (t) clearTimeout(t);
      const cic = (window as unknown as { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback;
      if (idle && cic) cic(idle);
    };
  }, []);
  return ready ? <>{children}</> : null;
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  // Service Worker (notificações da equipe) — nunca no editor/preview.
  useEffect(() => {
    void registerAppServiceWorker();
  }, []);

  // Jornada do visitante: sessão anônima registrada em segundo plano.
  useEffect(() => startAnalyticsSession(), []);

  return (
    <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <CartProvider>
            <FavoritesProvider>
              <LeadProvider>
                <KitProvider>
                  <AreaMarker />
                  <AppSplash />
                  <Outlet />
                  <BottomNav />
                  <AccountScreenMount />

                  <KitSheetMount />
                  <CartPersistence />
                  <SaveChoicesPrompt />
                  <VersionUpdatePrompt />
                  <DecantComboCelebration />
                  <AfterLoad>
                    <LiveProvider />
                  </AfterLoad>

                  <Toaster position="top-center" />
                </KitProvider>
              </LeadProvider>
            </FavoritesProvider>
          </CartProvider>
        </AuthProvider>
    </QueryClientProvider>
  );
}

