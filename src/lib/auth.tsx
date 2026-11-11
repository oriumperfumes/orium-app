import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { rememberWelcomeName } from "@/lib/pwa";

type Role = "owner" | "admin" | "client" | null;

type AuthValue = {
  session: Session | null;
  role: Role;
  loading: boolean;
  isStaff: boolean;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthValue>({
  session: null,
  role: null,
  loading: true,
  isStaff: false,
  signOut: async () => {},
});

const ROLE_KEY = "orium:role-cache";
function readCachedRole(userId: string | undefined): Role {
  if (!userId) return null;
  try {
    const c = JSON.parse(sessionStorage.getItem(ROLE_KEY) ?? "null") as { u: string; r: Role } | null;
    return c && c.u === userId ? c.r : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<Role>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    const resolveRole = async (s: Session | null) => {
      if (!s) {
        if (active) setRole(null);
        return;
      }
      const { data } = await supabase.rpc("ensure_profile");
      const r = ((data as Role) ?? "client") as Role;
      try {
        sessionStorage.setItem(ROLE_KEY, JSON.stringify({ u: s.user.id, r }));
      } catch {}
      if (active) setRole(r);
    };

    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      setSession(data.session);
      // papel já conhecido nesta sessão: libera a UI na hora e revalida em segundo plano
      // (só afeta a interface — o servidor/RLS continua validando cada leitura).
      const cached = readCachedRole(data.session?.user.id);
      if (cached) {
        setRole(cached);
        setLoading(false);
        void resolveRole(data.session);
        return;
      }
      await resolveRole(data.session);
      if (active) setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      // Primeiro nome real para a abertura do app instalado (nunca e-mail).
      const full = (s?.user.user_metadata?.["name"] as string | undefined) ?? null;
      rememberWelcomeName(full ? (full.trim().split(/\s+/)[0] ?? null) : null);
      if (!active) return;
      setSession(s);
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
        void resolveRole(s);
      }
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const value: AuthValue = {
    session,
    role,
    loading,
    // Sem sessão válida não existe staff: evita chamadas internas sem token
    // quando a sessão expira e a role ainda está em memória.
    isStaff: !!session && (role === "owner" || role === "admin"),

    signOut: async () => {
      await supabase.auth.signOut();
      setRole(null);
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
