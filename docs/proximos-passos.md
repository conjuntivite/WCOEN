# Próximos passos (para tratar em 2026-09-27)

Estado em 2026-09-26: o WCOEN está completo e validado com o WhatsApp real (auditoria, desligamento, recuperação offline, reconexão e Mongo fora do ar). Estas são as ideias e pendências combinadas para o dia seguinte.

## Ideias

1. **Aviso "processando..."** enquanto a `auditoria` roda (a fila de mensagens é serial e a chamada à IA pode levar até ~45 s).
2. **Iniciar o bot junto com o Windows** (serviço ou tarefa agendada). Cuidado: sob reinício automático, o `exit(1)` do código 440 (sessão substituída) recria o ping-pong entre duas instâncias.
3. **Rodar o bot fora da sessão do Claude Code**, num terminal próprio ou como serviço.
4. **Testar as mensagens temporárias** no grupo (único item da validação manual que ficou de fora).
5. **Auditoria:** linhas longas (comparação com o período anterior) podem quebrar no celular; dar o mesmo tratamento do balancete, com um item por linha.
6. **Um único `git push`** para os dois remotos (GitHub e GitLab).

## Adiados nas revisões (baixo risco)

- A confirmação 🟢/🔴 pode se perder se a conexão cair entre gravar e enviar; reenviar no próximo `open`.
- `recuperada` depende do relógio do PC; melhor usar `type === 'append'`.
- `conectar()` que lança erro não reagenda a tentativa.
- `pino` em `silent` esconde erros do Baileys; `LOG_LEVEL` opcional.
- Rejeitar modelos `:free` em `OPENROUTER_MODEL`.
- `limparSugestoes`: `*Economize*` perde o asterisco inicial; o corte de 200 unidades UTF-16 pode partir um emoji.
- Faltam testes dos prazos da auditoria (30 s / 45 s) e do log do service quando o auditor falha.
- `MemoryRepo` não desempata contas de total igual como o Mongo (só afeta a ordem de exibição).
- O resumo consulta até 12 períodos em sequência (`Promise.all` resolveria); o extrato carrega o livro inteiro a cada página.
- O timer de reconexão não é cancelado em `desligar`; um segundo `Ctrl+C` durante o desligamento é ignorado.
- Lista de números autorizados no `.env`, caso entre outra pessoa no grupo.
- `45.900` é lido como R$ 45.900,00 (ambiguidade de milhar, regra do plano original).

## Limpeza e segurança

- A chave do OpenRouter foi colada numa conversa: considerar gerar outra e trocar no `.env`.
- A pasta local `auth.bak` (sessão antiga do WhatsApp, já inválida) pode ser apagada.
