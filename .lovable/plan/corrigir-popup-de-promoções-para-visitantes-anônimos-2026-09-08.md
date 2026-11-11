# Corrigir popup de promoções para visitantes anônimos

## Implementação
- Tornar o identificador anônimo resiliente, priorizando armazenamento local e usando cookie first-party como fallback, sem depender de login ou sessão.
- Centralizar a avaliação da campanha com motivos explícitos para cada descarte: inativa, fora do período, não pública, produto inválido/indisponível ou já vista.
- Atualizar o popup após o carregamento assíncrono, sem cache negativo persistente, e registrar a impressão apenas depois que o popup estiver realmente visível.
- Manter a chave por campanha e o reset já existente, para que novas campanhas e “Mostrar novamente” não sejam bloqueados por campanhas anteriores.
- Preservar a fila: promoção primeiro; cupom somente quando não houver promoção pendente.

## Admin
- Adicionar “Testar popup” em cada promoção anunciada, abrindo uma prévia forçada sem alterar o histórico do navegador.
- Exibir um diagnóstico curto de elegibilidade da campanha e se ela já foi vista neste navegador.

## Validação
- Testar sessão anônima limpa, refresh após impressão, nova sessão anônima, nova campanha simulada, campanha múltipla, destino do botão e ausência de erros/overflow em celular e desktop.
- Confirmar que não existe service worker/PWA interferindo e que datas gravadas pelo Admin preservam o horário local de São Paulo ao serem convertidas para UTC.
