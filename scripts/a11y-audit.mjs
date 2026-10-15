// Auditoria automatizada parcial; requer o servidor local ativo. Não altera dados de usuários.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const base = process.env.BASE ?? 'http://127.0.0.1:5173';
const viewport = { width: 1440, height: 900 };
const tags = ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'];
const erp = '/loja/moto-prime/';
const scenarios = [
  ...['/', '/planos', '/cadastro'].map(path => ({ path, theme: 'public' })),
  ...['dashboard', 'produtos', 'pdv', 'financeiro', 'clientes', 'ordens-servico', 'whatsapp', 'personalizacao', 'ajuda'].map(route => ({ path: erp + route, theme: 'dark' })),
  ...['dashboard', 'produtos'].map(route => ({ path: erp + route, theme: 'light' })),
  ...['dark', 'light'].map(theme => ({ path: erp + 'produtos', theme, modal: 'Novo produto' })),
];
assert.equal(new Set(scenarios.map(s => JSON.stringify(s))).size, scenarios.length);
const output = new URL('../docs/evidence/a11y.json', import.meta.url);
await mkdir(new URL('.', output), { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const evidence = {
  startedAt: new Date().toISOString(), base, browser: 'Google Chrome', browserVersion: browser.version(),
  viewport, tags, tenant: 'moto-prime', expectedScenarios: scenarios.length,
  limitations: ['Auditoria automatizada parcial, não certifica conformidade WCAG completa.', 'Sem leitor de tela ou hardware físico.', 'Desktop; demais viewports, estados interativos e fluxos completos não cobertos.'],
  scans: [],
};
try {
  for (const scenario of scenarios) {
    // Cada cenário usa IndexedDB/cookies isolados; troca de tema afeta apenas esta sessão descartável.
    const context = await browser.newContext({ viewport, locale: 'pt-BR', colorScheme: scenario.theme === 'light' ? 'light' : 'dark', serviceWorkers: 'block' });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    const scan = { ...scenario, requestedUrl: new URL(scenario.path, base).href, viewport, startedAt: new Date().toISOString() };
    try {
      const response = await page.goto(scan.requestedUrl, { waitUntil: 'domcontentloaded' });
      assert(response?.ok(), `HTTP ${response?.status()}`);
      const heading = page.locator('h1').first();
      await heading.waitFor({ state: 'visible' });
      await page.locator('.skeleton-page').waitFor({ state: 'detached' });
      scan.heading = await heading.innerText();
      assert(!/404|não foi possível|indisponível|não encontrada|não permitido|Assinatura suspensa/i.test(scan.heading), `Tela inesperada: ${scan.heading}`);
      assert.equal(new URL(page.url()).pathname, scenario.path, 'Redirecionamento inesperado');
      if (scenario.theme !== 'public') {
        const shell = page.locator('.app-shell');
        if (await shell.getAttribute('data-theme') !== scenario.theme) {
          await page.getByRole('button', { name: scenario.theme === 'light' ? 'Ativar tema claro' : 'Ativar tema escuro', exact: true }).click();
        }
        await page.locator(`.app-shell[data-theme="${scenario.theme}"]`).waitFor({ state: 'visible' });
        scan.actualTheme = await shell.getAttribute('data-theme');
      }
      if (scenario.modal) {
        await page.getByRole('button', { name: scenario.modal, exact: true }).click();
        await page.getByRole('dialog', { name: scenario.modal, exact: true }).waitFor({ state: 'visible' });
      }
      await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})));
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      });
      scan.url = page.url();
      scan.result = await new AxeBuilder({ page }).withTags(tags).analyze();
      scan.violations = scan.result.violations;
      scan.status = 'completed';
      console.log(JSON.stringify({ path: scenario.path, theme: scenario.theme, modal: scenario.modal ?? null, violations: scan.violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, target: v.nodes[0]?.target })), incomplete: scan.result.incomplete.length }));
    } catch (error) {
      scan.status = 'error';
      scan.url = page.url();
      scan.error = error.stack ?? String(error);
      console.error(JSON.stringify({ ...scenario, error: scan.error }));
    } finally {
      scan.finishedAt = new Date().toISOString();
      evidence.scans.push(scan);
      await writeFile(output, JSON.stringify(evidence, null, 2) + '\n');
      await context.close();
    }
  }
} finally {
  evidence.finishedAt = new Date().toISOString();
  evidence.completedScenarios = evidence.scans.filter(s => s.status === 'completed').length;
  evidence.violationInstances = evidence.scans.reduce((sum, scan) => sum + (scan.violations?.length ?? 0), 0);
  evidence.affectedNodeInstances = evidence.scans.reduce((sum, scan) => sum + (scan.violations?.reduce((n, v) => n + v.nodes.length, 0) ?? 0), 0);
  await writeFile(output, JSON.stringify(evidence, null, 2) + '\n');
  await browser.close();
}
console.log(JSON.stringify({ completed: evidence.completedScenarios, expected: scenarios.length, violations: evidence.violationInstances, nodes: evidence.affectedNodeInstances }));
// 2 = erro de execução/cobertura; 1 = violações detectadas; 0 = sem violações automatizadas.
process.exitCode = evidence.completedScenarios !== scenarios.length ? 2 : evidence.violationInstances ? 1 : 0;
