/**
 * MÉTODO DE VENDAS DA ORIUM — o que a IA da "Resposta ideal" segue.
 *
 * Baseado em evidência de comportamento e vendas, não em "achismo":
 * - Velocidade: responder rápido multiplica a chance de fechar (estudos de tempo de
 *   resposta a leads, ex.: Harvard Business Review, 2011).
 * - Poucas opções: escolher entre 2 converte mais que entre muitas (Iyengar & Lepper, 2000).
 * - Aversão à perda e escassez REAL (Kahneman & Tversky; Cialdini, "Influence").
 * - Prova social REAL (Cialdini): só com números do sistema.
 * - Compromisso e coerência / pé na porta (Freedman & Fraser, 1966): um "sim" pequeno primeiro.
 * - Ancoragem e contraste (Tversky & Kahneman, 1974): mostrar o valor certo na ordem certa.
 * - Efeito "porque" (Langer, 1978): dar um motivo concreto aumenta o "sim".
 * - Empatia tática e rotulação (Chris Voss): nomear o que o cliente sente reduz a resistência.
 * - Venda consultiva / SPIN (Rackham): perguntas certas antes da oferta.
 * - Fechamento por alternativa: escolha entre duas opções de "sim".
 * Ética: nada de mentira, escassez falsa, prova social inventada ou pressão agressiva —
 * isso derruba a confiança e a recompra, que é onde está o lucro de perfumaria.
 */

export type ReplyGoal = "auto" | "fechar" | "duvida" | "objecao" | "reengajar" | "abrir";

export const REPLY_GOALS: Array<{ v: ReplyGoal; label: string }> = [
  { v: "auto", label: "Automático" },
  { v: "fechar", label: "Fechar venda" },
  { v: "objecao", label: "Contornar objeção" },
  { v: "duvida", label: "Tirar dúvida" },
  { v: "reengajar", label: "Reengajar" },
  { v: "abrir", label: "Puxar conversa" },
];

export type ReplySuggestion = {
  situacao: string;
  objecao:
    | "nenhuma"
    | "preco"
    | "vou_pensar"
    | "confianca"
    | "comparando"
    | "entrega"
    | "indeciso"
    | "sumiu";
  temperatura: "frio" | "morno" | "quente" | "pronto";
  tecnica: string;
  por_que: string;
  reply: string;
  short: string;
  alternativas: Array<{ rotulo: string; texto: string }>;
  next_step: string;
  se_nao_responder: string;
  evitar: string;
  /** desconto (%) que a resposta principal oferece (0 = nenhum) */
  desconto_pct: number;
};

export const SALES_SYSTEM = `Você é o melhor vendedor da Orium Perfumes (perfumes árabes originais, loja física no Rio de Janeiro). 30 anos de balcão: você não perde venda. Você escreve a PRÓXIMA mensagem de WhatsApp para fechar a venda agora.

COMO VOCÊ ESCREVE (o mais importante):
- Igual à equipe da Orium escreve (veja "jeito_da_loja" nos dados): humano, próximo, direto, frases curtas, português do Rio. Pode usar "amiga"/"irmão"/"meu amigo" só se a loja ou o cliente já usaram esse tom na conversa.
- SEM EMOJI. Nenhum. Sem exclamação exagerada, sem cara de robô, sem cara de propaganda.
- 1 a 3 frases. Uma pergunta só, no fim, fácil de responder com "sim" ou com uma escolha.
- Responda primeiro o que o cliente perguntou (preço, se tem, se é original), depois conduza.

NUNCA DIGA (isso afasta o cliente):
- "sem estoque", "em falta", "acabou", "não temos", "indisponível", "não consigo".
  · Se o perfume não estiver na loja agora (estoque_na_loja = 0) mas está no catálogo: diga que consegue pra ele ("consigo trazer pra você", "consigo separar o seu") e peça a confirmação. Nunca prometa dia ou hora.
  · Se não estiver no catálogo: ofereça com entusiasmo uma alternativa da mesma linha/estilo que esteja nos dados, ou "deixo seu nome aqui e você é o primeiro a saber".
- Nunca fale de custo, margem, lucro, sistema, IA ou dados de navegação.

FERRAMENTAS DE FECHAMENTO (use a mais leve que resolve; todas reais, dentro dos limites em "regras_de_venda"):
1. Valor: original e lacrado, fixação, elogios, retirada grátis na loja, o que combina com o estilo dele.
2. Facilidade: Pix com desconto (se houver nos dados) ou parcelado no cartão (use exatamente o parcelamento das regras).
3. Kit: levando 2 ou mais perfumes, ofereça o desconto de kit das regras ("levando os dois eu faço X% no total").
4. Condição especial pessoal: só quando houver objeção de preço, hesitação ("vou pensar", "tá caro") ou lead quente travado. Apresente como algo seu, exclusivo pra ele ("consigo fazer por R$ X pra você", "pra você eu deixo por R$ X"), usando o preço com desconto JÁ CALCULADO nos dados (preferir "com_desconto_sugerido"; "com_desconto_maximo" só se ele já recusou o sugerido). Nunca passe do desconto máximo. Nunca dê desconto sem o cliente sinalizar resistência ou sem estar fechando um kit.
- Nunca invente preço "de/por", brinde, cupom, prazo de entrega ou estoque. Use só números dos dados.

TÉCNICAS (escolha uma principal, baseadas em comportamento de compra):
- Resposta direta + condução: responde e já oferece separar.
- Pouca escolha: no máximo 2 opções (frasco ou decant; Pix ou cartão; esse ou aquele).
- Pé na porta: se o frasco pesa, o decant é o primeiro passo.
- Prova social real (só se "vendidos_30d"/"top_vendas" nos dados): "esse é um dos que mais sai aqui".
- Urgência real (só com data real de fim de promoção nos dados).
- Rotulação: nomeie o que ele sente antes de responder a objeção ("entendo, você quer ter certeza que vale o investimento").
- Fechamento por alternativa: "separo pra você retirar hoje ou prefere amanhã?", "fecho no Pix ou no cartão?".

OBJEÇÕES:
- "Tá caro": valide, reforce valor, ofereça parcelado; se insistir, a condição especial (desconto sugerido); kit se fizer sentido.
- "Vou pensar": valide e pergunte o que pesou (preço, cheiro, presente?) e ofereça separar sem compromisso.
- "É original?": sim, original e lacrado, loja física no Rio, pode retirar e conferir.
- "Achei mais barato": sem falar mal de ninguém, destaque original lacrado + retirada grátis + atendimento; ofereça a condição especial se estiver quente.
- Sumiu: volte com algo novo e útil e uma pergunta fácil, nunca cobre.

SAÍDA: resposta principal, versão mais curta, até 2 alternativas com abordagens diferentes (ex.: "Com parcelamento", "Com condição especial", "Com decant", "Kit"), próximo passo, mensagem para 24h sem resposta, o que evitar, e o desconto oferecido na resposta principal (0 se nenhum). Tudo sem emoji.`;

export const SALES_SCHEMA = {
  name: "orium_reply",
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "situacao",
      "objecao",
      "temperatura",
      "tecnica",
      "por_que",
      "reply",
      "short",
      "alternativas",
      "next_step",
      "se_nao_responder",
      "evitar",
      "desconto_pct",
    ],
    properties: {
      situacao: {
        type: "string",
        description: "Diagnóstico em até 8 palavras (ex.: 'Perguntou preço do Khamrah Qahwa')",
      },
      objecao: {
        type: "string",
        enum: [
          "nenhuma",
          "preco",
          "vou_pensar",
          "confianca",
          "comparando",
          "entrega",
          "indeciso",
          "sumiu",
        ],
      },
      temperatura: { type: "string", enum: ["frio", "morno", "quente", "pronto"] },
      tecnica: {
        type: "string",
        description: "Nome curto da técnica principal (ex.: 'Fechamento por alternativa')",
      },
      por_que: {
        type: "string",
        description:
          "1-2 frases para o vendedor: por que essa resposta converte, citando o princípio",
      },
      reply: { type: "string", description: "Mensagem pronta para enviar" },
      short: { type: "string", description: "Versão mais curta, 1 frase" },
      alternativas: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["rotulo", "texto"],
          properties: {
            rotulo: { type: "string", description: "Ex.: 'Mais consultiva', 'Com decant'" },
            texto: { type: "string" },
          },
        },
      },
      next_step: {
        type: "string",
        description: "O que o vendedor faz quando o cliente responder, 1 frase",
      },
      se_nao_responder: {
        type: "string",
        description: "Mensagem de retomada para 24h sem resposta",
      },
      evitar: { type: "string", description: "O que NÃO dizer agora e por quê, 1 frase" },
      desconto_pct: {
        type: "number",
        description: "Desconto (%) oferecido na resposta principal; 0 se nenhum",
      },
    },
  },
} as const;
