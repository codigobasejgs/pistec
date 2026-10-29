# PISTEC — Prontidão para produção (29/10/2026)

Fonte: código atual + consultas somente leitura ao Supabase, Vercel, Evolution, Resend e Cloudflare. Nada foi publicado nesta etapa.

## Onde cada integração executa

| Integração | Runtime real | Variáveis (nomes do código) | Onde ficam | Situação |
|---|---|---|---|---|
| Supabase (frontend) | Navegador `/app` (RLS) | `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` (`sb_publishable_…`) | Vercel (Production) | Presentes |
| Supabase (servidor) | Edge Functions | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Automáticas do Supabase | Presentes |
| Resend | Edge Function `worker` (fila `email_messages`), `email-webhook` | `RESEND_API_KEY`, `EMAIL_FROM`, `APP_URL`, `RESEND_WEBHOOK_SECRET` | Supabase secrets | **`RESEND_WEBHOOK_SECRET` ausente** |
| Supabase Auth SMTP | Supabase Auth | SMTP Resend (configurado no painel/API) | Supabase Auth | Configurado; recuperação de senha testada em 29/10 |
| Evolution | `whatsapp`, `whatsapp-webhook`, `worker` (bot) | `EVOLUTION_API_URL`, `EVOLUTION_API_KEY` | Supabase secrets | Presentes; instância PISTEC não pareada |
| Gemini | `assistant`, `mechanic`, `worker` (bot) | `GEMINI_API_KEY`, `AI_ENABLED=true` | Supabase secrets | Presentes |
| InfinitePay | `billing-checkout`, `billing-webhook`, ciclo diário | `INFINITEPAY_HANDLE`, `BILLING_WEBHOOK_TOKEN`, `BILLING_ENABLED=true`, `APP_URL` | Supabase secrets | Presentes |
| Web Push | `worker` (envio), navegador (inscrição) | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`; `VITE_VAPID_PUBLIC_KEY` | Supabase + Vercel (pública) | Presentes; pública idêntica nos dois lados |
| Autentique | `contract-sign`, `contract-webhook`, `worker` | `AUTENTIQUE_API_TOKEN`, `AUTENTIQUE_WEBHOOK_SECRET`, `AUTENTIQUE_SANDBOX=true` | Supabase secrets | Presentes (sandbox) |
| Vercel Functions | `api/tenant-app.ts` (manifest white label) | `VITE_SUPABASE_*` | Vercel | Presentes |

Nenhum segredo privado é necessário na Vercel: nenhuma função da Vercel chama Resend, Evolution, Gemini ou InfinitePay. Conferido: valores publicados no Supabase = cópia local (comparação por SHA-256, sem leitura dos valores).

## Estado observado em produção (somente leitura)

| Item | Evidência |
|---|---|
| Worker (cron 1 min) | 126 respostas HTTP 200 nas últimas 3 h; 54 × 401 até 17:54 UTC (corrigido com `--no-verify-jwt`); fila pendente = 0 |
| E-mail | 1 `welcome` enviado em 29/10 17:52 com ID do Resend; 3 antigos `dead` (antes do domínio verificado). Entrega **não confirmada**: sem webhook e a chave é só de envio (consulta do e-mail retorna `restricted_api_key`) |
| DNS e-mail | SPF em `send.pistec.com.br`, DKIM `resend._domainkey`, DMARC `p=reject`, raiz `v=spf1 -all` |
| Push | 8 entregues (27/10), 1 dispositivo inscrito |
| WhatsApp | Instância `pistec-33a28504-4787581c`: Evolution `connecting`, 0 mensagens; nenhuma mensagem real no banco |
| Cobrança | 1 fatura InfinitePay `Pendente`; nenhum webhook de pagamento recebido |
| IA | Nenhum uso registrado em produção |
| Vercel | Projeto `pistec`, branch de produção `main`, último deploy `b0293f1` READY (28/10 18:15) — **não contém** teste de 1 mês nem PISTEC NEXT |
| Migrations | 22 aplicadas; pendentes `20261103000100` e `20261104000100` |

## Correções feitas nesta etapa (locais)

| Problema | Correção |
|---|---|
| Bot do WhatsApp nunca respondia (sem implementação no worker) | Etapa `bot` no worker: Gemini → Evolution, reserva idempotente por mensagem (`whatsapp_bot_replies`), só com instância aberta, bot ligado, conversa sem atendente humano, plano com IA e quota |
| Status de entrega do WhatsApp não era registrado | `MESSAGES_UPDATE` assinado e tratado (`whatsapp_message_status`, só avança) |
| Contatos com `@lid` descartados | Usa `remoteJidAlt` quando presente; senão preserva `@lid` |
| Instâncias antigas sem os novos eventos | `connect` sincroniza a assinatura do webhook mantendo URL/token |
| Site público dizia "protótipo", "roadmap", "simulações" e o contato gravava só no navegador | Textos de FAQ/termos/privacidade atualizados; contato envia a `submit_lead` (Super Admin recebe notificação); falha real exibida |
| "Recuperar acesso" da demo registrava pedido simulado | Redireciona; link leva à recuperação real `/app/recuperar` |
| Super Admin sem "última operação real" | `admin_integration_summary` passa a informar a última operação confirmada por serviço e respostas do bot |
| `.env.example` com domínio antigo | Atualizado para `pistec.com.br` |

Simulações que **permanecem** e são corretas: somente na demonstração isolada (`/demonstracao`, `/loja/*`, IndexedDB), identificadas na tela. Teste `demo-isolation.e2e.ts` comprova que a demonstração não chama Supabase nem provedores.
