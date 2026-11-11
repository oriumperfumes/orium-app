import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    // Sessão local: instantâneo, sem ida à rede antes de trocar de tela.
    const { data } = await supabase.auth.getSession();
    const user = data.session?.user;
    if (!user) throw redirect({ to: "/auth" });
    // Revalida o usuário no servidor em segundo plano; sessão inválida → sai.
    void supabase.auth.getUser().then(({ data: d, error }) => {
      if (error || !d.user) void supabase.auth.signOut();
    });
    return { user };
  },
  component: () => <Outlet />,
});
