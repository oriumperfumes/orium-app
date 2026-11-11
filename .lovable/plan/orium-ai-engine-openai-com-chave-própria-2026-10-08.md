# Orium AI Engine — OpenAI com chave própria

## O que existe hoje (auditoria)
Seis lugares chamam a IA do Lovable:
1. Orium Copilot (texto + ferramentas) — conversa, preços, estoque, vendas, cupons, pedidos, comandos, aliases.
2. Voz — transcrição de áudio (vendas por voz e comandos).
3. Intenção de compra / comparação de fornecedores.
4. Identificação de perfumes (identidade do catálogo).
5. Pesquisa de perfume (research).
6. Ficha olfativa (enriquecimento de fragrâncias).
(O Google Maps da rota de fornecedores não é IA e fica como está.)

## Resultado
- Todas as 6 passam por um único **Orium AI Engine**, que usa a sua chave OpenAI.
- Nenhuma chamada escondida à IA do Lovable. Sem chave válida, a IA para e mostra erro claro — nunca troca sozinha de provedor.
- Copilot continua igual: visual, conversas, comandos, memória, ferramentas e confirmações.

## 1. Central de IA (Admin → Configurações → Inteligência Artificial)
- Provedor: OpenAI · Status (Conectado / Chave inválida / Sem saldo / Indisponível / Não configurado).
- Botão "Testar conexão" (valida a chave e lista os modelos reais da sua conta).
- Três perfis com seletor de modelo vindo da conta: **Econômico**, **Avançado**, **Voz**.
- Caixa "Testar a IA" (pergunta rápida + resposta + tokens + custo estimado).
- Consumo: requisições hoje, tokens, custo estimado hoje/mês, por funcionalidade, por modelo, latência média.
- Orçamento: limite diário, limite mensal, alerta (%), política ao atingir (bloquear tudo / só permitir Econômico).
- Tabela de preços por modelo editável (preço por 1M tokens de entrada/saída e por minuto de áudio), com valores iniciais da página oficial da OpenAI; tudo marcado como "estimativa".
- Só OWNER edita; ADMIN vê.

## 2. Segurança da chave
- A chave fica como segredo do servidor (`OPENAI_API_KEY`), cadastrada por um formulário seguro — nunca passa pelo navegador, código, banco, logs ou respostas.
- Limitação honesta: o painel não consegue gravar segredos do servidor. Então "Conectar / Substituir chave" na Central abre instruções e o formulário seguro é aberto por mim aqui no chat. "Desconectar" desliga a IA por um interruptor no banco (efeito imediato) até a chave ser trocada.
- A Central mostra apenas: configurada sim/não, últimos 4 dígitos nunca, só status.

## 3. Motor central
- Um módulo de servidor com: escolha de perfil → modelo, cliente OpenAI (Responses API para texto e ferramentas; API de transcrição para voz), checagem de orçamento antes da chamada, registro de uso depois (feature, modelo, tokens, custo, latência, sucesso/erro — sem texto do cliente).
- Tradução de erros: 401 chave inválida, 429/insufficient_quota sem saldo ou limite, 5xx indisponível.
- O modelo só usa as ferramentas já existentes do Copilot; nenhuma ferramenta de SQL livre.

## 4. Economia de tokens
- **Fast paths sem IA** no Copilot: navegação ("abre pedidos"), preço de decant/frasco (Pricing Engine), consulta de estoque, quando o comando é reconhecido com segurança pelo roteador de voz/texto que já existe.
- Roteamento por complexidade: comandos curtos/operacionais → Econômico; estratégia, análises, planejamento → Avançado.
- Histórico enviado reduzido (últimas ~12 mensagens, resultados de ferramentas compactados); aliases e comandos limitados aos relevantes à frase; nunca o catálogo inteiro.
- Cache curto para tarefas repetidas e seguras (identificação de perfume, ficha olfativa, research).
- Limite de requisições por minuto por usuário.

## 5. Falhas
- Erro legível no chat, conversa preservada, botão "Tentar novamente".
- Ações sensíveis continuam exigindo confirmação; repetir não executa a ferramenta duas vezes (as propostas já são confirmadas por id).

## 6. Custos — o que muda e o que não muda
- Consumo de IA do app: passa a ser cobrado pela OpenAI na sua conta.
- Créditos de desenvolvimento do Lovable (quando eu edito o app) e hospedagem/backend continuam existindo normalmente.

## 7. Testes
- Com a chave cadastrada: testar conexão, conversa, comando simples (fast path, zero tokens), preço de decant, estoque, cupom, comando personalizado, alias, comparação de fornecedores, transcrição, chave inválida, limite de orçamento.
- Confirmar por busca no código que não sobra nenhum endereço da IA do Lovable e que o navegador nunca recebe a chave.
- Limitação: fluxos do Admin exigem conta staff; a conta de teste não tem acesso, então parte dos testes na tela pode ficar para você conferir.

## Detalhes técnicos
- Tabelas novas: `ai_settings` (linha única: enabled, modelos por perfil, limites, política, alert_pct, preços jsonb) e `ai_usage` (feature, profile, model, input/output tokens, audio_seconds, cost_usd, latency_ms, ok, error_code, created_at). RLS: leitura staff, escrita só owner (has_role); inserts de uso via service role no servidor. GRANTs incluídos.
- `src/lib/ai/engine.server.ts`: `getAiConfig()`, `assertBudget()`, `openaiProvider()` (`@ai-sdk/openai` com `OPENAI_API_KEY`, `store:false`), `recordUsage()`, `transcribe()`, `mapOpenAIError()`.
- `src/lib/ai.functions.ts`: status, testar conexão (`GET /v1/models`), salvar config (owner), resumo de consumo, teste rápido.
- Migrar: `routes/api/copilot.ts`, `voice/stt.server.ts`, `purchase/intent.server.ts`, `catalog/identity.server.ts`, `catalog/research.server.ts`, `catalog/fragrance.server.ts`.
- Nova rota de configurações `admin.configuracoes.ia.tsx` (ou seção na tela existente).
- Remover `LOVABLE_API_KEY` dos caminhos de execução do app.
