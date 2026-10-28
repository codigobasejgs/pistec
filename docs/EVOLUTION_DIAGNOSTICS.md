# Evolution API — diagnóstico real (28/10/2026)

Verificação somente leitura (nenhuma instância criada, nenhuma mensagem enviada, nada apagado). Chave nunca impressa.

## Servidor

| Item | Resultado |
|---|---|
| Host | `api.tubaraoemprestimo.com.br` (HTTPS) |
| `GET /` | 200 · `version: 2.3.7` · `clientName: evolution_exchange` · WhatsApp Web `2.3000.1052053390` |
| Autenticação | chave do servidor aceita (`/instance/fetchInstances` 200); chave inválida → 401 |
| Licenciamento | nenhuma resposta `LICENSE_REQUIRED` |
| Instâncias no servidor | 5 — **1 do PISTEC**; 4 de outros projetos (`Tubarao`, `codigobase`, `pp-…`, `locakar`). As de outros projetos **não são tocadas** pelo PISTEC |
| Secrets no Supabase | `EVOLUTION_API_URL`, `EVOLUTION_API_KEY` configurados |

## Instância do PISTEC

| Item | Resultado |
|---|---|
| Nome | `pistec-33a28504-4787581c` (empresa "Teste", slug `teste`) |
| Estado na Evolution | `close` (nunca pareada; 0 mensagens) |
| Estado no Supabase | `connecting` (desatualizado: o PISTEC não recebeu o evento de fechamento) |
| Webhook configurado | `…/functions/v1/whatsapp-webhook?i=<instância>&t=***` · eventos `MESSAGES_UPSERT`, `CONNECTION_UPDATE` · habilitado |

## Conclusão (causa do "simulado")

1. **O ambiente real já usa a Evolution de verdade** (`supabase/functions/whatsapp`, `whatsapp-webhook`, `_shared/evolution.ts`): criação de instância, QR, estado, envio e recebimento chamam a API real. Não há mock nesse caminho.
2. **A tela simulada vista é a da demonstração** (`src/features/erp/WhatsApp.tsx`, rota `/loja/...` do demo com IndexedDB): instância "Atendimento principal (simulado)" vem de `src/seed.ts`. Ela é declaradamente demonstrativa e não roda no ambiente real.
3. **Lacunas reais do ambiente real** (a corrigir na 8.0): status do banco desatualizado (só consulta sob demanda), QR sem atualização automática, eventos de entrega (`MESSAGES_UPDATE`) e QR (`QRCODE_UPDATED`) não assinados, `@lid` ignorado (mensagens descartadas), só texto, sem central em 3 colunas, sem diagnóstico por instância no Super Admin, e o evento `whatsapp.inbound` ainda bloqueado no processador de saída (`Handler externo ainda não habilitado`) — ou seja, chatbot Gemini e push de nova mensagem não disparam.

## Formatos confirmados no código-fonte da 2.3.7

- `MESSAGES_UPDATE`: `{ keyId, remoteJid, fromMe, status }` com `status` ∈ `ERROR | PENDING | SERVER_ACK | DELIVERY_ACK | READ | PLAYED`.
- `MESSAGES_UPSERT`: quando `remoteJid` é `@lid` e há `remoteJidAlt`, a própria Evolution troca para o JID do número; sem `remoteJidAlt` o `@lid` precisa ser preservado (não convertido).
- `QRCODE_UPDATED`: `{ qrcode: { base64, code, pairingCode } }`.
- Webhook sem assinatura de payload; suporta cabeçalhos fixos e `jwt_key` (JWT HS256, 10 min) por instância.
- Envio: `POST /message/sendText/{inst}` `{ number, text }`; `POST /message/sendMedia/{inst}` `{ number, mediatype, mimetype, caption, fileName, media }`.
