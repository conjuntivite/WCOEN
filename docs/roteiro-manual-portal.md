# Roteiro manual do portal (WhatsApp real)

O WhatsApp real não é automatizável; rode este roteiro com um número de teste antes de liberar um piloto. **Pare o bot antigo antes** (dois processos no mesmo grupo respondem em dobro).

1. Suba o sistema (`docker compose up -d` ou `npm start`) e abra o portal.
2. **Cadastro:** cadastre-se com o `CONVITE`. Convite errado deve ser recusado.
3. **QR:** clique em *Conectar WhatsApp*; o QR aparece e se renova sozinho. No celular: *Aparelhos conectados → Conectar um aparelho* e escaneie. O painel deve passar para "Escolha o grupo" sem recarregar a página.
4. **Código de pareamento:** desconecte, conecte de novo, use *Estou no celular* com o número e digite o código no WhatsApp.
5. **QR expirado:** conecte e não escaneie por 2 minutos. Deve voltar a "Conecte seu WhatsApp" com o aviso.
6. **Grupo:** escolha um grupo. O grupo deve receber "✅ CONECTADO".
7. **Comandos:** `mercado 45,90`, `+ 70 plantão`, `balancete`, `extrato`, `desfazer`, `ajuda`. Confira o formato das mensagens.
8. **Isolamento:** cadastre uma segunda conta (outro número/grupo) e confirme que os balancetes não se misturam.
9. **Recuperação:** com a conta conectada, mate o servidor, mande um lançamento no grupo, suba de novo. O lançamento entra e chega o aviso "LANÇAMENTOS RECUPERADOS". Nenhuma mensagem "Bot online/desligando" deve aparecer.
10. **Sessão removida no celular:** remova o aparelho em *Aparelhos conectados*. O painel deve mostrar "sessão encerrada" e nada de reconexão em loop.
11. **Migração dos seus dados antigos:** `npm run migrar -- seu@email` e confira o extrato.
12. **Senha:** `npm run senha -- seu@email nova-senha-123` e entre com ela.
