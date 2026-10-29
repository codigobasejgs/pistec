# PISTEC — Matriz de aceitação (29/10/2026)

Legenda: REAL HOMOLOGADO · REAL PARCIAL · LOCAL VALIDADO · PENDENTE DE CONFIGURAÇÃO · BLOQUEADO POR PROVEDOR · BLOQUEADO POR AUTORIZAÇÃO · NÃO IMPLEMENTADO · DEFEITUOSO

| # | Serviço | Código | Configuração | Credencial | Conectividade | Operação real | Teste de falha | Segurança | Evidência | Pendência | Classificação |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Vercel | ok | `main`, Vite, rewrites, headers | VITE_* em Production | HTTPS ok | Deploy `b0293f1` | — | Sem segredo privado | API Vercel | Novo deploy; VITE_SUPABASE_* só em Production (Preview sem `/app`) | REAL PARCIAL |
| 2 | Cloudflare | — | DNS-only → Vercel; MX/TXT preservados | — | TLS ok | Site no ar | — | DMARC reject | DoH | — | REAL HOMOLOGADO |
| 3 | Supabase | ok | 22 migrations | ok | ok | RPCs/RLS em uso | Testes RLS 2 empresas (PGlite) | RLS forçada | Consultas somente leitura | Aplicar 2 migrations | REAL PARCIAL |
| 4 | Auth SMTP | — | Resend 465, PT-BR | ok | ok | Recuperação enviada (HTTP 200) | — | — | 29/10 | Confirmar recebimento na caixa | REAL PARCIAL |
| 5 | Resend | ok | Domínio verificado | Chave só envio | ok | 1 e-mail aceito com ID | Retentativa/dead testados | Chave no servidor | `email_messages` | `RESEND_WEBHOOK_SECRET` + webhook para confirmar entrega | PENDENTE DE CONFIGURAÇÃO |
| 6 | Evolution | ok (+bot, status, @lid) | URL/chave | ok | `GET /` 2.3.7, 401 com chave errada | Nenhuma mensagem | Parsers testados | Token por instância | Probe | Parear número de teste e prova bidirecional | BLOQUEADO POR AUTORIZAÇÃO |
| 7 | Gemini | ok | `AI_ENABLED=true` | ok | ok | Chamada real com áudio (fora do app): transcrição correta, peças só do catálogo, torque marcado incerto, 4,9 s, 1.370 tokens | Saída inválida descartada | Backend apenas | Log do teste | Publicar `mechanic`/worker e testar pelo app | REAL PARCIAL |
| 8 | InfinitePay | ok | `BILLING_ENABLED=true` | ok | API responde | Nenhum pagamento | Valor/status validados (Deno) | Retorno não marca pago | 1 fatura pendente | Pagamento real autorizado ou link sandbox | BLOQUEADO POR AUTORIZAÇÃO |
| 9 | Web Push | ok | VAPID | ok | ok | 8 entregues (27/10) | Expirados tratados | Conteúdo genérico | `notification_deliveries` | Teste em dispositivo físico | REAL PARCIAL |
| 10 | PWA | ok | manifest/SW | — | — | Instalável | Testes PWA 4/4 (emulação) | — | `pwa.e2e.ts` | Testes físicos | LOCAL VALIDADO |
| 11 | PWA White Label | ok | `api/tenant-app` | — | — | — | Testes unitários | — | `tenant-app.test.ts` | Validar em produção | LOCAL VALIDADO |
| 12 | Contratos | ok | Autentique sandbox | ok | ok | — | Webhook HMAC testado | — | Testes SQL | Signatário da contratada | PENDENTE DE CONFIGURAÇÃO |
| 13 | AutoPilot | ok | — | — | — | — | — | Só sugere | Unit + E2E | Publicar | LOCAL VALIDADO |
| 14 | Check-in | ok | — | — | — | — | Placa errada recusada | Fotos privadas | E2E + SQL | Publicar | LOCAL VALIDADO |
| 15 | Orçamentos | ok | — | — | — | — | Hash/repetição | Sem custo no link | SQL | Publicar | LOCAL VALIDADO |
| 16 | Portal | ok | headers `/c/*` | — | — | — | Revogado/inválido | Escopo por token | SQL | Publicar | LOCAL VALIDADO |
| 17 | Mecânico IA | ok | — | Gemini | ok | Ver linha 7 | Peça fora do catálogo descartada | Contexto mínimo | SQL + teste real Gemini | Publicar função `mechanic` | REAL PARCIAL |
| 18 | Estoque inteligente | ok | — | — | — | — | — | — | Unit | Publicar | LOCAL VALIDADO |
| 19 | Cotações | ok | — | — | — | — | Sem proposta/permissão | Compra só manual | SQL | Publicar | LOCAL VALIDADO |
| 20 | Agenda | parcial | — | — | — | — | Conflito bloqueado | — | SQL | Recursos/turnos | LOCAL VALIDADO (PARCIAL) |
| 21 | Fidelização | ok | — | — | — | — | — | Consentimento | Unit | Publicar | LOCAL VALIDADO |
| 22 | Rentabilidade | ok | — | — | — | — | — | Perfil restrito | Unit + E2E | Rateio indireto | LOCAL VALIDADO |
| 23 | Garantias | parcial | — | — | — | — | Recusa exige justificativa | — | SQL | Painel de indicadores | LOCAL VALIDADO (PARCIAL) |
| 24 | Moto Express | ok | — | — | — | — | — | — | E2E | Publicar | LOCAL VALIDADO |
| 25 | Frotas | parcial | — | — | — | — | Isolamento | Portal por frota | SQL | Condutores/centro de custo | LOCAL VALIDADO (PARCIAL) |
