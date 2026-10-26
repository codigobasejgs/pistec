import { useEffect, useState } from 'react';
import qrcode from 'qrcode-generator';
import { AppWindow, Copy, Download, RefreshCw, Smartphone } from 'lucide-react';
import { rpc, useDemo } from '../../store';
import { can } from '../../domain';
import { Badge, Field, Panel, useNotice } from '../../ui';
import { contrast } from './Branding';
import { makeIcons, type AppIcons } from './appIcons';

type Saved = { name: string; short_name: string; theme_color: string; background_color: string; icons: AppIcons; status: string; suspended_reason: string | null; version: number };

/** "Meu Aplicativo": PWA instalável com a marca da empresa, no endereço /app/m/<slug> (mesma origem; sem domínio próprio). */
export default function MyApp({ logo, primary }: { logo: string; primary: string }) {
  const { state, session, perform, mode } = useDemo(); const notice = useNotice();
  const tenant = state.tenants.find(t => t.id === session.tenantId)!;
  const [saved, setSaved] = useState<Saved | null>(null), [loading, setLoading] = useState(mode === 'real');
  const [name, setName] = useState(tenant.name.slice(0, 45)), [shortName, setShortName] = useState(tenant.name.slice(0, 12));
  const [theme, setTheme] = useState(primary), [background, setBackground] = useState('#ffffff');
  const [icons, setIcons] = useState<AppIcons | null>(null), [pending, setPending] = useState(false);
  const allowed = can(session.role, 'personalizacao', 'editar');
  const url = `${location.origin}/app/m/${tenant.slug}`;
  useEffect(() => {
    if (mode !== 'real') return;
    let alive = true;
    // Cliente do Supabase só existe no ambiente real; import dinâmico não carrega nada na demonstração.
    void import('../../real/client').then(({ supabase }) => supabase.from('tenant_apps').select('*').eq('tenant_id', tenant.id).maybeSingle()).then(({ data }) => {
      if (!alive || !data) return; const s = data as Saved; setSaved(s); setName(s.name); setShortName(s.short_name); setTheme(s.theme_color); setBackground(s.background_color); setIcons(s.icons);
    }).catch(() => notice('Não foi possível carregar o aplicativo salvo.')).finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [mode, tenant.id, notice]);
  const generate = async () => { if (!logo) { notice('Envie o logotipo da empresa acima antes de gerar os ícones.'); return; } try { setIcons(await makeIcons(logo, background)); } catch (e) { notice((e as Error).message); } };
  const themeRatio = contrast(theme), bgRatio = contrast(background, theme);
  const publish = async () => {
    if (!icons) { notice('Gere os ícones antes de publicar.'); return; }
    if (!name.trim() || !shortName.trim()) { notice('Informe o nome e o nome curto do aplicativo.'); return; }
    setPending(true);
    try {
      const version = await perform<number>(() => { throw new Error('Na demonstração o aplicativo personalizado só pode ser visualizado. Publique pela conta real.'); },
        rpc('save_tenant_app', { p_tenant: tenant.id, p: { name: name.trim(), shortName: shortName.trim(), themeColor: theme, backgroundColor: background, icons } }));
      setSaved({ name, short_name: shortName, theme_color: theme, background_color: background, icons, status: 'active', suspended_reason: null, version });
      notice(`Aplicativo publicado (versão ${version}). Quem já instalou recebe o novo ícone quando o sistema do aparelho atualizar.`);
    } catch (e) { notice((e as Error).message); } finally { setPending(false); }
  };
  const qr = (() => { const q = qrcode(0, 'M'); q.addData(url); q.make(); return q.createDataURL(6, 2); })();
  const copy = async () => { try { await navigator.clipboard.writeText(url); notice('Link copiado.'); } catch { notice('Copie o link manualmente: ' + url); } };
  const status = saved ? (saved.status === 'suspended' ? 'Suspenso' : 'Publicado') : 'Não publicado';

  return <Panel title="Meu Aplicativo" className="my-app"><div data-tour="app-section" className="stack">
    <p className="muted">Seus clientes e sua equipe instalam o sistema com o <strong>nome e o ícone da sua empresa</strong>. É o mesmo PISTEC, com login e dados protegidos; nada é publicado em lojas de aplicativos.</p>
    <div className="toolbar"><Badge>{loading ? 'Carregando…' : status}</Badge>{saved && <span className="muted small">Versão {saved.version}</span>}{mode === 'demo' && <Badge>Somente visualização na demonstração</Badge>}</div>
    {saved?.status === 'suspended' && <p className="callout warning" role="alert">Aplicativo suspenso pela administração da plataforma{saved.suspended_reason ? `: ${saved.suspended_reason}` : ''}. Fale com o suporte.</p>}
    <div className="my-app-grid"><div className="stack">
      <div className="form-grid">
        <span data-tour="app-name"><Field label="Nome do aplicativo" hint="Aparece na instalação e na tela de abertura (até 45)."><input value={name} maxLength={45} onChange={e => setName(e.target.value)}/></Field></span>
        <span data-tour="app-short"><Field label="Nome curto" hint={`Embaixo do ícone (até 12) · ${shortName.length}/12`}><input value={shortName} maxLength={12} onChange={e => setShortName(e.target.value)}/></Field></span>
      </div>
      <div className="form-grid" data-tour="app-colors">
        <Field label="Cor do tema (barra do aplicativo)"><div className="color-field"><input type="color" aria-label="Cor do tema" value={theme} onChange={e => setTheme(e.target.value)}/><code>{theme}</code></div></Field>
        <Field label="Cor de fundo do ícone e da abertura"><div className="color-field"><input type="color" aria-label="Cor de fundo do ícone" value={background} onChange={e => { setBackground(e.target.value); setIcons(null); }}/><code>{background}</code></div></Field>
      </div>
      <p className="muted small" data-tour="app-contrast"><Badge>{themeRatio >= 4.5 ? 'Contraste AA' : themeRatio >= 3 ? 'Contraste mínimo' : 'Contraste baixo'}</Badge> Tema × texto branco {themeRatio.toFixed(1)}:1 · Fundo × tema {bgRatio.toFixed(1)}:1.{themeRatio < 3 ? ' Escolha uma cor de tema mais escura para o relógio e a bateria ficarem legíveis.' : ''}</p>
      <div className="toolbar" data-tour="app-icons"><button type="button" className="btn" onClick={() => void generate()}><RefreshCw size={15}/>Gerar ícones do logotipo</button>{!logo && <span className="muted small">Envie o logotipo em Identidade da empresa.</span>}</div>
      <p className="muted small">São gerados: 192 e 512 px, ícone adaptável (Android, com margem de segurança), ícone do iPhone (180 px, fundo sólido) e favicon. Use um logotipo quadrado de pelo menos 512 px para melhor nitidez. O logotipo oficial do PISTEC não é alterado.</p>
      <button type="button" className="btn primary" data-tour="app-publish" disabled={pending || !allowed || mode === 'demo' || saved?.status === 'suspended' || !icons} onClick={() => void publish()}><AppWindow size={16}/>{pending ? 'Publicando…' : saved ? 'Atualizar aplicativo' : 'Publicar aplicativo'}</button>
      {!allowed && <p className="muted small">Seu perfil pode visualizar, mas não publicar.</p>}
      <p className="muted small">Disponível nos planos Premium e Enterprise. O servidor confere o plano ao publicar.</p>
    </div>
    <div className="stack" data-tour="app-preview"><strong>Prévia</strong>
      <div className="app-preview-row">{icons ? <><figure><img src={icons.maskable} alt="Ícone adaptável (Android)" className="mask-circle"/><figcaption>{shortName || 'App'}</figcaption></figure><figure><img src={icons.apple} alt="Ícone do iPhone" className="mask-ios"/><figcaption>{shortName || 'App'}</figcaption></figure><figure><img src={icons['512']} alt="Ícone padrão" style={{ background }}/><figcaption>Padrão</figcaption></figure></> : <p className="muted small">Gere os ícones para ver como ficam na tela inicial.</p>}</div>
      <div className="app-splash" style={{ background }}><div className="app-splash-bar" style={{ background: theme }}/>{icons && <img src={icons['192']} alt=""/>}<span style={{ color: contrast(background, '#000000') > contrast(background, '#ffffff') ? '#0b1220' : '#ffffff' }}>{name || 'Seu aplicativo'}</span></div>
    </div></div>
    <div className="my-app-share"><div className="stack" data-tour="app-link"><strong>Link do aplicativo</strong><code className="app-url">{url}</code>
      <div className="toolbar"><button type="button" className="btn" onClick={() => void copy()}><Copy size={15}/>Copiar link</button><a className="btn" href={qr} download={`qr-${tenant.slug}.gif`}><Download size={15}/>Baixar QR Code</a></div>
      <p className="muted small"><Smartphone size={13}/> Android/Chrome: abra o link e toque em Instalar. iPhone: abra no Safari → Compartilhar → Adicionar à Tela de Início. Computador: ícone de instalar na barra do Chrome ou Edge.</p>
      {!saved && <p className="muted small">O link só mostra a sua marca depois de publicar.</p>}</div>
      <img data-tour="app-qr" className="app-qr" src={qr} alt={`QR Code para ${url}`} width={180} height={180}/></div>
  </div></Panel>;
}
