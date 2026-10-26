import { expect, test } from 'vitest';
import { manifestFor, resolve, type PublicApp } from './tenant-app';

const png = 'data:image/png;base64,' + btoa('PNG');
const appA: PublicApp = { slug: 'loja-a', tenantName: 'Loja A', name: 'Loja A Peças', shortName: 'Loja A', themeColor: '#123456', backgroundColor: '#ffffff', icons: { 192: png, 512: png, maskable: png, apple: png, favicon: png }, version: 3 };
const fake = (rows: Record<string, PublicApp>) => (async (_: unknown, init?: RequestInit) => new Response(JSON.stringify(rows[JSON.parse(String(init?.body)).p_slug] ?? null))) as typeof fetch;
const env = { url: 'https://x.supabase.co', key: 'pub', fetchImpl: fake({ 'loja-a': appA, 'loja-b': { ...appA, slug: 'loja-b', name: 'Oficina B', tenantName: 'Oficina B' } }) };

test('manifest por empresa: id estável, start_url e escopo do app, ícones versionados', () => {
  const m = manifestFor(appA);
  expect(m).toMatchObject({ id: '/app/m/loja-a', start_url: '/app/m/loja-a', scope: '/app/', name: 'Loja A Peças', short_name: 'Loja A', display: 'standalone', theme_color: '#123456' });
  expect(m.icons.map(i => i.src)).toContain('/api/tenant-app?slug=loja-a&asset=maskable&v=3');
  expect(m.icons.find(i => i.purpose === 'maskable')).toBeTruthy();
});

test('empresas A e B recebem manifests diferentes; slug inválido, asset desconhecido e app inexistente são recusados', async () => {
  const a = JSON.parse(String((await resolve({ slug: 'loja-a' }, env)).body)), b = JSON.parse(String((await resolve({ slug: 'loja-b' }, env)).body));
  expect(a.name).toBe('Loja A Peças'); expect(b.name).toBe('Oficina B'); expect(a.id).not.toBe(b.id);
  expect((await resolve({ slug: '../x' }, env)).status).toBe(400);
  expect((await resolve({ slug: 'loja-a', asset: 'logo.svg' }, env)).status).toBe(400);
  expect((await resolve({ slug: 'nao-existe' }, env)).status).toBe(404);
  const icon = await resolve({ slug: 'loja-a', asset: '192' }, env);
  expect(icon).toMatchObject({ status: 200, type: 'image/png' });
  expect(new TextDecoder().decode(icon.body as Uint8Array)).toBe('PNG');
});
