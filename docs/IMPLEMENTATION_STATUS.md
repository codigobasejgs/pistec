# Status de Implementação PISTEC — Versão 2.0 Homologada

**Data de atualização:** 14 de outubro de 2026  
**Status geral:** 100% dos testes unitários e E2E aprovados · Tipagem TypeScript estrita sem erros · ESLint limpo · Build concluído.

---

## 1. Verificações Executadas

- **`tsc -b`:** Concluído com 0 erros em modo estrito.
- **`eslint .`:** Concluído com 0 erros e 0 avisos.
- **`vite build`:** Concluído com sucesso (saída gerada em `dist/`).
- **Vitest (140 testes):** 140 testes passando a 100%.
  - Domínio com troco e estorno líquido.
  - Baixas financeiras parciais, estornos e cancelamento.
  - Importação de produtos com upsert e detecção de duplicatas.
  - Cupons SaaS com percentual e valor fixo.
  - Migração transacional da versão 1 para a versão 2 do IndexedDB.
  - Persistência e restauração da sessão de demonstração.
- **Playwright Chrome (18 testes):** 18 testes passando a 100%.
  - Venda mista persistente e isolada por tenant.
  - Retomada de carrinho suspenso sem reserva de estoque.
  - Prévia de CSV antes de confirmação.
  - Onboarding de empresa refletido no Super Admin.
  - Isolamento de tema por empresa e bloqueio de papéis.
  - Guard do Super Admin.
  - Persistência de perfil no reload e limpeza no logout.
  - Tour guiado destacando elementos reais.
  - **Zero rolagem lateral em 8 larguras oficiais** (360px, 390px, 430px, 768px, 1024px, 1280px, 1440px, 1920px) em 16 rotas.
- **Landing Page:** 12 screenshots reais gerados e integrados sem nenhum fallback.
- **PWA:** Manifest W3C, Service Worker com precache, 20 ícones oficiais (16 a 512px) e banner de instalação.

---

## 2. Principais Novidades da Versão 2.0

1. **Troco no PDV:** Cálculo exato em centavos inteiros; pagamentos mistos recebem valor entregue; caixa recebe apenas o dinheiro líquido; bloqueio contra pagamentos insuficientes e excedentes em cartão.
2. **Baixas Parciais no Financeiro:** Títulos de contas a pagar e receber admitem múltiplas liquidações parciais; valor original preservado; saldo calculado ao vivo; estorno de baixas e cancelamento controlado.
3. **Cupons SaaS:** Gestão no Super Admin (`PISTEC20` com 20%, `BEMVINDO50` com R$ 50,00 fixo) e aplicação demonstrativa com cotação em tempo real na emissão de faturas.
4. **Importação XLSX e CSV:** Suporte a arquivos Excel `.xlsx` via `read-excel-file` com lazy-load; mapeamento visual de colunas; detecção de duplicatas; estratégias create, update e upsert.
5. **Persistência de Sessão Demo:** O lojista escolhe o perfil ou empresa demonstrativa e pode recarregar a página (F5) à vontade sem perder a sessão. Logout limpa as preferências.
6. **Migração v1 -> v2 no IndexedDB:** Bancos de dados de versões anteriores são migrados automaticamente de forma atômica e transacional preservando todos os registros existentes.
7. **PWA Instalável:** Aplicativo instalável no Chrome, Edge, Android e iOS/Safari com experiência dedicada sem abas de navegador.
8. **Tour por Componente Real:** O tour ilumina com *spotlight* e rola até o botão, card ou input exato que está sendo ensinado (`[data-tour]`).

---

## 3. Preparação para a Próxima Etapa (Backend Supabase)

O frontend está estruturado de forma desacoplada através de contratos de domínio puros (`src/domain.ts`). A integração futura com Supabase Auth e PostgreSQL/RLS não exigirá reconstrução das telas (vide roteiro em `docs/SUPABASE.md`).
