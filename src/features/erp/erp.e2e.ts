import { expect, test, type Page } from '@playwright/test';

async function snapshot(page: Page) {
  return page.evaluate(async () => {
    const request = indexedDB.open('pistec-demo-v1');
    const db = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try {
      const read = db.transaction('snapshots', 'readonly').objectStore('snapshots').get('demo');
      return await new Promise<import('../../types').DemoState>((resolve, reject) => { read.onsuccess = () => resolve(read.result.state); read.onerror = () => reject(read.error); });
    } finally { db.close(); }
  });
}

test('mixed sale survives reload and remains isolated by tenant', async ({ page }) => {
  await page.goto('/loja/moto-prime/pdv');
  await expect(page.getByRole('heading', { name: 'Frente de caixa' })).toBeVisible();
  const before = await snapshot(page);
  const product = before.products.find(row => row.tenantId === 'tenant-premium')!;
  const previous = before.sales.filter(row => row.tenantId === 'tenant-premium').length;
  const beforeCash = before.cashRegisters.find(row => row.tenantId === 'tenant-premium' && row.branchId === 'branch-premium-matriz' && !row.closedAt)!;
  await page.getByRole('textbox', { name: 'Nome, SKU ou código de barras' }).fill(product.sku);
  await page.getByRole('button', { name: 'Adicionar', exact: true }).click();
  await page.getByRole('textbox', { name: 'Valor do pagamento 1 (R$)', exact: true }).fill('10.00');
  await page.getByRole('button', { name: 'Outra forma' }).click();
  await page.getByRole('textbox', { name: 'Valor do pagamento 2 (R$)', exact: true }).fill(((product.price - 1000) / 100).toFixed(2));
  await page.getByRole('button', { name: 'Finalizar venda' }).click();
  await expect(page.getByRole('dialog', { name: 'Venda concluída' })).toBeVisible();
  await expect(page.getByText('RECIBO NÃO FISCAL', { exact: true })).toBeVisible();
  const after = await snapshot(page);
  expect(after.sales.filter(row => row.tenantId === 'tenant-premium')).toHaveLength(previous + 1);
  const sale = after.sales.find(row => !before.sales.some(old => old.id === row.id))!;
  expect(sale.payments).toEqual([{ method: 'Dinheiro', amount: 1000 }, { method: 'Pix', amount: product.price - 1000 }]);
  expect(after.cashRegisters.find(row => row.id === beforeCash.id)!.movements.reduce((sum, row) => sum + row.amount, 0) - beforeCash.movements.reduce((sum, row) => sum + row.amount, 0)).toBe(1000);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Frente de caixa' })).toBeVisible();
  expect((await snapshot(page)).sales.some(row => row.id === sale.id)).toBe(true);
  await page.goto(`/loja/moto-prime/vendas?q=${sale.id}`);
  await expect(page.getByRole('heading', { name: 'Vendas', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Buscar registros' }).fill(sale.id);
  await expect(page.getByRole('button', { name: `Detalhes da venda ${sale.id}`, exact: true })).toBeVisible();
  await page.goto('/loja/auto-center/vendas');
  await expect(page.getByRole('heading', { name: 'Vendas', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Buscar registros' }).fill(sale.id);
  await expect(page.getByText('Nenhuma venda encontrada. Realize vendas pelo PDV ou ajuste os filtros.')).toBeVisible();
});

test('suspended cart resumes after reload without reserving stock', async ({ page }) => {
  await page.goto('/loja/moto-prime/pdv');
  await expect(page.getByRole('heading', { name: 'Frente de caixa' })).toBeVisible();
  const before = await snapshot(page);
  const product = before.products.find(row => row.tenantId === 'tenant-premium')!;
  await page.getByRole('textbox', { name: 'Nome, SKU ou código de barras' }).fill(product.sku);
  await page.getByRole('button', { name: 'Adicionar', exact: true }).click();
  await page.getByRole('button', { name: 'Suspender', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retomar', exact: true })).toBeVisible();
  expect((await snapshot(page)).balances).toEqual(before.balances);
  await page.reload();
  await page.getByRole('button', { name: 'Retomar', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: 'Quantidade', exact: true })).toHaveValue('1');
  await page.getByRole('button', { name: 'Completar', exact: true }).click();
  await page.getByRole('button', { name: 'Finalizar venda' }).click();
  await expect(page.getByRole('dialog', { name: 'Venda concluída' })).toBeVisible();
  const saved = (await snapshot(page)).records.find(row => row.kind === 'cart' && row.tenantId === 'tenant-premium')!;
  expect(saved.status).toBe('Concluído');
  expect(saved.fields.saleId).toBeTruthy();
});

test('CSV preview persists a product only after confirmation', async ({ page }) => {
  await page.goto('/loja/moto-prime/produtos');
  await expect(page.getByRole('heading', { name: 'Produtos', exact: true })).toBeVisible();
  await page.getByLabel('Importar produtos CSV').setInputFiles({ name: 'produtos.csv', mimeType: 'text/csv', buffer: Buffer.from('name;sku;cost;price;min;max\nProduto E2E;E2E-CSV;10,00;20,00;0;50', 'utf8') });
  await expect(page.getByRole('dialog', { name: 'Prévia da importação' })).toBeVisible();
  expect((await snapshot(page)).products.some(row => row.sku === 'E2E-CSV')).toBe(false);
  await page.getByRole('button', { name: 'Confirmar importação' }).click();
  await expect(page.getByRole('dialog', { name: 'Prévia da importação' })).not.toBeVisible();
  await page.reload();
  await page.getByRole('textbox', { name: 'Nome, SKU, código de barras ou marca' }).fill('E2E-CSV');
  await expect(page.getByRole('button', { name: 'Produto E2E E2E-CSV' })).toBeVisible();
});

test('mobile ERP keeps forms and navigation usable without page overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const module of ['produtos', 'pdv', 'estoque', 'financeiro', 'ordens-servico', 'relatorios', 'whatsapp']) {
    await page.goto(`/loja/moto-prime/${module}`);
    await expect(page.locator('main h1')).toBeVisible();
    const width = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, viewport: innerWidth }));
    expect(width.scroll, module).toBeLessThanOrEqual(width.viewport + 1);
  }
  await page.goto('/loja/moto-prime/clientes');
  await page.getByRole('button', { name: 'Novo cliente' }).click();
  const dialog = page.getByRole('dialog', { name: 'Cadastro de cliente' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox', { name: 'Nome / razão social' }).fill('Cliente Mobile E2E');
  await dialog.getByRole('textbox', { name: 'Telefone', exact: true }).fill('11999999999');
  await dialog.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('textbox', { name: 'Nome, documento, telefone ou e-mail' }).fill('Cliente Mobile E2E');
  await expect(page.getByRole('cell', { name: 'Cliente Mobile E2E', exact: true })).toBeVisible();
});
