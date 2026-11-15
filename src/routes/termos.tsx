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
          {LEGAL.responsavel} (CNPJ {LEGAL.documento}), {LEGAL.endereco}. Consulte estas condições antes de
          confirmar o pedido. Veja também a{" "}
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
          <li>Os pedidos feitos no site são pagos por Pix. O site registra o pedido, e a Orium orienta o pagamento pelo WhatsApp {LEGAL.whatsapp}.</li>
          <li>Confira o preço e os descontos aplicados na sacola. Compras de atacado têm preço próprio quando atingem a quantidade indicada na sacola.</li>
          <li>Antes de confirmar a compra pelo atendimento, a Orium informa o valor total, o frete quando aplicável, o prazo de pagamento e as condições da opção escolhida.</li>
          <li>Se um item estiver indisponível ou houver divergência no pedido, fale com a Orium pelo WhatsApp para resolver a situação.</li>
        </ul>
      </section>

      <section>
        <h2>Entrega</h2>
        <p>
          A retirada na loja em Itaguaí/RJ é gratuita. Para receber por entrega, informe o endereço à Orium pelo
          WhatsApp {LEGAL.whatsapp}. A loja confirma se atende o endereço e informa o valor da entrega e o prazo
          antes de você confirmar a compra. Para itens sob encomenda, a Orium também confirma o prazo de disponibilidade.
        </p>
      </section>

      <section>
        <h2>Trocas, devolução e arrependimento</h2>
        <p>
          Nas compras feitas à distância, você pode desistir em até 7 dias corridos contados do recebimento do
          produto, conforme o art. 49 do Código de Defesa do Consumidor. Informe o número do pedido pelo WhatsApp{" "}
          {LEGAL.whatsapp} ou pelo e-mail {LEGAL.contatoDados}. A Orium confirma o recebimento da solicitação,
          orienta a devolução sem custo e restitui os valores pagos, inclusive o frete.
        </p>
        <p>
          Se o produto chegar com defeito, avaria ou diferente do pedido, use os mesmos canais para solicitar
          atendimento. Se puder, envie fotos para ajudar a identificar o problema.
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
          Se houver atraso, falha no site ou problema com o produto, fale com a Orium pelos canais de atendimento.
          Os direitos previstos na legislação de defesa do consumidor continuam aplicáveis.
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
