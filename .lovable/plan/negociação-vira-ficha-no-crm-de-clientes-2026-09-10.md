# Negociação vira ficha no CRM de Clientes

Quando o visitante informa o nome antes de ir para o WhatsApp, ele passa a existir em
Admin → Clientes, com tudo que aquele mesmo aparelho já fez (favoritos, carrinho,
perfumes vistos, alertas de estoque, interesses em negociação).

## Como a identidade funciona

O aparelho já tem um identificador próprio, guardado no navegador. Ele passa a ser a
chave da ficha:

```text
mesmo aparelho  ->  uma única ficha
   nome na Negociação        -> cria/atualiza a ficha
   pedido com WhatsApp       -> a mesma ficha ganha telefone
   login na conta            -> a mesma ficha ganha a conta
```

Nunca juntamos duas pessoas só porque têm o mesmo nome. Um aparelho pode ser ligado a
uma ficha existente (quando o telefone ou a conta coincidem), mas nunca cria uma
segunda pessoa.

## O que muda

1. **Ficha criada pelo nome na Negociação.** Ao continuar para o WhatsApp, o nome é
   gravado numa ficha ligada àquele aparelho. Negociar outro perfume atualiza a mesma
   ficha — nunca cria outra. Telefone e e-mail ficam vazios; nada é inventado.
2. **Histórico do aparelho na ficha.** A ficha passa a mostrar também o que foi feito
   sem login: favoritos, carrinho atual, carrinhos abandonados, perfumes vistos,
   alertas de estoque e a lista de interesses em negociação. Pedidos continuam
   aparecendo quando existirem.
3. **Favoritos anônimos passam a ser registrados.** Hoje o favorito de quem não tem
   conta só existe no navegador, então a equipe não vê. Passa a ser salvo também no
   servidor, ligado ao aparelho, e continua sendo do perfume inteiro — nunca de
   Decant ou Frasco. Ao entrar na conta, os favoritos do aparelho continuam sendo
   levados para a conta como já acontece.
4. **Marca discreta de ficha provisória.** Enquanto só existe nome, a ficha mostra em
   texto pequeno "Cliente identificado pelo dispositivo".
5. **Quando o telefone aparece.** Se essa pessoa fizer um pedido informando WhatsApp,
   a ficha provisória recebe o telefone e o histórico continua todo lá. Se já existir
   uma ficha com aquele telefone, o aparelho é ligado a ela e as duas fichas são
   unidas (nome, notas e histórico preservados).
6. **Interesses recebidos com nome clicável.** Em Admin → Negociação, tocar em
   "Christopher — Club de Nuit Intense Woman" abre a ficha da pessoa em
   Admin → Clientes.
7. **Busca e filtros de Clientes** passam a encontrar essas fichas provisórias.

## Detalhes técnicos

- Migração: nova tabela `crm_customer_devices` (`device_id` único → `customer_id`), com
  GRANTs, RLS somente para equipe/service role; `favorites` ganha `anonymous_id` (com
  `user_id` opcional, índice único por aparelho + produto) e política para leitura
  apenas da equipe; `negotiation_interests` ganha `customer_id`.
- `crm_upsert_customer` ganha `p_device_id`: procura por aparelho → conta → telefone →
  e-mail; grava o vínculo do aparelho; ao encontrar ficha definitiva com o mesmo
  aparelho, funde a provisória (move notas, interesses e vínculos, apaga a duplicada).
- `crm_customer_detail` e `crm_customer_list` passam a considerar os `device_id` da
  ficha nas consultas de favoritos, carrinhos, visualizações, alertas e interesses, e
  devolvem `devices`/`provisional` além de uma lista `negotiations`.
- `recordNegotiationInterest` chama `crm_upsert_customer` com aparelho + nome e grava
  `customer_id` no interesse; `listNegotiationInterests` devolve `customer_id`.
- Favoritos: novo `src/lib/favorites.functions.ts` (`syncAnonymousFavorite`) chamado
  pelo provider quando não há sessão; o merge ao entrar na conta permanece igual.
- Admin: `admin.negociacao.tsx` com nome clicável navegando para
  `/admin/clientes?cliente=<id>`; `admin.clientes.tsx` abre a ficha por esse parâmetro,
  exibe o rótulo discreto e a seção de interesses em negociação.
