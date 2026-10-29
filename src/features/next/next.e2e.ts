import { expect, test } from '@playwright/test';

// PISTEC NEXT na demonstração (IndexedDB). Fluxos reais com Supabase estão em supabase/tests/next.test.ts.
const SLUG = 'moto-prime';
test.beforeEach(({ page }) => { page.on('dialog', d => void d.accept()); });

/** Cadastra veículo pela tela Veículos e devolve cliente e placa. */
async function vehicle(page: import('@playwright/test').Page, type: 'Carro' | 'Moto') {
  const plate = `ABC${Math.floor(Math.random() * 10)}D${String(Math.floor(Math.random() * 90) + 10)}`;
  await page.goto(`/loja/${SLUG}/veiculos`);
  await page.getByRole('button', { name: 'Novo registro' }).click();
  const d = page.getByRole('dialog');
  await d.getByLabel('Título / nome').fill(`${type} teste`);
  const customer = d.getByLabel('Cliente', { exact: true }); await customer.selectOption({ index: 1 });
  const name = (await customer.locator('option:checked').textContent())!;
  await d.getByLabel('Tipo', { exact: true }).selectOption(type);
  await d.getByLabel('Placa').fill(plate);
  await d.getByLabel('Marca').fill('Honda'); await d.getByLabel('Modelo').fill('CG'); await d.getByLabel('Ano').fill('2020');
  await d.getByRole('button', { name: 'Salvar' }).click();
  await expect(d).toBeHidden();
  return { name, plate };
}

test('AutoPilot abre com indicadores e regras; menu traz os novos módulos', async ({ page }) => {
  await page.goto(`/loja/${SLUG}/autopilot`);
  await expect(page.getByRole('heading', { name: 'PISTEC AutoPilot' })).toBeVisible();
  await expect(page.locator('[data-tour="autopilot-kpis"] .stat')).toHaveCount(4);
  for (const label of ['AutoPilot', 'Check-in 360°', 'Moto Express', 'Estoque inteligente', 'Cotações', 'Lucro por OS', 'Fideliza (revisões)', 'Frotas'])
    await expect(page.locator('nav[aria-label="Módulos da loja"] a', { hasText: label })).toHaveCount(1);
  await page.getByRole('button', { name: 'Regras' }).click();
  await page.getByLabel('Orçamento sem resposta após (dias)').fill('5');
  await page.getByRole('button', { name: 'Salvar regras' }).click();
  await expect(page.getByText(/Orçamento sem resposta após \(dias\) = 5/)).toBeVisible();
});

test('check-in 360° cria a OS com checklist e confere a placa', async ({ page }) => {
  const { name, plate } = await vehicle(page, 'Carro');
  await page.goto(`/loja/${SLUG}/checkin`);
  await page.getByRole('combobox', { name: 'Cliente', exact: true }).selectOption({ label: name.trim() });
  await page.getByRole('combobox', { name: 'Veículo', exact: true }).selectOption({ label: `Carro teste · ${plate}` });
  await page.getByLabel('Confirme a placa').fill('XXX0X00');
  await page.getByRole('spinbutton', { name: 'Quilometragem', exact: true }).fill('99999');
  await page.getByLabel('Técnico responsável').fill('Rui');
  await page.getByLabel('Previsão de entrega').fill('2099-01-01');
  await page.getByLabel('Relato do cliente').fill('Barulho ao frear');
  await page.getByLabel(/Atendimento rápido/).check();
  await page.getByLabel('Pneus dianteiros: estado').selectOption('Atenção');
  await page.getByRole('button', { name: 'Registrar entrada' }).click();
  await expect(page.getByText('A placa conferida não corresponde ao veículo.')).toBeVisible();
  await page.getByLabel('Confirme a placa').fill(plate);
  await page.getByRole('button', { name: 'Registrar entrada' }).click();
  await expect(page).toHaveURL(/ordens-servico\?q=/);
  await expect(page.getByText(plate).first()).toBeVisible();
});

test('Moto Express: pacote da loja gera OS normal', async ({ page }) => {
  const { name, plate } = await vehicle(page, 'Moto');
  await page.goto(`/loja/${SLUG}/moto-express`);
  await page.getByRole('button', { name: 'Gerenciar pacotes' }).click();
  await page.getByRole('button', { name: 'Novo pacote' }).click();
  await page.getByLabel('Nome', { exact: true }).fill('Troca de óleo');
  await page.getByRole('combobox', { name: 'Peça do pacote' }).selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Adicionar', exact: true }).click();
  await page.getByRole('button', { name: 'Salvar pacotes' }).click();
  await page.getByRole('button', { name: 'Fechar pacotes' }).click();
  await page.getByRole('combobox', { name: 'Cliente', exact: true }).selectOption({ label: name.trim() });
  await page.getByRole('combobox', { name: 'Moto', exact: true }).selectOption({ label: `Moto teste · ${plate}` });
  await page.getByLabel('Quilometragem').fill('12000');
  await page.getByLabel('Técnico').fill('Rui');
  await page.getByRole('radio', { name: 'Troca de óleo' }).click();
  await expect(page.getByText(/Total: R\$/)).toBeVisible();
  await page.getByRole('button', { name: 'Abrir atendimento' }).click();
  await expect(page).toHaveURL(/mecanico/);
  await expect(page.getByLabel('Ordem de serviço')).toContainText('Express · Troca de óleo');
});

test('Estoque inteligente e Lucro por OS carregam com fórmulas explícitas; mobile sem rolagem lateral', async ({ page }) => {
  await page.goto(`/loja/${SLUG}/estoque-inteligente`);
  await expect(page.getByText(/Ponto de reposição = demanda média/)).toBeVisible();
  await page.goto(`/loja/${SLUG}/lucro-os`);
  await expect(page.getByText(/Não é lucro líquido/).first()).toBeVisible();
  await page.setViewportSize({ width: 360, height: 780 });
  for (const path of ['autopilot', 'checkin', 'moto-express', 'mecanico', 'fideliza', 'estoque-inteligente', 'lucro-os']) {
    await page.goto(`/loja/${SLUG}/${path}`);
    await expect(page.locator('main h1').first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), path).toBeLessThanOrEqual(1);
  }
});

test('perfil Mecânico vê execução mas não Lucro por OS', async ({ page }) => {
  await page.goto(`/loja/${SLUG}/dashboard`);
  await page.getByRole('button', { name: 'Menu da conta' }).click();
  await page.getByLabel('Papel demonstrativo').selectOption('Mecânico');
  const nav = page.getByRole('navigation', { name: 'Módulos da loja' });
  await expect(nav.getByRole('link', { name: 'Mecânico (execução)' })).toHaveCount(1);
  await expect(nav.getByRole('link', { name: 'Lucro por OS' })).toHaveCount(0);
  await page.goto(`/loja/${SLUG}/lucro-os`);
  await expect(page.getByText('Acesso não permitido')).toBeVisible();
});
