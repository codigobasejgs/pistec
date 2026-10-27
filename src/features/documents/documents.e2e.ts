import { expect, test } from '@playwright/test';

test('venda → documento: prévia com marca e aviso não fiscal, troca de papel, PDF baixado, sem enviar na demo', async ({ page }) => {
  await page.goto('/loja/moto-prime/pdv');
  await expect(page.getByRole('heading', { name: 'Frente de caixa' })).toBeVisible();
  await page.getByRole('button', { name: 'Adicionar', exact: true }).first().click();
  await page.getByRole('button', { name: /^Cobrar/ }).click();
  await page.getByRole('button', { name: 'Completar', exact: true }).click();
  await page.getByRole('button', { name: 'Finalizar venda' }).click();
  await expect(page.getByRole('dialog', { name: 'Venda concluída' })).toBeVisible();
  await page.getByRole('button', { name: /Imprimir · WhatsApp · E-mail · PDF/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Documento' });
  await expect(dialog).toBeVisible();
  const preview = dialog.frameLocator('iframe.doc-preview');
  await expect(preview.getByText('Moto Prime Peças', { exact: true })).toBeVisible();
  await expect(preview.getByText('Comprovante de venda')).toBeVisible();
  await expect(preview.getByText(/DOCUMENTO NÃO FISCAL/)).toBeVisible();
  await dialog.getByLabel('Papel').selectOption('a4');
  await expect(dialog.locator('iframe.doc-preview')).toHaveAttribute('srcdoc', /size:210mm 297mm/);
  const [pdf] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: 'PDF', exact: true }).click()]);
  expect(pdf.suggestedFilename()).toMatch(/^DEMO-.*\.pdf$/);
  await dialog.getByRole('button', { name: 'WhatsApp', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Enviar', exact: true })).toBeDisabled();
});

test('central de impressão: assistente salva impressora da estação; etiquetas geram prévia e ZPL', async ({ page }) => {
  await page.goto('/loja/moto-prime/impressao');
  await expect(page.getByRole('heading', { name: 'Impressão e documentos' })).toBeVisible();
  await page.getByRole('button', { name: 'Configurar impressora' }).click();
  await page.getByRole('button', { name: /Térmica de cupom/ }).click();
  for (let i = 0; i < 2; i++) await page.getByRole('button', { name: 'Avançar' }).click();
  await page.getByLabel('Nome para identificar').fill('Caixa 01');
  await page.getByRole('button', { name: 'Avançar' }).click();
  await page.getByRole('button', { name: /Bobina 58 mm/ }).click();
  await page.getByRole('button', { name: 'Avançar' }).click();
  await expect(page.frameLocator('iframe[title="Prévia da página de teste"]').getByText('Página de teste de impressão')).toBeVisible();
  await page.getByRole('button', { name: 'Avançar' }).click();
  await page.getByRole('button', { name: 'Ficou cortada' }).click();
  await expect(page.getByText(/Cortou:/)).toBeVisible();
  await page.getByRole('button', { name: 'Avançar' }).click();
  await page.getByRole('button', { name: 'Salvar impressora' }).click();
  await expect(page.getByText('Caixa 01', { exact: true })).toBeVisible();
  await expect(page.getByText(/Bobina 58 mm · Navegador/)).toBeVisible();

  await page.getByRole('button', { name: 'Etiquetas', exact: true }).click();
  await page.getByRole('spinbutton', { name: /Quantidade de etiquetas de/ }).first().fill('3');
  await expect(page.getByRole('button', { name: 'Imprimir 3 etiqueta(s)' })).toBeEnabled();
  await expect(page.frameLocator('iframe[title="Prévia das etiquetas"]').locator('.lb')).toHaveCount(3);
  const [zpl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'ZPL', exact: true }).click()]);
  expect(zpl.suggestedFilename()).toBe('etiquetas.zpl');
});

test('ordem de serviço: documentos de oficina com dados do registro; celular sem rolagem lateral', async ({ page }) => {
  await page.goto('/loja/moto-prime/ordens-servico');
  await expect(page.getByRole('heading', { name: 'Ordens de serviço' })).toBeVisible();
  await page.getByRole('button', { name: 'Tabela', exact: true }).click();
  await page.getByRole('button', { name: /^Detalhes de / }).first().click();
  await page.getByRole('button', { name: 'Documentos e impressão' }).click();
  const dialog = page.getByRole('dialog', { name: 'Documento' });
  await expect(dialog.frameLocator('iframe.doc-preview').getByText('Ordem de serviço — entrada')).toBeVisible();
  await dialog.getByLabel('Documento').selectOption('warranty');
  await expect(dialog.frameLocator('iframe.doc-preview').getByText(/Código de Defesa do Consumidor/)).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/loja/moto-prime/impressao');
  await expect(page.getByRole('heading', { name: 'Impressão e documentos' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
});
