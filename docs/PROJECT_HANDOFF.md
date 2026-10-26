# PISTEC — Handoff entre máquinas

Estado detalhado e evidências: `docs/PISTEC_3_AUDITORIA_COMPLETA.md`. Pendências: `docs/KNOWN_ISSUES.md`.

## 1. O que é

SaaS multi-tenant para oficinas, motopeças e autopeças. Dois modos no mesmo bundle:

- **Demonstração** (`/demonstracao`, `/loja/*`, `/admin`): 100% local (IndexedDB/Dexie), seed determinístico, nenhuma chamada externa.
- **Real** (`/app/*`): Supabase Auth + Postgres + RLS + RPCs. Carregado sob demanda (`src/real/*`).

## 2. Arquitetura

- **Frontend:** React 19 + Vite 6 + React Router 7, TypeScript 5.8. Regras de negócio da demo em `src/domain.ts`; telas em `src/features/*`; o modo real reaproveita as telas via `DemoContext` (`src/store.tsx`) e troca `perform` por chamadas `supabase.rpc` (`src/real/RealApp.tsx`).
- **Backend:** Postgres com escrita **só por RPC** (`SECURITY DEFINER`, `search_path=''`, `app.require` valida membership/papel/plano/assinatura). Leitura direta por RLS. Funções internas no schema `app` (não exposto). Eventos via `outbox_events` (mesma transação).
- **Edge Functions (Deno):** `billing-checkout`, `billing-webhook` (InfinitePay), `assistant` (Gemini, ferramentas somente leitura), `worker` (outbox → notificações).
- **PWA:** `public/sw.js` (marcadores preenchidos no build por `vite.config.ts`), `src/pwa.ts`.

## 3. Instalação

Requisitos testados: Node 22.17, npm 10.9, Chrome instalado (Playwright usa `channel: 'chrome'`).

```bash
npm ci
cp .env.example .env.local   # preencher; nunca versionar
```

Opcionais: Supabase CLI (2.75 funciona; atualizar), Docker (necessário só para `supabase start`), Deno (dispensável: `npx deno@2.5.6 ...`).

## 4. Comandos

| Ação | Comando |
|---|---|
| Dev | `npm run dev` → http://127.0.0.1:5173 |
| Typecheck / lint | `npm run typecheck` / `npm run lint` |
| Unitários + SQL/RLS (PGlite, sem Docker) | `npm test` |
| E2E local (exclui o real) | `npx playwright test src/demo-isolation.e2e.ts src/flows.e2e.ts src/pwa.e2e.ts src/saas.e2e.ts src/v2.e2e.ts src/admin.e2e.ts src/features/erp/erp.e2e.ts` (~7 min) |
| Edge Functions | `npx deno@2.5.6 test supabase/functions/_shared/integrations.test.ts` e `npx deno@2.5.6 check supabase/functions/*/index.ts` |
| Build / preview (SW ativo só em produção) | `npm run build` / `npm run preview` |
| Verificar provedores (somente leitura) | `node scripts/providers-check.mjs` |

`src/real/real.e2e.ts` **grava no Supabase real** e usa proxy SOCKS `127.0.0.1:1080`; só rode com autorização e túnel ativo.

## 5. Supabase

- Projeto remoto: ref em `supabase/.temp/project-ref` (ignorado) ou `SUPABASE_PROJECT_REF`.
- **Migrations nunca são editadas depois de aplicadas**; crie um arquivo novo. `scripts/migrate-backend.mjs` recusa migration aplicada alterada.
- Ver pendentes: `node --env-file=.env.local scripts/migrate-backend.mjs --project <ref>`; aplicar: acrescentar `--apply` (**autorização**).
- Smoke remoto sem efeito (rollback): `node scripts/sb.mjs --file supabase/tests/remote-smoke.sql`.
- Local com Docker: `supabase start` aplica `supabase/migrations` (config em `supabase/config.toml`).
- Edge Functions: `supabase functions deploy <nome>`; `billing-webhook` e `worker` com `--no-verify-jwt` (autenticam por token próprio).
- Secrets das funções: `supabase secrets set NOME=valor` (lista em `.env.example`).

## 6. Variáveis

Ver `.env.example`. Regra: só `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY` vão para o navegador. Todo o resto é servidor/CLI.

## 7. Deploy

Vercel (`vercel.json`: rewrite SPA + headers). Nenhum deploy sem autorização. Antes de publicar: `npm run build` e conferir `dist/assets` sem segredos.

## 7.1 Entrega multicanal (3.1)

- Worker roda a cada minuto via `pg_cron` → `/functions/v1/worker` (URL e token no Vault: `pistec_worker_url`, `pistec_worker_token`). Ao rotacionar `WORKER_TOKEN`, atualize **os dois** (secret da função e Vault).
- Push: `VAPID_*` (servidor) + `VITE_VAPID_PUBLIC_KEY` (navegador). Verificação ponta a ponta: `node node_modules/esbuild/bin/esbuild supabase/functions/_shared/webpush.ts --format=esm --outfile=dist-tools/webpush.mjs && npm run build && node scripts/push-check.mjs` (exige acesso a `fcm.googleapis.com`).
- E-mail: sem `EMAIL_FROM` os e-mails ficam em `email_messages` (status `queued`).
- WhatsApp: instâncias criadas pela função `whatsapp`; webhook `whatsapp-webhook?i=&t=` (sem JWT).
- Detalhes: `docs/PISTEC_3_IMPLEMENTATION_REPORT.md`.

## 8. Estado (2026-10-26)

- **Concluído e testado localmente:** ERP transacional (venda, cancelamento, caixa, financeiro com baixa parcial/estorno, compras, OS, orçamentos), RLS por empresa/filial/papel, planos e limites, Super Admin com MFA, cupons e faturas, PWA.
- **Código presente, sem validação real hoje:** checkout InfinitePay, assistente Gemini, Realtime.
- **Parcial:** worker/automações (sem agendamento), WhatsApp (só ingestão SQL), central de notificações (só in-app).
- **Ausente:** Resend, Web Push (envio), Storage, bot WhatsApp com IA.
- **Riscos:** chaves a rotacionar; SMTP padrão (2 e-mails/h).

Próximos passos: seção 9 da auditoria.
