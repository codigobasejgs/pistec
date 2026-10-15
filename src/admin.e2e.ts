import { expect, test, type Page } from '@playwright/test';

const adminMenu = (page: Page, name: string) => page.getByRole('navigation', { name: 'Administração da plataforma' }).getByRole('link', { name, exact: true });
const brl = (cents: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);

async function enterAdmin(page: Page) {
  await page.goto('/demonstracao');
  await page.getByRole('button', { name: 'Entrar como Super Admin' }).click();
  await expect(adminMenu(page, 'Empresas')).toBeVisible();
}

async function chooseMoto(page: Page) {
  await page.getByRole('link', { name: 'Trocar empresa demo' }).click();
  const select = page.locator('label.field:has-text("Empresa") select');
  const option = select.locator('option').filter({ hasText: 'Moto Prime Peças' });
  const value = await option.getAttribute('value');
  expect(value).toBeTruthy();
  await select.selectOption(value!);
  await page.getByRole('button', { name: 'Explorar empresa' }).click();
  await expect(page).toHaveURL(/\/loja\/moto-prime\/dashboard$/);
}

async function companyStatus(page: Page, status: string) {
  await adminMenu(page, 'Empresas').click();
  await page.getByRole('button', { name: 'Moto Prime Peças', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('select[name="status"]').selectOption(status);
  await dialog.getByRole('button', { name: 'Salvar empresa' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('row').filter({ hasText: 'Moto Prime Peças' })).toContainText(status);
}

test('Super Admin: MRR e ARR têm legendas de receita contratada', async ({ page }) => {
  await enterAdmin(page);
  await expect(page.getByText('MRR contratado', { exact: true })).toBeVisible();
  await expect(page.getByText('Recorrência contratada ativa, não recebida', { exact: true })).toBeVisible();
  await expect(page.getByText('ARR contratado', { exact: true })).toBeVisible();
  await expect(page.getByText('Projeção anual (MRR × 12)', { exact: true })).toBeVisible();
});

test('suspensão bloqueia ERP; reativação preserva os produtos da empresa', async ({ page }) => {
  await enterAdmin(page);
  await chooseMoto(page);
  await page.getByRole('link', { name: 'Produtos', exact: true }).click();
  await expect(page.locator('tbody tr').first()).toBeVisible();
  const before = await page.locator('tbody tr').allTextContents();
  expect(before.length).toBeGreaterThan(0);
  await page.getByRole('link', { name: 'Trocar empresa demo' }).click();
  await page.getByRole('button', { name: 'Entrar como Super Admin' }).click();
  await companyStatus(page, 'Suspensa');
  await chooseMoto(page);
  await expect(page.getByRole('heading', { name: 'Assinatura suspensa' })).toBeVisible();
  await expect(page.getByText('Os dados continuam preservados.', { exact: false })).toBeVisible();
  await page.getByRole('link', { name: 'Produtos', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Assinatura suspensa' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Novo produto', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'Trocar empresa demo' }).click();
  await page.getByRole('button', { name: 'Entrar como Super Admin' }).click();
  await companyStatus(page, 'Ativa');
  await chooseMoto(page);
  await page.getByRole('link', { name: 'Produtos', exact: true }).click();
  await expect(page.locator('tbody tr').first()).toBeVisible();
  expect(await page.locator('tbody tr').allTextContents()).toEqual(before);
});

test('cupom 15%: R$ 211,65 Pendente; inexistente, expirado e reutilizado recusados', async ({ page }) => {
  await enterAdmin(page);
  await adminMenu(page, 'Cobranças').click();
  await page.getByRole('link', { name: 'Cupons de desconto' }).click();
  for (const [code, expired] of [['QA15', false], ['QAEXPIRADO', true]] as const) {
    await page.getByRole('button', { name: 'Novo cupom' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('input[name="code"]').fill(code);
    await dialog.locator('input[name="description"]').fill('Validação QA de 15%');
    await dialog.locator('input[name="value"]').fill('15');
    await dialog.locator('input[name="perTenant"]').fill('1');
    await dialog.locator('input[name="planIds"][value="profissional"]').check();
    await dialog.locator('input[name="periods"][value="monthly"]').check();
    if (expired) {
      await dialog.locator('input[name="startsAt"]').fill('2020-01-01');
      await dialog.locator('input[name="endsAt"]').fill('2020-01-31');
    }
    await dialog.getByRole('button', { name: 'Salvar cupom' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('cell', { name: code, exact: true })).toBeVisible();
  }
  await adminMenu(page, 'Assinaturas').click();
  const company = page.getByRole('row').filter({ hasText: 'Oficina Rota 88' });
  await company.getByRole('button', { name: 'Gerar fatura' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('select').first().selectOption('profissional');
  await dialog.locator('select').nth(1).selectOption('monthly');
  for (const [code, reason] of [['NAOEXISTEQA', 'Cupom inexistente.'], ['QAEXPIRADO', 'Cupom fora da vigência.']]) {
    await dialog.getByLabel('Cupom', { exact: false }).fill(code);
    await expect(dialog.getByRole('alert').filter({ hasText: reason })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Gerar fatura Pendente' })).toBeDisabled();
  }
  await dialog.getByLabel('Cupom', { exact: false }).fill('QA15');
  await expect(dialog.locator('.adm-quote-total')).toHaveText(/Total da faturaR\$\s*211,65/);
  await dialog.getByRole('button', { name: 'Gerar fatura Pendente' }).click();
  await expect(dialog).toBeHidden();
  await company.getByRole('button', { name: 'Gerar fatura' }).click();
  await dialog.getByLabel('Cupom', { exact: false }).fill('QA15');
  await expect(dialog.getByRole('alert').filter({ hasText: 'Limite de usos por empresa atingido.' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Gerar fatura Pendente' })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Voltar', exact: true }).click();
  await adminMenu(page, 'Cobranças').click();
  await page.getByRole('link', { name: 'Faturas SaaS' }).click();
  await page.getByLabel('Buscar', { exact: true }).fill('QA15');
  const invoice = page.getByRole('row').filter({ hasText: 'Oficina Rota 88' }).filter({ hasText: /R\$\s*211,65/ });
  await expect(invoice).toHaveCount(1);
  await expect(invoice).toContainText('Pendente');
  await expect(invoice).toContainText(brl(24900 * 0.85));
});

test('preços públicos coincidem com Admin e atualizam na mesma aba via SPA', async ({ page }) => {
  await enterAdmin(page);
  await adminMenu(page, 'Planos').click();
  const plans = [
    { name: 'Essencial', monthly: 12900, quarterly: 34900, annual: 123900 },
    { name: 'Profissional', monthly: 24900, quarterly: 66900, annual: 238900 },
    { name: 'Premium', monthly: 44900, quarterly: 120900, annual: 430900 },
    { name: 'Enterprise', monthly: 79900, quarterly: 239700, annual: 958800 },
  ];
  for (const plan of plans) {
    const row = page.getByRole('row').filter({ has: page.getByRole('cell', { name: plan.name, exact: true }) });
    for (const amount of [plan.monthly, plan.quarterly, plan.annual]) await expect(row).toContainText(brl(amount));
  }
  await page.getByRole('link', { name: 'Trocar empresa demo' }).click();
  await page.getByRole('navigation').getByRole('link', { name: 'Planos', exact: true }).click();
  for (const [period, key, months] of [['Mensal', 'monthly', 1], ['Trimestral', 'quarterly', 3], ['Anual', 'annual', 12]] as const) {
    await page.getByRole('button', { name: period, exact: true }).click();
    for (const plan of plans) {
      const card = page.getByRole('article').filter({ has: page.getByRole('heading', { name: plan.name, exact: true }) });
      if (plan.name === 'Enterprise') {
        await expect(card).toContainText('Sob consulta');
        await expect(card).toContainText(`A partir de ${brl(plan.monthly)}/mês`);
      } else {
        await expect(card.locator('.pub-price')).toContainText(brl(Math.round(plan[key] / months)));
        await expect(card).toContainText(`${brl(plan[key])} cobrados por período ${period.toLowerCase()}`);
      }
    }
  }
  await page.getByRole('navigation').getByRole('link', { name: 'Ver demonstração', exact: true }).click();
  await page.getByRole('button', { name: 'Entrar como Super Admin' }).click();
  await adminMenu(page, 'Planos').click();
  await page.getByRole('cell', { name: 'Profissional', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Mensal (R$)', { exact: true }).fill('279,00');
  await page.getByRole('button', { name: 'Salvar plano' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.getByRole('link', { name: 'Trocar empresa demo' }).click();
  await page.getByRole('navigation').getByRole('link', { name: 'Planos', exact: true }).click();
  await page.getByRole('button', { name: 'Mensal', exact: true }).click();
  const updated = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Profissional', exact: true }) });
  await expect(updated.locator('.pub-price')).toContainText(brl(27900));
  await expect(updated).toContainText(`${brl(27900)} cobrados por período mensal`);
});

test('onboarding completo a 390px chega ao dashboard', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/cadastro?plano=profissional&periodo=monthly');
  const next = () => page.getByRole('button', { name: /Continuar/ }).click();
  const fits = async () => expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByLabel('Seu nome').fill('Teste Mobile');
  await page.getByLabel('E-mail').fill('mobile@exemplo.example');
  await fits(); await next();
  await page.getByLabel('Nome fantasia').fill('Oficina Mobile QA');
  await page.getByLabel('Razão social').fill('Oficina Mobile QA Ltda');
  await page.getByLabel('CPF / CNPJ fictício').fill('12345678000199');
  await fits(); await next();
  await page.getByLabel('CEP').fill('01001000');
  await page.getByRole('button', { name: 'Consultar CEP (simulado)' }).click();
  await page.getByLabel('Número', { exact: true }).fill('100');
  await fits(); await next();
  await fits(); await next();
  await fits(); await next();
  await expect(page.getByText('Profissional · Mensal · R$ 249,00')).toBeVisible();
  await page.getByRole('checkbox').check();
  await fits();
  await page.getByRole('button', { name: /Criar empresa demonstrativa/ }).click();
  await expect(page).toHaveURL(/\/loja\/oficina-mobile-qa\/dashboard$/);
  await expect(page.locator('.dashboard-heading h1')).toContainText('Olá, Teste');
  await fits();
  await page.reload();
  await expect(page.locator('.dashboard-heading h1')).toContainText('Olá, Teste');
});

test('ajuda encontra linguagem cotidiana, normaliza acentos e abre módulos reais', async ({ page }) => {
  await page.goto('/loja/moto-prime/ajuda');
  for (const [term, module] of [
    ['vender', 'pdv'], ['troco', 'pdv'], ['peça', 'produtos'], ['abrir caixa', 'pdv'],
    ['fechar caixa', 'caixa'], ['baixa', 'financeiro'], ['importar', 'produtos'],
    ['cores', 'personalizacao'], ['funcionário', 'funcionarios'], ['plano', 'minha-assinatura'],
    ['orçamento', 'orcamentos'], ['consertar moto', 'ordens-servico'], ['FUNCIONARIO', 'funcionarios'],
  ]) {
    await page.getByLabel('Buscar ajuda').fill(term);
    const link = page.locator(`.grid.grid-3 a[href="/loja/moto-prime/${module}"]`).first();
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(new RegExp(`/loja/moto-prime/${module}$`));
    await expect(page.locator('main h1')).toBeVisible();
    await page.goBack();
    await expect(page.getByLabel('Buscar ajuda')).toBeVisible();
  }
  await page.getByLabel('Buscar ajuda').fill('inexistente-xyz');
  await expect(page.getByRole('status').filter({ hasText: 'Nenhum artigo encontrado.' })).toBeVisible();
});
