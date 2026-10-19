import { expect, test } from '@playwright/test';

test('demonstração não consulta Supabase nem provedores e não inicializa sessão real', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (/supabase|infinitepay|resend|generativelanguage|api\.tubaraoemprestimo/i.test(url.hostname)) requests.push(`${request.method()} ${url.origin}${url.pathname}`);
  });
  await page.route(/supabase|infinitepay|resend|generativelanguage|api\.tubaraoemprestimo/i, route => route.abort());
  for (const path of ['/demonstracao', '/loja/moto-prime/dashboard', '/loja/moto-prime/produtos', '/loja/moto-prime/pdv', '/loja/moto-prime/financeiro', '/loja/moto-prime/whatsapp']) {
    await page.goto(path);
    await expect(page.locator('h1').first()).toBeVisible();
    if (path !== '/demonstracao') await expect(page.getByRole('button', { name: 'Ambiente demonstrativo: saiba mais' })).toBeVisible();
  }
  expect(requests).toEqual([]);
  expect(await page.evaluate(() => localStorage.getItem('pistec-real-auth'))).toBeNull();
  expect(await page.evaluate(() => performance.getEntriesByType('resource').map(r => r.name).some(name => /\/src\/real\//.test(name)))).toBe(false);
});
