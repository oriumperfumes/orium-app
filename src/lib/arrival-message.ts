/**
 * AVISO DE CHEGADA — texto humano para o WhatsApp do cliente.
 * Modelos fixos preenchidos com os dados reais do pedido (sem IA, sem número
 * de pedido, sem códigos). Nunca diz que tudo chegou se houver item pendente.
 */
import { productTitle } from "@/lib/format";
import { dayNumber, weekdayName } from "@/lib/delivery";

export type ArrivalInput = {
  customerName?: string | null;
  /** nomes dos perfumes que chegaram */
  arrived: string[];
  /** quantos itens do pedido ainda não chegaram */
  pendingCount: number;
  delivery: boolean;
  /** semente para variar a redação de forma estável */
  seed?: string;
  /** previsão combinada "YYYY-MM-DD" (opcional) e horário "HH:MM" */
  scheduledDate?: string | null;
  scheduledTime?: string | null;
};

const pick = <T,>(list: T[], n: number) => list[Math.abs(n) % list.length]!;

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

export function firstName(name?: string | null) {
  const n = (name ?? "").trim().split(/\s+/)[0] ?? "";
  if (!n) return "";
  return n.charAt(0).toUpperCase() + n.slice(1).toLowerCase();
}

export function buildArrivalMessage(input: ArrivalInput, variation = 0): string {
  const name = firstName(input.customerName);
  const names = [...new Set(input.arrived.map((n) => productTitle(n)).filter(Boolean))];
  const h = hash(input.seed ?? names.join("|")) + variation;
  const greeting = pick([`Oi${name ? `, ${name}` : ""}! Tudo bem? 😊`, `Oi${name ? `, ${name}` : ""}, tudo bem? 😊`], h);

  const one = names.length === 1;
  const partial = input.pendingCount > 0;
  const subject = one ? `seu ${names[0]}` : partial ? "parte dos seus perfumes" : "seus perfumes";
  const verb = one ? "chegou" : "chegaram";

  const arrival = input.delivery
    ? pick([`${cap(subject)} ${verb} aqui pra gente!`, `Passando pra te avisar que ${subject} ${verb} aqui na Orium!`], h >> 1)
    : pick([`Passando pra te avisar que ${subject} ${verb} aqui na Orium!`, `${cap(subject)} ${verb} aqui na Orium!`], h >> 1);

  const pending = partial
    ? one || names.length > 0
      ? `\n\nO restante ainda tá a caminho, assim que chegar eu te aviso.`
      : ""
    : "";

  const closing = input.delivery
    ? pick(
        [
          "Me fala qual horário fica melhor pra você que combinamos a entrega direitinho.",
          "Me conta qual horário é melhor pra você que a gente combina a entrega.",
        ],
        h >> 2,
      )
    : one
      ? pick(
          ["Já tá disponível pra você buscar. Quando puder, é só passar aqui!", "Já pode vir buscar quando quiser, tá separadinho pra você!"],
          h >> 2,
        )
      : pick(
          ["Já estão disponíveis pra retirada. Quando puder, é só passar aqui!", "Já tá tudo separadinho pra você. Quando puder, é só passar aqui!"],
          h >> 2,
        );

  // na entrega parcial com retirada, a frase de fechamento fala do que chegou
  const close = partial && !input.delivery && !one ? "O que chegou já tá separadinho pra você. Quando puder, é só passar aqui!" : closing;

  let finalClose = close;
  if (input.scheduledDate) {
    const d = input.scheduledDate.slice(0, 10);
    const wd = weekdayName(d);
    const when = `${wd}, dia ${dayNumber(d)}${input.scheduledTime ? `, às ${input.scheduledTime.slice(0, 5)}` : ""}`;
    finalClose = input.delivery
      ? pick([`A gente combinou a entrega pra ${when}. Qualquer coisa é só me chamar!`, `Tá combinado pra ${when}, beleza? Qualquer coisa é só me chamar!`], h >> 3)
      : pick([`Combinamos a retirada pra ${when}. Qualquer coisa é só me chamar!`, `Fica separadinho pra ${when}, combinado? Qualquer coisa é só me chamar!`], h >> 3);
  }

  return `${greeting}\n\n${arrival}${pending}\n\n${finalClose}`;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
