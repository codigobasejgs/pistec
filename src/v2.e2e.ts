import { expect, test } from '@playwright/test';

test('sessão demo (empresa, perfil e filial) sobrevive ao reload; sair limpa', async ({ page }) => {
  await page.goto('/demonstracao');
  const option = page.getByLabel('Empresa').locator('option', { hasText: 'Oficina Rota 88' });
  await page.getByLabel('Empresa').selectOption(await option.getAttribute('value') ?? '');
  await page.getByLabel('Perfil de acesso').selectOption('Vendedor');
  await page.getByRole('button', { name: /Explorar empresa/ }).click();
  await expect(page).toHaveURL(/oficina-rota-88\/dashboard/);
  await page.reload();
  await expect(page.locator('.account-button')).toContainText('Vendedor');
  await expect(page).toHaveURL(/oficina-rota-88/);
  // Vendedor não acessa financeiro: guard continua valendo após o reload.
  await page.goto('/loja/oficina-rota-88/financeiro');
  await expect(page.getByText('Acesso não permitido')).toBeVisible();
  await page.getByRole('button', { name: 'Menu da conta' }).click();
  await page.getByRole('link', { name: /Sair da demonstração/ }).click();
  await page.goto('/loja/moto-prime/dashboard');
  await expect(page.locator('.account-button')).toContainText('Proprietário');
});

test('tour destaca o elemento real e navega por passos', async ({ page }) => {
  await page.goto('/loja/moto-prime/dashboard');
  await page.getByRole('button', { name: 'Menu da conta' }).click();
  await page.getByRole('button', { name: /Tour guiado/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Tour guiado' });
  await expect(dialog).toBeVisible();
  await expect(page.locator('.tour-spotlight')).toBeVisible();
  await expect(dialog).toContainText('PASSO 1 DE');
  await dialog.getByRole('button', { name: 'Avançar' }).click();
  await expect(dialog).toContainText('PASSO 2 DE');
  await expect(dialog).toContainText('Busca universal');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

const widths = [320, 360, 375, 390, 430, 600, 768, 820, 1024, 1280, 1366, 1440, 1920, 2560];
const routes = ['/', '/planos', '/cadastro', '/loja/moto-prime/dashboard', '/loja/moto-prime/pdv', '/loja/moto-prime/produtos', '/loja/moto-prime/ordens-servico', '/loja/moto-prime/crm', '/loja/moto-prime/agenda', '/loja/moto-prime/whatsapp', '/loja/moto-prime/financeiro', '/loja/moto-prime/contas-receber', '/loja/moto-prime/caixa', '/loja/moto-prime/relatorios', '/loja/moto-prime/personalizacao', '/loja/moto-prime/minha-assinatura'];
for (const width of widths) {
  test(`sem rolagem horizontal da página em ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    for (const route of routes) {
      await page.goto(route); await page.waitForLoadState('networkidle');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      expect(overflow, `${route} @ ${width}px`).toBeLessThanOrEqual(1);
    }
    expect(errors).toEqual([]);
  });
}
