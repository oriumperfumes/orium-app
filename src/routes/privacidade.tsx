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
    links: [{ rel: "canonical", href: "/privacidade" }],
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
            <strong>Pedido e contato:</strong> nome, WhatsApp, forma de receber (retirada, entrega local ou envio) e,
            quando há entrega, endereço e CEP; itens, valores e forma de pagamento escolhida.
          </li>
          <li>
            <strong>Conta (opcional):</strong> e-mail e senha, ou nome, e-mail e foto de perfil que o Google informa
            quando você entra com Google. Não recebemos a sua senha do Google.
          </li>
          <li>
            <strong>Uso do site:</strong> favoritos, sacola, buscas, páginas vistas e um identificador do seu aparelho,
            para o site funcionar, lembrar a sua sacola e entender quais perfumes interessam.
          </li>
          <li>
            <strong>Atendimento:</strong> mensagens que você nos envia por WhatsApp ou por outro canal que a Orium
            venha a conectar.
          </li>
        </ul>
        <p>
          Não coletamos dados de cartão no site: o pagamento (Pix ou cartão) é combinado com a Orium depois do pedido.
        </p>
      </section>

      <section>
        <h2>Para que usamos</h2>
        <ul>
          <li>Registrar, confirmar, preparar e entregar o seu pedido, e cobrar e conferir o pagamento (execução do contrato).</li>
          <li>Calcular frete e prazos.</li>
          <li>Manter o seu login e a segurança da conta, e evitar fraudes (legítimo interesse e prevenção a fraudes).</li>
          <li>Atender dúvidas e pós-venda, inclusive com ferramentas de inteligência artificial como apoio, com a equipe no controle.</li>
          <li>Melhorar a loja e o catálogo com estatísticas de uso (legítimo interesse).</li>
          <li>Avisar sobre disponibilidade de produto, quando você pede, e cumprir obrigações legais e fiscais.</li>
        </ul>
      </section>

      <section>
        <h2>Com quem compartilhamos</h2>
        <p>Só com quem precisa para a loja funcionar, sempre no limite do necessário:</p>
        <ul>
          <li>Supabase (banco de dados e login), com servidores no Brasil.</li>
          <li>Cloudflare (hospedagem e segurança do site).</li>
          <li>Google (login com Google).</li>
          <li>SuperFrete e transportadoras/Correios (CEP, medidas e dados de entrega para cotar e enviar).</li>
          <li>WhatsApp/Meta (conversa com a Orium, iniciada por você).</li>
          <li>Provedor de IA contratado pela Orium, para apoiar o atendimento.</li>
        </ul>
        <p>Não vendemos os seus dados.</p>
      </section>

      <section>
        <h2>Por quanto tempo guardamos</h2>
        <p>
          Guardamos os dados do pedido pelo tempo necessário para o atendimento, a garantia e as obrigações fiscais e
          legais. Dados de conta ficam enquanto a conta existir. Depois, são apagados ou anonimizados, salvo quando a
          lei exigir guarda. [CONFIRMAR: prazo, por exemplo 5 anos para pedidos; REVISAR JURÍDICO].
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
