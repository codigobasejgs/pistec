import { createContext, useContext, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import Dexie, { type Table } from 'dexie';
import type { DemoState, Session } from './types';
import { createSeed, INITIAL_SESSION } from './seed';
import { validateState } from './domain';

interface Snapshot { id: string; state: DemoState }
export class DemoDatabase extends Dexie {
  snapshots!: Table<Snapshot, string>;
  constructor(name = 'pistec-demo-v1') {
    super(name);
    this.version(1).stores({ snapshots: 'id' });
  }
}
interface StoreView { state: DemoState; initialized: boolean; loading: boolean; error: string; failNext: boolean }
interface StoreOptions { db?: DemoDatabase; latency?: number; seed?: () => DemoState }
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Não foi possível salvar os dados.';

/** Fila por store; transações de leitura/escrita IndexedDB serializam também outras abas. */
export function createDemoStore(options: StoreOptions = {}) {
  const db = options.db ?? new DemoDatabase();
  const seed = options.seed ?? createSeed;
  const latency = options.latency ?? 180;
  if (!Number.isFinite(latency) || latency < 0) throw new Error('Latência inválida.');
  let view: StoreView = { state: freeze(seed()), initialized: false, loading: true, error: '', failNext: false };
  let initialized = false;
  let pending = 1;
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<StoreView>) => { view = { ...view, ...patch }; listeners.forEach(listener => listener()); };
  const wait = () => latency ? new Promise<void>(resolve => setTimeout(resolve, latency)) : Promise.resolve();
  const initialize = async () => {
    try {
      const state = await db.transaction('rw', db.snapshots, async () => {
        const saved = await db.snapshots.get('demo');
        const next = saved?.state ?? structuredClone(view.state);
        if (next.version !== 1) throw new Error('Versão de dados incompatível. Exporte seus dados antes de restaurar a demonstração.');
        validateState(next);
        if (!saved) await db.snapshots.put({ id: 'demo', state: next });
        return next;
      });
      initialized = true;
      publish({ state: freeze(state), initialized: true, error: '' });
    } catch (error) {
      publish({ error: errorMessage(error) });
      throw error;
    } finally { pending--; publish({ loading: pending > 0 }); }
  };
  const ready = initialize();
  let queue: Promise<unknown> = ready.catch(() => undefined);
  const enqueue = (action: ((draft: DemoState) => void) | null): Promise<void> => {
    const shouldFail = view.failNext;
    pending++;
    publish({ loading: true, failNext: shouldFail ? false : view.failNext });
    const task = queue.then(async () => {
      try {
        await wait();
        if (shouldFail) throw new Error('Falha simulada. Nenhuma alteração foi salva. Tente novamente.');
        if (action && !initialized) throw new Error('Persistência indisponível. Restaure a demonstração para tentar novamente.');
        const next = await db.transaction('rw', db.snapshots, async () => {
          const saved = action ? await db.snapshots.get('demo') : undefined;
          if (action && !saved) throw new Error('Snapshot não encontrado. Restaure a demonstração.');
          const draft = action ? structuredClone(saved!.state) : seed();
          if (action) {
            const result: unknown = action(draft);
            if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
              void Promise.resolve(result).catch(() => undefined);
              throw new Error('mutate exige callback síncrono; aguarde serviços antes de chamar mutate.');
            }
          }
          validateState(draft);
          await db.snapshots.put({ id: 'demo', state: draft });
          return structuredClone(draft);
        });
        initialized = true;
        publish({ state: freeze(next), initialized: true, error: '' });
      } catch (error) {
        publish({ error: errorMessage(error) });
        throw error;
      } finally { pending--; publish({ loading: pending > 0 }); }
    });
    queue = task.catch(() => undefined);
    return task;
  };
  return {
    ready,
    getSnapshot: () => view,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    mutate: (action: (draft: DemoState) => void) => enqueue(action),
    reset: () => enqueue(null),
    setFailNext: (value: boolean) => publish({ failNext: value }),
    db,
  };
}

type DemoStore = ReturnType<typeof createDemoStore>;
export interface DemoContextValue extends StoreView {
  session: Session;
  setSession(next: Session): void;
  mutate(action: (draft: DemoState) => void): Promise<void>;
  reset(): Promise<void>;
  setFailNext(value: boolean): void;
}
const DemoContext = createContext<DemoContextValue | null>(null);
let defaultStore: DemoStore | undefined;
const roles = ['Proprietário', 'Administrador', 'Gerente', 'Vendedor', 'Caixa', 'Estoquista', 'Mecânico', 'Atendente', 'Financeiro'];
export function DemoProvider({ children, store }: { children: ReactNode; store?: DemoStore }) {
  const [controller] = useState(() => store ?? (defaultStore ??= createDemoStore()));
  const view = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const [session, updateSession] = useState<Session>(() => ({ ...INITIAL_SESSION }));
  const value = useMemo<DemoContextValue>(() => ({
    ...view, session,
    setSession(next) {
      // Lê o snapshot atual: logo após um mutate, o `view` deste render ainda é o anterior.
      const current = controller.getSnapshot().state;
      if (!current.tenants.some(row => row.id === next.tenantId) || !current.branches.some(row => row.id === next.branchId && row.tenantId === next.tenantId && row.active) || !roles.includes(next.role) || !next.name.trim()) throw new Error('Sessão de demonstração inválida.');
      updateSession({ ...next });
    },
    mutate: controller.mutate,
    reset: async () => { await controller.reset(); updateSession({ ...INITIAL_SESSION }); },
    setFailNext: controller.setFailNext,
  }), [view, session, controller]);
  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>;
}
export function useDemo(): DemoContextValue {
  const context = useContext(DemoContext);
  if (!context) throw new Error('useDemo deve ser usado dentro de DemoProvider.');
  return context;
}
