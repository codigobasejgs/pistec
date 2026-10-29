# Supabase — auditoria de secrets e funções (29/10/2026)

## Secrets (somente nomes)
Presentes: `AI_ENABLED`, `APP_ORIGINS`, `APP_URL`, `AUTENTIQUE_API_TOKEN`, `AUTENTIQUE_SANDBOX`, `AUTENTIQUE_WEBHOOK_SECRET`, `BILLING_ENABLED`, `BILLING_WEBHOOK_TOKEN`, `EMAIL_FROM`, `EVOLUTION_API_KEY`, `EVOLUTION_API_URL`, `GEMINI_API_KEY`, `INFINITEPAY_HANDLE`, `RESEND_API_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT`, `WORKER_TOKEN` (+ automáticas `SUPABASE_*`).

Ausente e usado pelo código: **`RESEND_WEBHOOK_SECRET`** (webhook de entrega).

Flags: `AI_ENABLED=true`, `BILLING_ENABLED=true`, `AUTENTIQUE_SANDBOX=true` (verificado por digest, sem ler valores).

## Edge Functions publicadas
| Função | Versão | verify_jwt | Observação |
|---|---|---|---|
| worker | 13 | false | Valida `WORKER_TOKEN`; cron 200 desde 17:54 UTC |
| whatsapp | 6 | true | |
| whatsapp-webhook | 5 | false | Token por instância |
| email-webhook | 5 | false | Assinatura Svix (precisa do secret) |
| billing-checkout | 10 | true | |
| billing-webhook | 10 | false | Token |
| assistant | 9 | true | |
| admin-health | 7 | true | |
| contract-sign | 5 | true | |
| contract-webhook | 5 | false | HMAC |
| mechanic | — | — | **Não publicada** |
