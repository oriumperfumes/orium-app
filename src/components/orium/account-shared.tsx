/**
 * Partes leves da Conta (avatar, perfil, evento de abrir). A tela da Conta em
 * si é carregada sob demanda — só baixa quando o cliente toca em "Conta".
 */
import { Suspense, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { lazyUI, useIdlePrefetch } from "@/lib/lazy-ui";
import { cn } from "@/lib/utils";

export const OPEN_ACCOUNT = "orium:open-account";

/** Dados públicos do perfil, lidos do usuário logado. */
export function useProfile() {
  const { session } = useAuth();
  const meta = (session?.user.user_metadata ?? {}) as Record<string, unknown>;
  const name = String(meta["name"] ?? meta["full_name"] ?? "").trim();
  const avatar = String(meta["avatar_url"] ?? meta["picture"] ?? "").trim() || null;
  const phone = String(meta["phone"] ?? "").trim();
  const email = session?.user.email ?? "";
  const initials =
    (name || email)
      .split(/[\s@._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("") || "O";
  return { name, avatar, phone, email, initials, signedIn: !!session };
}

export function Avatar({ size, className }: { size: number; className?: string }) {
  const { avatar, initials } = useProfile();
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [avatar]);
  return (
    <span
      className={cn("grid shrink-0 place-items-center overflow-hidden rounded-full bg-[#262626] font-bold text-[#FFD599]", className)}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
    >
      {avatar && !broken ? (
        <img src={avatar} alt="" className="size-full object-cover" onError={() => setBroken(true)} />
      ) : (
        initials
      )}
    </span>
  );
}


const AccountScreenLazy = lazyUI(() => import("@/components/orium/AccountScreen"));

/**
 * Fica ouvindo o "abrir conta" e monta a tela na primeira vez. Depois disso
 * a própria tela escuta os próximos toques.
 */
export function AccountScreenMount() {
  const { session } = useAuth();
  const [wanted, setWanted] = useState(false);
  useIdlePrefetch([AccountScreenLazy.prefetch], !!session);
  useEffect(() => {
    if (wanted) return;
    const on = () => setWanted(true);
    window.addEventListener(OPEN_ACCOUNT, on);
    return () => window.removeEventListener(OPEN_ACCOUNT, on);
  }, [wanted]);
  if (!wanted) return null;
  return (
    <Suspense fallback={null}>
      <AccountScreenLazy initialOpen />
    </Suspense>
  );
}
