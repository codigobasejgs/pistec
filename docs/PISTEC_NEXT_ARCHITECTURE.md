# PISTEC NEXT 10.0 — Arquitetura e matriz de conclusão

Princípio: **nada de segundo ERP**. Todos os diferenciais usam as mesmas tabelas (`records`, `products`, `stock_*`, `customers`, `financial_entries`), as mesmas RPCs e as mesmas permissões. Nenhum preço, plano, teste gratuito ou migration histórica foi alterado.

## Peças novas

| Camada | Arquivo | Conteúdo |
|---|---|---|
| Regras puras | `src/services/workshop.ts` (+ `workshop.test.ts`) | AutoPilot, margem por OS, estoque inteligente, comparação de cotações, escopo aprovado, horários livres, revisões previstas |
| Banco | `supabase/migrations/20261104000100_pistec_next.sql` (aditiva) | `workshop_settings`, `record_attachments`, `customer_links`, `estimate_decisions`; RPCs abaixo; `save_record`/`transition_record` redefinidos com acréscimos (conflito de agenda, tipos `cotacoes`/`frotas`, OS de check-in sem itens, justificativa de garantia recusada) |
| Edge Function | `supabase/functions/mechanic` + `_shared/mechanic.ts` | Áudio/texto → Gemini → apontamento validado (peças só do catálogo do tenant) |
| Telas | `src/features/next/*` | AutoPilot, CheckIn, Mechanic, SmartStock, Profit, Loyalty, MotoExpress, QuotePanel, CustomerLink, CustomerPortal |
| Rotas | `main.tsx`, `real/RealApp.tsx` | `/loja/:slug/{autopilot,checkin,mecanico,estoque-inteligente,lucro-os,fideliza,moto-express,cotacoes,frotas}`; portal público `/c/<token>` |

### RPCs novas

| RPC | Quem | O que faz |
|---|---|---|
| `workshop_settings` / `save_workshop_settings` / `dismiss_alert` | membro / configurar / editar dashboard | Regras do AutoPilot, custo/hora (oculto sem Relatórios), pacotes Moto Express, dispensa auditada |
| `update_os_work` | editar OS (custos: editar Relatórios) | Horas, previsão, terceiros, comissão, próxima revisão; lista fechada de campos; nunca altera itens/valor |
| `add_record_attachment` / `set_attachment` | editar o módulo | Fotos privadas (data URL ≤ ~500 KB, máx. 24/registro); flag "mostrar ao cliente" |
| `create_customer_link` / `revoke_customer_links` | editar módulo | Token 48 hex, só hash no banco, 1–30 dias, escopo `record`/`customer`/`fleet` |
| `portal_view` / `portal_decide` (anon) | portador do token | Visão sem custo/notas internas; aprovação por item com hash do conteúdo visto, rate limit por link |
| `approve_supplier_quote` | cadastrar Compras | Proposta registrada → compra **Pendente** (idempotente); estoque só no recebimento |
| `authorize_mechanic_ai` | editar OS + plano com IA + assinatura ativa | Contexto mínimo para a IA (OS e catálogo nome/SKU, sem custo nem dados pessoais) |

## Eventos

Reaproveitado `app.emit` → `outbox_events` → worker → `deliver_internal_event` (idempotente, retry, dead-letter já existentes). Decisão no portal emite `record.status`; cotação aprovada emite `record.created`; dúvida do cliente cria notificação `estimate.question`. **Não** foi criado novo tipo de evento sem handler.

## Matriz de conclusão

| # | Funcionalidade | Resultado | Evidência | Pendências |
|---|---|---|---|---|
| 1 | AutoPilot | IMPLEMENTADO E TESTADO LOCALMENTE | `workshop.test.ts` (regras, dedupe, dispensa, isolamento), `next.test.ts` (dispensa auditada), E2E | Execução agendada no servidor (cron) e alertas por push/e-mail; modo automatizado deliberadamente não habilitado |
| 2 | Check-in 360° | IMPLEMENTADO E TESTADO LOCALMENTE | E2E (placa, checklist, OS criada); SQL fotos/RLS | Assinatura desenhada não implementada (fluxo jurídico não definido); vídeo não suportado |
| 3 | Orçamento por item | IMPLEMENTADO E TESTADO LOCALMENTE | `next.test.ts`: parcial 35000 de 55000, hash, repetição bloqueada, conversão só aprovados | Envio automático por Evolution/Resend (hoje: link + WhatsApp manual) |
| 4 | Portal do Cliente | IMPLEMENTADO E TESTADO LOCALMENTE | `next.test.ts`: escopos, sem custo, fotos compartilhadas, revogação, anon sem tabela | OTP/magic link de sessão própria; manifest PWA específico do portal |
| 5 | Mecânico IA | IMPLEMENTADO COM INTEGRAÇÃO EXTERNA NÃO VALIDADA | `mechanic-note.test.ts`, `next.test.ts` (autorização/plano/contexto) | Edge Function `mechanic` não publicada; Gemini com áudio não testado com chamada real |
| 6 | Estoque inteligente | IMPLEMENTADO E TESTADO LOCALMENTE | `workshop.test.ts` (ponto de reposição, compras pendentes, janela) | Prazo por fornecedor (hoje por produto `details.leadDays` ou padrão) |
| 7 | Cotação com fornecedores | IMPLEMENTADO E TESTADO LOCALMENTE | `next.test.ts` (proposta → compra → recebimento → saldo), `workshop.test.ts` (custo total) | Resposta do fornecedor por link próprio; API de fornecedor |
| 8 | Agenda inteligente | PARCIAL | `next.test.ts` (bloqueio mecânico/box, encaixe), `freeSlots` testado | Cadastro de recursos/turnos/feriados e visão por box; sugestão de horário ainda não exposta na tela da Agenda |
| 9 | Fideliza | IMPLEMENTADO E TESTADO LOCALMENTE | `workshop.test.ts`, E2E carrega | Disparo em lote/opt-out por canal; métricas de receita atribuída |
| 10 | Lucro por OS | IMPLEMENTADO E TESTADO LOCALMENTE | `workshop.test.ts` (R$ 800 − R$ 520 = R$ 280), restrição de perfil (SQL + E2E) | Rateio de despesas indiretas |
| 11 | Garantias e retrabalho | PARCIAL | `next.test.ts` (justificativa obrigatória) | Painel de indicadores de retrabalho |
| 12 | Moto Express + Frotas | IMPLEMENTADO E TESTADO LOCALMENTE (Frotas: PARCIAL) | E2E Moto Express; `next.test.ts` frota isolada + portal `fleet` | Frotas: condutores, centro de custo em relatórios, aprovação pelo gestor da frota |

Nada foi aplicado em produção: migration, Edge Function e frontend aguardam autorização.
