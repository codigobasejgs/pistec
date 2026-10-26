# Super Admin 4.0 — arquitetura, funcionalidades, permissões e QA (2026-10-27)

Um documento em vez de seis: arquitetura, funcionalidades, permissões, tour, UX e QA estão nas seções abaixo. Capturas reais: `docs/screenshots/admin/` (desktop, tablet, celular).

## 1. Arquitetura

- Rota: `/app/admin/*` (ambiente real, login Supabase). `/admin` da demonstração redireciona para cá; a demo não tem Super Admin.
- Frontend: `src/real/Admin.tsx` (rotas) + `src/real/admin/*`:
  - `AdminLayout.tsx`: sidebar por grupos (busca de módulo, favoritos, recolher; estado salvo no navegador), topbar (busca global Ctrl+K, alertas, tema escuro/claro/automático, ajuda, conta), breadcrumbs.
  - `data.ts`: `call()` para RPCs, `rows()` paginado, `useQuery()`, mensagens amigáveis (erros de regra do banco já vêm em português).
  - `ui.tsx`: `AdvancedTable` (busca, ordenação, paginação, vira cartões no celular), `ConfirmAction` (justificativa obrigatória), `Tabs`, `KeyValue`, `Timeline`, `BarSeries`/`Distribution` (SVG, sem biblioteca nova), estados de carregamento/erro/vazio.
  - Páginas: `Dashboard`, `Tenants` (visões filtradas da mesma página), `TenantDetail` (360°), `Billing` (assinaturas, planos, faturas, cupons, receita), `Operations` (leads, suporte, comunicados, alertas), `Tech` (integrações, consumo IA/WhatsApp, filas, push), `Security` (administradores, perfis, auditoria, segurança, configurações), `Help` + `helpContent.ts` + `AdminTour`.
- Sem segundo login, sem segundo service worker (push do admin usa o mesmo `sw.js`), sem dependências novas.
- Backend: migrations `20261027000100_admin_roles.sql` e `20261027000200_admin_operations.sql`; Edge Function `admin-health` (configuração + diagnóstico de conectividade).

## 2. Funcionalidades (todas persistem no Supabase)

| Área | O que faz | Servidor |
|---|---|---|
| Dashboard | Empresas por situação, novas no período, testes terminando, MRR/ARR, recebido, pendente/vencido, chamados, leads, onboarding, cancelamentos; gráficos de receita e cadastros por dia, empresas por plano, situação das assinaturas, MRR por plano; filtros de período; widgets ocultáveis | `admin_metrics` |
| Empresas | Lista com busca (nome, CNPJ, responsável, e-mail, telefone), filtros (situação, plano, data), ordenação, exportação CSV; visões: em teste, inadimplentes/suspensas, onboarding | RLS `tenants_read` |
| Perfil 360° | Cabeçalho + 9 abas (visão geral, cadastro, assinatura, cobranças, usuários, filiais, integrações, suporte/notas, auditoria) | `admin_tenant_detail` |
| Ações na empresa | Editar dados, prorrogar teste (1–90 dias, mostra data atual e nova), alterar plano (bloqueia se o uso exceder), suspender, reativar (N dias), cancelar ao fim do período, observações | `admin_save_tenant`, `admin_extend_trial`, `admin_change_plan`, `admin_set_subscription`, `admin_save_record` |
| Planos | Cartões com preço, limites, dias de teste e nº de empresas; criar/editar/desativar/ordenar | `admin_save_plan` |
| Assinaturas | Lista com situação, periodicidade, valor, fim do período, gateway; filtro "vencendo em 7 dias" | RLS |
| Faturas | Lista, filtro, exportação; baixa manual (marcada como `manual`, nunca como InfinitePay) e cancelamento, ambos com justificativa | `admin_set_invoice_status` |
| Cupons | Lista com usos; assistente em 5 etapas com prévia do desconto por plano | `admin_save_coupon` |
| Receita | Recebido no mês, baixas manuais, MRR, a receber/vencido, MRR por plano | `admin_metrics` |
| Leads (CRM do PISTEC) | Funil de 8 etapas (kanban) e tabela; leads da landing entram como "Novo"; histórico e comentários | `admin_save_record`, `admin_record_comment` |
| Suporte | Chamados com empresa, categoria, prioridade, SLA (atrasado), responsável; notas internas x resposta ao cliente (gera notificação na loja) | idem |
| Comunicados | Público (todas, teste, ativas, inadimplentes, por plano, selecionadas), prévia, confirmação, histórico | `admin_broadcast` |
| Alertas | Notificações de plataforma (nova empresa, pagamento, teste terminando, vencida, suspensão, conciliação) | RLS `notifications_read` |
| Notificações e push | Ativar/testar push no dispositivo do admin, dispositivos, histórico; contadores de entrega | `send_test_push_platform`, `admin-health` |
| Integrações | Por serviço: configuração (nomes de variáveis), conectividade (chamada segura), uso real, última falha; detalhe com orientações | `admin-health` |
| Consumo IA / WhatsApp | Por empresa: consultas, tokens, custo estimado, bloqueios; conexão e volumes do WhatsApp; suspender/liberar IA com justificativa | `admin_usage`, `admin_set_ai` |
| Automações e filas | Contadores, eventos recentes, webhooks recebidos, reprocessar evento em falha definitiva | `admin_retry_event` |
| Administradores | Listar, conceder perfil, remover (só proprietário) | `admin_list_admins`, `admin_set_admin` |
| Auditoria | Filtros por data, módulo, só plataforma; justificativa, antes/depois, correlação | RLS `audit_read` |
| Segurança | Trocar a própria senha; regras vigentes | Supabase Auth |
| Configurações | Parâmetros vigentes (identidade, teste por plano, tolerância, limites, agendamentos) | leitura |
| Ajuda / Tour | 22 artigos com busca; 8 tours que destacam `[data-tour]` reais | — |

### Definições das métricas
- **MRR**: soma do valor mensal equivalente das assinaturas `active` (trimestral ÷ 3, anual ÷ 12). Receita contratada, não recebida.
- **ARR**: MRR × 12 (projeção).
- **Recebido**: soma de `billing_transactions.paid_amount` no período, exceto baixas manuais (mostradas à parte).
- **Onboarding incompleto**: empresa sem nenhum produto.
- **Cancelamentos**: ações "Assinatura: cancel" na auditoria no período; churn simples só quando há base.

## 3. Permissões (verificadas no servidor)

`platform_admins.role`: `owner`, `admin`, `finance`, `sales`, `support`, `ops`, `auditor`. Função `app.admin_perm(role, perm)`.

| Permissão | owner | admin | finance | sales | support | ops | auditor |
|---|---|---|---|---|---|---|---|
| billing.read (faturas, receita, MRR) | ✓ | ✓ | ✓ | | | | ✓ |
| billing.manage | ✓ | ✓ | ✓ | | | | |
| coupons.manage | ✓ | ✓ | ✓ | | | | |
| subscriptions.manage | ✓ | ✓ | ✓ | | | | |
| tenants.edit | ✓ | ✓ | | | ✓ | | |
| leads.manage | ✓ | ✓ | | ✓ | | | |
| support.manage | ✓ | ✓ | | | ✓ | | |
| broadcast | ✓ | ✓ | | | | ✓ | |
| integrations.manage | ✓ | ✓ | | | | ✓ | |
| jobs.retry | ✓ | ✓ | | | | ✓ | |
| audit.read | ✓ | ✓ | ✓ | | | ✓ | ✓ |
| admins.manage | ✓ | | | | | | |
| planos (criar/editar) | ✓ | ✓ | | | | | |

Todos os perfis veem dashboard (sem bloco financeiro se não tiverem `billing.read`), empresas e perfil 360° (faturas e auditoria só com a permissão). Ninguém altera o próprio acesso. Usuário de loja não executa nenhuma RPC `admin_*`. A conta `pistec.gestao@gmail.com` é `owner`. Autenticador (MFA) desativado por decisão do proprietário.

## 4. QA executado (2026-10-27)

| Verificação | Resultado |
|---|---|
| `npm run typecheck`, `npm run lint`, `npm run build` | OK |
| `npm test` | 218/218 (inclui `supabase/tests/admin.test.ts`, 9 testes: perfis, prorrogação com auditoria, suspensão sem perda de dados, troca de plano com limites, MRR, 360° sem dados privados, administradores, chamado com resposta notificando a loja, reprocessamento) |
| E2E local (ERP, demo, PWA) | 37/37, sem regressão |
| Deno type-check `admin-health` | OK |
| Migrations no remoto | 16/16 aplicadas; smoke remoto PASS |
| RPCs com a conta do proprietário (remoto) | `admin_metrics`, `admin_list_admins`, `admin_usage`, `admin-health` com diagnóstico: 200 |
| Diagnóstico real | InfinitePay respondeu (sem cobrança), Resend chave válida só para envio, Evolution 2.3.7, Gemini chave aceita |
| Capturas reais | 21 imagens (13 desktop, 3 tablet, 5 celular) com conta e empresa temporárias, removidas no fim; rolagem horizontal no celular corrigida (de 63 px para 0) |

### Não feito / pendente
- E2E automatizado das telas do admin contra o banco real (as capturas exercitam as rotas, mas sem asserções de fluxo).
- Teste com leitor de tela e em aparelhos físicos; Lighthouse.
- Anexos em chamados (Storage não implementado), SLA configurável por tela (fixo: Crítica 4 h, Alta 24 h, Média 48 h, Baixa 72 h), agendamento de comunicados, comunicados por e-mail/WhatsApp.
- Edição de identidade visual/contatos pela tela (exibidos, não editáveis).
- Acesso assistido aos dados de uma loja (não implementado de propósito).
