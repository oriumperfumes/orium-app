# Editar e excluir vendas da loja

Hoje uma venda registrada só pode ser cancelada. Vou dar o ciclo completo: **ver → editar → corrigir → excluir**, sempre revertendo o efeito antigo e aplicando o novo dentro de uma única operação segura no banco.

## O que você vai ver

**Na lista de Vendas da loja**
Cada card ganha um menu discreto `⋯` com `Editar venda` e `Excluir venda`. Tocar no card continua abrindo o detalhe.

**No detalhe da venda**
Tudo continua somente leitura. No topo: `Editar` e o menu `⋯` → `Excluir venda`.
Novo botão discreto `Ver histórico` mostra a linha do tempo:

```text
22/09 · 22:31   Venda registrada por voz
22/09 · 22:40   Quantidade alterada — Asad Bourbon 3 → 2
22/09 · 22:41   Pagamento alterado — Cartão → Pix
```

Vendas por voz continuam mostrando “Registro: Voz” e `Ver transcrição` — a transcrição original nunca é alterada pela edição.

**Editando**
A venda abre já preenchida, em cards verticais (nada de tabela):

```text
[foto]  Asad Bourbon
        DECANT · 5ml
        [−]  2  [+]        R$ 39,90 cada     [ Alterar ]
──────────────────────────────────────────────
[foto]  Liquid Brun
        FRASCO                1x   R$ 330,00  [ Alterar ]
──────────────────────────────────────────────
Pagamento   Pix
Desconto    —
Total       R$ 409,80
            [ Salvar alterações ]
```

Pode trocar produto, Frasco/Decant, tamanho 2/5/10ml, quantidade, preço unitário, desconto, total, pagamento, cliente, data/hora, além de adicionar e remover itens. Trocar produto, variante e pagamento acontece em painéis que sobem de baixo.

`🎙 Corrigir por voz` dentro da edição: “na verdade foram dois Asad Bourbon de 5ml” muda apenas o rascunho. Nada é salvo até você tocar `Salvar alterações`.

**Excluindo**

```text
Excluir esta venda?

Essa ação irá retirar a venda dos relatórios, reverter o estoque,
recalcular receita e lucro, atualizar rankings e remover os efeitos
de reposição quando aplicável.

Venda #LV-0142 · Total R$ 119,70
[ Cancelar ]   [ Excluir venda ]
```

O card sai da lista com uma animação curta e aparece “Venda excluída e movimentações revertidas.”

## Regras que o sistema garante

- **Editar = reverter o antigo e aplicar o novo.** 3×5ml → 2×5ml termina com 10ml consumidos (não 25). 1 frasco → 2 frascos termina em −2 (não −3). Trocar Asad por Asad Bourbon devolve 1 Asad e baixa 1 Asad Bourbon. Trocar 2 decants de 5ml por 1 frasco devolve os 10ml e baixa o frasco.
- **Excluir = reverter tudo**: 15ml voltam, frascos voltam, receita/lucro/ranking voltam ao que eram.
- **Nunca duas vezes**: dois toques em `Salvar alterações` ou em `Excluir venda` aplicam a movimentação uma única vez.
- **Custo**: item que não mudou preserva o custo gravado no momento da venda; item novo ou alterado usa o custo atual. Qual política foi usada fica registrada no histórico. Sem custo, continua “Lucro pendente — custo ausente”.
- **Cliente**: trocar de João para Maria move a venda no histórico comercial, sem duplicar. Remover o cliente só desvincula — o cliente nunca é apagado.
- **Excluída não conta** em vendas, lucro, ticket médio, mais vendidos, histórico ativo do cliente nem nos relatórios. A auditoria permanece recuperável.
- **Reposição** acompanha automaticamente, porque é calculada a partir do estoque reconciliado — sem quantidade antiga presa nem duplicidade.
- **Funil digital continua intocado.**
- Somente Admin/Owner editam ou excluem, validado no servidor — não basta esconder o botão.

## Parte técnica

**Migração `0008_store_sale_edit.sql`**
- `store_sales`: `deleted_at`, `deleted_by`, `deletion_reason`, `edit_seq integer default 0`.
- `store_sale_update(p_payload jsonb)` — `SECURITY DEFINER`, `is_staff` obrigatório. Trava a venda com `FOR UPDATE`, checa `p_expected_seq` (idempotência otimista: seq divergente devolve `{already:true}` sem aplicar nada), estorna o estoque de todos os itens atuais via `store_sale_apply_stock` com sinal negativo, apaga os itens, reinsere os novos com a política de custo (snapshot preservado quando `product_id` + `variant` + `decant_ml` são idênticos ao item anterior; senão `store_product_cost`), reaplica o estoque, recalcula `subtotal/discount/total/cost_total/gross_profit/cost_complete`, incrementa `edit_seq` e grava `store_sale_events` com o diff legível (itens, quantidades, preços, pagamento, cliente, data, política de custo).
- `store_sale_delete(p_id, p_reason)` — estorna o estoque item a item, marca `deleted_at/deleted_by/deletion_reason`, `status = 'excluida'`, e registra o evento. Se `deleted_at` já existir, retorna `{already:true}` sem tocar no estoque.
- `store_sale_list`, `store_sale_detail`, `admin_dashboard`, `top_sold_products` passam a filtrar `deleted_at IS NULL` (detalhe continua acessível por id para auditoria). `store_sale_detail` devolve também `edit_seq` e os `details` dos eventos.

**Servidor** — `src/lib/store-sales.functions.ts`: `storeSaleUpdate` e `storeSaleDelete` com `requireSupabaseAuth` + `is_staff`, e `storeSaleInterpret` reutilizado para a correção por voz (já aceita rascunho anterior como contexto).

**Interface**
- `SaleDetailSheet.tsx`: somente leitura + `Editar`, menu `⋯`, `Ver histórico` (linha do tempo formatada a partir dos eventos) e confirmação de exclusão.
- Novo `SaleEditSheet.tsx` (+ `SaleEditItemCard.tsx`) em `src/components/orium/admin/store-sales/`: cards verticais, steppers, bottom sheets de produto/variante/pagamento/cliente, `🎙 Corrigir por voz` reaproveitando `recorder.ts` e a rota de transcrição, e `Salvar alterações` com chave de sequência.
- `admin.vendas-loja.tsx`: menu `⋯` no card, invalidação de `["store-sales"]`, `["store-sale-detail"]` e `["admin-dashboard"]` (lista atualiza sem recarregar), remoção animada e toast.
- Mobile-first, sem overflow de 320 a 430px, campos ≥16px.

**Testes** — 3×5ml → 2×; 1 frasco → 2; Asad → Asad Bourbon; excluir e conferir estoque/receita/lucro/ranking; repetir a exclusão; preço 300 → 280; cliente João → Maria; duplo toque em salvar; Playwright em 320/360/390/430 e 1280.
