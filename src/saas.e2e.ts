import { expect, test } from '@playwright/test';

test('onboarding cria empresa em teste e ela aparece na demonstração', async ({ page }) => {
  await page.goto('/cadastro?plano=profissional&periodo=quarterly');
  const next = () => page.getByRole('button', { name: /Continuar/ }).click();
  await page.getByLabel('Seu nome').fill('Teste E2E'); await page.getByLabel('E-mail').fill('e2e@exemplo.example'); await next();
  await page.getByLabel('Nome fantasia').fill('Oficina E2E'); await page.getByLabel('Razão social').fill('Oficina E2E Ltda'); await page.getByLabel('CPF / CNPJ fictício').fill('12345678000199'); await next();
  // CEP determinístico no teste (resposta real do ViaCEP gravada); a consulta real é verificada em address.e2e.ts.
  await page.route('https://viacep.com.br/ws/01001000/json/', r => r.fulfill({ json: { cep: '01001-000', logradouro: 'Praça da Sé', complemento: 'lado ímpar', bairro: 'Sé', localidade: 'São Paulo', uf: 'SP', ibge: '3550308' } }));
  await page.getByLabel('CEP').fill('01001000');
  await expect(page.getByText('Endereço localizado! Confira os dados e informe o número.')).toBeVisible();
  await expect(page.getByLabel('Número')).toBeFocused();
  await page.getByLabel('Número').fill('100'); await next();
  await next(); await next();
  await expect(page.getByText('R$ 669,00')).toBeVisible(); // trimestral Profissional
  await page.getByRole('checkbox').check(); await page.getByRole('button', { name: /Criar empresa demonstrativa/ }).click();
  await expect(page).toHaveURL(/\/loja\/oficina-e2e\/dashboard/);
  await expect(page.locator('main h1')).toContainText('Olá, Teste');
  await page.goto('/demonstracao');
  await expect(page.getByLabel('Empresa').locator('option', { hasText: 'Oficina E2E' })).toHaveCount(1);
});

test('tema e marca isolados por empresa; papel sem permissão é bloqueado', async ({ page }) => {
  await page.goto('/loja/moto-prime/dashboard');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Ativar tema claro' }).click();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-theme', 'light');
  await page.goto('/loja/auto-center/dashboard');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-theme', 'dark');
  await page.reload(); await page.goto('/loja/moto-prime/dashboard');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-theme', 'light'); // persistido no IndexedDB
  await page.getByRole('button', { name: 'Menu da conta' }).click();
  await page.getByLabel('Papel demonstrativo').selectOption('Mecânico');
  // Sessão demo vive em memória (sem auth real): navegar sem recarregar.
  await expect(page.getByRole('link', { name: 'Financeiro', exact: true })).toHaveCount(0);
  await page.evaluate(() => { history.pushState({}, '', '/loja/moto-prime/financeiro'); dispatchEvent(new PopStateEvent('popstate')); });
  await expect(page.getByText('Acesso não permitido')).toBeVisible();
});

test('Super Admin não existe na demonstração: /admin leva ao login real', async ({ page }) => {
  await page.route(/supabase/, route => route.abort()); // não toca o servidor real
  await page.goto('/admin/empresas');
  await expect(page).toHaveURL(/\/app\/(admin|login)/);
  await page.goto('/demonstracao');
  await expect(page.getByRole('button', { name: /Super Admin/ })).toHaveCount(0);
  // Sessão antiga gravada com admin=true não reativa nada.
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('pistec-demo-session') ?? 'null'); if (s) localStorage.setItem('pistec-demo-session', JSON.stringify({ ...s, admin: true })); });
  await page.goto('/loja/moto-prime/dashboard');
  await expect(page.locator('.account-button')).not.toContainText('Super Admin');
  await page.goto('/');
  await expect(page.getByRole('link', { name: /Testar grátis por 14 dias/ })).toBeVisible();
  await expect(page.locator('img[src="/screenshots/dashboard.webp"]').first()).toBeVisible();
});
