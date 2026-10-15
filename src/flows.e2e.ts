import { expect, test, type Page } from '@playwright/test';

// Fluxos ponta a ponta pela UI real. Cada teste roda em contexto novo (IndexedDB limpo → seed do dia).
const SLUG = 'moto-prime';
const toCents = (text: string) => { const negative = /-|Falta/.test(text); const value = Math.round(Number(text.replace(/[^\d,]/g, '').replace(',', '.')) * 100); return negative ? -value : value; };
const reais = (cents: number) => (cents / 100).toFixed(2);
const brl = (cents: number) => new RegExp(`R\\$\\s${(cents / 100).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`);
const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
const stat = (page: Page, label: string) => page.locator('.stat').filter({ has: page.getByText(label, { exact: true }) }).first().locator('strong');

test.beforeEach(({ page }) => { page.on('dialog', dialog => void dialog.accept()); });

async function createProduct(page: Page, slug: string, name: string, sku: string, cost: string, price: string) {
  await page.goto(`/loja/${slug}/produtos`);
  await page.getByRole('button', { name: 'Novo produto' }).click();
  const dialog = page.getByRole('dialog', { name: 'Novo produto' });
  await dialog.getByLabel('Nome', { exact: true }).fill(name);
  await dialog.getByLabel('SKU', { exact: true }).fill(sku);
  await dialog.getByLabel('Custo (R$)').fill(cost);
  await dialog.getByLabel('Preço (R$)').fill(price);
  await dialog.getByRole('button', { name: 'Salvar produto' }).click();
  await expect(dialog).toBeHidden();
}

async function stockEntry(page: Page, name: string, quantity: number) {
  await page.goto(`/loja/${SLUG}/estoque`);
  await page.getByRole('button', { name: 'Movimentar', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Movimentar estoque' });
  await dialog.getByLabel('Produto').selectOption({ label: name });
  await dialog.getByLabel('Tipo').selectOption('Entrada');
  await dialog.getByLabel('Quantidade').fill(String(quantity));
  await dialog.getByRole('button', { name: 'Confirmar' }).click();
  await expect(dialog).toBeHidden();
}

async function stockOf(page: Page, sku: string) {
  await page.goto(`/loja/${SLUG}/estoque`);
  await page.getByRole('textbox', { name: 'Buscar registros' }).fill(sku);
  const row = page.getByRole('row').filter({ hasText: sku });
  await expect(row).toHaveCount(1);
  const cell = async (label: string) => Number(await row.locator(`td[data-label="${label}"]`).innerText());
  return { physical: await cell('Físico'), reserved: await cell('Reservado'), available: await cell('Disponível') };
}

async function openPdv(page: Page) {
  await page.goto(`/loja/${SLUG}/pdv`);
  await expect(page.getByRole('heading', { name: 'Frente de caixa' })).toBeVisible();
  if (await page.getByText('Caixa fechado', { exact: true }).isVisible()) {
    await page.getByRole('button', { name: 'Abrir caixa' }).click();
    const dialog = page.getByRole('dialog', { name: 'Abrir caixa' });
    await dialog.getByLabel('Fundo de abertura (R$)').fill('100.00');
    await dialog.getByRole('button', { name: 'Abrir caixa' }).click();
    await expect(page.getByText('Caixa aberto', { exact: true })).toBeVisible();
  }
}

async function addToCart(page: Page, sku: string, quantity: number) {
  await page.getByRole('textbox', { name: 'Nome, SKU ou código de barras' }).fill(sku);
  await page.getByRole('button', { name: 'Adicionar', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Quantidade', exact: true }).fill(String(quantity));
}

async function finishSale(page: Page) {
  await page.getByRole('button', { name: 'Finalizar venda' }).click();
  const dialog = page.getByRole('dialog', { name: 'Venda concluída' });
  await expect(dialog).toBeVisible();
  const saleId = /Venda (\S+) ·/.exec(await dialog.innerText())?.[1] ?? '';
  expect(saleId).toMatch(/^sale-\d+$/);
  return { dialog, saleId };
}

async function cashExpected(page: Page) {
  await page.goto(`/loja/${SLUG}/caixa`);
  return toCents(await stat(page, 'Caixa físico esperado').innerText());
}

async function sellNewProduct(page: Page, quantity: number, stock = 10) {
  const sku = `E2E-${unique()}`, name = `Produto fluxo ${sku}`;
  await createProduct(page, SLUG, name, sku, '10.00', '25.00');
  await stockEntry(page, name, stock);
  await openPdv(page);
  await addToCart(page, sku, quantity);
  await page.getByRole('textbox', { name: 'Valor do pagamento 1 (R$)', exact: true }).fill(reais(2500 * quantity));
  const { dialog, saleId } = await finishSale(page);
  await dialog.getByRole('button', { name: 'Fechar janela' }).click();
  return { sku, name, saleId };
}

test('1. venda: produto → entrada → PDV com troco → estoque, vendas e caixa conferem após reload', async ({ page }) => {
  const sku = `E2E-${unique()}`, name = `Produto venda ${sku}`;
  await createProduct(page, SLUG, name, sku, '10.00', '25.00');
  await stockEntry(page, name, 10);
  expect(await stockOf(page, sku)).toEqual({ physical: 10, reserved: 0, available: 10 });
  const cashBefore = await cashExpected(page);

  await openPdv(page);
  await addToCart(page, sku, 2);
  await page.getByRole('textbox', { name: 'Valor do pagamento 1 (R$)', exact: true }).fill('60.00');
  await expect(stat(page, 'Troco a devolver')).toHaveText(brl(1000));
  await expect(page.getByText(/Pagamento coberto\. Devolva R\$\s10,00 de troco\./)).toBeVisible();
  const { dialog, saleId } = await finishSale(page);
  await expect(dialog.getByRole('status')).toHaveText(/^Troco: R\$\s10,00$/);
  await expect(dialog.getByText(/Dinheiro: R\$\s50,00 · entregue R\$\s60,00/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Fechar janela' }).click();

  const verify = async () => {
    expect(await stockOf(page, sku)).toMatchObject({ physical: 8, available: 8 });
    await page.goto(`/loja/${SLUG}/vendas`);
    await page.getByRole('textbox', { name: 'Buscar registros' }).fill(saleId);
    const row = page.getByRole('row').filter({ has: page.getByRole('button', { name: `Detalhes da venda ${saleId}`, exact: true }) });
    await expect(row).toHaveCount(1);
    await expect(row.locator('td[data-label="Total"]')).toHaveText(brl(5000));
    await expect(row.locator('td[data-label="Status"]')).toHaveText('Concluída');
    expect(await cashExpected(page) - cashBefore, 'caixa recebe só o líquido (entregue − troco)').toBe(5000);
  };
  await verify();
  await page.reload();
  await verify();
});

test('2. pagamento misto Pix + Dinheiro com troco; cartão acima do total e pagamento insuficiente bloqueados', async ({ page }) => {
  const sku = 'PRE-0001'; // Filtro de óleo PSL55 · R$ 34,90 (seed)
  const cashBefore = await cashExpected(page);
  await openPdv(page);
  await addToCart(page, sku, 1);
  const method1 = page.getByRole('combobox', { name: 'Forma de pagamento 1', exact: true });
  const value1 = page.getByRole('textbox', { name: 'Valor do pagamento 1 (R$)', exact: true });
  const finish = page.getByRole('button', { name: 'Finalizar venda' });

  await method1.selectOption('Crédito');
  await value1.fill('40.00');
  await expect(page.getByText(/Pix e cartões excedem o total em R\$\s5,10\. Troco só em dinheiro\./)).toBeVisible();
  await expect(finish).toBeDisabled();

  await method1.selectOption('Pix');
  await value1.fill('10.00');
  await expect(page.getByText(/Pagamento insuficiente: faltam R\$\s24,90\./)).toBeVisible();
  await expect(stat(page, 'Falta receber')).toHaveText(brl(2490));
  await expect(finish).toBeDisabled();

  await value1.fill('20.00');
  await page.getByRole('button', { name: 'Outra forma' }).click();
  await page.getByRole('combobox', { name: 'Forma de pagamento 2', exact: true }).selectOption('Dinheiro');
  await page.getByRole('textbox', { name: 'Valor do pagamento 2 (R$)', exact: true }).fill('20.00');
  await expect(stat(page, 'Troco a devolver')).toHaveText(brl(510));
  await expect(finish).toBeEnabled();
  const { dialog } = await finishSale(page);
  await expect(dialog.getByRole('status')).toHaveText(/^Troco: R\$\s5,10$/);
  await expect(dialog.getByText(/^Pix: R\$\s20,00$/)).toBeVisible();
  await expect(dialog.getByText(/Dinheiro: R\$\s14,90 · entregue R\$\s20,00/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Fechar janela' }).click();
  expect(await cashExpected(page) - cashBefore, 'só o dinheiro líquido entra no caixa').toBe(1490);
});

test('3. cancelamento em Vendas devolve estoque e caixa uma única vez', async ({ page }) => {
  const { sku, saleId } = await sellNewProduct(page, 2);
  expect((await stockOf(page, sku)).physical).toBe(8);
  const cashBefore = await cashExpected(page);

  await page.goto(`/loja/${SLUG}/vendas`);
  await page.getByRole('textbox', { name: 'Buscar registros' }).fill(saleId);
  const row = page.getByRole('row').filter({ has: page.getByRole('button', { name: `Detalhes da venda ${saleId}`, exact: true }) });
  const cancel = row.getByRole('button', { name: 'Cancelar' });
  await cancel.dblclick(); // duplo clique não pode estornar duas vezes
  await expect(row.locator('td[data-label="Status"]')).toHaveText('Cancelada');
  await expect(cancel).toBeDisabled();

  expect((await stockOf(page, sku)).physical).toBe(10);
  await page.getByRole('button', { name: 'Movimentações', exact: true }).click();
  await page.getByRole('textbox', { name: 'Buscar registros' }).fill(saleId);
  await expect(page.getByRole('row').filter({ hasText: 'Estorno' })).toHaveCount(1);
  expect(await cashExpected(page) - cashBefore).toBe(-5000);

  await page.reload();
  expect(await cashExpected(page) - cashBefore).toBe(-5000);
  expect((await stockOf(page, sku)).physical).toBe(10);
  await page.goto(`/loja/${SLUG}/financeiro`);
  await page.getByRole('textbox', { name: 'Buscar registros' }).fill(`Estorno da venda ${saleId}`);
  await expect(page.getByRole('row').filter({ hasText: `Estorno da venda ${saleId}` })).toHaveCount(1);
});

test('4. compra: pedido → receber → estoque sobe e conta a pagar é criada', async ({ page }) => {
  const sku = 'PRE-0005', product = 'Vela de ignição NGK'; // custo R$ 22,50
  const before = (await stockOf(page, sku)).physical;
  const title = `Compra E2E ${unique()}`;
  await page.goto(`/loja/${SLUG}/compras`);
  await page.getByRole('button', { name: 'Novo registro' }).click();
  const dialog = page.getByRole('dialog', { name: 'Cadastro de compra' });
  await dialog.getByLabel('Título / nome').fill(title);
  await dialog.getByLabel('Fornecedor').selectOption({ label: 'Distribuidora Eixo Sul (DEMO)' });
  await dialog.getByLabel('Previsão de recebimento').fill('2099-01-10');
  await dialog.getByLabel('Vencimento').fill('2099-02-10');
  const picker = dialog.getByLabel('Produto para adicionar');
  await picker.selectOption(await picker.locator('option', { hasText: product }).getAttribute('value') ?? '');
  await dialog.getByRole('button', { name: 'Adicionar item' }).click();
  await dialog.getByLabel(`Quantidade de ${product}`).fill('5');
  await dialog.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(dialog).toBeHidden();

  const status = page.getByRole('combobox', { name: `Status de ${title}` });
  await expect(status).toHaveValue('Pendente');
  await status.selectOption('Recebida');
  await expect(status).toHaveValue('Recebida');
  await expect(status).toBeDisabled();

  expect((await stockOf(page, sku)).physical).toBe(before + 5);
  await page.goto(`/loja/${SLUG}/contas-pagar`);
  await page.getByRole('textbox', { name: 'Buscar registros' }).fill(title);
  const row = page.getByRole('row').filter({ hasText: title });
  await expect(row).toHaveCount(1);
  await expect(row.locator('td[data-label="Original"]')).toHaveText(brl(11250));
  await expect(row.locator('td[data-label="Situação"]')).toHaveText('Em aberto');
  await expect(row.locator('td[data-label="Tipo"]')).toHaveText('Pagar');
});

test('5. oficina: orçamento → aprovar → OS (sem duplicar) → Pronta com reserva e consumo', async ({ page }) => {
  const sku = 'PRE-0006', product = 'Correia dentada';
  const before = await stockOf(page, sku);
  const title = `Revisão E2E ${unique()}`;
  await page.goto(`/loja/${SLUG}/orcamentos`);
  await page.getByRole('button', { name: 'Novo registro' }).click();
  const dialog = page.getByRole('dialog', { name: 'Cadastro de orçamento' });
  await dialog.getByLabel('Título / nome').fill(title);
  await dialog.getByLabel('Cliente', { exact: true }).selectOption({ label: 'Ana Martins' });
  await dialog.getByLabel('Válido até').fill('2099-12-31');
  await dialog.getByLabel('Mão de obra (R$)').fill('50,00');
  const picker = dialog.getByLabel('Produto para adicionar');
  await picker.selectOption(await picker.locator('option', { hasText: product }).getAttribute('value') ?? '');
  await dialog.getByRole('button', { name: 'Adicionar item' }).click();
  await dialog.getByLabel(`Quantidade de ${product}`).fill('2');
  await dialog.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(dialog).toBeHidden();

  const quoteStatus = page.getByRole('combobox', { name: `Status de ${title}` });
  await quoteStatus.selectOption('Aprovado');
  await expect(quoteStatus).toHaveValue('Aprovado');
  const row = page.getByRole('row').filter({ hasText: title });
  await row.getByRole('button', { name: 'Converter' }).dblclick(); // 2 conversões não podem gerar 2 OS
  await expect(quoteStatus).toHaveValue('Convertido');
  await expect(row.getByRole('button', { name: 'Converter' })).toHaveCount(0);

  await page.goto(`/loja/${SLUG}/ordens-servico`);
  const osStatus = page.getByRole('combobox', { name: `Status de ${title}` });
  await expect(osStatus).toHaveCount(1);
  await expect(osStatus).toHaveValue('Aberta');
  for (const next of ['Em diagnóstico', 'Em execução']) { await osStatus.selectOption(next); await expect(osStatus).toHaveValue(next); }
  expect(await stockOf(page, sku), 'Em execução reserva sem baixar o físico').toEqual({ physical: before.physical, reserved: before.reserved + 2, available: before.available - 2 });

  await page.goto(`/loja/${SLUG}/ordens-servico`);
  for (const next of ['Em testes', 'Pronta']) { await osStatus.selectOption(next); await expect(osStatus).toHaveValue(next); }
  expect(await stockOf(page, sku), 'Pronta consome a reserva').toEqual({ physical: before.physical - 2, reserved: before.reserved, available: before.available - 2 });

  await page.goto(`/loja/${SLUG}/contas-receber`);
  await page.getByRole('textbox', { name: 'Buscar registros' }).fill(title);
  await expect(page.getByRole('row').filter({ hasText: title }).locator('td[data-label="Original"]')).toHaveText(brl(2 * 12990 + 5000));
});

test('6. financeiro: baixas parciais, quitação, estorno e baixa acima do saldo', async ({ page }) => {
  const description = `Receber E2E ${unique()}`;
  await page.goto(`/loja/${SLUG}/contas-receber`);
  await page.getByRole('button', { name: 'Novo lançamento' }).click();
  const form = page.getByRole('dialog', { name: 'Lançamento financeiro' });
  await expect(form.getByLabel('Tipo')).toHaveValue('Receita');
  await form.getByLabel('Descrição').fill(description);
  await form.getByLabel('Categoria').fill('Serviços');
  await form.getByLabel('Valor (R$)').fill('1000,00');
  await form.getByLabel('Vencimento').fill('2099-12-31');
  await form.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(form).toBeHidden();

  await page.getByRole('combobox', { name: 'Situação' }).selectOption({ label: 'Todas' });
  await page.getByRole('textbox', { name: 'Buscar registros' }).fill(description);
  const row = page.getByRole('row').filter({ hasText: description });
  const cell = (label: string) => row.locator(`td[data-label="${label}"]`);
  await expect(cell('Situação')).toHaveText('Em aberto');
  await expect(cell('Saldo')).toHaveText(brl(100000));

  const settle = async (amount: string) => {
    await row.getByRole('button', { name: 'Receber', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Registrar recebimento' });
    await dialog.getByLabel('Valor da baixa (R$)').fill(amount);
    return dialog;
  };
  let dialog = await settle('300');
  await dialog.getByRole('button', { name: 'Confirmar baixa' }).click();
  await expect(dialog).toBeHidden();
  await expect(cell('Situação')).toHaveText('Parcialmente pago');
  await expect(cell('Saldo')).toHaveText(brl(70000));

  dialog = await settle('800');
  await expect(dialog.getByText(/Valor acima do saldo de R\$\s700,00\./)).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Confirmar baixa' })).toBeDisabled();
  await dialog.getByLabel('Valor da baixa (R$)').fill('700');
  await dialog.getByRole('button', { name: 'Confirmar baixa' }).click();
  await expect(dialog).toBeHidden();
  await expect(cell('Situação')).toHaveText('Quitado');
  await expect(cell('Saldo')).toHaveText(brl(0));
  await expect(row.getByRole('button', { name: 'Receber', exact: true })).toBeDisabled();

  await row.getByRole('button', { name: `Histórico de ${description}` }).click();
  const history = page.getByRole('dialog', { name: 'Histórico de baixas' });
  await history.getByLabel('Motivo (estorno ou cancelamento)').fill('Cheque devolvido (E2E)');
  await history.getByRole('button', { name: 'Estornar baixa' }).first().click();
  await expect(history.getByText('Estornada')).toHaveCount(1);
  await expect(history.getByRole('button', { name: 'Estornar baixa' })).toHaveCount(1);
  await history.getByRole('button', { name: 'Fechar janela' }).click();
  await expect(cell('Situação')).toHaveText('Parcialmente pago');
  await expect(cell('Saldo')).toHaveText(brl(30000));

  dialog = await settle('300,01');
  await expect(dialog.getByText(/Valor acima do saldo de R\$\s300,00\./)).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Confirmar baixa' })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Cancelar' }).click();

  await page.reload();
  await page.getByRole('combobox', { name: 'Situação' }).selectOption({ label: 'Todas' });
  await page.getByRole('textbox', { name: 'Buscar registros' }).fill(description);
  await expect(cell('Situação')).toHaveText('Parcialmente pago');
  await expect(cell('Pago')).toHaveText(brl(70000));
});

test('7. fechamento de caixa com diferença exige motivo e entra no histórico', async ({ page }) => {
  await page.goto(`/loja/${SLUG}/caixa`);
  const withDifference = Number(await stat(page, 'Fechamentos com diferença').innerText());
  await page.getByRole('button', { name: 'Fechar caixa' }).click();
  const dialog = page.getByRole('dialog', { name: 'Fechar caixa' });
  const expected = toCents(await dialog.locator('.stat').filter({ hasText: 'Esperado' }).locator('strong').innerText());
  await dialog.getByLabel('Dinheiro contado (R$)').fill(reais(expected - 500));
  await expect(dialog.locator('.stat').filter({ hasText: 'Diferença' }).locator('strong')).toHaveText(/-R\$\s5,00/);
  const reason = dialog.getByLabel('Motivo da diferença');
  await expect(reason).toHaveAttribute('required', '');
  await dialog.getByRole('button', { name: 'Confirmar' }).click();
  await expect(dialog).toBeVisible();
  expect(await reason.evaluate((input: HTMLInputElement) => input.validity.valueMissing)).toBe(true);
  await expect(page.getByRole('button', { name: 'Fechar caixa', includeHidden: true })).toBeVisible(); // Modal torna o conteúdo de fundo aria-hidden.

  const text = `Falta de troco E2E ${unique()}`;
  await reason.fill(text);
  await dialog.getByRole('button', { name: 'Confirmar' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('Caixa fechado. Abra um caixa para operar vendas em dinheiro.')).toBeVisible();
  const row = page.getByRole('row').filter({ hasText: text });
  await expect(row).toHaveCount(1);
  await expect(row.locator('td[data-label="Diferença"]')).toHaveText(/Falta R\$\s5,00/);
  await expect(row.locator('td[data-label="Contado"]')).toHaveText(brl(expected - 500));
  await expect(stat(page, 'Fechamentos com diferença')).toHaveText(String(withDifference + 1));
  await page.reload();
  await expect(page.getByRole('row').filter({ hasText: text })).toHaveCount(1);
});

test('8. multi-tenant: produto criado em moto-prime não aparece em auto-center', async ({ page }) => {
  const sku = `E2E-${unique()}`, name = `Produto isolado ${sku}`;
  await createProduct(page, SLUG, name, sku, '1.00', '2.00');
  await page.getByRole('textbox', { name: 'Nome, SKU, código de barras ou marca' }).fill(sku);
  await expect(page.getByRole('button', { name: `${name} ${sku}` })).toBeVisible();
  await page.goto('/loja/auto-center/produtos');
  await expect(page.locator('.store-identity')).toContainText('Auto Center Peças');
  await page.getByRole('textbox', { name: 'Nome, SKU, código de barras ou marca' }).fill(sku);
  await expect(page.getByText('Nenhum produto encontrado. Cadastre um produto ou ajuste os filtros.')).toBeVisible();
  await page.goto('/loja/auto-center/pdv');
  await page.getByRole('textbox', { name: 'Nome, SKU ou código de barras' }).fill(sku);
  await expect(page.getByText(name)).toHaveCount(0);
  await page.goto('/loja/auto-center/estoque');
  await page.getByRole('button', { name: 'Movimentar', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Movimentar estoque' }).getByLabel('Produto').locator('option', { hasText: name })).toHaveCount(0);
});

test('9. permissão: Mecânico não vê/acessa Financeiro nem o botão de excluir produto', async ({ page }) => {
  await page.goto(`/loja/${SLUG}/produtos`);
  await expect(page.getByRole('button', { name: 'Excluir Filtro de óleo PSL55' })).toBeVisible(); // Proprietário vê
  await page.getByRole('button', { name: 'Menu da conta' }).click();
  await page.getByLabel('Papel demonstrativo').selectOption('Mecânico');
  await expect(page.locator('.account-button')).toContainText('Mecânico');
  await expect(page.getByRole('link', { name: 'Financeiro', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Contas a receber', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Produtos', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Excluir / })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Novo produto' })).toBeDisabled();
  await page.goto(`/loja/${SLUG}/financeiro`); // papel persiste no reload; guard continua valendo
  await expect(page.getByText('Acesso não permitido')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Financeiro' })).toHaveCount(0);
});
