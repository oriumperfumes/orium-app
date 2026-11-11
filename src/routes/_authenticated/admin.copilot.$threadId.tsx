import { createFileRoute } from "@tanstack/react-router";
import { AdminShell } from "@/components/orium/AdminShell";
import { CopilotThreadView } from "@/components/orium/copilot/CopilotPanel";

export const Route = createFileRoute("/_authenticated/admin/copilot/$threadId")({
  head: () => ({
    meta: [
      { title: "Orium Copilot — Admin" },
      { name: "description", content: "Assistente operacional do Admin da Orium." },
      { property: "og:title", content: "Orium Copilot" },
      { property: "og:description", content: "Assistente operacional do Admin da Orium." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Page,
});

function Page() {
  const { threadId } = Route.useParams();
  return (
    <AdminShell title="Orium Copilot" bare>
      <div className="h-[calc(100dvh-11rem)] overflow-hidden rounded-[22px] bg-[#161616] lg:h-[calc(100dvh-5rem)]">
        <CopilotThreadView key={threadId} threadId={threadId} />
      </div>
    </AdminShell>
  );
}
