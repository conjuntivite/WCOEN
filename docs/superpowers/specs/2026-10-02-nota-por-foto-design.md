# Nota por foto — design

**Data:** 2026-10-02 · **Status:** aprovado (versão enxuta), implementação aguardando o piloto

## Objetivo
Lançar uma despesa/receita a partir da foto de um cupom ou nota enviada no grupo do WhatsApp. A IA só **transcreve**; o lançamento só acontece quando o usuário confirma.

## Regras (vindas das decisões do projeto)
- IA só sob pedido explícito: só foto **com legenda `/nota`** dispara a leitura. Foto sem essa legenda é ignorada em silêncio.
- IA nunca calcula: ela copia o total impresso; o código valida o formato e monta o comando.
- Só modelo pago (`OPENROUTER_VISION_MODEL`, recusa `:free`), com `provider: { require_parameters: true, data_collection: 'deny' }`. Se nenhum provedor atender, a chamada falha; nunca relaxa em silêncio.
- A resposta é marcada como sugestão da IA.

## Fluxo
1. Foto + legenda `/nota [r|d] [categoria] [@conta]` → o bot baixa a imagem (JPEG/PNG/WebP, ≤ 5 MB, ≤ 20 por hora por conta) e chama a IA **fora da fila serial** da conta.
2. O bot responde com a prévia e, na última linha, o comando pronto, por exemplo `/d mercado 37,80 01/10/2026 @principal`.
3. Para confirmar, o usuário **responde à prévia com `/ok`**: o comando citado roda pelo caminho normal com `msgId` = id da prévia. Um `/ok` repetido cai no índice único `(conta_id, msg_id)`, então nunca há lançamento duplo. Para corrigir, o usuário copia a linha, ajusta e envia.

Sem tabela nova, sem estados, sem armazenar a imagem. Se o processo cair durante a leitura, a foto se perde e o usuário reenvia (limite aceito no piloto).

## O que a IA devolve (JSON Schema strict)
`legivel` (bool), `emitente`, `data_emissao` (`AAAA-MM-DD`), `total` (string `"37.80"`), `categoria` (sugestão). Tudo anulável, exceto `legivel`.

## Etapa 0 — piloto (antes de integrar ao WhatsApp)
Um script lê as fotos de `piloto/` (fora do git) e mostra, para cada uma, o total lido, a data, o tempo e o custo. Ele para em **US$ 1,00** ou em 30 fotos. Se o OpenRouter não informar o custo, o script para (não dá para garantir o teto). Recomendação manual: criar uma chave só para o piloto com limite de crédito de US$ 1 no OpenRouter.

## Fora do escopo (adiado)
Portal/upload, itens da nota, avisos de duplicidade (mesma nota em dias diferentes), PDF/XML, fallback de modelo, armazenamento e retenção da imagem.
