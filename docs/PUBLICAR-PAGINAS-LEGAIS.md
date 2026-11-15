# Páginas /privacidade e /termos: o que preencher e como publicar

Status: **rascunho** (`LEGAL_DRAFT = true`). Nada daqui vai ao ar sem revisão e sem a autorização da virada.

## 1. Dados da empresa a preencher (`src/lib/legal-info.ts`)
| Campo | O que colocar | Observação |
|---|---|---|
| `responsavel` | Razão social ou nome empresarial de quem vende | Como no CNPJ/MEI |
| `documento` | CNPJ (de preferência) | **Página pública.** Se for MEI, use o CNPJ; evite CPF |
| `endereco` | Endereço comercial/ponto de retirada, Itaguaí/RJ | **Página pública.** Se for a sua casa, use só bairro/cidade ou um endereço comercial |
| `contatoDados` | E-mail para pedidos de dados pessoais (LGPD) | Crie um e-mail da loja; não use e-mail pessoal |
| `LEGAL_UPDATED` | Data da versão (ex.: 15/12/2026) | |
`whatsapp` ((21) 97717-4508) e `site` já são públicos no site.

**Onde preencher com segurança:** direto no arquivo `src/lib/legal-info.ts`, na branch do PR #2, pelo editor web do GitHub (lápis do arquivo) ou localmente. **Não envie esses dados no chat.** Como as páginas são públicas, preencha apenas o que pode ser público; documento pessoal (CPF) e endereço residencial não devem ser publicados.

## 2. Decisões de venda a confirmar (marcadas `[CONFIRMAR]` / `[REVISAR]` no texto)
Práticas já confirmadas no app/banco e usadas no texto: loja física em Itaguaí; retirada sem custo; entrega local em Itaguaí, Seropédica, Mangaratiba e Rio de Janeiro (Uber Entregas/99 Entrega, valor combinado no WhatsApp); envio pelos Correios com frete do SuperFrete; sob encomenda ≈ 4 dias para retirada/entrega local; Pix com 5% de desconto; atacado a partir de 6 peças; decants de 2/5/10 ml (R$ 24,90 / 49,90 / 84,90); pedido confirmado no WhatsApp.
A confirmar:
1. Pagamento: antes do envio/retirada? Prazo para pagar antes de cancelar o pedido?
2. Cartão: parcelamento e taxas (o site mostra um preço de cartão sem o desconto do Pix).
3. **Devolução de decants e frascos abertos/usados** (*destacado*): a loja não tem política escrita. Texto sugerido no rascunho: decants são separados sob pedido; depois de abertos ou usados, só há troca por defeito ou erro da loja. Decidir também sobre itens sob encomenda e quem paga o frete de devolução. O direito de arrependimento de 7 dias (CDC art. 49) vale para compras à distância; **revisão jurídica** da redação para itens abertos.
4. **Limites de responsabilidade** (*destacado*): atrasos de transporte, indisponibilidade do site, reação/alergia a perfume. O CDC não permite limitar responsabilidade por defeito ou falha da loja; **revisão jurídica** da redação.
5. Retenção de dados (Privacidade): por quanto tempo guardar pedidos e contas (sugestão: pedidos 5 anos por obrigação fiscal; contas até pedirem exclusão). Confirmar.
6. Provedores citados: Supabase, Cloudflare, Google, SuperFrete/Correios, WhatsApp/Meta, provedor de IA (OpenAI). Confirmar que a lista reflete o que estará ligado na virada (IA e Meta só se forem ativadas).

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
