# Evolution API — validação de produção (29/10/2026)

| Item | Resultado |
|---|---|
| Servidor | `api.tubaraoemprestimo.com.br`, HTTPS, `GET /` 200, versão 2.3.7, WhatsApp Web 2.3000.1052252157 |
| Autenticação | Chave correta 200; chave inválida 401 |
| Instâncias | 5 no servidor; 1 do PISTEC (`pistec-33a28504-4787581c`, `connecting`, 0 mensagens). As 4 de outros projetos não são tocadas |
| Simulação | O ambiente real chama a Evolution de verdade. A tela "simulada" é a da demonstração (`/loja/*`), identificada como tal |

## Implementado nesta etapa (local)
- Eventos assinados: `MESSAGES_UPSERT`, `MESSAGES_UPDATE`, `CONNECTION_UPDATE`, `QRCODE_UPDATED`; instâncias existentes atualizadas ao conectar.
- Status de entrega (`ERROR/PENDING/SERVER_ACK/DELIVERY_ACK/READ/PLAYED`) gravado só em avanço.
- `@lid`: usa `remoteJidAlt` quando presente.
- Bot Gemini no worker: uma resposta por mensagem, pausa quando atendente assume, quota por empresa, falha registrada.
- Origem do webhook: token por instância (hash no banco) na URL; nome da instância vem da URL, nunca do corpo; deduplicação por (instância, id).
- Envio manual só para conversas iniciadas pelo cliente (sem disparo em massa).

## Prova bidirecional — NÃO executada
Exige parear um número de teste seu. Roteiro após publicar:
1. `/app/loja/teste/whatsapp` → Conectar → ler QR.
2. Do celular de teste, enviar "oi" ao número pareado.
3. Conferir conversa no PISTEC e `whatsapp_messages` (direção `in`).
4. Responder pelo PISTEC; conferir `out` → `delivered`/`read`.
5. Ligar o assistente automático e repetir; conferir `whatsapp_bot_replies` = `sent` e `ai_usage`.
