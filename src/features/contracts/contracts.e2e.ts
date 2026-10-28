import { expect, test, type Page } from '@playwright/test';
import minuta from '../../../supabase/functions/_shared/contracts/minuta-2026-1.json' with { type: 'json' };

// Respostas do Supabase interceptadas (catálogo e minuta em rascunho, como em produção hoje). Sem login.
const provider = { legalName: '59.760.458 MARCO ANTONIO BOGGIAN', document: '59.760.458/0001-91', legalNature: 'Empresário Individual', brand: 'PISTEC', address: 'Rua Jacques Pilon, 189, Vila Piauí, São Paulo/SP, CEP 05109-160', email: 'marco.boggian@gmail.com', phone: '(11) 3621-8304' };
const plans = [
  { id: 'essencial', name: 'Essencial', monthly: 12900, quarterly: 34900, annual: 123900, trialDays: 14, users: 2, branches: 1, products: 500, whatsapp: 1, aiMessages: 0, features: ['PDV e caixa'], modules: [] },
  { id: 'profissional', name: 'Profissional', monthly: 24900, quarterly: 66900, annual: 238900, trialDays: 14, users: 5, branches: 1, products: 5000, whatsapp: 2, aiMessages: 30, features: ['Ordens de serviço'], modules: [] },
  { id: 'premium', name: 'Premium', monthly: 44900, quarterly: 120900, annual: 430900, trialDays: 14, users: 15, branches: 3, products: 20000, whatsapp: 5, aiMessages: 200, features: ['Múltiplas filiais'], modules: ['*'] },
];
async function mockBackend(page: Page) {
  await page.route(/\/rest\/v1\/rpc\/contract_catalog/, r => r.fulfill({ json: { plans, provider, version: null, draft: { code: minuta.code, title: minuta.body.title, status: 'draft' } } }));
  await page.route(/\/rest\/v1\/rpc\/contract_public_terms/, r => r.fulfill({ json: { code: minuta.code, title: minuta.body.title, status: 'draft', body: minuta.body } }));
}

test('menu e rodapé sem aba "Contrato"; /contrato antigo leva a /planos', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: 'Navegação principal' }).getByRole('link', { name: 'Contrato', exact: true })).toHaveCount(0);
  await expect(page.locator('footer').getByRole('link', { name: /Contrato/ })).toHaveCount(0);
  await expect(page.locator('footer').getByRole('link', { name: 'Termos de uso' })).toBeVisible();
  await page.goto('/contrato');
  await expect(page).toHaveURL(/\/planos$/);
});

test('/planos inicia a contratação com o plano e a periodicidade escolhidos', async ({ page }) => {
  await page.goto('/planos');
  await page.getByRole('button', { name: 'Anual' }).click();
  const premium = page.getByRole('link', { name: 'Contratar Premium' });
  await expect(premium).toHaveAttribute('href', '/app/contratar/premium?periodo=annual');
  await expect(page.getByRole('link', { name: /Contratar Enterprise/ })).toHaveCount(0); // sob proposta: consultor
  await expect(page.getByRole('link', { name: 'Falar com consultor' })).toBeVisible();
});

for (const [id, name, period, label, value] of [['essencial', 'Essencial', 'monthly', 'Mensal', 'R$ 129,00'], ['profissional', 'Profissional', 'quarterly', 'Trimestral', 'R$ 669,00'], ['premium', 'Premium', 'annual', 'Anual', 'R$ 4.309,00']] as const) {
  test(`sem login: ${name} ${label} mostra resumo, limites e condições antes de qualquer cadastro`, async ({ page }) => {
    await mockBackend(page);
    await page.goto(`/app/contratar/${id}?periodo=${period}`);
    await expect(page.getByRole('heading', { name: `${name} · ${label}` })).toBeVisible();
    await expect(page.locator('.hire-chosen .hire-price').first()).toContainText(value);
    await expect(page.getByRole('button', { name: new RegExp(`^${label} ·`) })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('region', { name: 'Condições do contrato' })).toContainText('Cancelamento');
    await expect(page.getByRole('region', { name: 'Condições do contrato' })).toContainText('59.760.458/0001-91');
    await expect(page.getByText(/Contratação digital ainda não liberada/)).toBeVisible(); // minuta em revisão: não esconde
    await page.getByText(/Ler o texto da minuta/).click();
    expect(await page.locator('.hire-terms-full').innerText()).not.toMatch(/\{\{\w+\}\}/);
    await expect(page.getByRole('link', { name: 'Entrar e continuar' })).toHaveAttribute('href', `/app/login?next=${encodeURIComponent(`/contratar/${id}?periodo=${period}`)}`);
    // o plano escolhido fica guardado para depois do login/confirmação de e-mail
    expect(await page.evaluate(() => localStorage.getItem('pistec-hire-intent'))).toBe(`/contratar/${id}?periodo=${period}`);
  });
}

test('trocar periodicidade dentro da contratação atualiza valor e URL', async ({ page }) => {
  await mockBackend(page);
  await page.goto('/app/contratar/profissional?periodo=monthly');
  await page.getByRole('button', { name: /^Anual ·/ }).click();
  await expect(page).toHaveURL(/\/app\/contratar\/profissional\?periodo=annual$/);
  await expect(page.getByRole('heading', { name: 'Profissional · Anual' })).toBeVisible();
  await expect(page.locator('.hire-chosen .hire-price').first()).toContainText('R$ 2.389,00');
});

test('Enterprise (sob proposta) não abre contratação online', async ({ page }) => {
  await mockBackend(page);
  await page.goto('/app/contratar/enterprise');
  await expect(page.getByText(/não está disponível para contratação online/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Falar com consultor' })).toBeVisible();
});

for (const width of [320, 390, 768, 1366]) {
  test(`contratação sem rolagem lateral em ${width}px`, async ({ page }) => {
    await mockBackend(page);
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/app/contratar/premium?periodo=annual');
    await expect(page.getByRole('heading', { name: 'Premium · Anual' })).toBeVisible();
    await page.getByText(/Ler o texto da minuta/).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });
}
