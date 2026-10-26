import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { rpc, useDemo } from '../store';
import { date, money } from '../lib';
import { PageHeader, Panel } from '../ui';
import Integrations from './Integrations';

export default function RealAdmin() {
  const { state, session, perform } = useDemo();
  const [error,setError]=useState(''), [status,setStatus]=useState(''), [pending,setPending]=useState(false);
  if (!session.admin) return <main className="page"><h1>Acesso administrativo restrito</h1><Link to="/">Voltar</Link></main>;
  async function run(action: () => Promise<void>, message: string) {
    setPending(true); setError(''); setStatus('');
    try { await action(); setStatus(message); }
    catch(e){setError(e instanceof Error?e.message:'Não foi possível concluir.');}
    finally{setPending(false);}
  }
  return <main className="page"><PageHeader title="Super Admin PISTEC" subtitle="Administração da plataforma PISTEC."/><Link to="/">Minhas empresas</Link>{error&&<p role="alert">{error}</p>}{status&&<p role="status">{status}</p>}
    <Integrations/>
    <Panel title="Empresas cadastradas">{state.tenants.length===0&&<p>Nenhuma empresa cadastrada.</p>}{state.tenants.map(t=><form key={t.id} className="toolbar" onSubmit={e=>{
      e.preventDefault(); const f=new FormData(e.currentTarget);
      void run(()=>perform(()=>{throw new Error('Operação real');},rpc('admin_save_tenant',{p:{id:t.id,name:t.name,email:t.email,planId:String(f.get('planId')),status:String(f.get('status'))}})),'Empresa atualizada.');
    }}><strong>{t.name}</strong><span>{t.email}</span><select name="planId" defaultValue={t.planId}>{state.plans.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select><select name="status" defaultValue={t.status}>{['Teste','Ativa','Vencida','Suspensa','Cancelada'].map(s=><option key={s}>{s}</option>)}</select><button className="btn" disabled={pending}>Salvar</button></form>)}</Panel>
    <Panel title="Planos SaaS">{state.plans.map(p=><p key={p.id}><strong>{p.name}</strong> · Mensal {money(p.monthly)} · {p.users} usuários · {p.branches} filiais · {p.products} produtos</p>)}</Panel>
    <Panel title="Cupons SaaS">{state.coupons.map(c=><p key={c.id}><strong>{c.code}</strong> · {c.description} · {c.active?'Ativo':'Inativo'}</p>)}
      <form className="stack" onSubmit={e=>{
        e.preventDefault(); const f=new FormData(e.currentTarget);
        void run(()=>perform(()=>{throw new Error('Operação real');},rpc('admin_save_coupon',{p:{code:String(f.get('code')),description:String(f.get('description')),kind:String(f.get('kind')),value:Number(f.get('value')),startsAt:String(f.get('startsAt')),endsAt:String(f.get('endsAt')),maxUses:Number(f.get('maxUses')),perTenant:Number(f.get('perTenant')),active:true}})),'Cupom salvo.');
      }}><h3>Novo cupom</h3><label className="field">Código<input name="code" required maxLength={30}/></label><label className="field">Descrição<input name="description" required maxLength={200}/></label><label className="field">Tipo<select name="kind"><option value="percent">Percentual (pontos-base)</option><option value="fixed">Valor fixo (centavos)</option></select></label><label className="field">Valor<input name="value" type="number" min={1} required/></label><label className="field">Início<input name="startsAt" type="date" required/></label><label className="field">Fim<input name="endsAt" type="date" required/></label><label className="field">Limite total<input name="maxUses" type="number" min={0} defaultValue={0}/></label><label className="field">Limite por empresa<input name="perTenant" type="number" min={0} defaultValue={1}/></label><button className="btn primary" disabled={pending}>Criar cupom</button></form></Panel>
    <Panel title="Faturas SaaS">{state.invoices.map(i=><div key={i.id} className="toolbar"><span>{i.id} · {money(i.amount)} · {i.status} · Venc. {date(i.dueDate)}</span>{i.status==='Pendente'&&<button className="btn" disabled={pending} onClick={()=>{if(window.confirm('Cancelar esta fatura?'))void run(()=>perform(()=>{throw new Error('Operação real');},rpc('admin_set_invoice_status',{p_invoice:i.id,p_status:'Cancelada',p_note:'Cancelamento pelo Super Admin'})),'Fatura cancelada.');}}>Cancelar fatura</button>}</div>)}</Panel>
    <Panel title="Comunicado para empresas"><form className="stack" onSubmit={(e:FormEvent<HTMLFormElement>)=>{
      e.preventDefault(); const f=new FormData(e.currentTarget);
      void run(()=>perform(()=>{throw new Error('Operação real');},rpc('admin_broadcast',{p_title:String(f.get('title')),p_body:String(f.get('body')),p_audience:'all'})),'Comunicado registrado.');
    }}><label className="field">Título<input name="title" required maxLength={160}/></label><label className="field">Mensagem<textarea name="body" required maxLength={2000}/></label><button className="btn primary" disabled={pending}>Publicar comunicado</button></form></Panel>
  </main>;
}
