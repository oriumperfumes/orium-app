import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/admin/integridade")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/manutencao", search: { tab: "integridade" }, replace: true });
  },
});
