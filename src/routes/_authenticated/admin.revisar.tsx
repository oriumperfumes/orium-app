import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/admin/revisar")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/produtos" });
  },
});
