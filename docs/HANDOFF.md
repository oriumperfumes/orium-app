# HANDOFF — orium-app (mapa para não precisar ler o código todo)

> Regra permanente: **toda entrega relevante atualiza este arquivo** (seção "Mapa por assunto" + "Registro de entregas").
> Registre o que foi feito, quando, e com qual resultado; o que não foi verificado fica escrito como "não verificado".

## 1. O que é (e o que não é)

- **orium-app** (este repositório, `oriumperfumes/orium-app`) = loja + Admin + CRM da Orium Perfumes. Produção em `oriumperfumes.com`.
- **Não é** o `App-orium` (PWA da loja, banco `swayqdawanmanbyqmeyh`, Worker `app-orium`) **nem** o `orium-os` (outro sistema, Worker `orium-os`).
  Nunca copie identificadores, chaves ou bancos de um para o outro.

## 2. Como está conectado hoje (verificado em 25/11/2026)

| Peça | Onde | Observação |
|---|---|---|
| Código | GitHub `oriumperfumes/orium-app`, branch `main` | Conectado ao Lovable: **nunca reescrever histórico publicado** (sem force push/rebase/amend). |
| Frontend + servidor | Worker Cloudflare `orium-app` (existe também `orium-app-homolog`, parado desde 14/11) | TanStack Start + Nitro (alvo Cloudflare). Deploy parece automático a partir da `main` (Worker alterado 1 min depois do merge do PR #40) — **origem exata do deploy não verificada**. Não há `wrangler.jsonc` no repositório. |
| Domínio | `oriumperfumes.com` | `oriumperfum.lovable.app` ainda aparece no README/código (URL antiga do Lovable). |
| Banco / Auth / Storage | Supabase **OriumProducao**, ref `onazmlxfrstrdefbekle`, `sa-east-1`, Postgres 17 | Login por e-mail e Google. Buckets privados: `negociacao`, `produtos`, `wa-media`. |
| Banco antigo | Supabase **OriumApp**, ref `zvlspnavxpxltolvmlfj` | Cópia congelada em 14/11 (último login 14/11). **Não é usado.** Pausar antes de apagar. |
| `supabase/config.toml` | `project_id = "rfafnlhsddnsfdlvucuh"` | **Desatualizado** (não é nenhum dos dois acima). O certo seria `onazmlxfrstrdefbekle`. |
| Funções de borda | Supabase: `sync-suppliers`, `enrich-fragrances` | Código em `supabase/functions/*` (gerado de `supabase/edge-src/*` por `scripts/build-edge-sync.mjs`). |
| Tarefas agendadas | `pg_cron` no Supabase (7 jobs) | Fornecedores 05h/08h, fichas 03h20/04h20, consulta 07h35, análise de conversas a cada 15 min, `orium-db-guard` (5 min), `orium-housekeeping` (diário). Algumas chamam `https://oriumperfumes.com/api/public/hooks/*`. |
| Ponte do WhatsApp | `bridge/` (Baileys), roda num servidor Oracle Cloud Always Free | Fala com o banco por `wa_bridge_*` + token. Não verificado se está no ar. |
| Widgets Android | `apps/android-widget`, build no GitHub Actions (`android-widget.yml`) | APK na release `android-widgets`. |
| IA | OpenAI, sempre por `src/lib/ai/engine.server.ts` | Nunca chamar outro provedor direto. |

Segredos: nada de `service_role`/tokens no código ou em docs. O servidor usa `SUPABASE_SERVICE_ROLE_KEY` do ambiente; o navegador usa só a chave publicável (`VITE_SUPABASE_*`).

## 3. Quem entra no Admin

- `/admin/*` exige `isStaff` (`src/lib/auth.tsx`, guarda em `src/routes/_authenticated/admin.tsx`): papel `owner` ou `admin` em `user_roles`.
- O papel nasce no login: a função `ensure_profile()` lê `admin_allowlist` pelo e-mail e grava o papel em `user_roles` (senão, `client`).
- Só o **Dono** adiciona/remove admins (Configurações › Equipe, `owner_add_admin`/`owner_remove_admin`). Servidor confere com `is_staff(uid)` e `has_role(uid,'owner')`.
- Nenhuma política de RLS usa e-mail fixo (conferido: 0 de 156).

## 4. Mapa por assunto

### 4.1 Negociação (Admin → Negociação, rota `/admin/negociacao`)

Perfumes da própria Orium, deslacrados, negociados um a um. Vitrine pública em `/negociacao`.

| O quê | Onde |
|---|---|
| Tela do Admin (cartões, filtros, painel do item, menu "⋯") | `src/routes/_authenticated/admin.negociacao.tsx` |
| Funções do servidor (listar, salvar item, foto, vender, **pagamento**) | `src/lib/negotiation.functions.ts` |
| Tipos/rótulos/estado do frasco | `src/lib/negotiation.ts` |
| Tabelas | `negotiation_items` (vitrine, leitura pública só AVAILABLE/NEGOTIATING), `negotiation_interests` (quem demonstrou interesse), **`negotiation_sales`** (venda e pagamento, só equipe) |
| Situações do item | `AVAILABLE` (Disponível), `NEGOTIATING` (Negociando), `SOLD` (Vendido), `HIDDEN` (Oculto) |

**Venda e controle de pagamento** (entregue em 25/11/2026, branch `feat/negociacao-pagamento`):

- Ao escolher **Vendido** (no painel do item **ou** no menu "⋯" do cartão), aparece o cartão **"Venda e pagamento"** (`src/components/orium/admin/negotiation/SaleCard.tsx`):
  para quem (cliente do CRM ou nome livre), por quanto, quanto já pagou (`PayAmount`: Nada ainda · Metade · Tudo ou valor livre; `+50` soma ao já pago), forma de pagamento (Pix/Cartão/Dinheiro), até quando o restante vence e observação.
- Salvar = `saveNegotiationSale` (grava/atualiza `negotiation_sales` **e** põe o item em `SOLD`). Pode ser chamado de novo a cada recebimento: `amount_paid` é o **total acumulado**.
- A conta de pagamento é uma só: `src/lib/negotiation-sale.ts` (`saleSummary`, `salePayload`, `saleToDraft`, `saleStatusText`). Painel, cartão da vitrine e "A receber" usam estas funções — não recalcular em outro lugar.
- Cartão da vitrine mostra "Vendido · Nome" + "R$ valor · Pago / Falta R$ x / Não pagou"; o número "Vendidos" mostra **A receber R$ …** quando há saldo.
- Regras: valor > 0; pago nunca passa do valor (também em constraint do banco); pago por completo zera o vencimento; ficha do CRM manda no nome (nome livre só sem ficha).
- Escolher "Vendido" no menu abre o painel já na venda (não troca a situação sem registrar a venda). Outras situações continuam trocando direto.
- **Não** gera venda em "Vendas da loja", **não** mexe em estoque, preço nem catálogo. Isso é diferente de `sellNegotiationItem` (botão "Vendi uma peça do mostruário" em Vendas da loja, `store-sales/ShowcaseSale.tsx`), que registra faturamento via `store_sale_commit` e também põe o item em `SOLD`, mas **sem** controle de parcelas. Se a mesma peça passar pelos dois caminhos, o faturamento vem só do segundo; o caderno de pagamento é só do primeiro.
- Segurança: `negotiation_sales` fica **fora** de `negotiation_items` de propósito (essa tabela tem leitura pública da vitrine; nome de cliente e valores não podem ficar ao alcance de `anon`). RLS ligado, política só `is_staff`, `anon` sem acesso. Se o item voltar para Disponível, a linha de venda é mantida (histórico) mas só aparece quando o item está `SOLD`.
- Migration: `supabase/migrations/20261125120000_negociacao_vendas.sql` (**já aplicada em produção em 25/11/2026**, tabela vazia). Teste: `supabase/tests/20261125_negotiation_sales.test.sql`.

### 4.2 Pedidos (pagamento por valor)

`PayAmount`, `DateChips`, `resolvePaid`, `draftFrom` em `src/components/orium/admin/orders/controls.tsx` — reaproveitados pela Negociação. Detalhes de fases e pagamento por perfume estão em `AGENTS.md`.

### 4.3 Outras áreas (onde olhar primeiro)

- Vendas da loja: `src/components/orium/admin/store-sales/*`, `src/lib/store-sales.functions.ts`, RPC `store_sale_commit`.
- CRM / WhatsApp: `src/lib/crm*.ts`, `src/lib/wa-insights.server.ts`, `src/lib/crm-wa.functions.ts`, `bridge/`.
- Equipe/permissões: `src/lib/team.functions.ts`, `TeamSettings.tsx`.
- Regras de arquitetura detalhadas (preço único, IA, fornecedores, motion, layout): `AGENTS.md`.

## 5. Como validar uma mudança

```bash
bun install            # ou: npm install --ignore-scripts
npx tsc --noEmit -p .  # tipos (precisa passar sem erros)
npx vite build         # build de produção
npx prettier --write <arquivos novos>   # o repositório antigo tem muito aviso de formatação; não reformate arquivos que você não alterou
```

Banco: toda mudança é migration nova em `supabase/migrations/` (nunca editar migration já aplicada), com RLS ligado e teste em `supabase/tests/`.

### Testar antes de aprovar (regra do dono: toda entrega passa por teste local antes do merge)

O merge na `main` publica em produção, e **qualquer teste usa o banco de produção** (não há banco de testes). Por isso:

```bash
git clone https://github.com/oriumperfumes/orium-app && cd orium-app
git checkout <branch-da-entrega>
bun install
cp .env.example .env     # preencher com os valores do painel do Supabase (Project Settings → API)
bun run dev              # abre em http://localhost:<porta mostrada no terminal>
```

- `.env`: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` e `SUPABASE_SERVICE_ROLE_KEY` (esta última é chave de administrador: só no `.env` local, que não vai para o git; nunca no chat, no código ou em docs).
- Entre no Admin com uma conta de equipe. O login com Google pode não funcionar em `localhost`; use e-mail e senha se a conta tiver. Não verificado.
- Teste sempre com item fictício ("TESTE — apagar"), preferindo situação **Oculto** antes de mexer, e apague no final. Peça para conferir no banco que nada de teste sobrou.
- Em sessão na nuvem (Claude Code web) o `localhost` não é acessível ao dono; só dá para rodar o servidor para ele se houver computador conectado à sessão.

## 6. Pendências e coisas não verificadas

- Teste de tela (navegador) da venda na Negociação: **não verificado** — o Admin exige login; foi verificada só a lógica (12 casos, `saleSummary`/`salePayload`), tipos, build e RLS no banco.
- O arquivo `supabase/tests/20261125_negotiation_sales.test.sql` não foi rodado por inteiro (precisa do baseline do banco); as mesmas verificações de acesso (anon, cliente comum, pago ≤ preço) foram rodadas direto em produção dentro de uma transação desfeita: 3 de 3 passaram.
- `supabase/config.toml` com `project_id` errado; `orium-app-homolog` e o Supabase OriumApp possivelmente sem uso; branches antigas já mergeadas ainda no GitHub.
- A tabela `integration_secrets` guarda tokens no próprio banco (valores não foram lidos): avaliar mover para o cofre do Supabase.
- Origem exata do deploy do Worker (Workers Builds vs. Publish do Lovable) e se a ponte do WhatsApp está no ar: não verificado.

## 7. Registro de entregas

| Data | O que | Verificação |
|---|---|---|
| 25/11/2026 | Venda e controle de pagamento na Negociação (`negotiation_sales`, `SaleCard`, `saveNegotiationSale`, `listNegotiationSales`) | tsc ok · `vite build` ok · lógica 12/12 · RLS 3/3 em produção (rollback) · tela não verificada |
| 25/11/2026 | Este HANDOFF criado a partir do levantamento da estrutura | leitura de código, Supabase e Cloudflare (somente leitura) |
