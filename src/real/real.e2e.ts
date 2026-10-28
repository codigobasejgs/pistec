// E2E do ambiente real contra o projeto Supabase autorizado.
// Cria conta temporária isolada, executa operações reais pela UI e remove a conta e os dados no finally.
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const env = Object.fromEntries(readFileSync('.env.local','utf8').split(/\r?\n/).filter(l=>/^[A-Z_]+=/.test(l)).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1).trim()]));
test.use({ launchOptions: { proxy: { server: 'socks5://127.0.0.1:1080', bypass: 'localhost,127.0.0.1' } } });
const headers = { apikey: env.SUPABASE_SECRET_KEY, Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`, 'Content-Type': 'application/json' };
async function admin(path: string, method: string, body?: unknown) {
  const response = await fetch(`${env.VITE_SUPABASE_URL}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (!response.ok) throw new Error(`HTTP ${response.status} em ${path}: ${await response.text()}`);
  return response.status === 204 ? null : response.json().catch(() => null);
}

test('ambiente real: login, onboarding, produto, estoque, caixa, venda e financeiro', async ({ page }) => {
  test.setTimeout(120000);
  const id = randomBytes(6).toString('hex');
  const email = `e2e-${id}@smoke.invalid`, password = `PistecE2E-${randomBytes(9).toString('base64url')}!9`;
  const created = await admin('/auth/v1/admin/users', 'POST', { email, password, email_confirm: true, user_metadata: { name: 'Operador E2E' } });
  const userId = String(created.id);
  try {
    await page.goto('/app/login');
    await page.getByLabel('E-mail').fill(email);
    await page.getByLabel('Senha').fill(password);
    await page.getByRole('button', { name: 'Entrar na sua conta' }).click();
    await expect(page.getByRole('heading', { name: 'Minhas empresas' })).toBeVisible();
    expect(await page.evaluate(() => indexedDB.databases())).toEqual([]);

    await page.getByRole('link', { name: 'Cadastrar empresa' }).click();
    const companyName = `Oficina Real ${id}`;
    await page.getByLabel('Nome fantasia').fill(companyName);
    await page.getByLabel('Razão social').fill(`${companyName} LTDA`);
    await page.getByLabel('Responsável').fill('Operador E2E');
    await page.getByLabel('CNPJ').fill('12345678000199');
    // Endereço pelo CEP real (ViaCEP via proxy) e persistência no Supabase.
    await page.getByLabel('CEP').fill('01001-000');
    await expect(page.getByLabel('Logradouro')).toHaveValue('Praça da Sé', { timeout: 15000 });
    await page.getByLabel('Número').fill('100');
    await page.getByLabel('Plano').selectOption('premium');
    await page.getByRole('button', { name: 'Criar empresa' }).click();
    await page.getByRole('link', { name: companyName }).click();
    const [saved] = await admin(`/rest/v1/tenants?select=address,address_data&name=eq.${encodeURIComponent(companyName)}`, 'GET') as { address: string; address_data: Record<string, string> }[];
    expect(saved.address).toBe('Praça da Sé, 100, Sé, São Paulo/SP, CEP 01001-000');
    expect(saved.address_data).toMatchObject({ zip: '01001000', number: '100', city: 'São Paulo', state: 'SP' });
    await expect(page.getByText('AMBIENTE REAL', { exact: true })).toBeVisible();

    await page.getByRole('link', { name: 'Produtos', exact: true }).click();
    await page.getByRole('button', { name: 'Novo produto' }).click();
    await page.getByRole('textbox', { name: 'Nome' }).fill('Pastilha de freio E2E');
    await page.getByRole('textbox', { name: 'SKU' }).fill(`E2E-${id}`);
    await page.getByRole('textbox', { name: 'Custo (R$)' }).fill('40,00');
    await page.getByRole('textbox', { name: 'Preço (R$)' }).fill('100,00');
    await page.getByRole('button', { name: 'Salvar' }).click();
    await expect(page.getByRole('button', { name: 'Editar Pastilha de freio E2E' })).toBeVisible();

    await page.getByRole('link', { name: 'Estoque', exact: true }).click();
    await page.getByRole('button', { name: 'Movimentar' }).click();
    await page.getByRole('combobox', { name: 'Produto' }).selectOption({ index: 1 });
    await page.getByRole('spinbutton', { name: 'Quantidade' }).fill('5');
    await page.getByRole('textbox', { name: 'Referência / motivo' }).fill(`NF-${id}`);
    await page.getByRole('button', { name: 'Confirmar' }).click();
    await expect(page.getByRole('cell', { name: '5' }).first()).toBeVisible();

    await page.getByRole('link', { name: 'PDV', exact: true }).click();
    await page.getByRole('button', { name: 'Abrir caixa' }).click();
    await page.getByRole('textbox', { name: 'Fundo de abertura (R$)' }).fill('50,00');
    await page.getByRole('dialog', { name: 'Abrir caixa' }).getByRole('button', { name: 'Abrir caixa' }).click();
    await page.getByRole('button', { name: 'Adicionar', exact: true }).click();
    await page.getByRole('button', { name: /^Cobrar/ }).click();
    await page.getByRole('textbox', { name: 'Valor do pagamento 1 (R$)', exact: true }).fill('100,00');
    await page.getByRole('button', { name: 'Finalizar venda' }).click();
    await expect(page.getByRole('dialog', { name: 'Venda concluída' })).toBeVisible();
    await page.getByRole('button', { name: 'Fechar janela' }).click();

    await page.locator('summary', { hasText: 'Gestão' }).click();
    await page.getByRole('link', { name: 'Financeiro', exact: true }).click();
    await expect(page.getByRole('cell', { name: 'Quitado' }).first()).toBeVisible();
    await page.reload();
    await expect(page.getByRole('cell', { name: 'Quitado' }).first()).toBeVisible();
  } finally {
    const tenants = (await admin(`/rest/v1/tenants?select=id&created_by=eq.${userId}`, 'GET')) as { id: string }[] | null;
    for (const tenant of tenants ?? []) {
      for (const table of ['sales', 'financial_entries', 'records', 'stock_movements', 'cash_registers', 'products', 'customers']) {
        await admin(`/rest/v1/${table}?tenant_id=eq.${tenant.id}`, 'DELETE');
      }
      await admin(`/rest/v1/tenants?id=eq.${tenant.id}`, 'DELETE');
    }
    await admin(`/auth/v1/admin/users/${userId}`, 'DELETE');
  }
});
