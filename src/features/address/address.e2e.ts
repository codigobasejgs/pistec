import { expect, test, type Page, type Route } from '@playwright/test';
import { toAddressStep } from './e2e-helpers';

// Cenários determinísticos interceptam os provedores (respostas reais gravadas em 28/10/2026).
// A prova de conectividade real (sem interceptação) está em address.real.e2e.ts.
const SE = { cep: '01001-000', logradouro: 'Praça da Sé', complemento: 'lado ímpar', bairro: 'Sé', localidade: 'São Paulo', uf: 'SP', ibge: '3550308' };
const PAULISTA = { cep: '01310-100', logradouro: 'Avenida Paulista', complemento: 'de 612 a 1510 - lado par', bairro: 'Bela Vista', localidade: 'São Paulo', uf: 'SP', ibge: '3550308' };
const GENERIC = { cep: '78175-000', logradouro: '', complemento: '', bairro: '', localidade: 'Poconé', uf: 'MT', ibge: '5106505' };

const viacep = (page: Page, handler: (cep: string, route: Route) => Promise<void> | void) =>
  page.route(/viacep\.com\.br\/ws\/\d{8}\/json\//, route => handler(route.request().url().match(/ws\/(\d{8})/)![1], route));
const status = (page: Page) => page.locator('.address-status');

test('consulta automática sem clicar: preenche, foca no número, botão sem "(simulado)"', async ({ page }) => {
  const calls: string[] = [];
  await viacep(page, (cep, r) => { calls.push(cep); return r.fulfill({ json: SE }); });
  await toAddressStep(page);
  await expect(page.getByRole('button', { name: /simulado/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Consultar endereço' })).toBeVisible();
  await page.getByLabel('CEP').pressSequentially('01001000', { delay: 20 });
  await expect(page.getByLabel('CEP')).toHaveValue('01001-000');
  await expect(status(page)).toHaveText('Endereço localizado! Confira os dados e informe o número.');
  await expect(page.getByLabel('Logradouro')).toHaveValue('Praça da Sé');
  await expect(page.getByLabel('Bairro')).toHaveValue('Sé');
  await expect(page.getByLabel('Cidade')).toHaveValue('São Paulo');
  await expect(page.getByLabel('UF')).toHaveValue('SP');
  await expect(page.getByLabel('Número')).toHaveValue('');
  await expect(page.getByLabel('Complemento (opcional)')).toHaveValue('');
  await expect(page.getByLabel('Número')).toBeFocused();
  expect(calls).toEqual(['01001000']); // uma consulta só, com 8 dígitos
});

test('CEP incompleto não consulta; inexistente mostra erro sem inventar endereço', async ({ page }) => {
  const calls: string[] = [];
  await viacep(page, (cep, r) => { calls.push(cep); return r.fulfill({ json: { erro: 'true' } }); });
  await page.route(/brasilapi\.com\.br/, r => r.fulfill({ json: { cep: '99999999', city: 'Sarandi', state: 'PR', street: 'Avenida das Torres', neighborhood: 'Centro' } }));
  await toAddressStep(page);
  await page.getByLabel('CEP').fill('01001'); await page.getByLabel('Número').click();
  await expect(status(page)).toHaveText('Informe um CEP com 8 números.');
  await page.waitForTimeout(700); expect(calls).toEqual([]);
  await page.getByLabel('CEP').fill('99999-999');
  await expect(status(page)).toHaveText('Não encontramos este CEP. Confira os números informados.');
  await expect(page.getByLabel('Logradouro')).toHaveValue('');
  await expect(page.getByLabel('Cidade')).toHaveValue('');
  await page.getByRole('button', { name: /Continuar/ }).click();
  await expect(page.getByText('Informe o logradouro.')).toBeVisible(); // não avança com endereço vazio
});

test('ViaCEP fora do ar usa BrasilAPI; os dois fora do ar liberam preenchimento manual', async ({ page }) => {
  let brasil = 'ok';
  await viacep(page, (_cep, r) => r.abort('failed'));
  await page.route(/brasilapi\.com\.br\/api\/cep\/v2\/\d{8}/, r => brasil === 'ok'
    ? r.fulfill({ json: { cep: '01001000', state: 'SP', city: 'São Paulo', neighborhood: 'Sé', street: 'Praça da Sé', service: 'open-cep' } }) : r.abort('failed'));
  await toAddressStep(page);
  await page.getByLabel('CEP').fill('01001000');
  await expect(page.getByLabel('Logradouro')).toHaveValue('Praça da Sé');
  brasil = 'down';
  await page.getByLabel('CEP').fill('01310100');
  await expect(status(page)).toHaveText('Não foi possível consultar o CEP agora. Tente novamente ou preencha o endereço manualmente.');
  // manual: os campos continuam editáveis e o cadastro segue
  await page.getByLabel('Logradouro').fill('Avenida Paulista'); await page.getByLabel('Número').fill('1000');
  await page.getByLabel('Bairro').fill('Bela Vista'); await page.getByLabel('Cidade').fill('São Paulo'); await page.getByLabel('UF').selectOption('SP');
  await page.getByRole('button', { name: /Continuar/ }).click();
  await expect(page.getByRole('heading', { name: 'Plano' })).toBeVisible();
});

test('CEP trocado durante a consulta: resposta antiga não sobrescreve a nova', async ({ page }) => {
  await viacep(page, async (cep, r) => {
    if (cep === '01001000') { await new Promise(res => setTimeout(res, 1500)); return r.fulfill({ json: SE }).catch(() => undefined); }
    return r.fulfill({ json: PAULISTA });
  });
  await toAddressStep(page);
  await page.getByLabel('CEP').fill('01001000');
  await expect(status(page)).toHaveText('Consultando CEP…');
  await page.getByLabel('CEP').fill('01310100');
  await expect(page.getByLabel('Logradouro')).toHaveValue('Avenida Paulista');
  await page.waitForTimeout(1600);
  await expect(page.getByLabel('Logradouro')).toHaveValue('Avenida Paulista');
  await expect(page.getByLabel('CEP')).toHaveValue('01310-100');
});

test('número, complemento e correção manual são preservados em nova consulta', async ({ page }) => {
  await viacep(page, (cep, r) => r.fulfill({ json: cep === '01001000' ? SE : PAULISTA }));
  await toAddressStep(page);
  await page.getByLabel('CEP').fill('01001000');
  await expect(page.getByLabel('Logradouro')).toHaveValue('Praça da Sé');
  await page.getByLabel('Número').fill('42'); await page.getByLabel('Complemento (opcional)').fill('Fundos');
  await page.getByRole('button', { name: 'Consultar endereço' }).click();
  await expect(page.getByLabel('Número')).toHaveValue('42');
  await expect(page.getByLabel('Complemento (opcional)')).toHaveValue('Fundos');
  // correção manual do logradouro: novo CEP não troca sem perguntar
  await page.getByLabel('Logradouro').fill('Praça da Sé, Galeria');
  await page.getByLabel('CEP').fill('01310100');
  await expect(page.getByRole('group', { name: 'Endereço sugerido pelo CEP' })).toContainText('Avenida Paulista');
  await expect(page.getByLabel('Logradouro')).toHaveValue('Praça da Sé, Galeria');
  await expect(page.getByLabel('Bairro')).toHaveValue('Bela Vista'); // bairro veio da consulta anterior: atualizado
  await page.getByRole('button', { name: 'Usar endereço do CEP' }).click();
  await expect(page.getByLabel('Logradouro')).toHaveValue('Avenida Paulista');
  await expect(page.getByLabel('Número')).toHaveValue('42');
  // voltar e avançar mantém os dados
  await page.getByRole('button', { name: /Continuar/ }).click();
  await page.getByRole('button', { name: 'Voltar' }).click();
  await expect(page.getByLabel('Número')).toHaveValue('42');
  await expect(page.getByLabel('Logradouro')).toHaveValue('Avenida Paulista');
});

test('CEP genérico preenche só cidade/UF e foca no logradouro; 320px sem rolagem lateral', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 }); // tela pequena (≈ teclado virtual aberto)
  await viacep(page, (_cep, r) => r.fulfill({ json: GENERIC }));
  await toAddressStep(page);
  await page.getByLabel('CEP').fill('78175000');
  await expect(status(page)).toHaveText('Localizamos a cidade e o estado. Complete as demais informações do endereço.');
  await expect(page.getByLabel('Cidade')).toHaveValue('Poconé');
  await expect(page.getByLabel('UF')).toHaveValue('MT');
  await expect(page.getByLabel('Logradouro')).toHaveValue('');
  await expect(page.getByLabel('Bairro')).toHaveValue('');
  await expect(page.getByLabel('Logradouro')).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  for (const label of ['CEP', 'Logradouro', 'Número', 'Bairro', 'Cidade', 'UF']) {
    const box = await page.getByLabel(label).boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(320);
  }
});
