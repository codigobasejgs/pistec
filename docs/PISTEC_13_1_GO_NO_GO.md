# PISTEC 13.1: GO/NO-GO (30/10/2026)

**Recomendação: GO para publicar landing, planos e catálogo**, com as integrações pendentes comunicadas com honestidade na própria página. Ainda não publicado: aguarda autorização.

## O que muda

| Área | Entrega |
|---|---|
| Landing | Novo hero, segmentos (oficinas, motos, motopeças, autopeças, mista), 13 diferenciais NEXT com telas reais (WebP, lazy), jornada, IA ("auxilia; o profissional decide"), WhatsApp (bot "em homologação"), white label/PWA, antes e depois sem métricas inventadas |
| /planos | Seletor de período com total real e equivalente mensal; "Tudo do X, mais"; comparação por categoria; no celular, dois planos escolhidos, sem rolagem lateral |
| Catálogo único | `feature_catalog` + `plan_catalog()` (anônimo). A mesma fonte alimenta landing, /planos, contratação (`contract_catalog`), Anexo I de contratos novos, Minha assinatura e Super Admin |
| Super Admin | Planos SaaS → "Recursos e planos": matriz e troca de estado (Disponível / Requer configuração / Em homologação) com justificativa e auditoria |
| Demo | CTA "Gostou do PISTEC? Comece seu mês grátis." (topo em telas largas e aviso DEMO) |
| SEO | Título, descrição, canonical e OG por rota; JSON-LD (Organization + SoftwareApplication, sem notas nem avaliações); `robots.txt`, `sitemap.xml`; `noindex` em /app, /loja, /admin, /c, /d, cadastro e login |
| Ajuda | Artigos "planos e limites" e "ativar IA"; artigo do WhatsApp deixou de anunciar o atendente automático |

Preços, limites, módulos, teste de 1 mês e contratos existentes: **inalterados** (ensaio em produção com rollback: preços idênticos, 1 empresa, 0 registros afetados).

## Evidências

| Verificação | Resultado |
|---|---|
| TypeScript / ESLint | 0 erros |
| Vitest (unitários + banco PGlite) | 340/340, incluindo catálogo = frontend = seed, `app.require` por recurso, Essencial bloqueado ao forjar o payload (9 módulos + IA), estado só por Super Admin com auditoria, contratação e Anexo I = catálogo, rollback |
| E2E Playwright (demo e público) | saas, v2 (14 larguras sem rolagem lateral), demo-isolation, flows, pwa, contracts, documents, erp, next e address passaram |
| Ensaio da migration em produção (transação + ROLLBACK) | HTTP 201; 5 funções, 28 recursos; Essencial 8, Profissional 26, Premium 28, Enterprise 28; preços iguais; após o rollback, 24 migrations aplicadas (nada gravado) |
| Rolagem lateral | 0 px em /, /planos (1440 e 390) e no dashboard da demo |
| Performance (build de produção) | Desktop: LCP 1,18 s, CLS 0,034. Celular com CPU 4× mais lenta e 1,6 Mbps: LCP 6,6 s, CLS 0,057, clique no período 191–214 ms |

## Riscos e pendências (não bloqueiam a landing)

| Item | Situação | Ação |
|---|---|---|
| LCP no celular lento | O elemento de LCP é o título (texto); o tempo vem do JS de entrada (React, router e Dexie da demo, ~159 KB gzip) | Próxima versão: separar a demo (Dexie, seed) da entrada pública |
| `RESEND_WEBHOOK_SECRET` | Não gravado; o endpoint responde 503 | O proprietário cola o `whsec_…` (não é a chave `re_…`) |
| WhatsApp | Nenhum número pareado | Landing diz "requer conectar"; o bot segue "em homologação" |
| IA da empresa teste | `ai_settings.enabled=false` | Ativação pelo Super Admin |
| InfinitePay / Autentique | Sem pagamento ou assinatura real executados (proibido sem autorização) | Homologar com transação autorizada |
| Redistribuição de planos | Apenas proposta | Ver `PISTEC_PLAN_REDISTRIBUTION_PROPOSAL.md` |
| E2E contra produção real (`real.e2e`, `address.real.e2e`) | Não rodados nesta etapa | Rodar após aplicar a migration |

## Publicação (após autorização)

1. `node --env-file=.env.local scripts/migrate-backend.mjs --project <ref> --apply` (aplica `20261105000100_feature_catalog`, numa transação).
2. Push `main` → deploy Vercel.
3. Smoke: `/`, `/planos`, `/robots.txt`, `/sitemap.xml`, `rpc/plan_catalog` anônimo, `/app/contratar/profissional`, Super Admin → Planos SaaS.

**Rollback:** `supabase/rollback/20261105000100_feature_catalog.down.sql` (testado em `rollback-catalog.test.ts`) e promover o deploy anterior na Vercel.
