/**
 * Cliente permanece na tela sem recarregar automaticamente no meio de compras.
 * Revalida build a cada três minutos e quando volta ao app.
 */
import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useCart } from "@/lib/cart";
import { useFavorites } from "@/lib/favorites";
import { PopCard, PopIcon } from "@/components/orium/PopCard";

declare const __ORIUM_BUILD_ID__: string;
const CHECK_INTERVAL = 180000;
const SNOOZE_INTERVAL = 1800000;

export function VersionUpdatePrompt() {
  const { open: cartOpen, items } = useCart();
  const { entries: favorites } = useFavorites();
  const [hasUpdate, setHasUpdate] = useState(false);
  const [hiddenUntil, setHiddenUntil] = useState(0);
  const [checkedAt, setCheckedAt] = useState(0);

  useEffect(() => {
    let alive = true;
    let checking = false;
    async function checkVersion() {
      if (!alive || checking || document.visibilityState !== "visible" || !navigator.onLine) return;
      checking = true;
      const abortController = new AbortController();
      const timeout = window.setTimeout(() => abortController.abort(), 8000);
      try {
        const res = await fetch(`/_orium/version?t=${Date.now()}`, {
          credentials: "same-origin", cache: "no-store",
          headers: { Accept: "text/plain" }, signal: abortController.signal,
        });
        if (!res.ok || !res.headers.get("content-type")?.includes("text/plain")) return;
        const serverBuildId = (await res.text()).trim();
        if (alive && /^[a-f0-9]{20}$/.test(serverBuildId) && serverBuildId !== __ORIUM_BUILD_ID__) {
          setHasUpdate(true);
        }
      } catch {
        // Falha temporária de rede não deve afetar a navegação.
      } finally {
        window.clearTimeout(timeout);
        checking = false;
        if (alive) setCheckedAt(Date.now());
      }
    }
    const initial = window.setTimeout(() => void checkVersion(), 10000);
    const interval = window.setInterval(() => void checkVersion(), CHECK_INTERVAL);
    const onVisible = () => { if (document.visibilityState === "visible") void checkVersion(); };
    const onOnline = () => void checkVersion();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    return () => {
      alive = false;
      window.clearTimeout(initial);
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
    };
  }, []);

  if (!hasUpdate || cartOpen || checkedAt < hiddenUntil) return null;

  const reload = () => {
    try {
      if (items.length) window.localStorage.setItem("orium-cart", JSON.stringify(items));
      if (favorites.length) window.localStorage.setItem("orium-favorites", JSON.stringify(favorites));
    } catch { /* O app já salva os dados regularmente. */ }
    window.location.reload();
  };

  const snooze = () => setHiddenUntil(Date.now() + SNOOZE_INTERVAL);

  return (
    <PopCard
      role="status"
      media={
        <PopIcon>
          <RefreshCw aria-hidden="true" className="size-[20px]" strokeWidth={2.2} />
        </PopIcon>
      }
      eyebrow="Atualização"
      title="Tem novidade na Orium"
      text="Atualize para ver a versão nova. Sua sacola e seus favoritos continuam aqui."
      primary={{ label: "Atualizar agora", onClick: reload }}
      secondary={{ label: "Depois", onClick: snooze }}
      onDismiss={snooze}
      dismissLabel="Lembrar mais tarde"
      z={80}
    />
  );
}
