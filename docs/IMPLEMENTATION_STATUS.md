# Status de implementação — 2026-10-14

## Verificado

- `tsc -b`, `eslint .` e `vite build` sem erros.
- Vitest: 97 testes passando.
  - Domínio: venda, cancelamento, estoque, transferência, inventário, OS (reserva, consumo e reversão), caixa, compras, conversões sem duplicar, limites de plano, isolamento por tenant.
  - Também cobertos: store/IndexedDB, falha simulada sem gravação parcial, mocks de billing e workflows do ERP.
- Playwright (Chrome): 7 testes passando.
  - Venda mista que persiste após reload e fica isolada por tenant.
  - Carrinho suspenso e retomado.
  - Importação CSV com prévia.
  - Mobile em 390px.
  - Onboarding até o Super Admin.
  - Tema isolado por empresa e bloqueio por papel.
  - Guard do admin e landing.
- Sem rolagem horizontal em 21 rotas em 390px (`scripts/overflow.mjs`).
- Landing com 11 screenshots reais carregando, sem fallback (`scripts/check-landing.mjs`).

## Implementado

- **Landing:** problemas e soluções, benefícios, galeria com telas reais, WhatsApp, white label, planos mensal/trimestral/anual com comparação, Enterprise sob consulta, licença perpétua sob consulta, FAQ, depoimentos reservados (sem inventar), formulários de lead e páginas legais.
- **Cadastro:** onboarding em 6 etapas (CEP simulado, plano, identidade visual, aceite dos termos).
- **ERP:**
  - Dashboard fiel ao mockup, com dados derivados das operações, widgets personalizáveis e ações rápidas.
  - Produtos (CRUD, CSV), estoque e inventário, PDV e caixa.
  - Clientes, CRM (kanban), veículos, orçamentos, OS e agenda.
  - Compras, fornecedores e financeiro (pagar/receber).
  - WhatsApp e automações simulados.
  - Equipe, filiais, tarefas, notificações, garantias e relatórios com CSV.
  - Personalização com prévia, minha assinatura, central de ajuda, tour e busca Ctrl+K.
- **Super Admin:** dashboard SaaS, empresas, planos, assinaturas, cobranças, financeiro SaaS, suporte, integrações, usuários, relatórios e configurações.
- **Temas:** escuro, claro e automático. RBAC demo com 9 papéis.

## Limitações reais

- **Segurança:** a sessão demo fica em memória e é perdida ao recarregar (dados não). Não há autenticação nem isolamento seguro: tudo roda no navegador.
- **Logos:** são PNG raster gerados por IA, sem SVG oficial. Recomenda-se vetorizar.
- **PDV:** sem cálculo de troco (pagamentos precisam somar exatamente o total); baixa de conta sempre integral.
- **CSV:** a importação só cria SKUs novos (até 1.000 linhas); não há XLSX. PDF só pela impressão do navegador.
- **Integrações simuladas:** cupons não são aplicados às cobranças. CEP, WhatsApp, Asaas e InfinitePay são simulados.
- **Caixa:** a diferença no fechamento vai apenas para a auditoria.
- **Catálogo de aplicações:** compatibilidade demonstrativa, sem fonte técnica validada.
- **Tour:** destaca o cabeçalho de cada módulo real, não elementos individuais.
- **Dados:** `validateState` revalida o estado inteiro a cada mutação, adequado ao volume demo. Snapshot de versão diferente exige restaurar os dados demo.
- **Publicação:** não houve deploy nem push.
