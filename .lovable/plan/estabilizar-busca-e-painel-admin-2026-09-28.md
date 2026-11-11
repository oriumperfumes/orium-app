# Estabilizar busca e painel Admin

## Objetivo
Restaurar o funcionamento completo da busca pública e do Admin sem redesenhar a interface nem alterar regras comerciais.

## Busca do catálogo
- Unificar texto digitado, termo enviado ao catálogo e popup em uma única sequência de estado.
- Fazer a busca automaticamente após o debounce, sem Enter, resetando a paginação a cada termo.
- Cancelar consultas antigas e impedir resultados anteriores durante a troca de query.
- Confirmar que a consulta usa apenas produtos públicos/canônicos elegíveis e respeita nome, marca, aliases, fuzzy e separação de flankers.
- Preservar texto e resultados ao alternar entre busca normal/sticky e ao abrir um produto e voltar.
- Validar histórico, teclado, ESC, gesto/botão voltar, clique fora e limpeza.

## Estabilidade do Admin
- Corrigir a incompatibilidade entre os pacotes de navegação que está causando o erro `_nonReactive` no pré-carregamento.
- Auditar shell, cabeçalho, menu lateral, barra inferior, Dashboard, Pedidos, Estoque, Produtos, Reposição, Ao Vivo e Copilot.
- Corrigir somente falhas funcionais: rotas inválidas, permissões, consultas, providers, efeitos/listeners, camadas fixas, scroll e overflow.
- Manter o visual e as regras atuais.

## Validação
- Executar verificações automatizadas específicas da busca e navegação.
- Testar no navegador os fluxos completos solicitados, incluindo retorno do produto para a busca.
- Percorrer as páginas principais do Admin com menu e Copilot em 393px, tablet e desktop.
- Conferir erros de execução, console, rede e compilação; finalizar apenas sem erro crítico reproduzível.

## Detalhes técnicos
- TanStack Query continuará responsável por cache/cancelamento; o `AbortSignal` será encaminhado até a chamada da busca.
- A URL continuará guardando a pesquisa confirmada para restauração, mas será sincronizada automaticamente pelo mesmo debounce.
- As dependências TanStack serão alinhadas na mesma versão compatível para eliminar falhas internas do Router.