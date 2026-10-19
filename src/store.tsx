import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import Dexie, { type Table } from 'dexie';
import type { DemoState, Session } from './types';
import { createSeed, INITIAL_SESSION } from './seed';
import { validateState } from './domain';
import { migrate } from './migrations';

export const DEMO_SESSION_KEY = 'pistec-demo-session';

const roles = ['Proprietário', 'Administrador', 'Gerente', 'Vendedor', 'Caixa', 'Estoquista', 'Mecânico', 'Atendente', 'Financeiro'];

/**
 * Valida se um objeto de sessão corresponde a uma empresa, filial e papel válidos no estado atual.
 */
export function isValidSession(candidate: unknown, state: DemoState): candidate is Session {
  if (!candidate || typeof candidate !== 'object') return false;
  const s = candidate as Record<string, unknown>;
  if (typeof s.tenantId !== 'string' || !state.tenants.some(t => t.id === s.tenantId)) return false;
  if (typeof s.branchId !== 'string' || !state.branches.some(b => b.id === s.branchId && b.tenantId === s.tenantId && b.active)) return false;
  if (typeof s.role !== 'string' || !roles.includes(s.role)) return false;
  if (typeof s.name !== 'string' || !s.name.trim()) return false;
  if (typeof s.admin !== 'boolean') return false;
  return true;
}

/** Lê a sessão demo salva do localStorage com tratamento de erro e validação. */
export function loadPersistedSession(): Session | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(DEMO_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const s = parsed as Record<string, unknown>;
    if (typeof s.tenantId === 'string' && typeof s.branchId === 'string' && typeof s.role === 'string' && typeof s.name === 'string' && typeof s.admin === 'boolean') {
      return {
        tenantId: s.tenantId,
        branchId: s.branchId,
        role: s.role as Session['role'],
        name: s.name,
        admin: s.admin,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/** Persiste a sessão demo no localStorage com try/catch silencioso. */
export function persistSession(session: Session | null): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (session) {
      localStorage.setItem(DEMO_SESSION_KEY, JSON.stringify({
        tenantId: session.tenantId,
        branchId: session.branchId,
        role: session.role,
        name: session.name,
        admin: session.admin,
      }));
    } else {
      localStorage.removeItem(DEMO_SESSION_KEY);
    }
  } catch {
    // Falha silenciosa em private window / storage desativado
  }
}

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
        if (!saved) {
          const fresh = structuredClone(view.state);
          validateState(fresh);
          await db.snapshots.put({ id: 'demo', state: fresh });
          return fresh;
        }
        // Migra o snapshot salvo usando migrations.ts (transacional: falha aborta transação)
        const migrated = migrate(saved.state);
        // Atualiza no banco se a versão mudou ou se houve enriquecimento
        if (saved.state.version !== migrated.version) {
          await db.snapshots.put({ id: 'demo', state: migrated });
        }
        return migrated;
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
/** Chamada de RPC Supabase equivalente à operação demo. Só é usada no modo real. */
export interface Remote { fn: string; args: Record<string, unknown> }
export const rpc = (fn: string, args: Record<string, unknown>): Remote => ({ fn, args });
export interface DemoContextValue extends StoreView {
  /** 'demo' = IndexedDB local; 'real' = Supabase (rotas /app). */
  mode: 'demo' | 'real';
  /** Prefixo das rotas internas: '' na demo, '/app' no modo real. */
  prefix: string;
  session: Session;
  setSession(next: Session): void;
  mutate(action: (draft: DemoState) => void): Promise<void>;
  /** Executa a operação: demo aplica `demo` no snapshot local; real chama `remote` no servidor e recarrega. */
  perform<T>(demo: (draft: DemoState) => T, remote?: Remote): Promise<T>;
  reset(): Promise<void>;
  setFailNext(value: boolean): void;
  logout(): void;
}
export const DemoContext = createContext<DemoContextValue | null>(null);
let defaultStore: DemoStore | undefined;

export function DemoProvider({ children, store }: { children: ReactNode; store?: DemoStore }) {
  const [controller] = useState(() => store ?? (defaultStore ??= createDemoStore()));
  const view = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);

  // Inicializa sessão a partir do localStorage persistido (se válido com o snapshot inicial do seed)
  const [session, updateSession] = useState<Session>(() => {
    const candidate = loadPersistedSession();
    if (candidate && isValidSession(candidate, controller.getSnapshot().state)) {
      return candidate;
    }
    return { ...INITIAL_SESSION };
  });

  // Revalida a sessão sempre que o estado do store for atualizado
  useEffect(() => {
    if (!view.initialized) return;
    if (!isValidSession(session, view.state)) {
      const fallback = { ...INITIAL_SESSION };
      updateSession(fallback);
      persistSession(fallback);
    }
  }, [view.state, view.initialized, session]);

  const value = useMemo<DemoContextValue>(() => ({
    ...view, session, mode: 'demo', prefix: '',
    async perform<T>(demo: (draft: DemoState) => T) {
      let result: T | undefined;
      await controller.mutate(draft => { result = demo(draft); });
      return result as T;
    },
    setSession(next) {
      // Lê o snapshot atual: logo após um mutate, o `view` deste render ainda é o anterior.
      const current = controller.getSnapshot().state;
      if (!isValidSession(next, current)) {
        throw new Error('Sessão de demonstração inválida.');
      }
      const clean = { ...next };
      updateSession(clean);
      persistSession(clean);
    },
    mutate: controller.mutate,
    reset: async () => {
      await controller.reset();
      const initial = { ...INITIAL_SESSION };
      updateSession(initial);
      persistSession(initial);
    },
    setFailNext: controller.setFailNext,
    logout: () => {
      persistSession(null);
      updateSession({ ...INITIAL_SESSION });
    },
  }), [view, session, controller]);

  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>;
}

export function useDemo(): DemoContextValue {
  const context = useContext(DemoContext);
  if (!context) throw new Error('useDemo deve ser usado dentro de DemoProvider.');
  return context;
}
