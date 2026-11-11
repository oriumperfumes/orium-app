# ORIUM ATENDIMENTO — instalação e limites reais

## Entrega no código
- Nova página Admin → Atendimento (/admin/atendimento): lista, filtros, busca, atribuição, prioridade, status, histórico, resposta manual, rascunho da OpenAI, orientações aprovadas e visão dos canais.
- Persistência em drizzle/migrations/0036_omnichannel_atendimento.sql. Executar a migração no banco correto antes de acessar o módulo. Commit não executa SQL.
- WhatsApp Business Cloud API: /api/public/hooks/whatsapp (GET challenge; POST HMAC SHA-256), recebimento idempotente, mensagens de texto, recibos de status e envio humano somente na janela livre de 24h. Fora dela exigem-se templates aprovados, ainda não implementados.
- Envio confirmado somente quando a Meta retorna identificador. Diante de erro incerto, conferir no WhatsApp antes de reenviar.
- Orium AI Engine OpenAI: apenas sugestões revisadas por humano; consulta o Pricing Engine/estoque quando o produto é resolvido com segurança. Questões sensíveis são escaladas. Nenhum envio automático e nenhuma ação financeira pela IA.
- CRM aparece apenas quando o vínculo confiável crm_customer_id existir. Nunca unir pessoas de redes diferentes pelo nome.

## Configuração oficial do WhatsApp
1. Conta WhatsApp Business Platform com app/número e permissões aprovadas pela Meta.
2. Configurar exclusivamente como segredos de backend:
   - WHATSAPP_ACCESS_TOKEN: token oficial com permissão de envio.
   - WHATSAPP_PHONE_NUMBER_ID: ID do número usado no webhook.
   - WHATSAPP_VERIFY_TOKEN: segredo do desafio GET.
   - META_APP_SECRET: segredo para validar X-Hub-Signature-256.
   - META_GRAPH_API_VERSION: opcional; revisar conforme ciclo de suporte Meta.
3. Configurar o callback HTTPS https://<domínio-do-app>/api/public/hooks/whatsapp; assinar messages.
4. Validar challenge, assinatura inválida, webhook duplicado, recebimento e envio reais, status de entrega e limite de 24h. Sem credenciais reais, a conexão permanece desconectada; não simular mensagens.
5. Verificar política de privacidade, retenção e tratamento de dados pessoais.

## Outros canais e automação
- Instagram: depende de conta profissional e permissões/escopos Meta. Não habilitado.
- TikTok: depende de APIs de mensagens disponíveis e permissões aprovadas. Não habilitado.
- Chat do site: não habilitado nesta etapa para evitar endpoint público sem antiabuso.
- Modos supervisionado e controlado salvam preferências, mas o envio automático continua desativado até implementação específica e validação das políticas.

## Segurança
- Novas tabelas: acesso RLS apenas para equipe autenticada; toda escrita é server-side com is_staff; orientações e modo da IA somente owner.
- Webhook usa service role apenas após assinatura válida; função SQL inbound permitida só ao serviço. Nunca armazenar credenciais Meta no frontend.
- Mensagens recebidas são dados não confiáveis, não instruções. Conversa enviada à OpenAI com telefones e e-mails mascarados.
- Definir procedimento LGPD de retenção, revisão e exclusão. Nenhum expurgo automático foi implementado nesta etapa.

## Testes e próximo ciclo
- npx vitest run src/lib/atendimento/__tests__/rules.spec.ts
- npm run build
- Verificação manual mobile 320/375/390, lista vazia, filtros, atualização, atribuição, erros de API, retries de webhooks, CRM e revisão de IA.
- Aprovação da Meta, migração no banco de produção e testes de mensagens reais não são substituíveis por inspeção do código.
- Próximas etapas: métricas globais, paginação por cursor, templates oficiais, integrações aprovadas Instagram/TikTok, distribuição e automação controlada, procedimento de retenção LGPD.
