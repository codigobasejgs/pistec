# PISTEC 3.1 — Relatório de implementação (2026-10-26)

Ponto de partida: `docs/PISTEC_3_AUDITORIA_COMPLETA.md` (mesma data). O prompt 3.1 citava um diagnóstico antigo ("sem Supabase, sem RLS, 156 testes"); o repositório já tinha backend com 38 tabelas, RLS e 201 testes. Esta entrega **completa** o que faltava sobre essa base, sem refazer.

Documento único em vez dos 13 pedidos: cada integração é uma seção abaixo. `PROJECT_HANDOFF.md` e `KNOWN_ISSUES.md` foram atualizados.

## 1. O que foi aplicado no Supabase remoto (autorizado: "aplicar próximos passos")

| Ação | Evidência |
|---|---|
| Migrations `20261026000100` (correções da auditoria), `…0200` (agendamentos), `…0300` (entrega multicanal) | `migrate-backend.mjs`: 13/13 aplicadas, sem divergência |
| `pg_cron` + `pg_net`; jobs `pistec-worker` (1 min), `pistec-billing-cycle` (03:15 UTC), `pistec-cron-cleanup` | `cron.job` lista os 3 ativos |
| `WORKER_TOKEN` **rotacionado** (novo, aleatório) no secret das Edge Functions e no Vault | Valor nunca exibido |
| Redeploy `billing-checkout` (v5) e `billing-webhook` (v5) | API de gerenciamento |
| Fila parada processada | worker HTTP 200 `{"processed":16,"failed":0}`; outbox 16/16 `done` |
| Pós-migração | smoke remoto PASS; 40/40 tabelas com RLS forçado; anon só `submit_lead`; 0 `SECURITY DEFINER` sem `search_path` |

**Não publicado (exige autorização explícita):** funções novas (`whatsapp`, `whatsapp-webhook`, `email-webhook`, `admin-health`), nova versão do `worker` (envio push/e-mail), `assistant` inalterado, secrets VAPID/`EMAIL_FROM`/`RESEND_WEBHOOK_SECRET`, deploy Vercel. O worker remoto atual é a versão anterior: processa outbox, **não** envia push nem e-mail.

## 2. Matriz de conclusão

| Módulo | Estado | Arquivos | Testes |
|---|---|---|---|
| Auth, RLS, Super Admin (aal2) | IMPLEMENTADO E VALIDADO COM SERVIÇO REAL | migr. 0200/0600, `src/real/*` | smoke remoto + 43 SQL |
| ERP transacional | IMPLEMENTADO E VALIDADO EM AMBIENTE LOCAL | migr. 0400 | 26 backend (PGlite) |
| Concorrência real (2 conexões) | BLOQUEADO POR INFRAESTRUTURA | — | sem Docker; PGlite é conexão única |
| Automações (outbox + cron) | IMPLEMENTADO E VALIDADO COM SERVIÇO REAL | migr. 0200, `worker/` | 16 eventos processados no remoto |
| Web Push — banco (fila, preferências, permissões, backoff, expiração, TTL, limite) | IMPLEMENTADO E VALIDADO EM AMBIENTE LOCAL | migr. 0300 | `delivery.test.ts` (4 testes de push) |
| Web Push — criptografia/VAPID | IMPLEMENTADO E TESTADO COM MOCK | `_shared/webpush.ts` | Deno: decifrado por implementação independente do lado UA (RFC 8291), JWT verificado |
| Web Push — service worker | IMPLEMENTADO E VALIDADO EM AMBIENTE LOCAL | `public/sw.js` | E2E: `PushEvent` real exibe notificação; URL externa vira `/app` |
| Web Push — entrega real (FCM) | BLOQUEADO POR INFRAESTRUTURA | `scripts/push-check.mjs` | rede desta máquina não alcança `fcm.googleapis.com`/`mtalk.google.com` (timeout); script pronto |
| Web Push — tela | IMPLEMENTADO MAS NÃO VALIDADO | `src/real/Notifications.tsx`, `push.ts` | typecheck/lint; sem E2E real (exige login) |
| Resend — fila, templates, retentativa, supressão, webhook Svix | IMPLEMENTADO E TESTADO COM MOCK | migr. 0300, `_shared/email.ts`, `email-webhook/`, `worker/` | 3 Deno + 2 SQL |
| Resend — envio real | BLOQUEADO POR CREDENCIAIS | — | chave atual é "sending only" e sem domínio verificado (`GET /domains` 401) |
| Evolution — webhook, envio, QR, estado, logout, contatos, atribuição, pausa do bot | IMPLEMENTADO E TESTADO COM MOCK | migr. 0300, `_shared/evolution.ts`, `whatsapp/`, `whatsapp-webhook/`, `src/real/WhatsApp.tsx` | 2 Deno + 1 SQL |
| Evolution — real | IMPLEMENTADO MAS NÃO VALIDADO | — | servidor 2.3.7 respondeu (`GET /` 200, 4 instâncias de outros sistemas); nenhuma instância PISTEC criada, nenhuma mensagem enviada |
| Bot WhatsApp com Gemini | NÃO IMPLEMENTADO | — | `whatsapp.inbound` carrega `bot`; falta o consumidor |
| Gemini assistente interno | IMPLEMENTADO MAS NÃO VALIDADO (hoje) | `assistant/` | 3 Deno |
| InfinitePay | IMPLEMENTADO E TESTADO COM MOCK; checkout real gerado em 16/10 | `billing-*` | Deno + SQL |
| Super Admin — integrações | IMPLEMENTADO MAS NÃO VALIDADO | `admin-health/`, `src/real/Integrations.tsx`, `admin_integration_summary` | 1 SQL (permissão) |
| Storage | NÃO IMPLEMENTADO | — | nenhum fluxo usa arquivos ainda |
| Dependências | IMPLEMENTADO E VALIDADO EM AMBIENTE LOCAL | `package.json` | `npm audit`: 0 vulnerabilidades |

## 3. Web Push

Fluxo: evento → `deliver_internal_event` → `notifications` (com `module`) → trigger `enqueue_push` → `notification_deliveries` (uma por dispositivo) → worker `claim_push` → `sendPush` → `finish_push`.

- **Destinatários:** membros ativos com permissão de leitura do módulo do evento (`app.member_can_read`: papel + filial + plano); notificação pessoal só para o usuário; Super Admin só para notificações de plataforma.
- **Preferências:** `notification_preferences.push` e `muted_types` por usuário/empresa.
- **Entrega:** 2xx `sent`; 404/410 `expired` + inscrição marcada; 429/5xx/rede → backoff 2^n min, até 5 tentativas → `dead`; lease de 5 min; TTL 24 h; limite 30 por usuário/10 min; teste autorizado 5/10 min.
- **Conteúdo:** título do tipo de evento + "Abra o PISTEC para ver os detalhes." Nada de nome de cliente/valor na tela bloqueada.
- **Clique:** só rotas `/app/*`; qualquer outra vira `/app`.
- **Biblioteca:** nenhuma. `web-push` (npm) depende de módulos Node; a implementação usa só WebCrypto (Deno/Node/navegador), ~70 linhas.
- **iOS/iPadOS:** a tela explica que é preciso instalar na Tela de Início (16.4+). Não testado em aparelho.
- **Chave VAPID:** par gerado e gravado só em `.env.local` (ignorado). Para ativar: `supabase secrets set VAPID_PUBLIC_KEY=… VAPID_PRIVATE_KEY=… VAPID_SUBJECT=…`, `VITE_VAPID_PUBLIC_KEY` na Vercel, deploy do worker.

## 4. Resend

Eventos enfileiram e-mail na mesma transação (`app.queue_email`, idempotente por chave): boas-vindas, convite (token sai do outbox e vai só para o e-mail), fatura criada, pagamento confirmado, fatura vencida, fim do teste, suspensão. Templates em HTML com tabelas e estilo inline, dados escapados, links só para `APP_URL`.

Sem `EMAIL_FROM` o worker não envia e os e-mails **ficam na fila** (não se perdem). Erros 4xx (exceto 408/429) são permanentes; o resto vai para retentativa. Bounce/complaint (webhook Svix verificado) suprime o endereço. Limite de 50 por empresa/hora.

Não implementado: templates por loja (orçamento, OS, veículo pronto) e envio de e-mail pelo lojista; e-mail do Auth continua no SMTP padrão até configurar SMTP com domínio verificado.

## 5. Evolution API (2.3.7)

- Instância por empresa criada pela função `whatsapp` (limite do plano), webhook com token aleatório por instância (só o hash fica no banco), eventos `MESSAGES_UPSERT` e `CONNECTION_UPDATE`.
- O nome da instância vem da URL configurada pelo PISTEC, nunca do corpo do evento. Grupos e broadcast são ignorados.
- Dedup `(instância, id externo)`; contato por conversa; atribuição a atendente com permissão (notifica só ele); "assumir" pausa o bot naquela conversa.
- Envio só para conversas iniciadas pelo cliente (sem disparo para números arbitrários). Mensagens enviadas pelo bot/loja (`fromMe`) não geram evento → sem loop.

## 6. InfinitePay

Documentação oficial consultada hoje (`/checkout-documentacao`): `POST /links` (centavos), `POST /payment_check` (`success, paid, amount, paid_amount, installments, capture_method`), webhook **sem assinatura**, reenvio **somente quando a resposta é 400**. Não há API de recorrência documentada no checkout → renovação por fatura nova (`run_billing_cycle`, agora agendado).

Ajustes: o webhook converte qualquer falha recuperável em 400 (antes 503/409 não seriam reenviados); `cancelled_invoice` é aceito (pagamento registrado e Super Admin alertado). Moeda/conta: `payment_check` usa o `handle` do PISTEC e o `order_nsu` (id da fatura); a API não retorna moeda (BRL implícito).

## 7. Testes executados nesta entrega

| Suíte | Resultado |
|---|---|
| `npm test` (unitários + SQL PGlite) | 209/209 (eram 201; +8 de entrega) |
| Deno (`supabase/functions/_shared/*.test.ts`) | 11/11 |
| Deno type-check, 8 Edge Functions | OK |
| `pwa.e2e.ts` | 4/4 (inclui push no service worker) |
| typecheck, lint, build | OK |
| `npm audit` | 0 vulnerabilidades (`vitest` 3→5, `zod` 3→4) |
| Smoke remoto pós-migração | PASS |
| E2E demais suítes | **não reexecutadas após esta entrega** (última: 42/43 hoje cedo, falha corrigida) |
| Push real FCM | **não concluído**: rede bloqueia o push service |

## 8. Próximos passos que precisam da sua autorização

1. Deploy das funções novas e do worker: `supabase functions deploy worker whatsapp email-webhook admin-health` e `whatsapp-webhook` com `--no-verify-jwt`.
2. Secrets VAPID e `VITE_VAPID_PUBLIC_KEY` na Vercel + deploy do frontend.
3. Domínio verificado no Resend → `EMAIL_FROM`, webhook → `RESEND_WEBHOOK_SECRET`, SMTP do Auth.
4. Instância WhatsApp de teste com um número autorizado.
5. Rodar `node scripts/push-check.mjs` numa rede que alcance `fcm.googleapis.com`.
6. Rotacionar as chaves restantes (Supabase access token, Gemini, Evolution, Resend).
