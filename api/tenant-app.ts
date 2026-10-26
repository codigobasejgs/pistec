// Vercel Function: manifest e ícones do aplicativo personalizado de cada empresa, na MESMA origem do PISTEC
// (o navegador só instala um PWA cujo manifest/start_url são da origem do app).
// GET /api/tenant-app?slug=<slug>&asset=manifest|192|512|maskable|apple|favicon
// Dados vêm da RPC pública tenant_app_public (só identidade visual de apps ativos; nunca dados da loja).

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const ICONS = ['192', '512', 'maskable', 'apple', 'favicon'];

export type PublicApp = { slug: string; tenantName: string; name: string; shortName: string; themeColor: string; backgroundColor: string; icons: Record<string, string>; version: number };
type Out = { status: number; type: string; body: string | Uint8Array; cache?: string };

export function manifestFor(app: PublicApp) {
  const base = `/app/m/${app.slug}`;
  const icon = (asset: string, sizes: string, purpose?: string) => ({ src: `/api/tenant-app?slug=${app.slug}&asset=${asset}&v=${app.version}`, sizes, type: 'image/png', ...(purpose ? { purpose } : {}) });
  return {
    id: base, name: app.name, short_name: app.shortName, description: `Aplicativo de ${app.tenantName}`, lang: 'pt-BR', dir: 'ltr',
    start_url: base, scope: '/app/', display: 'standalone', orientation: 'any',
    theme_color: app.themeColor, background_color: app.backgroundColor, categories: ['business', 'productivity'],
    icons: [icon('192', '192x192'), icon('512', '512x512'), icon('maskable', '512x512', 'maskable'), icon('apple', '180x180')],
  };
}

export async function resolve(query: Record<string, unknown>, { url, key, fetchImpl = fetch }: { url?: string; key?: string; fetchImpl?: typeof fetch }): Promise<Out> {
  const slug = String(query.slug ?? ''), asset = String(query.asset ?? 'manifest');
  if (!SLUG.test(slug) || slug.length > 60 || (asset !== 'manifest' && !ICONS.includes(asset))) return { status: 400, type: 'application/json', body: JSON.stringify({ error: 'Parâmetros inválidos.' }) };
  if (!url || !key) return { status: 503, type: 'application/json', body: JSON.stringify({ error: 'Configuração ausente.' }) };
  const r = await fetchImpl(`${url}/rest/v1/rpc/tenant_app_public`, { method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_slug: slug }), signal: AbortSignal.timeout(8000) });
  if (!r.ok) return { status: 502, type: 'application/json', body: JSON.stringify({ error: 'Serviço indisponível.' }) };
  const app = await r.json() as PublicApp | null;
  if (!app) return { status: 404, type: 'application/json', body: JSON.stringify({ error: 'Aplicativo não encontrado.' }) };
  if (asset === 'manifest') return { status: 200, type: 'application/manifest+json', body: JSON.stringify(manifestFor(app)), cache: 'public, max-age=300' };
  const data = String(app.icons?.[asset] ?? '');
  if (!data.startsWith('data:image/png;base64,')) return { status: 404, type: 'application/json', body: JSON.stringify({ error: 'Ícone ausente.' }) };
  // ?v=<versão> muda a cada publicação: o ícone pode ficar em cache por mais tempo.
  return { status: 200, type: 'image/png', body: Uint8Array.from(atob(data.slice(22)), c => c.charCodeAt(0)), cache: 'public, max-age=86400' };
}

type Res = { statusCode: number; setHeader(name: string, value: string): void; end(body?: string | Uint8Array): void };
export default async function handler(req: { query?: Record<string, unknown> }, res: Res) {
  const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
  try {
    const out = await resolve(req.query ?? {}, { url: env.VITE_SUPABASE_URL, key: env.VITE_SUPABASE_PUBLISHABLE_KEY });
    res.statusCode = out.status; res.setHeader('Content-Type', out.type); res.setHeader('Cache-Control', out.cache ?? 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(out.body);
  } catch {
    res.statusCode = 502; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ error: 'Falha ao gerar o aplicativo.' }));
  }
}
