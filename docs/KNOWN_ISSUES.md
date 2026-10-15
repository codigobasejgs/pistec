# PISTEC — Registro de Limitações, Defeitos Conhecidos e Pendências

Este documento registra com transparência todas as limitações identificadas, pendências de integração futura e restrições do ambiente atual, em conformidade com as boas práticas de QA.

---

## 1. Defeitos Menores Conhecidos (P2 e P3)

| ID | Severidade | Módulo | Descrição | Impacto | Resolução Prevista |
|---|:---:|---|---|---|---|
| **DEF-01** | P2 | `src/ui.tsx:31` | O elemento `<label className="field">` concatena todo o texto de `<option>` filhas no cálculo de nome acessível no Chromium | Não impede o uso por mouse ou toque; quebra seletores semânticos estritos `getByRole('combobox', { name: 'Empresa', exact: true })` | Substituição de `<label>` envoltório por associação via `htmlFor`/`id` gerados por `useId()` na etapa de componentes Radix Form |
| **DEF-02** | P3 | `src/features/admin/Admin.tsx:328` | Faturas geradas além do tamanho da página (10 itens) são inseridas no fim e aparecem na página 2 sem auto-paginação | O operador precisa navegar para a página 2 ou filtrar pelo nome da empresa/código | Adicionar ordenação padrão decrescente por data e indicador de "Nova fatura criada" com link direto |

---

## 2. Limitações Inerentes ao Modo de Demonstração Frontend

1. **Segurança e Isolamento:**
   - O isolamento entre empresas (`tenantId`) é aplicado por filtros e repositórios locais em memória e IndexedDB.
   - Isso garante uma experiência de testes visualmente fidedigna, mas **não substitui** autenticação segura, tokens criptográficos e políticas Row Level Security (RLS) no PostgreSQL/Supabase.
2. **Emissão de Documentos Fiscais:**
   - O PDV emite cupons e comprovantes térmicos não-fiscais. A emissão real de NFC-e e NF-e depende de credenciamento na SEFAZ, certificado A1 e infraestrutura de mensageria fiscal de backend.
3. **Serviços Externos Simulados:**
   - Consulta de CEP, cobranças bancárias (Asaas/InfinitePay) e mensageria WhatsApp operam com adaptadores mock determinísticos. Nenhuma cobrança real é efetuada e nenhuma mensagem externa é disparada pelo navegador.
4. **Persistência do PWA:**
   - O aplicativo instalado em PWA utiliza o IndexedDB do navegador do dispositivo. Caso o usuário realize a limpeza total de dados do site nas configurações do sistema operacional, os registros locais demonstrativos serão reinicializados para o seed de fábrica.

---

## 3. Escopo Não Testado / Pendente de Recursos Físicos

1. **Hardware Físico:**
   - Todos os testes móveis foram executados via motores de emulação oficial do Playwright / Chromium (resoluções de 360px a 1920px). A validação em aparelhos iPhone, Galaxy, iPad e tablets físicos requer disponibilização dos dispositivos em laboratório de QA.
2. **Leitores de Tela:**
   - A acessibilidade foi homologada a 100% via motor automatizado `axe-core` cobrindo as regras WCAG 2.2 AA. A validação com usuários cegos utilizando NVDA, JAWS ou VoiceOver permanece como etapa de validação humana posterior.
3. **Sessões com Usuários Leigos Reais:**
   - O roteiro de 12 tarefas foi preparado em `docs/UX_AUDIT.md` e está pronto para aplicação moderada com 5 a 8 lojistas e mecânicos reais.
