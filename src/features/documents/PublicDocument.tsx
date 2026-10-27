import { useEffect, useMemo, useState } from 'react';
import { Download, Printer } from 'lucide-react';
import { buildDoc, TITLES } from '../../../supabase/functions/_shared/documents/model';
import { paperOf } from '../../../supabase/functions/_shared/documents/paper';
import { download, html, pdf, printHtml, type Issued } from './service';

type Public = { snapshot: Issued['snapshot']; expiresAt: string; slug: string };

/** Consulta pública de documento por link seguro (/d/<token>): só o documento daquele token, com a marca da loja, sem acesso ao ERP. */
export default function PublicDocument() {
  const token = location.pathname.split('/')[2] ?? '';
  const [data, setData] = useState<Public | null | 'invalid'>(null);
  useEffect(() => {
    void (async () => {
      try { const { supabase } = await import('../../real/client'); const { data, error } = await supabase.rpc('document_public', { p_token: token }); setData(error || !data ? 'invalid' : data as Public); }
      catch { setData('invalid'); }
    })();
  }, [token]);
  const issued = useMemo(() => data && data !== 'invalid' ? { id: '', number: data.snapshot.number, version: data.snapshot.version, copies: 0, snapshot: data.snapshot } as Issued : null, [data]);
  const paper = useMemo(() => paperOf(issued?.snapshot.type === 'sale' ? 'thermal-80' : 'a4'), [issued]);
  const content = useMemo(() => issued ? html(issued, paper) : '', [issued, paper]);
  useEffect(() => { if (issued) document.title = `${TITLES[issued.snapshot.type]} ${issued.number} — ${issued.snapshot.company.name}`; }, [issued]);
  if (data === null) return <main className="public-doc" role="status">Carregando documento…</main>;
  if (!issued) return <main className="public-doc"><h1>Link indisponível</h1><p>Este link expirou, foi revogado ou não existe. Peça um novo link à loja.</p></main>;
  const doc = buildDoc(issued.snapshot), c = doc.company;
  return <main className="public-doc">
    <h1 style={{ margin: 0, fontSize: '1.2rem' }}>{doc.title} {doc.number} · {c.name}</h1>
    <div className="toolbar"><button className="btn" onClick={() => void printHtml(content)}><Printer size={16}/>Imprimir</button>
      <button className="btn" onClick={async () => download(await pdf(issued, paper), `${doc.number}.pdf`, 'application/pdf')}><Download size={16}/>Baixar PDF</button></div>
    <iframe title={`${doc.title} ${doc.number}`} sandbox="allow-same-origin allow-modals" srcDoc={content}/>
    <p className="small">Contato: {[c.phone, c.whatsapp && `WhatsApp ${c.whatsapp}`, c.email].filter(Boolean).join(' · ') || c.name} · Link válido até {new Date((data as Public).expiresAt).toLocaleDateString('pt-BR')}. Documento não fiscal.</p>
  </main>;
}
