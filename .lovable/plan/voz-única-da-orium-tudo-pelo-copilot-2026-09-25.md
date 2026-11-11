# Voz única da Orium: tudo pelo Copilot

Objetivo: falar precisa ser a forma mais rápida de operar a Orium. Vai existir um só microfone, um só jeito de entender e uma só memória de correções, e tudo passa pelo Copilot.

## Etapa 1 — Unificar (remover a voz separada)
- Em Vendas da Loja sai o "Registrar por voz", junto com a janela, o gravador e o microfone de "Adicionar/Corrigir por voz".
- Continuam ali: ver, lançar à mão, editar, excluir/cancelar e o histórico.
- Entra o botão **Registrar com Copilot**. Ele abre o mesmo Copilot de sempre, já sabendo que é uma venda.
- A venda passa a ser uma ação do Copilot com um cartão na conversa: itens, marca, frasco ou decant com o tamanho, quantidade, preço do sistema, pagamento, total e o botão [Confirmar venda]. Ela é registrada pelos mesmos passos seguros que já existem hoje (estoque, lucro, auditoria, sem duplicar).
- A memória de pronúncias aprendidas continua única. As correções já guardadas continuam valendo.

## Etapa 2 — Entender certo
- **Limpeza do texto antes de interpretar.** Números por extenso viram algarismo ("dois" → 2, "trezentos e vinte reais" → R$320, "319 e 90" → R$319,90, "dez por cento" → 10%). "cinco ml" e "cinco eme ele" viram 5ml. "decante/decan/amostra" viram decant. "lacrado/fechado/completo" viram frasco. "picks/pics" viram Pix. Palavras repetidas ("lique de lique de bran") são limpas.
- **Busca de perfume por som.** Leva em conta como o brasileiro pronuncia nomes árabes, ingleses e franceses, além do texto escrito, da marca, dos apelidos já aprendidos e do histórico de correções.
  - "açaí bourbon" → Asad Bourbon, "lique de bran" → Liquid Brun, "clube de nuí silage" → Club de Nuit Sillage.
- **As versões continuam separadas.** Yara ≠ Yara Candy ≠ Yara Moi, Asad ≠ Asad Bourbon, Hawas Black ≠ Hawas Kobra. Se ouviu "bourbon", o Asad Bourbon tem prioridade. Na dúvida, o Copilot pergunta "Qual deles?" e mostra as fotos.
- **Vocabulário da loja para o reconhecimento de fala.** A cada gravação, o reconhecimento recebe uma lista curta dos nomes mais prováveis: em estoque, mais vendidos, a tela atual, apelidos frequentes e os seus comandos. Não vão centenas de nomes.
- **Aprende com você.** Um apelido só é guardado depois que você confirma. O sistema conta quantas vezes confirmou e quando usou por último. Uma correção "Não, é Asad Bourbon" também ensina qual nome estava errado.

## Etapa 3 — Responder rápido
- **Caminho rápido, sem IA pesada.** "Abre pedidos", "resumo de hoje", seus comandos (ex.: "fechamento"), "sim/não/cancela", "tenho 3 Liquid Brun", "chegaram mais 3…", "coloca ele a 319,90", "vendi dois Asad Bourbon de 5 no Pix", "adiciona 3 Hawas Black na reposição" e "compara Hawas Black". Esses pedidos são entendidos na hora e o cartão já aparece pronto.
- **IA só quando agrega:** frases ambíguas, pedidos compostos, conselhos e conversa livre.
- **Tudo em paralelo:** enquanto a fala é transcrita, o sistema já busca a tela atual, os comandos e os perfumes prováveis. Numa venda com vários itens, todos os perfumes são buscados de uma vez.
- **Microfone:**
  - "Estou ouvindo…" aparece no instante do toque.
  - Ele percebe sozinho quando você terminou de falar: espera cerca de 0,7s de silêncio, sem cortar pausas naturais como "Vendi dois Asad Bourbon… de cinco ml".
  - "Entendendo…" aparece antes de o servidor responder.
  - A gravação fica curta e leve e usa filtros de ruído e de eco quando o aparelho oferece.
- **Se demorar:** aparece "Está demorando mais que o normal" com [Tentar novamente] [Digitar].
- **Meta:** o cartão de um comando simples aparecer cerca de 1 a 2 segundos depois de você parar de falar.

## Etapa 4 — Conversa natural e correções
- O Copilot lembra o rascunho em andamento, o último produto e a tela atual.
- "Coloca três em estoque" na ficha do Liquid Brun → Liquid Brun. "Coloca ele a 319,90" → o último perfume citado.
- Venda sem tamanho → "Qual tamanho?" com [2ml] [5ml] [10ml]. Você pode responder "cinco" falando.
- "Na verdade o Asad foram três" e "troca pagamento para dinheiro" mudam o rascunho atual sem criar uma ação nova.
- Um item duvidoso não trava a venda: os itens resolvidos ficam prontos e só o duvidoso pergunta.
- "Sim" confirma só a última ação e perde a validade depois de 10 minutos. "Não" e "cancela" descartam.
- Botão **Corrigir falando** no cartão.

## Etapa 5 — Configuração, celular e medição
- Nas Configurações do Copilot: modo do microfone **Tocar para falar** (padrão) ou **Segurar para falar**, bom para loja barulhenta. Também dá para mudar isso conversando.
- A gravação para com segurança se o app perde o foco ou chega uma ligação.
- Sem permissão de microfone: "Não consegui acessar o microfone." com [Digitar comando], sem quebrar o Copilot.
- Aviso discreto quando o som está muito baixo.
- **Medição interna, sem aparecer na tela:** tempos de cada etapa, texto ouvido e texto limpo, o que foi entendido, produtos encontrados, confiança e correções. Assim dá para ver no futuro a porcentagem de comandos entendidos sem correção. O áudio nunca é guardado.

## Testes
- Testes automáticos com transcrições ruins simuladas: todos os exemplos do seu pedido, as versões que não podem se misturar, a venda grande com vários itens, a correção de quantidade, os preços por extenso, o cupom até domingo e o comando "fechamento".
- Teste de ponta a ponta com uma fala gerada por voz sintética, para medir o tempo até o cartão aparecer.
- Telas em 320, 390, 768 e 1440px.
- **O que depende de você:** o teste com a sua voz real, com barulho de loja, no iPhone (Safari e app instalado) e no Android. Eu não tenho microfone nem aparelho físico. Também preciso de um login de administrador para ver as telas logadas.

## Detalhes técnicos
- Remover `SaleComposer` VoiceStage, `store-sales/recorder.ts` e `/api/store-sale-transcribe`, e mover gravação e transcrição para `src/lib/voice/` (recorder com VAD por RMS e endpoint adaptativo de ~700ms, push-to-talk, `echoCancellation/noiseSuppression/autoGainControl`, mono 16 kHz WAV/webm curto, abort em `visibilitychange`). Store única `CopilotVoiceProvider` com os estados idle|listening|transcribing|resolving|awaiting_confirmation|executing|error.
- Endpoint único `/api/copilot/voice`: auth staff, STT `google/gemini-3.5-transcribe` com `prompt` do lexicon priorizado (cache em memória por 5 min) e, em paralelo, carga de contexto e comandos. Depois `normalize.ts` (números pt-BR, unidades, pagamento, variante, dedupe de stutter) → `router.ts` (regex/gramática para os intents rápidos) → resolver em lote (reusa `store-sales-match.server.ts` e o índice fonético de `store-sales-phonetics.ts`, estendido com regras de pronúncia pt-BR para nomes estrangeiros e veto de flanker do identity-v3). Com o intent resolvido, cria direto a pendência no registry (sem LLM). Senão, cai no `/api/copilot` (astra, esforço low) com o texto já normalizado e os candidatos pré-resolvidos.
- Nova ação `store_sale_register` no registry chamando a RPC atômica existente, com preview, confirmação e undo por cancelamento. Estado `copilot_threads.draft` (pending_action, current_draft, last_entity) com TTL.
- `voice_product_aliases` ganha `confirm_count`, `last_used_at` e `rejected_product_id`, e passa a ser gravada só na confirmação. Índice trigram/fonético em `products(normalized_name, phonetic_key)`.
- Tabela `copilot_voice_metrics` (tempos, transcrição bruta/normalizada, intent, entidades, confiança, corrigido), staff-only com GRANT + RLS.
- Configuração `mic_mode` nas settings do Copilot.
