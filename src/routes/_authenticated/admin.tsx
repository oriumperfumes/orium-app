import { createFileRoute, Outlet, Link } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { AdminChrome } from "@/components/orium/AdminShell";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/admin")({
  component: AdminGate,
});

function AdminGate() {
  const { loading, isStaff } = useAuth();

  if (loading) {
    // shell do Admin imediatamente — nunca a Home nem tela vazia
    return (
      <AdminChrome>
        <div className="space-y-3 p-4" aria-busy>
          <div className="h-7 w-44 rounded-lg bg-muted/60" />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-24 rounded-2xl bg-muted/40" />
            ))}
          </div>
        </div>
      </AdminChrome>
    );
  }

  if (!isStaff) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="max-w-sm text-center">
          <h1 className="display text-3xl">Área restrita</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Esta área é exclusiva da administração da Orium Perfumes.
          </p>
          <Button asChild className="mt-6 rounded-full">
            <Link to="/">Voltar ao catálogo</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <AdminChrome>
      <Outlet />
    </AdminChrome>
  );
}
