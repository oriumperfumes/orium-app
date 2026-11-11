import { createFileRoute } from "@tanstack/react-router";

/** Endpoint oficial da Meta. Verificação GET e assinatura HMAC obrigatória no POST. */
export const Route = createFileRoute("/api/public/hooks/whatsapp")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const params = new URL(request.url).searchParams;
        const token = process.env["WHATSAPP_VERIFY_TOKEN"];
        if (!token) return new Response("Não configurado", { status: 503 });
        const { timingSafeEqual } = await import("node:crypto");
        const supplied = Buffer.from(params.get("hub.verify_token") ?? "");
        const expected = Buffer.from(token);
        const valid = supplied.length === expected.length && timingSafeEqual(supplied, expected);
        if (params.get("hub.mode") !== "subscribe" || !valid) return new Response("Forbidden", { status: 403 });
        return new Response(params.get("hub.challenge") ?? "", { status: 200, headers: { "Content-Type": "text/plain" } });
      },
      POST: async ({ request }) => {
        const secret = process.env["META_APP_SECRET"];
        if (!secret) return new Response("Não configurado", { status: 503 });
        const { createHmac, timingSafeEqual } = await import("node:crypto");
        const bytes = Buffer.from(await request.arrayBuffer());
        if (bytes.length > 512 * 1024) return new Response("Payload muito grande", { status: 413 });
        const signature = request.headers.get("x-hub-signature-256") ?? "";
        const supplied = Buffer.from(signature);
        const expected = Buffer.from("sha256=" + createHmac("sha256", secret).update(bytes).digest("hex"));
        if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
          return new Response("Assinatura inválida", { status: 401 });
        let body: unknown;
        try { body = JSON.parse(bytes.toString("utf8")); } catch { return new Response("JSON inválido", { status: 400 }); }
        try {
          const { receiveWhatsapp } = await import("@/lib/atendimento/whatsapp.server");
          await receiveWhatsapp(body);
          return new Response("OK", { status: 200 });
        } catch (e) {
          console.error("Webhook atendimento:", e instanceof Error ? e.message.slice(0, 150) : "erro");
          // 5xx permite que a Meta faça retry; o RPC é idempotente.
          return new Response("Falha temporária", { status: 503 });
        }
      },
    },
  },
});
