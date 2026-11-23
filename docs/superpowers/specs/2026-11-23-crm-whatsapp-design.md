# CRM Orium — WhatsApp + inteligência de leads

## Por quê
A área Clientes vira o centro de vendas da loja (perfumes árabes): todas as conversas do
WhatsApp em tempo real, juntas com o que a pessoa fez no app, e uma leitura automática de
quem está pronto pra comprar. Sucesso = o dono abre o CRM e sabe na hora com quem falar,
o que oferecer e por quanto.

## Metas
- Inbox do WhatsApp em tempo real dentro do Admin (lista de conversas | chat | ficha).
- Perfume citado no chat → cartão com preço final, custo, margem e estoque, na hora.
- Cliente único: conta do app + contato do WhatsApp unidos pelo número (normalizado E.164).
- Ferramenta de leads: pontuação de calor, listas prontas (Quentes agora, Prontos pra
  promoção, Hora de recompra, Carrinho parado, Sumidos), e perfil de compra por cliente
  (decant x frasco, faixa de preço/ticket, sensibilidade a promoção, marcas e notas preferidas,
  intervalo de recompra) escrito em frases simples.

## Não-metas / anti-metas
- Nada de envio em massa ou automático pelo WhatsApp: toda mensagem sai por clique do dono
  (reduz risco de bloqueio da conexão não oficial).
- Não expor custo/margem fora do Admin (só staff, RLS `is_staff`).
- Não quebrar Clientes/Ao vivo/Conversão atuais; o CRM os absorve.

## Abordagens (decisão do dono)
1. API oficial da Meta — segura, grátis para receber/responder; cobra marketing.
2. **Conexão não oficial por QR (escolhida)** — grátis, risco de bloqueio, precisa de servidor 24h.
3. Leads primeiro, WhatsApp depois.
Servidor: **Oracle Cloud Always Free** (grátis e 24h; o dono cria a conta). Até lá, a ponte
roda no PC do dono para testes.

## Como (decisões técnicas — escolha do Claude)
- **Ponte** (`bridge/`, Node + Baileys): mantém a sessão do WhatsApp, grava conversas e
  mensagens no Supabase e envia o que o Admin coloca na fila de saída. Fala com o banco só por
  funções `wa_bridge_*` protegidas por um token próprio (não precisa da chave secreta do Supabase).
  QR code e status aparecem no Admin.
- **Banco**: `wa_contacts`, `wa_messages`, `wa_outbox`, `wa_bridge_state`; Realtime ligado.
  União com `crm_customers` pelo telefone normalizado.
- **Leads**: função SQL que calcula, por cliente, pontuação e perfil a partir de pedidos,
  itens, carrinhos, favoritos, eventos de visita e conversas.
- **Detecção de perfume**: no Admin, cada mensagem é comparada com nomes/marcas do catálogo
  (normalização sem acento + apelidos comuns); match vira cartão de preço.
- **UI**: no padrão do Admin (PanelKit/PricingUI, dourado), inspirada nas referências: inbox de
  3 colunas e um painel de leads em colunas por estágio.

## Fases
1. Banco + inteligência de leads + ficha unificada (funciona sem WhatsApp).
2. Inbox do WhatsApp + detecção de perfume + ponte rodando no PC.
3. Ponte na Oracle, 24h.
