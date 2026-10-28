import { expect, test } from '@playwright/test';
import minuta from '../../../supabase/functions/_shared/contracts/minuta-2026-1.json' with { type: 'json' };

// Termos públicos simulados: versão ainda em rascunho (estado real até a aprovação jurídica).
const terms = { code: minuta.code, title: minuta.body.title, status: 'draft', publishedAt: null, body: minuta.body,
  provider: { legal_name: '59.760.458 MARCO ANTONIO BOGGIAN', document: '59.760.458/0001-91', legal_nature: 'Empresário Individual', brand: 'PISTEC', address: 'Rua Jacques Pilon, 189, Vila Piauí, São Paulo/SP, CEP 05109-160' } };

test.beforeEach(async ({ page }) => {
  await page.route(/\/rest\/v1\/rpc\/contract_public_terms/, r => r.fulfill({ json: terms }));
});

test('landing → /contrato: dados oficiais da contratada, aviso de minuta e termos sem variáveis cruas', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Contrato', exact: true }).first().click();
  await expect(page).toHaveURL(/\/contrato$/);
  await expect(page.getByRole('heading', { name: 'Contrato de Prestação de Serviços', level: 1 })).toBeVisible();
  await expect(page.getByText('59.760.458/0001-91')).toBeVisible();
  await expect(page.getByText('Empresário Individual')).toBeVisible();
  await expect(page.getByText('Minuta em revisão jurídica.')).toBeVisible();
  await page.getByText(/Ler o texto da minuta completo/).click();
  const text = await page.locator('.pub-contract-terms').innerText();
  expect(text).toContain('59.760.458 MARCO ANTONIO BOGGIAN');
  expect(text).not.toMatch(/\{\{\w+\}\}/);
  await expect(page.getByRole('link', { name: 'Iniciar contratação' })).toHaveAttribute('href', '/app/contratar');
  await expect(page.getByRole('link', { name: 'Contrato de Prestação de Serviços' })).toBeVisible();
});

test('planos oferecem contratação digital e /contrato não estoura em 320px', async ({ page }) => {
  await page.goto('/planos');
  await expect(page.getByRole('link', { name: 'Contratar com contrato digital' }).first()).toHaveAttribute('href', /^\/app\/contratar\/[a-z0-9-]+$/);
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto('/contrato');
  await page.getByText(/Ler o texto da minuta completo/).click();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('/app/contratar sem login leva ao login preservando o destino', async ({ page }) => {
  await page.goto('/app/contratar/profissional');
  await expect(page).toHaveURL(/\/app\/login\?next=%2Fcontratar%2Fprofissional|\/app\/login\?next=\/contratar\/profissional/);
});
