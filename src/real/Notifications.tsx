import { useEffect, useState } from 'react';
import { useDemo } from '../store';
import { supabase } from './client';
import { PageHeader, Panel } from '../ui';

type Notification = { id:string; title:string; body:string; created_at:string; read_at:string|null };
export default function Notifications() {
  const { session } = useDemo();
  const [items,setItems]=useState<Notification[]>([]), [error,setError]=useState(''), [pending,setPending]=useState(false);
  useEffect(()=>{
    let active=true;
    async function load(){
      const [{data,error},{data:reads,error:readError}] = await Promise.all([
        supabase.from('notifications').select('id,title,body,created_at,read_at').eq('tenant_id',session.tenantId).order('created_at',{ascending:false}).limit(100),
        supabase.from('notification_reads').select('notification_id,read_at'),
      ]);
      if(!active)return;
      if(error || readError){setError('Não foi possível carregar as notificações.');return;}
      const seen=new Map((reads??[]).map(r=>[r.notification_id,r.read_at]));
      setItems((data??[]).map(n=>({...n,read_at:n.read_at??seen.get(n.id)??null})));setError('');
    }
    void load();
    const channel=supabase.channel(`notifications:${session.tenantId}`).on('postgres_changes',{event:'INSERT',schema:'public',table:'notifications',filter:`tenant_id=eq.${session.tenantId}`},()=>void load()).subscribe();
    return ()=>{active=false;void supabase.removeChannel(channel);};
  },[session.tenantId]);
  async function mark(id:string){
    setPending(true);
    const {error}=await supabase.rpc('mark_notifications_read',{p_ids:[id]});
    if(error)setError(error.message);else setItems(current=>current.map(n=>n.id===id?{...n,read_at:new Date().toISOString()}:n));
    setPending(false);
  }
  return <div className="page"><PageHeader title="Notificações" subtitle="Últimas 100 notificações autorizadas da empresa."/>{error&&<p role="alert">{error}</p>}{items.length===0&&<p>Nenhuma notificação disponível.</p>}{items.map(n=><Panel key={n.id} title={n.title}><p>{n.body}</p><time dateTime={n.created_at}>{new Date(n.created_at).toLocaleString('pt-BR')}</time>{n.read_at?<p>Lida</p>:<button className="btn" disabled={pending} onClick={()=>void mark(n.id)}>Marcar como lida</button>}</Panel>)}</div>;
}
