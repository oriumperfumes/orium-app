# Mostrar "Acessou recentemente" na ficha do cliente

## O que está acontecendo

A seção existe no código, mas está escondida porque nenhum cliente tem visualizações ligadas a ele. Conferi no banco:

- Existem 12 visualizações registradas e 8 fichas de cliente.
- Nenhuma visualização casa com nenhuma ficha (0 para todos os clientes).

Motivo: o site guarda **dois identificadores diferentes** do visitante. As visualizações de perfume são gravadas com um identificador próprio, enquanto o CRM (favoritos, carrinho, interesses em negociação) usa outro. Como os dois nunca coincidem, o histórico de acessos nunca é associado à ficha.

## O que será feito

1. **Unificar o identificador do visitante**: as visualizações passarão a usar o mesmo identificador de aparelho que o CRM já usa (o que também sobrevive melhor, pois fica em cookie além do armazenamento local).
2. **Vincular quem está logado**: quando a pessoa está com conta, a visualização é atribuída à conta e a ficha do CRM é encontrada por ela.
3. **Aproveitar o histórico antigo**: migração que liga as visualizações já existentes às fichas quando o aparelho/conta puder ser identificado com segurança (sem casar por nome, sem apagar nada).
4. **Sempre mostrar a seção**: em vez de desaparecer, "Acessou recentemente" aparece com a mensagem "Nenhum acesso registrado ainda" quando não houver dados — assim você nunca fica na dúvida se é bug ou falta de dado.
5. **Verificação real**: abrir o site como visitante, ver alguns perfumes, informar o nome na Negociação e confirmar que os perfumes vistos aparecem na ficha desse cliente em Admin → Clientes.

## Onde encontrar depois

Admin → Clientes → toque no nome do cliente → seção **Acessou recentemente**, logo abaixo de "Pedidos". Cada linha mostra perfume, marca, data/hora, quantas vezes acessou e abre a página do perfume ao toque.

## Detalhes técnicos

- `src/lib/product-views.ts`: substituir a chave `orium-visitor` pelo `deviceId()` de `src/lib/promotions.ts` (fonte única), mantendo o registro silencioso.
- `log_product_view`: garantir gravação de `user_id` a partir de `auth.uid()` além de `p_anonymous_id`.
- Migração: registrar em `crm_customer_devices` os aparelhos das visualizações que já pertencem a um cliente identificável (via carrinho/favorito/interesse com o mesmo identificador) e nada além disso.
- `crm_customer_detail` já retorna `recent_views` corretamente — nenhuma mudança de SQL na consulta em si.
- `CustomerSheet.tsx`: renderizar a `Section` sempre, com `Empty` quando a lista vier vazia.
