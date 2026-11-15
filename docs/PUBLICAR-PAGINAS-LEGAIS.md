# Páginas /privacidade e /termos: o que preencher e como publicar

Status: **rascunho** (`LEGAL_DRAFT = true`). Nada daqui vai ao ar sem revisão e sem a autorização da virada.

## 1. Dados da empresa
A razão social, o CNPJ, o endereço comercial, o e-mail de atendimento sobre dados pessoais e a data da versão estão em `src/lib/legal-info.ts`. Confirme se essa caixa de e-mail receberá e responderá solicitações de privacidade.

## 2. Conferências antes de aprovar o texto
- Lançamento aprovado com Pix, retirada grátis em Itaguaí/RJ e entrega com valor e prazo combinados pelo WhatsApp. O site registra o pedido, e a Orium orienta o pagamento no atendimento. Antes de publicar, confirme no ensaio que o checkout oferece apenas essas opções, que aceita pedido com entrega ainda sem cotação e que informa que o valor da entrega será combinado antes de confirmar a compra. Cartão e frete automático ficam para uma etapa posterior.
- Confirme quem recebe pedidos de desistência, quem orienta a devolução e como a Orium processará o reembolso. O rascunho segue o direito de arrependimento para vendas à distância e evita impor uma restrição geral a itens abertos. Revise a aplicação a casos específicos de decants e produtos sob encomenda.
- Valide o fluxo de solicitações de dados pessoais, a guarda e o descarte dos registros e a lista de prestadores ativos. O rascunho descreve critérios de retenção por finalidade. Confirme internamente os prazos aplicáveis e verifique a configuração de coleta de estatísticas no lançamento. Inclua SuperFrete ou outros prestadores específicos quando a operação estiver confirmada. Acompanhe a operação se ativar IA, novos canais ou serviços com tratamento ou transferência internacional de dados.
- Aprove o texto com a pessoa responsável pelas práticas da Orium. Referências para revisão: [CDC, art. 49](https://www.planalto.gov.br/ccivil_03/leis/l8078compilado.htm), [Decreto do comércio eletrônico](https://www2.camara.leg.br/legin/fed/decret/2013/decreto-7962-15-marco-2013-775557-publicacaooriginal-139266-pe.html), [guia do Procon-SP](https://www.procon.sp.gov.br/wp-content/uploads/2024/08/Guia_de_Comercio_Eletronico.pdf) e [LGPD](https://www2.camara.leg.br/legin/fed/lei/2018/lei-13709-14-agosto-2018-787077-normaatualizada-pl.html).

## 3. Ordem para publicar e liberar o login Google aos clientes (depois da sua autorização da virada)
1. **Pré-condições:** campos preenchidos; texto revisado (com advogado, se possível); `LEGAL_DRAFT = false`; PR #1 (logo) e PR #2 aprovados e mesclados; build limpo.
2. **Ensaio:** publicar no Worker de ensaio e conferir `/privacidade` e `/termos` (sem o aviso de rascunho, links no rodapé, `indexável`).
3. **Virada do DNS** (adiada até a sua autorização): `oriumperfumes.com` e `www` apontando para o Worker. Conferir TLS.
4. **Conferir as URLs públicas:** `https://oriumperfumes.com/privacidade` e `/termos` devolvem 200.
5. **Google Cloud, projeto `orium-loja` → Branding:** preencher "Link da Política de Privacidade" e "Link dos Termos de Serviço" (as duas URLs acima); domínio autorizado `oriumperfumes.com` e página inicial já estão salvos. Salvar.
6. **Público-alvo → Publicar app** (Em produção). Os escopos são só `openid`, `email` e `profile`: não exige verificação do Google. Se o Google pedir verificação do domínio, confirmar a propriedade no Search Console.
7. **Teste com cliente real que não seja usuário de teste:** login Google mantém o UUID importado; `/admin` mostra "Área restrita".
8. Depois: observar os primeiros logins; remover usuários de teste só se quiser. O `orium-perfumes` (n8n/homologação) permanece intacto.
**Retorno:** se algo falhar, voltar o app para "Testando" no Google (clientes deixam de entrar, a equipe continua pelos usuários de teste) e, se necessário, repor o DNS conforme o roteiro de retorno da carga definitiva.
