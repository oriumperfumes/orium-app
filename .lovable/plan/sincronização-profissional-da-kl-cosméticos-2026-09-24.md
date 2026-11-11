# Sincronização profissional da KL Cosméticos

## Diagnóstico confirmado até aqui

- A vitrine `klcosmeticos.catalog.kyte.site` responde ao servidor com `403` e uma página de proteção, inclusive em `/`, `/pt-BR`, `?preview=old` e `sitemap.xml`. Isso será registrado como `SOURCE_BLOCKED`; não haverá tentativa de contorno.
- A fonte estruturada do próprio catálogo chegou a ser localizada e 63 ofertas reais da KL foram gravadas, todas com preço e vínculo canônico. Porém a execução caiu durante o primeiro lote, antes de criar o histórico da execução, e deixou a KL em “sincronizando”.
- O lote atual faz trabalho caro item a item, especialmente validação remota de imagens. Isso excedeu o tempo da chamada. Portanto o problema principal atual não é “zero produtos”: é uma execução longa, sem checkpoint e sem fechamento de diagnóstico.
- A proteção contra lote inicial vazio já existe parcialmente, mas usa mensagem genérica e não cobre adequadamente respostas inválidas, catálogo drasticamente menor, falha após um lote parcial nem todo o ciclo acumulado.

## 1. Adapter exclusivo e diagnóstico da fonte

- Criar um `KLCosmeticosAdapter` independente do Smart Mania, com operações separadas de descoberta, coleta, parse, normalização e health check.
- Auditar e validar cada resposta: URL solicitada/final, redirects, status, content-type, tamanho, duração, quantidade detectada e amostra segura limitada.
- Classificar falhas com códigos estáveis: `SOURCE_UNAVAILABLE`, `SOURCE_BLOCKED`, `HTML_CHANGED`, `NO_PRODUCTS_FOUND`, `PARSER_FAILED`, `NETWORK_ERROR`, `TIMEOUT`, `RATE_LIMITED` e `INVALID_RESPONSE`.
- Usar somente recursos públicos normalmente acessíveis. Se a fonte estruturada deixar de funcionar, interromper com o código correto e manter importação manual disponível.
- Implementar retry limitado com backoff e circuit breaker exclusivo da KL.

## 2. Execução confiável e preservação dos dados

- Reduzir os lotes da KL e persistir checkpoints reais, para nenhuma chamada longa ficar sem resultado.
- Separar coleta/normalização da validação de imagens; imagem não poderá impedir a importação do preço.
- Deduplicar a carga pelo identificador estável da KL antes do match canônico.
- Tratar HTTP 200 com zero itens como `PARSER_FAILED / NO_PRODUCTS_FOUND`, nunca sucesso.
- Considerar o ciclo completo bem-sucedido somente quando houver produtos reais e cobertura coerente com o último catálogo válido.
- Em qualquer falha, preservar preço, disponibilidade e vínculo anteriores. Ausência por falha técnica nunca vira “indisponível”.
- Representar disponibilidade como `AVAILABLE`, `UNAVAILABLE` ou `UNKNOWN`; somente informação explícita da fonte poderá marcar indisponível.
- Corrigir o estado travado atual da KL sem apagar as 63 ofertas já válidas.

## 3. Auditoria, histórico e identidade

- Ampliar o registro de execução com etapa (`FETCH`, `DISCOVERY`, `PARSE`, `NORMALIZE`, `MATCH`, `IMPORT`), código do erro, contadores acumulados e eventos cronológicos.
- Guardar metadados e amostras limitadas da resposta, nunca páginas enormes ou dados sensíveis.
- Registrar brutos, parseados, únicos, associados, novos canônicos, revisão, ignorados e erros.
- Persistir o payload/hash essencial da oferta, preço promocional quando real e histórico centavo a centavo.
- Manter os vínculos `supplier_product_id → canonical_product_id`; itens já confirmados não passam novamente por fuzzy match.
- Preservar o veto rígido de flankers. Itens duvidosos ficam em revisão, sem fusão automática.
- No primeiro ciclo completo, tratar a carga como baseline para não publicar centenas de falsas “novidades”.

## 4. Controles no Admin

- Na KL, adicionar **Testar conexão** com health check curto, sem importar catálogo.
- Exibir status, última tentativa, último sucesso válido, etapa, código/motivo real, circuit breaker e contadores.
- Exibir progresso verdadeiro por lote durante **Sincronizar agora** e um log técnico expansível somente para Admin/Owner.
- Manter **Importar catálogo** e **Colar lista da KL**. Adicionar CSV/XLSX com prévia e confirmação antes de aplicar; todos os formatos passam pelo mesmo normalizador e Identity Engine.
- O histórico mostrará a última oferta válida quando a leitura atual falhar.

## 5. Backfill e validação final

- Executar backfill completo da KL por todas as páginas/categorias acessíveis, sem zerar dados por falha e sem marcar o baseline inteiro como novidade.
- Conferir cobertura: coletados, únicos, vinculados, novos canônicos, revisão e ignorados.
- Validar parser monetário brasileiro com testes (`R$ 249,90`, `249,90` → `249.90`) e estados de disponibilidade.
- Testar zero produtos com HTTP 200, fonte indisponível, parser quebrado, paginação, retries e preservação das ofertas antigas.
- Conferir pelo menos 10 preços reais da KL centavo a centavo quando a fonte permitir leitura verificável.
- Testar identidade de Hawas Black, Asad Bourbon, Yara/Yara Elixir, Club de Nuit Iconic/Sillage e Liquid Brun.
- Confirmar regressão de MRX e Smart Mania sem alterar seus adapters.
- Confirmar que ofertas KL vinculadas aparecem no Comparador, participam do melhor preço e podem ser escolhidas na Reposição.
- Integrar ao agendamento de 3 horas em `America/Sao_Paulo` somente após o health check demonstrar automação estável; sincronização manual permanecerá disponível.

## Detalhes técnicos

- A sincronização continuará no backend TanStack já usado pela Orium; não haverá leitura da KL no navegador.
- Uma migração adicionará campos de diagnóstico/etapa/circuit breaker e disponibilidade explícita, além de uma tabela de eventos de execução com acesso exclusivo a Admin/Owner e permissões de serviço.
- O motor acumulará métricas do ciclo inteiro, em vez de declarar sucesso com base apenas no último lote.
- Os cálculos do Comparador continuarão usando somente ofertas válidas salvas no banco; falhas da fonte não apagarão nem substituirão o último valor confiável.
