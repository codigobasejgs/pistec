import { useState, type FormEvent } from 'react';
import { useDemo } from '../store';
import { supabase } from './client';
import { PageHeader, Panel } from '../ui';

export default function Assistant() {
  const { session } = useDemo();
  const [message,setMessage]=useState(''), [answer,setAnswer]=useState(''), [error,setError]=useState(''), [pending,setPending]=useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); if(pending || !message.trim())return;
    setPending(true);setError('');setAnswer('');
    try {
      const {data,error}=await supabase.functions.invoke('assistant',{body:{tenantId:session.tenantId,branchId:session.branchId,message:message.trim()}});
      if(error)throw new Error('Assistente indisponível. Verifique ativação, permissões e limite diário.');
      if(typeof data?.answer!=='string')throw new Error('Resposta inválida do assistente.');
      setAnswer(data.answer);
    }catch(e){setError(e instanceof Error?e.message:'Não foi possível concluir a consulta.');}finally{setPending(false);}
  }
  return <div className="page"><PageHeader title="Assistente PISTEC" subtitle="Consultas somente leitura, limitadas às suas permissões."/><Panel><p>Respostas geradas por IA podem conter erros. Confira os registros antes de decidir. Nenhuma venda, pagamento ou mensagem será executada pelo assistente.</p><form className="stack" onSubmit={submit}><label className="field">Sua pergunta<textarea required maxLength={4000} value={message} onChange={e=>setMessage(e.target.value)}/></label><button className="btn primary" disabled={pending}>{pending?'Consultando…':'Consultar assistente'}</button></form>{error&&<p role="alert">{error}</p>}{answer&&<section aria-label="Resposta do assistente" role="status" style={{whiteSpace:'pre-wrap'}}>{answer}</section>}</Panel></div>;
}
