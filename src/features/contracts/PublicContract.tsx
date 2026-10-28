import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, FileSignature, ShieldCheck } from 'lucide-react';
import type { ContractBody } from '../../../supabase/functions/_shared/contracts/template';

type Terms = { code: string; title: string; status: string; publishedAt: string | null; body: ContractBody; provider: Record<string, string> };
const FALLBACK_PROVIDER = { legal_name: '59.760.458 MARCO ANTONIO BOGGIAN', document: '59.760.458/0001-91', legal_nature: 'Empresário Individual', brand: 'PISTEC', address: 'Rua Jacques Pilon, 189, Vila Piauí, São Paulo/SP, CEP 05109-160' };
const FAQ = [
  ['O contrato é assinado de verdade?', 'Sim. A assinatura é feita na Autentique, prestadora de assinatura eletrônica: cada signatário recebe o convite por e-mail, confirma os dados e assina. O PISTEC só considera o contrato concluído quando a Autentique confirma todas as assinaturas, e guarda o PDF assinado com o certificado e a trilha de auditoria.'],
  ['Preciso pagar antes de assinar?', 'Não. Primeiro você confere e assina o contrato; a cobrança (InfinitePay) é gerada depois, com exatamente o valor que está no contrato assinado. Se ainda estiver no período de teste, a primeira cobrança vence no fim do teste.'],
  ['O preço pode mudar depois que eu assinar?', 'Não para o período contratado. As condições ficam congeladas no contrato. Reajustes futuros exigem comunicação prévia e, quando necessário, novo aceite.'],
  ['Onde fica o meu contrato?', 'Na sua conta: Minha assinatura → Contratos e documentos. O acesso exige login; não existe página pública com seus dados.'],
  ['Posso cancelar?', 'Sim, em Minha assinatura, com efeito ao fim do período já pago. Seus dados ficam disponíveis para exportação no prazo informado no Anexo I.'],
];

/** Página pública "Contrato de Prestação de Serviços": explica e mostra os termos vigentes (sem dados de clientes). */
export default function PublicContract() {
  const [terms, setTerms] = useState<Terms | null | 'off'>(null);
  useEffect(() => { void (async () => { try { const { supabase } = await import('../../real/client'); const { data, error } = await supabase.rpc('contract_public_terms'); setTerms(error || !data ? 'off' : data as Terms); } catch { setTerms('off'); } })(); }, []);
  const t = terms && terms !== 'off' ? terms : null;
  const p = t?.provider ?? FALLBACK_PROVIDER, published = t?.status === 'published';
  return <section className="pub-section pub-legal pub-contract">
    <span className="pub-eyebrow">CONTRATAÇÃO DIGITAL</span>
    <h1>Contrato de Prestação de Serviços</h1>
    <p>Formalize sua contratação com segurança: confira o plano, preencha os dados da empresa e assine digitalmente o contrato PISTEC. Esta página explica o processo e mostra os termos vigentes; ela não é um contrato assinado.</p>
    <div className="pub-actions"><Link className="pub-button" to="/planos">Conhecer os planos<ArrowRight size={18}/></Link><a className="pub-button pub-button-outline" href="/app/contratar">Iniciar contratação</a></div>
    <div className="pub-contract-grid">
      <article><h2><ShieldCheck size={18}/> Quem presta o serviço</h2><dl>
        <dt>Nome empresarial</dt><dd>{p.legal_name}</dd><dt>CNPJ</dt><dd>{p.document}</dd><dt>Natureza jurídica</dt><dd>{p.legal_nature}</dd>
        <dt>Marca do software</dt><dd>{p.brand}</dd><dt>Endereço</dt><dd>{p.address}</dd></dl>
        <p className="pub-small">PISTEC é a marca comercial do software; o nome empresarial registrado é o informado acima.</p></article>
      <article><h2><FileSignature size={18}/> Como funciona</h2><ol>
        <li>Escolha o plano e a periodicidade (preços vêm do catálogo vigente).</li><li>Informe os dados da empresa e do representante com poderes para contratar.</li>
        <li>Confira o resumo e leia o contrato já preenchido; corrija o que precisar antes de assinar.</li>
        <li>Assine na Autentique (convite por e-mail); a contratada também assina.</li><li>Pague pela InfinitePay quando houver cobrança; a ativação depende da confirmação do pagamento.</li>
        <li>Baixe o contrato assinado, o certificado e o histórico na sua conta.</li></ol></article>
    </div>
    <h2>Direitos e deveres, em resumo</h2>
    <ul><li>Você usa o PISTEC conforme o plano contratado; os dados da sua operação continuam seus e podem ser exportados.</li>
      <li>A contratada mantém o serviço, a segurança e a separação entre empresas; integrações de terceiros dependem de configuração.</li>
      <li>Cancelamento pela área de assinatura, sem multa, com efeito ao fim do período pago. Direitos legais do consumidor prevalecem quando aplicáveis.</li>
      <li>Documentos comerciais emitidos pelo PISTEC não são notas fiscais.</li></ul>
    <h2>Termos vigentes {t && <small className="pub-small">· versão {t.code}</small>}</h2>
    {terms === null ? <p role="status">Carregando os termos…</p> : !t ? <p>Não foi possível carregar os termos agora. Tente novamente em instantes.</p> : <>
      {!published && <p className="pub-contract-draft" role="note"><strong>Minuta em revisão jurídica.</strong> Este texto ainda não foi aprovado e não está disponível para contratação. A contratação digital será liberada após a aprovação.</p>}
      <details className="pub-contract-terms"><summary>Ler o texto {published ? 'vigente' : 'da minuta'} completo</summary>
        <h3>{t.body.title}</h3><p>{t.body.subtitle}</p>
        {t.body.sections.map(s => <section key={s.title}><h4>{s.title}</h4>{s.paragraphs.map((x, i) => <p key={i}>{x.replace(/\{\{contratada_nome\}\}/g, p.legal_name).replace(/\{\{contratada_cnpj\}\}/g, p.document).replace(/\{\{(\w+)\}\}/g, '[preenchido na contratação]')}</p>)}</section>)}
      </details></>}
    <h2>Perguntas frequentes</h2>
    <div className="pub-faq-list">{FAQ.map(([q, a]) => <details key={q}><summary>{q}</summary><p>{a}</p></details>)}</div>
  </section>;
}
