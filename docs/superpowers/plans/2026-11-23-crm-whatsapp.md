# CRM Orium (WhatsApp + Leads) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Clientes vira um CRM: leads com pontuação e próxima ação, ficha única app+WhatsApp,
inbox do WhatsApp em tempo real com detecção de perfume (preço, custo, margem).

**Architecture:** Supabase guarda tudo (tabelas `wa_*` + função `crm_leads`). Uma ponte Node
(Baileys) fala com o banco só por RPCs `wa_bridge_*` protegidas por token (hash sha256 em
`wa_bridge_state`). O Admin lê por server functions e escuta Realtime.

**Tech Stack:** TanStack Start, React Query, Supabase (RLS `is_staff`), Baileys, Node 20.

**Spec:** `docs/superpowers/specs/2026-11-23-crm-whatsapp-design.md`

## Global Constraints
- Nada é enviado sem clique do dono; sem envio em massa.
- Custo/margem só para staff (server function com `copilotContext`; `getProductCosts` exige owner/admin).
- Telefone canônico = 11 dígitos BR (DDD + 9 + número); jid antigo sem o 9 ganha o 9.
- UI no padrão Admin: PageTitle, PxKpi, dash-card, SidePanel/PanelKit, dourado.

## Review Focus
- Mensagem citando "pisa"/"arya" (palavra comum) não pode virar cartão certo: nome de 1 palavra só conta com marca junto ou palavra rara (≥6 letras, fora da lista de palavras comuns).
- Contato do WhatsApp sem ficha no CRM: aparece no inbox e pode ser ligado/criado.
- Ponte desligada: inbox mostra "ponte offline" e as mensagens pendentes ficam na fila.
- Mensagem de grupo/status (`@g.us`, `status@broadcast`) é ignorada pela ponte.
- jid com 12 dígitos (sem o 9) casa com o cliente de 11 dígitos.

---

### Task 1: Banco (migration `20261123120000_crm_whatsapp.sql`)
- Tabelas `wa_bridge_state`, `wa_contacts(jid pk, phone_normalized, push_name, customer_id, stage, unread, last_*)`,
  `wa_messages(id pk, jid, from_me, body, kind, ts, status)`, `wa_outbox(id, jid, body, status, error, wa_id)`.
- `wa_norm_phone(text) returns text` (regra acima). Ligação automática contato↔`crm_customers.phone_normalized`.
- RPCs da ponte: `wa_bridge_heartbeat`, `wa_bridge_ingest(jsonb)`, `wa_bridge_claim_outbox`, `wa_bridge_outbox_result`.
- `crm_leads()` staff-only: por cliente, métricas de compra (pedidos do app + vendas da loja), comportamento
  (views, carrinhos, favoritos, esperando, ao vivo) e WhatsApp; devolve jsonb.
- Verificar: `select wa_norm_phone('552194550954')` = `21994550954`; `select crm_leads()` roda como staff.

### Task 2: Inteligência (`src/lib/crm-intel.ts`, puro + testes vitest)
- `scoreLead(raw): {score, temp:'quente'|'morno'|'frio', reasons[]}`; `profileOf(raw): string[]` frases;
  `segmentsOf(raw): Segment[]` (quentes, carrinho, promo, recompra, upgrade, esperando, sumidos, responder);
  `nextAction(raw): {title, message}` com mensagem pronta.
- Testes: cliente com carrinho aberto hoje → quente; comprou decant há 30 dias → segmento upgrade.

### Task 3: Detector de perfume (`src/lib/perfume-mentions.ts` puro + `.server.ts` índice)
- `findMentions(text, index): {productId, term, confidence}[]` por n-gramas (1–5 tokens) sem acento.
- Server fn `crmPerfumeQuote({productIds})` → `getProductPrices` + `getProductCosts`.

### Task 4: Server functions (`src/lib/crm-wa.functions.ts`)
- `crmLeads`, `waInbox`, `waThread({jid})`, `waSend({jid, body})`, `waMarkRead`, `waSetStage`, `waLinkCustomer`, `waBridgeStatus`.

### Task 5: UI
- `admin.clientes.tsx`: abas Leads | Conversas | Clientes (lista atual).
- Leads: KPIs, colunas por segmento (estilo das referências), cartão com calor, motivos, perfil e próxima ação.
- Conversas: 3 colunas (lista | chat | ficha com perfil + cartões de perfume), Realtime, status da ponte/QR.

### Task 6: Ponte (`bridge/`)
- `bridge/index.mjs` Baileys: auth em `bridge/auth/`, ignora grupos, ingest em lote, fila de saída a cada 2 s,
  heartbeat 20 s com QR. `.env`: SUPABASE_URL, SUPABASE_KEY (publishable), BRIDGE_TOKEN.
- Rodar local; depois Oracle (systemd).

### Task 7: Verificar, commit, deploy
- tsc, vitest, build, teste local com mocks, push main, wrangler deploy.
