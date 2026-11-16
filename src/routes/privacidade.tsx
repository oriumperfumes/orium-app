import { createFileRoute } from "@tanstack/react-router";
import { LegalPage, LEGAL_DRAFT } from "@/components/orium/LegalPage";
import { LEGAL, LEGAL_UPDATED } from "@/lib/legal-info";

export const Route = createFileRoute("/privacidade")({
  head: () => ({
    meta: [
      { title: "Política de Privacidade — Orium Perfumes" },
      { name: "description", content: "Como a Orium Perfumes trata os seus dados pessoais, conforme a LGPD." },
      ...(LEGAL_DRAFT ? [{ name: "robots", content: "noindex" }] : []),
    ],
    links: [{ rel: "canonical", href: `${LEGAL.site}/privacidade` }],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <LegalPage title="Política de Privacidade" updated={LEGAL_UPDATED}>
      <section>
        <h2>Quem somos</h2>
        <p>
          A Orium Perfumes ({LEGAL.site}) vende perfumes árabes em decants (2, 5 ou 10 ml) e frascos. O responsável pelo
          tratamento dos seus dados é {LEGAL.responsavel}, {LEGAL.documento}, com endereço em {LEGAL.endereco}. Para
          falar sobre seus dados: {LEGAL.contatoDados} ou WhatsApp {LEGAL.whatsapp}.
        </p>
      </section>

      <section>
        <h2>Quais dados usamos</h2>
        <ul>
          <li>
            <strong>Pedido e contato:</strong> nome, WhatsApp, forma de receber (retirada na loja ou entrega) e,
            quando há entrega, endereço e CEP; itens, valores e forma de pagamento escolhida.
          </li>
          <li>
            <strong>Conta (opcional):</strong> e-mail e credencial de acesso administrada pelo serviço de
            autenticação. Se usar o Google, recebemos seu identificador, e-mail e dados básicos de perfil
            disponibilizados por ele, como nome e foto, para identificar sua conta e permitir o acesso.
          </li>
          <li>
            <strong>Uso do site:</strong> favoritos, sacola, buscas, páginas vistas, origem da visita, um
            identificador do navegador e informações técnicas como tipo de aparelho, navegador e idioma. A atividade
            pode ser associada à sua conta ou ao seu pedido quando você se identifica.
          </li>
          <li>
            <strong>Atendimento:</strong> mensagens e informações do pedido que você compartilha com a Orium pelo
            WhatsApp ou por e-mail.
          </li>
        </ul>
        <p>
          O site registra o pedido. A Orium fornece as orientações para pagamento por Pix pelo WhatsApp.
        </p>
      </section>

      <section>
        <h2>Para que usamos</h2>
        <ul>
          <li>Registrar, confirmar, preparar e entregar o seu pedido, e cobrar e conferir o pagamento (execução do contrato).</li>
          <li>Combinar o valor da entrega e o prazo com você.</li>
          <li>Manter o seu login e a segurança da conta, e evitar fraudes (legítimo interesse e prevenção a fraudes).</li>
          <li>Atender dúvidas, acompanhar pedidos e prestar suporte pós-venda.</li>
          <li>Melhorar a loja e o catálogo com estatísticas de uso (legítimo interesse).</li>
          <li>Avisar sobre disponibilidade de produto, quando você pede, e cumprir obrigações legais e fiscais.</li>
        </ul>
      </section>

      <section>
        <h2>Com quem compartilhamos</h2>
        <p>Só com quem precisa para a loja funcionar, sempre no limite do necessário:</p>
        <ul>
          <li>Supabase, para banco de dados e autenticação, e Cloudflare, para hospedagem e segurança do site.</li>
          <li>Google, quando você usa o login com Google, e para envio de e-mails de cadastro e recuperação.</li>
          <li>Serviços de entrega (como aplicativos de entrega), quando você escolhe receber em casa, somente com o necessário para realizar a entrega.</li>
          <li>WhatsApp (Meta), quando o checkout abre uma mensagem com os dados do pedido ou quando você usa o canal para falar com a Orium.</li>
        </ul>
        <p>Não vendemos os seus dados.</p>
      </section>

      <section>
        <h2>Por quanto tempo guardamos</h2>
        <p>
          O prazo de guarda depende da finalidade de cada dado. Mantemos os dados da conta para prestar o serviço
          enquanto a conta estiver ativa. Os registros de pedidos são mantidos pelo tempo necessário para atender
          solicitações sobre a compra e cumprir obrigações legais e fiscais. Você pode pedir a exclusão da conta
          pelos canais abaixo. Alguns registros podem ser conservados nas hipóteses previstas em lei.
        </p>
      </section>

      <section>
        <h2>Seus direitos (LGPD)</h2>
        <p>
          Você pode pedir confirmação de que tratamos seus dados, acesso, correção, anonimização ou eliminação,
          portabilidade, informação sobre compartilhamento e revogar consentimentos, quando for o caso. Basta escrever
          para {LEGAL.contatoDados} ou chamar no WhatsApp {LEGAL.whatsapp}. Respondemos no prazo da lei. Você também
          pode reclamar à Autoridade Nacional de Proteção de Dados (ANPD).
        </p>
      </section>

      <section>
        <h2>Cookies e armazenamento no aparelho</h2>
        <p>
          Usamos armazenamento do navegador (por exemplo, para manter sua sessão, sua sacola e seus favoritos) e
          estatísticas de uso próprias. Você pode limpar esses dados nas configurações do navegador; o site continua
          funcionando, mas pode esquecer sua sacola.
        </p>
      </section>

      <section>
        <h2>Segurança</h2>
        <p>
          Usamos conexão criptografada, controle de acesso por perfil (cliente, administrador e dono) e guardamos
          chaves e segredos somente no servidor. Nenhum sistema é 100% seguro; se houver incidente relevante,
          avisaremos você e a ANPD conforme a lei.
        </p>
      </section>

      <section>
        <h2>Mudanças nesta política</h2>
        <p>Podemos atualizar este texto. A data de atualização fica no topo desta página.</p>
      </section>
    </LegalPage>
  );
}
