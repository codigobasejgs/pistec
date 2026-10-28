# Validação da assinatura

| Item | Situação |
|---|---|
| Provedor | Autentique (API GraphQL, webhook HMAC-SHA256) — adaptador em `supabase/functions/_shared/autentique.ts` |
| Aceite na tela | checkbox explícita, desmarcada, só habilitada após rolar o texto até o fim; texto diz que **não é a assinatura** |
| Assinatura | feita no Autentique (convite por e-mail). O PISTEC não desenha assinatura no PDF nem assina pela contratada |
| Conclusão | `svc_contract_complete` só com todos os signatários assinados **e** PDF assinado baixado com SHA-256 |
| Evidências | hash do enviado, hash do assinado, eventos (`contract_signature_events`, deduplicados), PDF final com certificado do provedor |
| Eventos fora de ordem / duplicados | testados (`supabase/tests/contracts.test.ts`) |
| Recusa, expiração, cancelamento | testados (idem) |

## O que foi executado

| Teste | Resultado |
|---|---|
| Fluxo de assinatura com eventos simulados no banco (mock do provedor) | **Testado localmente** (SQL) |
| Sandbox Autentique | **Não executado — pendente de credenciais** (`AUTENTIQUE_API_TOKEN`, `AUTENTIQUE_WEBHOOK_SECRET`) |
| Provedor real | **Não executado — pendente de credenciais e de versão jurídica publicada** |
| Webhook em produção | publicado; responde 503 sem segredo (verificado em 28/10/2026) |

Assinatura incorporada (embed) na página: a Autentique oferece link de assinatura; hoje o fluxo usa o convite por e-mail, que funciona sem configuração extra. Embed fica para depois da homologação com credenciais.
