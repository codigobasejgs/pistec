import type { DemoState, FinancialEntry, Settlement } from './types';
import { validateState } from './domain';

export const CURRENT_DATA_VERSION = 2;

/**
 * Migra um snapshot bruto para a versão 2 do esquema PISTEC.
 * Transacional: qualquer erro na validação ou conversão aborta a migração
 * sem alterar o snapshot persistido.
 *
 * Mudanças v1 -> v2:
 * 1. version = 2
 * 2. Branding: radius definido como 'default' quando ausente ou inválido
 * 3. Vendas: change = 0 quando ausente; payments.amount preservado
 * 4. Financeiro: entradas com paid=true geram uma baixa (settlement) integral automática se vazias
 * 5. Cupons: coupons = [] e couponRedemptions = []
 * 6. Caixas: campos closingReason/closedBy opcionais presentes
 */
export function migrate(raw: unknown): DemoState {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Snapshot inválido: dados não são um objeto.');
  }

  const data = structuredClone(raw) as Record<string, unknown>;
  const version = Number(data.version ?? 1);

  if (!Number.isSafeInteger(version) || version < 1) {
    throw new Error(`Versão de dados desconhecida: ${String(data.version)}`);
  }

  if (version > CURRENT_DATA_VERSION) {
    throw new Error(`Versão de dados incompatível: ${version}. Versão atual suportada: ${CURRENT_DATA_VERSION}.`);
  }

  // Se já estiver na versão atual, apenas valida a estrutura
  if (version === CURRENT_DATA_VERSION) {
    const state = data as unknown as DemoState;
    validateState(state);
    return state;
  }

  // Migração v1 -> v2
  if (version === 1) {
    // 1. Branding: radius 'default'
    if (Array.isArray(data.tenants)) {
      for (const t of data.tenants as Record<string, unknown>[]) {
        if (t && typeof t === 'object') {
          const branding = (t.branding ?? {}) as Record<string, unknown>;
          if (!['compact', 'default', 'round'].includes(String(branding.radius))) {
            branding.radius = 'default';
          }
          t.branding = branding;
        }
      }
    }

    // 2. Vendas: change = 0 quando ausente
    if (Array.isArray(data.sales)) {
      for (const s of data.sales as Record<string, unknown>[]) {
        if (s && typeof s === 'object') {
          if (s.change === undefined || s.change === null) {
            s.change = 0;
          }
        }
      }
    }

    // 3. Financeiro: entradas com paid=true geram baixa integral se settlements estiver vazio
    if (Array.isArray(data.finances)) {
      for (const f of data.finances as (FinancialEntry & Record<string, unknown>)[]) {
        if (f && typeof f === 'object') {
          if (!Array.isArray(f.settlements)) {
            f.settlements = [];
          }
          if (f.paid && f.settlements.length === 0 && Number.isSafeInteger(f.amount) && f.amount > 0) {
            const date = typeof f.date === 'string' && f.date ? f.date : new Date().toISOString();
            const settlement: Settlement = {
              id: `settle-migrated-${f.id}`,
              requestId: `migration:${f.id}`,
              amount: f.amount,
              date: date.slice(0, 10),
              method: 'Migração v1',
              user: 'Sistema',
              note: `Baixa integral automática gerada na migração v1->v2 (lançamento ${f.id})`,
            };
            f.settlements.push(settlement);
          }
        }
      }
    }

    // 4. Coleções de cupons SaaS
    if (!Array.isArray(data.coupons)) {
      data.coupons = [];
    }
    if (!Array.isArray(data.couponRedemptions)) {
      data.couponRedemptions = [];
    }

    // 5. Atualiza versão
    data.version = CURRENT_DATA_VERSION;
  }

  const migrated = data as unknown as DemoState;
  validateState(migrated);
  return migrated;
}
