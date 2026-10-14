import 'fake-indexeddb/auto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { createDemoStore, DemoDatabase, DemoProvider } from '../../store';
import { NoticeProvider } from '../../ui';
import Products from './Products';
import Inventory from './Inventory';
import Pos from './Pos';
import Records from './Records';
import Finance from './Finance';
import Reports from './Reports';
import WhatsApp from './WhatsApp';
import { configs } from './record-config';

describe('ERP route render smoke', () => {
  let store: ReturnType<typeof createDemoStore>;
  beforeAll(async () => { store = createDemoStore({ db: new DemoDatabase(`erp-render-${crypto.randomUUID()}`), latency: 0 }); await store.ready; });
  afterAll(async () => { await store.db.delete(); });
  const pages = [['produtos', Products], ['estoque', Inventory], ['inventario', Inventory], ['pdv', Pos], ['financeiro', Finance], ['caixa', Finance], ['contas-pagar', Finance], ['contas-receber', Finance], ['relatorios', Reports], ['whatsapp', WhatsApp], ['clientes', Records], ['vendas', Records], ...Object.keys(configs).map(module => [module, Records] as const)] as const;
  for (const [module, Page] of pages) it(`renders ${module} against persisted seed`, () => {
    const html = renderToString(<MemoryRouter initialEntries={[`/loja/moto-prime/${module}`]}><DemoProvider store={store}><NoticeProvider><Routes><Route path="/loja/:tenantSlug/:module" element={<Page />} /></Routes></NoticeProvider></DemoProvider></MemoryRouter>);
    expect(html).toContain('<h1>');
    expect(html).not.toContain('Módulo não encontrado');
    expect(html).not.toContain('NaN');
    expect(html).not.toContain('undefined');
    expect(html).not.toContain('<iframe');
  });
});
