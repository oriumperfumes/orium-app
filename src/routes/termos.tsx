import { createFileRoute } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { LegalPage, LEGAL_DRAFT } from "@/components/orium/LegalPage";
import { LEGAL, LEGAL_UPDATED } from "@/lib/legal-info";

export const Route = createFileRoute("/termos")({
  head: () => ({
    meta: [
      { title: "Termos de Serviço — Orium Perfumes" },
      { name: "description", content: "Regras de uso do site e de compra na Orium Perfumes." },
      ...(LEGAL_DRAFT ? [{ name: "robots", content: "noindex" }] : []),
    ],
    links: [{ rel: "canonical", href: "/termos" }],
  }),
  component: TermsPage,
});

function TermsPage() {
  return (
    <LegalPage title="Termos de Serviço" updated={LEGAL_UPDATED}>
      <section>
        <h2>Sobre estes termos</h2>
        <p>
          Estes termos valem para o uso do site {LEGAL.site} e para compras na Orium Perfumes, operada por{" "}
          {LEGAL.responsavel} ({LEGAL.documento}), {LEGAL.endereco}. Ao usar o site ou fazer um pedido, você concorda
          com eles. Veja também a{" "}
          <Link to={"/privacidade" as never} className="underline hover:text-white">
            Política de Privacidade
          </Link>
          .
        </p>
      </section>

      <section>
        <h2>Produtos</h2>
        <p>
          Vendemos perfumes em frasco e em decants de 2, 5 ou 10 ml (parte do frasco original, transferida para um
          frasco com borrifador). As fotos e descrições são informativas. Marcas citadas pertencem aos seus titulares.
          Alguns itens são sob encomenda e têm prazo próprio, informado antes da compra.
        </p>
      </section>

      <section>
        <h2>Pedido e pagamento</h2>
        <ul>
          <li>O pedido feito no site fica registrado e é confirmado com você pelo WhatsApp {LEGAL.whatsapp}.</li>
          <li>O pedido só é fechado depois dessa confirmação e do pagamento combinado (Pix ou cartão).</li>
          <li>Os preços e descontos (como o do Pix) são os mostrados no momento do pedido. Podemos corrigir erros evidentes de preço antes de confirmar.</li>
          <li>Disponibilidade depende de estoque; se algo faltar, avisamos e combinamos a melhor solução com você.</li>
        </ul>
      </section>

      <section>
        <h2>Entrega</h2>
        <p>
          Você pode retirar na loja, receber por entrega local (valor combinado) ou por envio pelos Correios/
          transportadora, com frete e prazo calculados para o seu CEP. Prazos de envio contam depois da postagem; itens
          sob encomenda saem depois que o produto chega à Orium. Confira os dados de entrega ao pedir.
        </p>
      </section>

      <section>
        <h2>Trocas, devolução e arrependimento</h2>
        <p>
          Nas compras feitas à distância, você pode desistir em até 7 dias corridos do recebimento (Código de Defesa do
          Consumidor, art. 49). [REVISAR: regras para decants e frascos já abertos, e quem paga o frete de devolução].
          Produto com defeito ou diferente do pedido: fale conosco pelo WhatsApp {LEGAL.whatsapp} com fotos para
          resolvermos.
        </p>
      </section>

      <section>
        <h2>Sua conta</h2>
        <p>
          Você é responsável por manter a sua conta e senha em segurança e por informar dados verdadeiros. Podemos
          limitar ou encerrar contas usadas para fraude ou abuso.
        </p>
      </section>

      <section>
        <h2>Uso do site</h2>
        <p>
          Não é permitido tentar acessar áreas restritas, copiar o catálogo de forma automatizada, sobrecarregar o site
          ou usá-lo para fins ilícitos. O conteúdo do site (marca, textos e imagens próprias) é da Orium.
        </p>
      </section>

      <section>
        <h2>Responsabilidade</h2>
        <p>
          Fazemos o possível para manter o site disponível e correto, mas ele pode ficar indisponível por manutenção ou
          por fatores fora do nosso controle. [REVISAR: limites de responsabilidade, conforme a lei].
        </p>
      </section>

      <section>
        <h2>Mudanças e contato</h2>
        <p>
          Podemos atualizar estes termos; a versão vigente é a desta página. Dúvidas: WhatsApp {LEGAL.whatsapp} ou{" "}
          {LEGAL.contatoDados}. Fica eleito o foro do domicílio do consumidor.
        </p>
      </section>
    </LegalPage>
  );
}
