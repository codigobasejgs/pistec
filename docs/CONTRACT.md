# Contrato de implementação — PISTEC 2.0

Stack inalterada: React 19 + TS estrito, CSS próprio (tokens em `src/styles.css`), Radix Dialog, Lucide, Recharts, Dexie. Nova dependência: `read-excel-file` (somente leitura XLSX, no navegador, lazy import). Sem backend, sem rede.

Tipos compartilhados: `src/types.ts` (fonte única). Dinheiro sempre inteiro em centavos.

## Store (`src/store.tsx`)
`useDemo()` → `{ state, session, setSession, mutate, reset, loading, initialized, error, failNext, setFailNext, logout }`.
- `mutate(action)` síncrono, serializado, persiste antes de publicar (inalterado).
- **Versão de dados = 2.** `migrate(raw): DemoState` exportada de `src/migrations.ts` — v1→v2 adiciona `settlements` (entradas `paid` antigas viram uma baixa integral), `change: 0` em vendas, `coupons/couponRedemptions: []`, `branding.radius: 'default'`. Migra em transação; falha não sobrescreve snapshot.
- **Sessão demo persistida** em `localStorage['pistec-demo-session']` (só tenantId/branchId/role/name/admin). Restaurada no boot, validada contra o estado (tenant/filial/papel); inválida → `INITIAL_SESSION`. `logout()` limpa a chave. Isso NÃO é autenticação.

## Domínio (`src/domain.ts`) — assinaturas existentes preservadas
- `completeSale(state, input)`: `input.payments[].amount` = valor ENTREGUE. Somente 'Dinheiro' admite troco. Aplica não-dinheiro primeiro; soma não-dinheiro > total → erro; total entregue < total → erro "Pagamento insuficiente". Grava `sale.payments[].amount` = aplicado, `tendered` no dinheiro, `sale.change`. Caixa recebe só dinheiro líquido (entregue − troco). Idempotente por requestId.
- `settleEntry(state, tenantId, entryId, { amount, method, date, user, note, requestId })` → baixa parcial/total; erro se > saldo, cancelada, ou requestId repetido com outro conteúdo (mesmo conteúdo = no-op).
- `reverseSettlement(state, tenantId, entryId, settlementId, user, reason)`.
- `cancelEntry(state, tenantId, entryId, user, reason)` — só sem baixas ativas.
- `entryStatus(entry, today: string): EntryStatus`; `entryPaid(entry)`; `entryBalance(entry)`.
- `closeCash(state, tenantId, id, counted, reason?, user?)`: grava expected/difference/closingReason/closedBy; diferença ≠ 0 exige motivo; NÃO cria lançamento financeiro. Fechar duas vezes → erro.
- `importProducts(state, tenantId, rows: ProductImportRow[], strategy: 'create' | 'update' | 'upsert', ): ImportReport` — chave SKU por tenant; duplicados na planilha → segunda ocorrência ignorada com erro; respeita limite do plano; tudo-ou-nada por linha válida (linhas inválidas viram erros, não abortam).
- Cupons SaaS: `couponQuote(state, tenantId, code, planId, period, today)` → `{ coupon, original, discount, total }` ou erro com motivo (inexistente, inativo, fora da vigência, plano/período inelegível, limite total, limite por empresa). `createSubscriptionInvoice(state, { tenantId, planId, period, couponCode?, provider, requestId, today })` → BillingInvoice Pendente com desconto aplicado só nesta fatura; registra redemption. Nunca marca pago.
- `saveCoupon(state, coupon)` valida (percent 1–10000 bps, fixed > 0, datas, código único em maiúsculas).
- `can(role, module, action)` inalterado.

## UI compartilhada (`src/ui.tsx`)
`Button({variant:'primary'|'secondary'|'ghost'|'outline'|'danger', loading, icon, ...})`, `PageHeader`, `Panel`, `Stat({label,value,hint,icon,tone,trend?:{value:number,label:string},action?})`, `Badge`, `Modal({title,open,onClose,children,footer?,size?:'md'|'lg'|'xl'})`, `Field({label,hint?,error?,children})`, `Empty`, `DataTable`, `useNotice`, `MoneyInput({value:number(centavos),onChange})`, `ChartTooltip`.
Classes: `.btn .primary .secondary .ghost .outline .danger .is-loading`, `.grid*`, `.stack`, `.toolbar`, `.form-grid`, `.form-section`, `.kanban`, `.kanban-col`, `.kanban-card`, `.calendar`, `.chat-*`.

## Tour
Elementos-alvo com `data-tour="<modulo>-<elemento>"` (ex.: `pdv-search`, `pdv-cart`, `pdv-pay`, `products-new`). Passos em `src/app/tours.ts`. Cada agente coloca `data-tour` nos elementos das suas telas e registra os passos via mensagem ao coordenador.

## Responsabilidades
- Domínio: `domain.ts`, `migrations.ts`, `seed.ts`, `store.tsx`, `services/billing.ts`, `domain.test.ts`.
- ERP: `src/features/erp/*`.
- Público/Admin: `src/features/public/*`, `src/features/admin/*`.
- Coordenador: `styles.css`, `ui.tsx`, `app/*`, `navigation.ts`, `main.tsx`, `dashboard`, `settings`, docs, e2e de raiz, screenshots.
