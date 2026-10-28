# Integração com o provedor de assinatura

## Escolha: Autentique

Avaliados Autentique e Clicksign. Autentique escolhido: API GraphQL pública e documentada, modo `sandbox` gratuito, webhook com HMAC-SHA256, PDF assinado com página de certificado, operação no Brasil (MP 2.200-2/2001, Lei 14.063/2020 — assinatura eletrônica avançada/simples conforme método de autenticação).

## Configuração (secrets das Edge Functions)

| Secret | Uso |
|---|---|
| `AUTENTIQUE_API_TOKEN` | Bearer da API `https://api.autentique.com.br/v2/graphql` |
| `AUTENTIQUE_WEBHOOK_SECRET` | segredo HMAC do webhook; sem ele `contract-webhook` responde 503 |
| `AUTENTIQUE_SANDBOX` | `true` = todos os documentos em sandbox; contrato real é **recusado** enquanto estiver `true` |

Webhook no painel Autentique: `https://<projeto>.supabase.co/functions/v1/contract-webhook` (deploy com `--no-verify-jwt`; autenticação pela assinatura `x-autentique-signature`).

## Operações usadas

`createDocument` (multipart), `document(id)` (assinaturas e arquivos), `resendSignatures`, `updateDocument(deadline_at)` para bloquear ao cancelar. Limite do provedor: 60 req/min — o worker reconcilia no máximo 10 por execução.

## Status

- Implementado e testado com mock (testes SQL simulam eventos fora de ordem, duplicados, recusa, expiração).
- **Pendente de credenciais**: nenhum token configurado; nada foi enviado ao Autentique (nem sandbox).
