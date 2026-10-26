import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PlayCircle } from 'lucide-react';
import { Button, Field, PageHeader, Panel } from '../../ui';
import { adminArticles, adminTours, searchAdminHelp } from './helpContent';

const startTour = (id: string) => { try { sessionStorage.setItem('pistec-admin-tour-next', id); } catch { /* opcional */ } dispatchEvent(new Event('pistec:admin-tour')); };

export function HelpCenter() {
  const [params] = useSearchParams(); const [q, setQ] = useState(params.get('q') ?? '');
  const found = searchAdminHelp(q); const cats = Array.from(new Set(found.map(a => a.category)));
  return <div className="page"><PageHeader title="Central de Ajuda" subtitle="Respostas para operar a plataforma. Cada artigo leva à tela certa e, quando houver, ao tour guiado."/>
    <Panel><Field label="Qual é a sua dúvida?"><input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Ex.: como prorrogar um teste?" autoFocus/></Field></Panel>
    {cats.map(c => <section key={c}><h2 className="section-title">{c}</h2><div className="grid grid-3">{found.filter(a => a.category === c).map(a => <Panel key={a.id} title={a.title}><p>{a.text}</p>
      <div className="toolbar"><Link className="btn" to={a.to}>Abrir a tela</Link>{a.tour && <Button icon={<PlayCircle size={15}/>} onClick={() => startTour(a.tour!)}>Ver tour</Button>}</div></Panel>)}</div></section>)}
    {!found.length && <p role="status">Nada encontrado para "{q}". Tente outras palavras ou veja todos os {adminArticles.length} artigos apagando a busca.</p>}</div>;
}

export function Tutorials() {
  return <div className="page"><PageHeader title="Tour guiado" subtitle="Escolha um módulo. O tour abre a página e destaca os elementos reais, passo a passo. O progresso fica salvo neste navegador."/>
    <div className="grid grid-3">{Object.entries(adminTours).map(([k, t]) => <Panel key={k} title={t.label}><p className="muted">{t.steps.length} passo(s): {t.steps.map(s => s.title).join(', ')}.</p>
      <Button variant="primary" icon={<PlayCircle size={15}/>} onClick={() => startTour(k)}>Iniciar</Button></Panel>)}</div></div>;
}
