# PISTEC — Go/No-Go (29/10/2026)

| Área | Decisão | Motivo |
|---|---|---|
| Publicar código + migrations | **GO técnico** (aguarda sua autorização) | Testes verdes, ensaio no banco real ok, rollback testado |
| Teste de 1 mês | GO | Não altera a empresa existente (Ativa, vence 24/11) |
| PISTEC NEXT (12) | GO como recurso novo | Testado local; homologação real começa após publicar |
| WhatsApp/bot | **NO-GO para clientes** até pareamento | Sem prova bidirecional |
| E-mail rastreado | **NO-GO para "entrega confirmada"** | Falta webhook Resend |
| Cobrança | **NO-GO para homologação financeira** | Sem pagamento confirmado |
| Push multi-dispositivo | NO-GO para declarar compatibilidade | Só 1 dispositivo |

## Bloqueios críticos e quem resolve
1. **Autorização de publicação** — você.
2. **Pareamento WhatsApp** — você, com o celular de teste, em `/app/loja/teste/whatsapp` (após publicar).
3. **Webhook Resend** — você no painel: endpoint `https://xbnnbwsfdkjsbohomezx.supabase.co/functions/v1/email-webhook`, eventos `email.sent`, `email.delivered`, `email.delivery_delayed`, `email.bounced`, `email.complained`, `email.failed`; me envie o *signing secret* (`whsec_…`).
4. **IA da empresa de teste** — Super Admin → empresa → liberar IA (o bot exige isso além do interruptor da loja).
5. **InfinitePay** — valor e conta para uma cobrança controlada, se quiser homologar.
6. **Autentique** — nome e e-mail do signatário da contratada.
