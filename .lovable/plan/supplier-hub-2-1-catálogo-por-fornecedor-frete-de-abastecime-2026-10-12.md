# Supplier Hub 2.1 — Catálogo por fornecedor + frete de abastecimento SuperFrete

## O que já verifiquei
- A conta SuperFrete atual **aceita cotar com origem em São Paulo**: um teste com um CEP público da região da 25 de Março até Itaguaí devolveu PAC e SEDEX com preço e prazo reais. Esse CEP de teste não será salvo. O CEP real da Amado continua sem confirmação e ficará em branco.
- **Contratar** (comprar a etiqueta) com origem no fornecedor não será feito nem testado. Normalmente quem posta é o próprio fornecedor. O sistema vai apenas cotar e registrar o valor.

## 1. Catálogo público por fornecedor
- Uma nova opção no fornecedor: **Todos os elegíveis**, **Somente selecionados** ou **Não disponibilizar**.
- Cada produto pode ficar em **Seguir fornecedor**, **Permitir** ou **Não permitir**. A escolha do produto vale mais que a do fornecedor.
- O bloqueio vale para a **oferta**, não para o perfume. A disponibilidade pública só leva em conta as ofertas liberadas. Se a MRX tem o Liquid Brun e está liberada, ele continua no site.
- O estoque lacrado da loja vem sempre primeiro, e os bloqueios manuais gerais continuam valendo. Nada é apagado: fotos, preços, histórico e vínculos ficam guardados.
- A sincronização continua importando, atualizando preços e comparando. Ela nunca muda essas escolhas, porque elas ficam guardadas separadas dos dados que a sincronização atualiza.
- Uma tela **Produtos do fornecedor** com custo real, situação no catálogo, filtro, seleção múltipla e permitir/bloquear em lote, com confirmação.

## 2. Logística e frete de abastecimento
- O fornecedor ganha: CEP de origem, serviços preferidos, uma embalagem padrão (altura, largura, comprimento e peso por frasco, ou peso total), número de volumes e valor declarado. Tudo é opcional e nada é preenchido por mim.
- O destino é o CEP cadastrado da Orium, mas com um campo próprio para "receber mercadorias", separado da origem usada nos envios aos clientes.
- Um botão **Calcular frete com SuperFrete** mostra transportadora, serviço, valor, prazo e data estimada de chegada em dias úteis no horário de Brasília. Se a API falhar ou faltarem dados, aparece o motivo. Também dá para **registrar uma cotação enviada pelo fornecedor**, marcada como "informada pelo fornecedor".
- Na **Retirada própria** não há cálculo de transportadora. Ficam o prazo de retirada e o custo de deslocamento, se houver. Esse custo entra nas análises, nunca como zero.
- Cada cotação fica guardada com a data, a origem (SuperFrete ou fornecedor) e se é estimada ou confirmada.

## 3. Custo real e divisão do frete
- O frete pertence à **remessa**. Ele é dividido entre os itens por **quantidade**, por **valor** ou por **peso** (este último só quando todos os itens têm peso). O método usado aparece na tela.
- O comparador mostra o custo anunciado, o frete dividido e o custo estimado total, além de um alerta de "frete a consultar" quando não houver cotação. Nunca há duplicação: se o custo já inclui o frete, ele não é somado de novo.
- Os rótulos passam a ser **Mais barato (custo total)**, **Preferencial** e **Menor prazo**.

## 4. Margem mínima
- Um ajuste de margem mínima desejada, como 25%, que pode ser geral e também por fornecedor.
- O aviso "Este produto pode não atingir a margem mínima desejada." usa o preço real de venda do sistema de preços. As opções são: Manter no catálogo, Não disponibilizar esta oferta ou Revisar preço.
- Nada é bloqueado automaticamente, a menos que você ligue essa regra de forma explícita.
- Os custos ficam separados: anunciado, logístico estimado, efetivo confirmado, venda, margem estimada e margem realizada. O preço público só muda com custos confirmados ou quando você ligar isso. Preços manuais continuam protegidos.

## 5. Reposição
- Os itens são agrupados por fornecedor. Cada fornecedor faz **uma única cotação para a remessa inteira**, com a quantidade total.
- Aparecem o custo total, o frete dividido, o prazo e a opção de trocar de fornecedor, respeitando as preferências.
- Quando faltam medidas ou peso, o sistema pede esses dados em vez de inventar.
- A consulta por WhatsApp continua só com frascos.

## 6. Copilot
- Ferramentas novas que buscam direto no banco:
  - "compensa comprar X no fornecedor Y"
  - "quanto fica trazer N perfumes de SP" (só cota quando há embalagem cadastrada)
  - "quais produtos não estão autorizados no catálogo"
  - "bloquear o catálogo do fornecedor mantendo a sincronização", sempre com confirmação

## 7. Testes
- Os 16 cenários pedidos, com dados reais:
  - bloquear todo o catálogo e liberar um produto
  - bloquear outro produto e verificar que o produto que existe na MRX continua público
  - estoque lacrado preservado e sincronização rodando duas vezes sem desfazer escolhas
  - cotação SP → Itaguaí e falha da API
  - remessa de vários frascos com divisão do frete sem duplicação
  - comparação RJ × SP, Reposição, margens e preço público sem alteração

## Detalhes técnicos
- Migração apenas aditiva:
  - `suppliers`: `catalog_mode` (all/selected/none, padrão all; Amado como none se você quiser), `origin_cep`, `default_package` jsonb, `declared_value`, `freight_services`, `min_margin_pct`, `freight_cost_affects_pricing` bool padrão false
  - `supplier_product_preferences`: `catalog` (inherit/allow/deny)
  - nova tabela `supplier_freight_quotes` (supplier_id, source superfrete/supplier, status estimated/confirmed, units, weight, price, days, service, carrier, raw, created_by)
  - `shipping_settings`: `receiving_cep`
  - Tudo restrito à equipe (RLS).
- `products_effective_availability` / `recompute_product_pricing`: a oferta só sustenta a disponibilidade quando `use_for_availability` está ligado e a regra de catálogo efetiva permite. Isso respeita a ordem já existente: bloqueio manual, depois estoque lacrado, depois regras manuais, depois ofertas liberadas, e por fim indisponível.
- O adaptador SuperFrete de `shipping.server.ts` é exportado e reaproveitado com outro par de CEPs. As cotações para clientes não mudam.
- O rateio de frete fica em um helper puro com testes. `compare.server.ts` e `hub.server.ts` passam a usar esse rateio.
