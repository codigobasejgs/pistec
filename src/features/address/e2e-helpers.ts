import { expect, type Page } from '@playwright/test';

/** Abre o cadastro da landing e avança até a etapa Endereço. */
export async function toAddressStep(page: Page) {
  await page.goto('/cadastro');
  const next = () => page.getByRole('button', { name: /Continuar/ }).click();
  await page.getByLabel('Seu nome').fill('Teste CEP'); await page.getByLabel('E-mail').fill('cep@exemplo.example'); await next();
  await page.getByLabel('Nome fantasia').fill('Oficina CEP'); await page.getByLabel('Razão social').fill('Oficina CEP Ltda'); await page.getByLabel('CPF / CNPJ fictício').fill('12345678000199'); await next();
  await expect(page.getByRole('heading', { name: 'Endereço' })).toBeVisible();
}
