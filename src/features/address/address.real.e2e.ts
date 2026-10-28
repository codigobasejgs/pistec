import { expect, test } from '@playwright/test';
import { toAddressStep } from './e2e-helpers';

// Consultas REAIS (sem interceptação) ao ViaCEP e à BrasilAPI.
// Neste ambiente a saída para a internet passa pelo SOCKS local (o mesmo do real.e2e.ts); sem ele o teste é pulado.
test.use({ launchOptions: { proxy: { server: process.env.E2E_PROXY ?? 'socks5://127.0.0.1:1080', bypass: 'localhost,127.0.0.1' } } });
test('consulta REAL ao ViaCEP (sem interceptação) preenche 01001-000', async ({ page }) => {
  const online = await page.evaluate(() => fetch('https://viacep.com.br/ws/01001000/json/', { signal: AbortSignal.timeout(8000) }).then(r => r.ok, () => false)).catch(() => false);
  test.skip(!online, 'Sem acesso à internet neste ambiente.');
  await toAddressStep(page);
  await page.getByLabel('CEP').fill('01001-000');
  await expect(page.getByLabel('Logradouro')).toHaveValue('Praça da Sé', { timeout: 10000 });
  await expect(page.getByLabel('Cidade')).toHaveValue('São Paulo');
  await expect(page.getByLabel('UF')).toHaveValue('SP');
});

test('BrasilAPI REAL responde o mesmo CEP (fallback disponível)', async ({ page }) => {
  await page.goto('/');
  const r = await page.evaluate(() => fetch('https://brasilapi.com.br/api/cep/v2/01001000', { signal: AbortSignal.timeout(8000) }).then(x => x.ok ? x.json() : null, () => null));
  test.skip(!r, 'Sem acesso à internet neste ambiente.');
  expect(r).toMatchObject({ cep: '01001000', city: 'São Paulo', state: 'SP' });
});
