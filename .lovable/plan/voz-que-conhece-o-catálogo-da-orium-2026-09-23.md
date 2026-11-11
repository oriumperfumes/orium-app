# Voz que conhece o catálogo da Orium

Hoje a fala é tratada quase como texto final: o que o reconhecimento de voz escreve
("açaí bourbon", "Lique de Lique de Bran") vira o nome do item. Vamos colocar uma
camada de inteligência entre a fala e a venda, de modo que **todo item só exista
depois de ser associado a um perfume real do catálogo**.

Novo caminho: fala → transcrição (com vocabulário da loja) → limpeza e extração →
resolução no catálogo (texto + fonética + apelidos + aprendizado) → revisão →
confirmação.

## 1. Resolver de perfumes (o coração da correção)

Um único resolvedor passa a decidir qual perfume foi dito:

- **Limpeza da fala**: minúsculas, acentos, pontuação, números falados ("dois" → 2)
  e remoção de gagueira/repetição do reconhecimento ("lique de lique de",
  "asad asad bourbon", "club club de nuit").
- **Fonética pt-BR**: cada nome do catálogo e cada nome falado ganham uma forma
  sonora (ç/ss/s, c/k/qu, ai/a, u/ou, brun/bran/brã, on/om/õ, h muda, terminações
  suaves). "açaí bourbon" e "asad bourbon" passam a soar igual; "lique de bran" e
  "liquid brun" também.
- **Busca ampla**: nome canônico, marca, apelidos já cadastrados, nomes de
  fornecedor, apelidos de voz aprendidos — todos como vocabulário.
- **Ranqueamento**: palavra-a-palavra + fonética + cobertura de tokens + marca
  (bônus quando dita, nunca obrigatória) + pequeno bônus para itens em estoque.
- **Flanker com peso altíssimo**: se a fala tem "bourbon", "Asad Bourbon" ganha de
  "Asad" com folga; se a fala é só "Asad", ganha o "Asad" exato. Yara, Yara Moi,
  Yara Elixir, Club de Nuit Intense/Iconic/Milestone nunca se misturam.
- **Confiança**: alta preenche direto; média pede "É este produto?"; baixa mostra
  as opções com foto e pergunta qual foi.
- Se um item não resolve, os outros continuam resolvidos (erro parcial nunca
  descarta a venda inteira).

## 2. Nunca inventar o que não foi dito

- Sem tamanho falado → item fica "Decant · tamanho pendente" e a tela pergunta
  **[2ml] [5ml] [10ml]**, sem reabrir a escolha do perfume.
- "frasco lacrado / fechado / completo / inteiro" → Frasco já selecionado, sem
  mostrar tamanhos de decant.
- Pagamento não falado → "Pagamento não informado" com [Pix] [Cartão] [Dinheiro];
  nada de Pix automático.
- Preço só aparece depois de definir frasco/tamanho, usando o preço vigente como
  sugestão editável.
- Enquanto faltar produto ou tamanho, Subtotal e Total mostram "—" (nunca R$ 0,00).
- Marca real do catálogo assim que o perfume é resolvido; "Marca não informada"
  desaparece.

## 3. Aprendizado com as confirmações

Nova tabela interna **voice_product_aliases** (fala normalizada → perfume, contagem
de confirmações, datas). Só grava quando o Admin confirma ou corrige o item, e é
usada como atalho de reconhecimento nas próximas vendas — sem nunca virar nome
público do produto. Também registramos, apenas para qualidade interna, o que foi
falado, o que foi sugerido, o que foi confirmado, a confiança e o tempo de resposta.

## 4. Vocabulário para o reconhecimento de voz

Antes de transcrever, mandamos uma lista curta e relevante de nomes da loja (mais
vendidos, em estoque, disponíveis) como dica de vocabulário. Se o serviço ignorar a
dica, a camada de resolução continua resolvendo — não dependemos do acerto do
reconhecimento.

## 5. Revisão mais limpa e correção por voz

- Acerto alto: foto, nome, marca, variante, quantidade — e só o que falta em destaque.
- Acerto médio: "É este produto?" com [Confirmar] [Trocar].
- Discreto: "Você disse '…açaí bourbon…' · Entendi **Asad Bourbon**".
- Estados de progresso: "Transcrevendo…", "Identificando os perfumes…",
  "Montando a venda…".
- Microfone de correção continua valendo: "o Asad foi de 5 ml", "não é Asad normal,
  é Asad Bourbon". O contexto da conversa é apagado ao confirmar ou cancelar.

## Detalhes técnicos

- Migração `0007_voice_aliases.sql`: `voice_product_aliases` (transcript_normalized,
  phonetic_key, canonical_product_id, confirmation_count, created_at, last_used_at,
  unique por fala+produto) e `voice_match_log`; RLS staff-only + GRANTs; RPC
  idempotente `voice_alias_learn(p_transcript, p_product_id)`.
- Novo `src/lib/store-sales-phonetics.ts` (puro): normalização, de-stutter, números
  falados, chave fonética pt-BR e similaridade.
- `store-sales-match.server.ts` reescrito: múltiplas âncoras de busca, apelidos +
  apelidos de voz, pontuação com flanker/fonética/marca/estoque, top 5, confiança
  com regra de nome exato.
- `store-sales-ai.server.ts`: extração mantém nome falado cru, `size_ml` e
  `payment_method` nulos quando não ditos, reconhece "lacrado" como FULL; a
  transcrição passa a enviar dica de vocabulário do catálogo.
- `store-sales.functions.ts`: `needs_size` separado de `needs_variant`, preço só
  após variante definida, aprendizado de apelido no commit, log de métricas.
- `SaleComposer.tsx`: cartão por nível de confiança, chips de tamanho só para
  decant, totais "—" enquanto incompleto, estados de progresso.
- IDs sempre do banco; a IA nunca devolve UUID. `LOVABLE_API_KEY` só no servidor.

## Testes

Casos do pedido, inclusive o print: "dois decants do açaí bourbon e um frasco
lacrado do Lique de Lique de Bran" → Asad Bourbon (Lattafa, decant, 2x, tamanho
pendente) + Liquid Brun (French Avenue, frasco, 1x), pagamento pendente. Mais as
variações fonéticas de Asad Bourbon e Liquid Brun, flankers (Yara Elixir, Asad),
com/sem tamanho, frasco, preço falado, reconhecimento ruim e aprendizado de apelido.
Layout 320–1920px sem overflow e sem erros de console.
