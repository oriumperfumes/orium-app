/**
 * ORIUM VOICE ENGINE — entrada única de voz (e texto) do Copilot.
 *
 * ÁUDIO → transcrição (com vocabulário da loja) → limpeza → roteador rápido →
 * ferramenta real da central de ações. Em paralelo com a transcrição, o índice
 * do catálogo é aquecido. Quando o pedido não é óbvio, devolvemos só o texto e
 * o Copilot com IA assume. IDs, preços e estoque vêm sempre do banco.
 */
import { createFileRoute } from "@tanstack/react-router";

const MAX_BYTES = 8 * 1024 * 1024;

type VoiceCtx = { threadId?: string | null; page?: { route?: string | null; product_id?: string | null } | null; last_product_id?: string | null };

const brlf = (v: number | null | undefined) => (v == null ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));

export const Route = createFileRoute("/api/copilot-voice")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const t0 = Date.now();
        const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
        const declared = Number(request.headers.get("Content-Length") ?? 0);
        if (declared > MAX_BYTES) return json({ error: "Gravação muito longa." }, 413);

        const isForm = (request.headers.get("Content-Type") ?? "").includes("multipart/form-data");
        let file: File | null = null;
        let typed: string | null = null;
        let vctx: VoiceCtx = {};
        let clientMs: number | null = null;
        try {
          if (isForm) {
            const form = await request.formData();
            const f = form.get("file");
            file = f instanceof File && f.size ? f : null;
            vctx = JSON.parse(String(form.get("context") ?? "{}"));
            clientMs = Number(form.get("speech_ms") ?? 0) || null;
          } else {
            const body = (await request.json()) as { text?: string; context?: VoiceCtx };
            typed = String(body.text ?? "").slice(0, 600);
            vctx = body.context ?? {};
          }
        } catch {
          return json({ error: "Pedido inválido." }, 400);
        }
        if (!file && !typed?.trim()) return json({ error: "Não ouvi nada. Tente de novo." }, 400);
        if (file && file.size > MAX_BYTES) return json({ error: "Gravação muito longa." }, 413);

        const { copilotContext, bearer } = await import("@/lib/copilot/context.server");
        let ctx;
        try {
          ctx = await copilotContext(bearer(request), vctx.threadId ?? null);
        } catch (e) {
          if (e instanceof Response) return json({ error: "Sem permissão." }, e.status);
          throw e;
        }
        const tAuth = Date.now();

        const { warmCatalogIndex } = await import("@/lib/store-sales-match.server");
        const warm = warmCatalogIndex(ctx.adminDb).catch(() => undefined);

        let transcript = typed ?? "";
        let tStt = tAuth;
        if (file) {
          try {
            const { voiceLexicon } = await import("@/lib/voice/lexicon.server");
            const { transcribeAudio } = await import("@/lib/voice/stt.server");
            const lex = await voiceLexicon(ctx.adminDb).catch(() => []);
            transcript = await transcribeAudio(file, lex);
          } catch (e) {
            return json({ error: e instanceof Error ? e.message : "Não consegui ouvir." }, 502);
          }
          tStt = Date.now();
          if (!transcript.trim()) return json({ error: "Não entendi. Fale de novo, mais perto do microfone." }, 422);
        }

        const { normalizeTranscript } = await import("@/lib/voice/normalize");
        const { routeIntent } = await import("@/lib/voice/router");
        const norm = normalizeTranscript(transcript);
        const intent = routeIntent(norm.text, norm.payment);
        await warm;

        const R = await import("@/lib/copilot/registry.server");
        const contextProduct = vctx.page?.product_id ?? vctx.last_product_id ?? null;
        let reply: { tool: string; input: unknown; output: any; text?: string | null } | null = null;
        let control: string | null = null;

        try {
          switch (intent?.type) {
            case "confirm":
            case "cancel":
              control = intent.type;
              break;
            case "mic_mode":
              control = `mic_${intent.mode}`;
              break;
            case "navigate": {
              const out = await R.resolveNavigation(ctx, intent.destination, null, null, intent.order_number);
              reply = { tool: "navigate", input: intent, output: out };
              break;
            }
            case "summary": {
              const s = await R.querySalesSummary(ctx, intent.period);
              reply = {
                tool: "sales_summary",
                input: { period: intent.period },
                output: s,
                text: `**${String(s.period).charAt(0).toUpperCase()}${String(s.period).slice(1)}:** ${brlf(s.revenue)} em ${s.orders} venda(s) · lucro bruto ${brlf(s.gross_profit)}${s.margin_percent != null ? ` (${Math.round(s.margin_percent)}%)` : ""}.\nPedidos pendentes: ${s.pending_orders}.${s.restock ? ` Reposição aberta: ${s.restock.units} un. · ${brlf(s.restock.cost)}.` : ""}${s.top_products[0] ? `\nMais vendido: ${s.top_products[0].name}.` : ""}`,
              };
              break;
            }
            case "pending_orders": {
              const list = (await R.queryOrders(ctx, "pendente")) as any[];
              reply = {
                tool: "list_orders",
                input: { status: "pendente" },
                output: list,
                text: list.length ? `**${list.length} pedido(s) pendente(s):**\n${list.slice(0, 8).map((o) => `- #${o.order_number} · ${o.customer ?? "Cliente"} · ${brlf(o.total)}`).join("\n")}` : "Nenhum pedido pendente.",
              };
              break;
            }
            case "sale": {
              const input = {
                items: intent.items.map((i) => ({ product_id: null, query: i.query, spoken: i.query, variant: i.variant, decant_ml: i.decant_ml, quantity: i.quantity, unit_price: null })),
                payment_method: intent.payment,
                customer_name: null,
              };
              reply = { tool: "propose_store_sale", input, output: await R.proposeStoreSale(ctx, input, transcript) };
              break;
            }
            case "stock": {
              if (!intent.query && !contextProduct) break;
              const input = { items: [{ product_id: intent.query ? null : contextProduct, query: intent.query, mode: intent.mode, quantity: intent.quantity }] };
              reply = { tool: "propose_stock_change", input, output: await R.proposeStock(ctx, input, transcript) };
              break;
            }
            case "price": {
              if (!intent.query && !contextProduct) break;
              const input = { product_id: intent.query ? null : contextProduct, query: intent.query, price_kind: "retail" as const, new_price: intent.price, delta: null };
              reply = { tool: "propose_price_change", input, output: await R.proposePrice(ctx, input, transcript) };
              break;
            }
            case "restock": {
              const input = { items: [{ product_id: null, query: intent.query, quantity: intent.quantity, supplier: null }] };
              reply = { tool: "propose_restock_add", input, output: await R.proposeRestockAdd(ctx, input, transcript) };
              break;
            }
            case "order_status": {
              const input = { order_number: intent.order_number, status: intent.status };
              reply = { tool: "propose_order_status", input, output: await R.proposeOrderStatus(ctx, input, transcript) };
              break;
            }
            case "compare": {
              const { compareBasket } = await import("@/lib/purchase/compare.server");
              const c = await compareBasket(ctx.adminDb, [{ key: "l0", query: intent.query, quantity: 1, product_id: null, forced_supplier_id: null }]);
              const it = c.items[0];
              if (!it || !it.product) break; // ambíguo: a IA pergunta qual
              // flanker: nome do produto não pode ter palavras que não foram faladas
              const toks = (x: string) => x.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/[^a-z0-9]+/).filter((w) => w.length > 1);
              const said = new Set(toks(intent.query));
              if (toks(it.product.name).some((w) => !said.has(w))) break;
              const offers = [...it.offers].filter((o) => o.price != null).sort((a, b) => a.price! - b.price!);
              reply = {
                tool: "compare_suppliers",
                input: { lines: [{ name: intent.query, quantity: 1 }] },
                output: { product: it.product, offers: offers.map((o) => ({ supplier: o.supplier_name, price: o.price, status: o.status })) },
                text: offers.length
                  ? `**${it.product.name}**\n${offers.map((o) => `- ${o.supplier_name}: ${brlf(o.price)}${o.status !== "disponivel" ? " · indisponível" : ""}`).join("\n")}${it.chosen ? `\n\nMelhor: **${it.chosen.supplier_name}** (${brlf(it.chosen.price)}).` : ""}`
                  : `Nenhum fornecedor tem preço para ${it.product.name}.`,
              };
              break;
            }
          }
        } catch (e) {
          reply = { tool: "error", input: null, output: { error: e instanceof Error ? e.message : "Falhou." } };
        }
        const tDone = Date.now();

        // medição interna (nunca guarda áudio)
        void ctx.userDb
          .from("copilot_voice_metrics")
          .insert({
            user_id: ctx.userId,
            thread_id: vctx.threadId ?? null,
            source: file ? "voice" : "text",
            speech_ms: clientMs,
            audio_bytes: file?.size ?? null,
            auth_ms: tAuth - t0,
            transcription_ms: file ? tStt - tAuth : null,
            resolve_ms: tDone - tStt,
            total_ms: tDone - t0,
            transcript_raw: transcript.slice(0, 600),
            transcript_normalized: norm.text.slice(0, 600),
            intent: intent?.type ?? "llm",
            fast_path: !!reply || !!control,
            entities: intent ?? null,
          })
          .then(
            () => undefined,
            () => undefined,
          );

        // resposta rápida vira mensagens normais da conversa (salvas no histórico)
        let messages: unknown[] | null = null;
        if (reply) {
          const callId = `fast_${crypto.randomUUID()}`;
          const user = { id: crypto.randomUUID(), role: "user", parts: [{ type: "text", text: transcript }] };
          const parts: any[] = [{ type: `tool-${reply.tool}`, toolCallId: callId, state: "output-available", input: reply.input ?? {}, output: reply.output }];
          if (reply.text) parts.push({ type: "text", text: reply.text });
          else if (reply.output?.kind === "needs" && reply.output.message) parts.push({ type: "text", text: reply.output.message });
          messages = [user, { id: crypto.randomUUID(), role: "assistant", parts }];
          if (vctx.threadId) {
            const { data: t } = await ctx.userDb.from("copilot_threads").select("messages, title").eq("id", vctx.threadId).maybeSingle();
            if (t) {
              const all = [...((t.messages as unknown[]) ?? []), ...messages].slice(-60);
              await ctx.userDb
                .from("copilot_threads")
                .update({ messages: all as never, updated_at: new Date().toISOString(), ...(t.title ? {} : { title: transcript.slice(0, 60) }) })
                .eq("id", vctx.threadId);
            }
          }
        }

        return json({ messages, transcript, normalized: norm.text, intent: intent?.type ?? null, control, reply, timings: { total_ms: tDone - t0, stt_ms: file ? tStt - tAuth : null } });
      },
    },
  },
});
