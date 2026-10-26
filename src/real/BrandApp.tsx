import { useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import type { Session as AuthSession } from '@supabase/supabase-js';
import { supabase } from './client';
import { signIn } from './auth';

type PublicApp = { slug: string; tenantName: string; name: string; shortName: string; themeColor: string; backgroundColor: string; icons: Record<string, string>; version: number };

/** Troca manifest, ícones, título e cor da barra pelos da empresa (mesmo service worker, mesma origem). */
export function applyBrandHead(app: PublicApp) {
  const set = (selector: string, make: () => HTMLElement, attr: string, value: string) => { const el = document.head.querySelector<HTMLElement>(selector) ?? document.head.appendChild(make()); el.setAttribute(attr, value); };
  const link = (rel: string) => () => Object.assign(document.createElement('link'), { rel });
  const meta = (name: string) => () => Object.assign(document.createElement('meta'), { name });
  const asset = (a: string) => `/api/tenant-app?slug=${app.slug}&asset=${a}&v=${app.version}`;
  set('link[rel="manifest"]', link('manifest'), 'href', asset('manifest'));
  document.head.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]').forEach(el => el.remove());
  set('link[rel="icon"]', link('icon'), 'href', asset('favicon'));
  set('link[rel="apple-touch-icon"]', link('apple-touch-icon'), 'href', asset('apple'));
  set('meta[name="theme-color"]', meta('theme-color'), 'content', app.themeColor);
  set('meta[name="apple-mobile-web-app-title"]', meta('apple-mobile-web-app-title'), 'content', app.shortName);
  document.title = app.name;
}

/** Entrada do aplicativo da empresa: /app/m/<slug>. Logado e membro → abre a loja; senão, login com a marca. */
export default function BrandApp() {
  const { slug = '' } = useParams(); const navigate = useNavigate();
  const [app, setApp] = useState<PublicApp | null | 'missing'>(null), [auth, setAuth] = useState<AuthSession | null | undefined>(undefined);
  const [error, setError] = useState(''), [pending, setPending] = useState(false);
  useEffect(() => {
    let alive = true;
    void supabase.rpc('tenant_app_public', { p_slug: slug }).then(({ data, error }) => { if (!alive) return; if (error || !data) { setApp('missing'); return; } setApp(data as PublicApp); applyBrandHead(data as PublicApp); });
    void supabase.auth.getSession().then(({ data }) => alive && setAuth(data.session));
    return () => { alive = false; };
  }, [slug]);
  if (app === 'missing') return <Navigate to="/login" replace/>;
  if (!app || auth === undefined) return <main className="brand-login" role="status">Carregando…</main>;
  // Sessão existente: a própria loja revalida membership (RLS); quem não é membro vê "acesso revogado" lá.
  if (auth) return <Navigate to={`/loja/${app.slug}/dashboard`} replace/>;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (pending) return; const form = new FormData(event.currentTarget);
    setPending(true); setError('');
    try { await signIn(String(form.get('email') ?? ''), String(form.get('password') ?? '')); navigate(`/loja/${(app as PublicApp).slug}/dashboard`, { replace: true }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível entrar.'); } finally { setPending(false); }
  }
  return <main className="brand-login" style={{ '--app-bg': app.backgroundColor, '--app-theme': app.themeColor } as CSSProperties}>
    <div className="brand-login-card"><img src={app.icons['192']} alt={app.tenantName}/><h1>{app.name}</h1><p className="muted">Entre com a conta que {app.tenantName} cadastrou para você.</p>
      <form className="stack" onSubmit={submit}><label className="field">E-mail<input name="email" type="email" autoComplete="email" required maxLength={254}/></label>
        <label className="field">Senha<input name="password" type="password" autoComplete="current-password" required maxLength={128}/></label>
        {error && <p role="alert">{error}</p>}<button className="btn primary" disabled={pending}>{pending ? 'Aguarde…' : 'Entrar'}</button></form>
      <a href="/app/recuperar">Esqueci a senha</a><p className="brand-login-foot">Tecnologia PISTEC</p></div></main>;
}
