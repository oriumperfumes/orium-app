import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/admin/marcas")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/manutencao", search: { tab: "marcas" }, replace: true });
  },
});
