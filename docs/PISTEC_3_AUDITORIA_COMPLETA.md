# PISTEC 3.0 — Auditoria completa (2026-10-26)

Branch `feat/pistec-3-backend`, commit base `635c87d`. Máquina: Windows 10, Node 22.17.1, npm 10.9.2, Supabase CLI 2.75.0, Chrome instalado. **Sem Docker e sem Deno global** (Deno 2.5.6 executado via `npx deno`).

Este documento substitui os relatórios separados pedidos (SECURITY_AUDIT, SUPABASE_VALIDATION, BILLING/RESEND/EVOLUTION/GEMINI/PUSH_VALIDATION, INTEGRATION_STATUS). Cada um é uma seção abaixo; arquivos separados repetiriam o mesmo conteúdo.

## Legenda

A — integração real validada · B — validada localmente (PGlite/mocks) · C — código presente, integração não validada · D — parcial ou defeituosa · E — não implementada · F — não verificável neste ambiente.

"Remoto (leitura)" = consulta somente leitura ao projeto Supabase autorizado (`scripts/sb.mjs`, API de gerenciamento). `remote-smoke.sql` roda numa transação com `rollback`; nenhum dado remoto foi alterado nesta auditoria.

## 1. Resultado dos testes (executados hoje)

| Suíte | Comando | Resultado |
|---|---|---|
| Typecheck | `npm run typecheck` | OK |
| Lint | `npm run lint` | OK |
| Unitários + SQL (PGlite) | `npm test` | **201/201** (antes: 199; +2 testes de regressão desta auditoria) |
| SQL/RLS sem a correção | `security.test.ts` sem `20261026000100` | 2 falhas esperadas, o que prova que os testes novos detectam os defeitos |
| E2E local (Chrome) | `playwright test` (todos exceto `real.e2e.ts`) | 1ª execução: 41 ok, 1 falha, 1 pulado → teste PWA corrigido → `pwa.e2e.ts` 3/3 |
| Deno (Edge Functions) | `npx deno@2.5.6 test supabase/functions/_shared/integrations.test.ts` | 3/3 |
| Deno type-check | `npx deno@2.5.6 check supabase/functions/*/index.ts` | OK (4 funções) |
| Build produção | `npm run build` | OK |
| Smoke remoto | `node scripts/sb.mjs --file supabase/tests/remote-smoke.sql` | PASS (rollback) |
| E2E real | `src/real/real.e2e.ts` | **NÃO EXECUTADO**: grava dados reais e exige túnel SOCKS `127.0.0.1:1080` ausente nesta máquina |

Total executado: 201 + 43 + 3 + 1 = 248 casos. Reprovados após correções: 0. Não executados: `real.e2e.ts`, testes em dispositivos físicos, Firefox/Safari/Edge.

## 2. Matriz de conformidade

| ID | Requisito | Arquivos | Função / endpoint | Estado | Teste | Evidência | Problema | Correção | Pendência | Dependência externa |
|---|---|---|---|---|---|---|---|---|---|---|
| R01 | Supabase Auth (cadastro, login, recuperação, convite, MFA, Super Admin) | `src/real/auth.ts`, `AuthPage.tsx`, `RealApp.tsx`, migr. 0200/0300 | `onboard_tenant`, `accept_invite`, `app.is_platform_admin` (aal2) | **B** | SQL + config remota | 26 testes backend; Auth remoto: confirmação de e-mail ligada, senha ≥ 12, MFA TOTP ligado, rotação de refresh token | SMTP padrão do Supabase: **2 e-mails/hora** → convites e recuperação travam com uso real | — | SMTP próprio (Resend) | Domínio verificado |
| R02 | PostgreSQL / schema | `supabase/migrations/*` | 38 tabelas, valores em centavos (`bigint`) | **A** | remoto (leitura) + PGlite | 10/10 migrations aplicadas, sem divergência (`migrate-backend.mjs`); banco vazio sobe só com as migrations (`smoke.test.ts`) | — | — | Aplicar `20261026000100` | Autorização |
| R03 | RLS multi-tenant | migr. 0200, 0600 | `can_read`, `can_branch`, `is_member` | **A** (empresa) / **B** (filial, papel) | smoke remoto + PGlite | 38/38 tabelas com `ENABLE`+`FORCE RLS`; 92 funções `SECURITY DEFINER`, todas com `search_path`; anon só executa `submit_lead`; nenhuma escrita direta para anon/authenticated | Notificações coletivas visíveis para qualquer papel | **Corrigido** (coluna `module` + policy) | Aplicar migration | — |
| R04 | Storage | — | — | **E** | remoto (leitura) | 0 buckets, nenhuma policy | Não implementado | — | Logos/anexos usam `branding` JSON | — |
| R05 | Edge Functions | `supabase/functions/*` | `billing-checkout`, `billing-webhook`, `assistant`, `worker` | **C** | Deno + leitura remota | 4 ativas (v2); `verify_jwt` ligado em checkout/assistant; webhook/worker com token próprio comparado em tempo constante | Checkout concorrente podia gerar 2 links | **Corrigido** (`.is('checkout_url', null)`) | Redeploy de `billing-checkout` | Autorização |
| R06 | Realtime | `src/real/Notifications.tsx`, migr. 0200 | publicação `supabase_realtime` | **C** | remoto (leitura) | Publica `notifications`, `whatsapp_messages`; cliente assina INSERT | Não testado ao vivo | — | Teste com 2 sessões | — |
| R07 | Jobs e automações | `worker/index.ts`, migr. 1000 | `claim_outbox`, `deliver_internal_event`, `run_billing_cycle` | **D** | PGlite + remoto | Lógica testada (claim exclusivo, dead-letter após 5) | **Nada agenda o worker nem o ciclo de cobrança**: `pg_cron` não instalado; **16 eventos `pending` desde 16/10** | — | Habilitar `pg_cron`+`pg_net` e agendar | Autorização |
| R08 | Isolamento de filial | migr. 0300/0600 | `branch_ok`, `can_branch` | **B** | PGlite | Testes "membro restrito a uma filial", "RLS bloqueia filial não autorizada" | — | — | — | — |
| R09 | ERP transacional (venda, cancelamento, caixa, compra, OS, baixas) | migr. 0400 | `complete_sale`, `cancel_sale`, `settle_entry`, `receive_purchase`, `convert_record` | **B** | PGlite | Idempotência por `request_id`+hash; preço vem do servidor; sem efeito parcial | — | — | — | — |
| R10 | Concorrência | migr. 0400 | `for update`, advisory locks | **F** | — | PGlite é conexão única: testes repetem chamadas, não as rodam em paralelo | Corrida real não exercitada | — | Teste com 2 conexões em Postgres local (Docker) ou homologação | Docker |
| R11 | InfinitePay (assinaturas SaaS) | `_shared/infinitepay.ts`, `billing-*`, migr. 0500/0800 | `/links`, `/payment_check`, `svc_confirm_payment` | **C** | Deno + PGlite | Pagamento só confirma via `payment_check` no servidor; valor exato; webhook duplicado ignorado; SaaS separado das vendas | (1) Pagamento em fatura cancelada era descartado sem registro; (2) segundo pagamento de fatura paga não gerava alerta | **Corrigidos**: transação registrada + evento `billing.review` ao Super Admin | Nenhum pagamento real feito; recorrência automática **não existe** no código (renovação = fatura nova pelo `run_billing_cycle`, que não está agendado) | Pagamento autorizado de R$ 1,00 |
| R12 | Resend | só `scripts/providers-check.mjs` | — | **E** | — | Tabela `email_messages` existe; nenhum código envia | Não implementado | — | Função de envio + webhook | Domínio verificado |
| R13 | Evolution API | migr. 0500 | `app.svc_whatsapp_inbound` | **D** | PGlite | Dedup por `(instance_id, external_id)`, isolado por tenant | Sem Edge Function de webhook/envio, sem QR/instância, tela WhatsApp real mostra "pendente" | — | Implementar contra a versão instalada (doc. antiga cita 2.3.7) | Instância conectada + número de teste |
| R14 | Gemini — assistente interno | `assistant/index.ts`, `_shared/ai-tools.ts`, migr. 0900 | 6 ferramentas somente leitura | **C** | Deno + PGlite | Modelo não escolhe tenant/filial; ferramenta revalida papel e plano; cota atômica; máx. 3 turnos / 10 chamadas | Não reexecutado (custo) | — | Painel de consumo (RPC `ai_usage_summary` sem tela) | Chave Gemini |
| R15 | Gemini — bot WhatsApp | — | — | **E** | — | `whatsapp_bot` em `ai_settings` sem consumidor | — | — | Depende de R13 | — |
| R16 | Web Push | migr. 0500 | `save_push_subscription` | **E** (envio) | PGlite | Tabela + RPC; sem VAPID, sem `push` no `sw.js`, sem tela de inscrição, sem remetente | Não implementado | — | Ver §6 | Chaves VAPID |
| R17 | Central de notificações | `src/real/Notifications.tsx` | `notifications`, `mark_notifications_read` | **D** | PGlite | Só in-app; dedup por `source_event_id` | Vazia em produção (R07); sem preferências na UI (RPC existe) | Filtro por papel corrigido | Canais push/e-mail/WhatsApp | — |
| R18 | Central de automações | migr. 0400 | `simulate_automation` | **D** | — | Só simulação; sem tela de regras | — | — | — | — |
| R19 | Configurações por empresa | `src/real/Settings.tsx` | `update_tenant_profile`, `update_branding` | **B** | PGlite + E2E demo | — | Painel "Integrações" é texto fixo | — | Status real das integrações | — |
| R20 | Planos e permissões | migr. 0200 | `app.require`, `role_can` | **B** | PGlite | Paridade SQL × `can()` do frontend testada; limite de plano no banco | — | — | — | — |
| R21 | Logs e auditoria | migr. 0200 | `app.audit`, `audit_logs` | **B** | PGlite | Correlation id gravado; logs de Edge sem segredo | — | — | — | — |
| R22 | Super Admin | `src/real/Admin.tsx` | `admin_*` (exigem aal2) | **B** | PGlite | Empresas, cupons, cancelar fatura, comunicado | Sem painel de integrações, consumo IA, logs, upgrade/downgrade dedicado | — | — | — |
| R23 | PWA | `public/sw.js`, `src/pwa.ts` | — | **B** | E2E Chrome | Manifest, SW único, offline, atualização A→B sem recarregar sozinho | Teste offline intermitente (corrida do evento `online`, não do produto) | **Corrigido** no teste | Instalação real, iOS, Lighthouse | Dispositivos |
| R24 | Tour e Central de Ajuda | `src/app/tours.ts`, `features/settings/help.ts` | — | **B** (demo) | Vitest + E2E | 15 testes de ajuda | No ambiente real a ajuda esconde artigos de WhatsApp, assinatura, PWA | — | Artigos do ambiente real | — |
| R25 | Testes automatizados | `src/**`, `supabase/tests/**` | — | **B** | — | §1 | — | +2 testes | Concorrência, Edge Functions com HTTP | Docker |
| R26 | Preparação para produção | — | — | **D** | — | Build OK; sem segredo no bundle | R07, R12, R13, R16 | — | §8 | — |

## 3. Segurança

**Corrigido nesta auditoria (migration `20261026000100_audit_fixes.sql`, ainda não aplicada no remoto):**

1. **Vazamento por papel em notificações (médio).** Notificações coletivas (`user_id null`) eram lidas por qualquer membro: um Mecânico via diferenças de caixa, faturas da assinatura e vendas. Agora cada notificação guarda `module` e a policy exige `app.can_read`. Teste: `security.test.ts` › "notificação coletiva respeita o papel".
2. **Dinheiro recebido descartado (médio, financeiro).** Pagamento confirmado em fatura cancelada retornava `cancelled_invoice` sem gravar a transação. Agora grava, audita e emite `billing.review`. O segundo pagamento de fatura já paga também alerta. Teste: "pagamento em fatura cancelada ou repetido".
3. **Checkout duplicado (baixo).** Duas chamadas simultâneas a `billing-checkout` podiam gerar dois links válidos para a mesma fatura. Agora só o primeiro é persistido e devolvido.

**Verificado sem problema:** nenhum segredo no Git, no histórico (`git log --all -p`) nem no bundle `dist/` (a única ocorrência de `sb_secret_` é o detector de prefixo da biblioteca `supabase-js`). `.env.local`, `.vercel`, `supabase/.temp` estão ignorados. Variáveis `VITE_*` só têm URL e chave publicável. Toda escrita passa por RPC com `app.require` (membership, papel, plano, assinatura). Super Admin exige linha em `platform_admins` **e** sessão `aal2`; usuário não altera o próprio papel (`set_member` bloqueia). O IA não recebe tenant/filial do modelo e usa o JWT do usuário.

**Riscos abertos:**

| Risco | Severidade | Recomendação |
|---|---|---|
| `.env.local` guarda `SUPABASE_ACCESS_TOKEN` (acesso total à conta) e chaves de provedores; `docs/BACKEND_STATUS.md` relata chaves coladas em chat | Alta | Rotacionar todas; usar token de escopo mínimo; não copiar `.env.local` entre máquinas por canal inseguro |
| Token do webhook na query string (pode aparecer em logs de proxy) | Baixa | Mitigado: pagamento sempre reconfirmado por `payment_check` |
| `zod@3` (dependência de produção) — GHSA de exaustão de memória em coleções grandes | Baixa (usado só no navegador sobre respostas do próprio servidor) | Migrar para `zod@4` (major) |
| `vitest@3` — 2 críticas + 1 moderada | Só dev | `vitest@5` |
| SMTP padrão (2 e-mails/h) | Operacional | SMTP próprio |

## 4. Supabase

Remoto (leitura): 10 migrations aplicadas e idênticas aos arquivos; 38/38 tabelas com RLS forçado; extensões `pgcrypto`, `supabase_vault`, `uuid-ossp`; `pg_cron` e `pg_net` **disponíveis, não instalados**; 0 empresas, 1 Super Admin; secrets configurados por nome: `AI_ENABLED, APP_ORIGINS, APP_URL, BILLING_ENABLED, BILLING_WEBHOOK_TOKEN, EVOLUTION_API_KEY, EVOLUTION_API_URL, GEMINI_API_KEY, INFINITEPAY_HANDLE, RESEND_API_KEY, WORKER_TOKEN` (+ padrão Supabase). Nenhum VAPID.

Local: sem Docker → `supabase start` indisponível. Os testes SQL usam PGlite (Postgres real em processo) com stub mínimo de `auth`. Limites: sem concorrência real, sem Realtime, sem Storage, sem GoTrue.

## 5. Cobrança (InfinitePay)

Fluxo implementado: `request_subscription_invoice` (fatura idempotente + cupom com lock) → `billing-checkout` (`POST /links`, `order_nsu = id da fatura`, URL validada em `*.infinitepay.io`) → webhook com token → `POST /payment_check` → `svc_confirm_payment` (valor exato, `paid_amount ≥ amount`, `transaction_nsu` único) → assinatura ativa por 30/90/365 dias.

Cenários cobertos por teste: retorno do navegador não ativa (rota `/pagamento` só informa); webhook duplicado (`duplicate`); valor divergente (`amount_mismatch`); transação reutilizada (`unique(provider, transaction_nsu)`); fatura cancelada e pagamento repetido (novos). Não cobertos: erro/timeout do provedor no webhook (o código retorna 5xx e mantém o evento `received` para reprocessar, mas não há teste HTTP), evento fora de ordem.

Não há API de recorrência no código; a estratégia é fatura de renovação 5 dias antes do vencimento + suspensão após 5 dias de carência, **dependente do agendamento de `run_billing_cycle`** (R07). A documentação oficial da InfinitePay não pôde ser consultada nesta sessão (página antiga 404; busca indisponível); validar endpoints e campos de `payment_check` antes do piloto.

## 6. Resend, Evolution, Gemini, Web Push

- **Resend — E.** Nenhum envio. Para implementar: Edge Function consumindo `email_messages` (status/tentativas/`idempotency_key` já modelados), webhook de entrega, SMTP do Auth apontando para Resend.
- **Evolution — D.** Ingestão SQL deduplicada e isolada. Faltam: Edge Function de webhook (`messages.upsert`, `connection.update`) com segredo, envio, criação de instância/QR, tela de atendimento, transferência. Anti-loop: `outbox_events.depth ≤ 3` existe; mensagens `from_me` não disparam evento.
- **Gemini — C (interno) / E (WhatsApp).** Testes de segurança cobertos por unidade: argumentos extras rejeitados, ferramenta desconhecida rejeitada, cota esgotada. Prompt injection, custo por tenant e "sem fonte confiável → humano" dependem de execução real, não feita.
- **Web Push — E.** Para implementar: par VAPID (`supabase secrets set`), `push`/`notificationclick` no `sw.js` existente (não criar segundo SW), inscrição em Configurações → Notificações chamando `save_push_subscription`, remetente no worker com limpeza de endpoint 404/410 (`expired_at`, `failures` já existem). iOS só com PWA instalado (16.4+). Corpo genérico na tela bloqueada.

## 7. PWA, usabilidade, tour

PWA: SW único com precache por versão, navegação offline pelo shell, atualização só por consentimento com proteção de formulário/carrinho (`useBusyGuard`), dados de negócio só no IndexedDB (demo). Ambiente real não grava offline (correto: sem estratégia de sincronização). Não testado: instalação real, iOS/Android físicos, Edge/Firefox/Safari, Lighthouse.

Usabilidade (ambiente real, inspeção de código): módulos não migrados exibem "Módulo em integração… Nenhuma operação foi simulada" (honesto, mas sem caminho alternativo); Super Admin é uma página única longa; UUIDs de fatura e de usuário aparecem crus em tabelas (Funcionários mostra `user_id` em vez de nome/e-mail). Nenhuma sessão com usuários reais foi feita; o roteiro está em `docs/UX_AUDIT.md`.

## 8. Prontidão

| Nível | Situação |
|---|---|
| Demonstração | **Pronto** (`/demonstracao`, isolada, 0 requisições externas) |
| Homologação do núcleo ERP real | **Pronto** após aplicar `20261026000100` |
| Piloto controlado | **Não**: worker e ciclo de cobrança sem agendamento; SMTP limitado a 2/h |
| Produção | **Não**: R07, R12, R13, R16 abertos; rotação de chaves não confirmada |

## 9. Próximas ações (ordem)

1. Aplicar `20261026000100_audit_fixes.sql` (`node --env-file=.env.local scripts/migrate-backend.mjs --project <ref> --apply`) e redeploy de `billing-checkout`. **Requer autorização.**
2. Agendar worker (1 min) e `run_billing_cycle` (diário): `create extension pg_cron; create extension pg_net;` + `cron.schedule` chamando `/functions/v1/worker` com `WORKER_TOKEN` lido do Vault (não colar o token no SQL versionado). Processa os 16 eventos parados.
3. Rotacionar chaves; trocar `SUPABASE_ACCESS_TOKEN` por token de escopo mínimo.
4. SMTP próprio + envio Resend.
5. Web Push (seção 6).
6. Evolution: webhook + envio + tela.
7. Teste de concorrência real (Docker ou homologação) para venda/estoque.
8. `zod@4`, `vitest@5`, Supabase CLI atual.
