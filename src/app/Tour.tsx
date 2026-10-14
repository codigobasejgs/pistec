import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useDemo } from '../store';
import { Modal } from '../ui';

export default function Tour({ admin, onClose }: { admin: boolean; onClose: () => void }) {
  const { state, session } = useDemo(); const navigate = useNavigate(); const location = useLocation();
  const key = `pistec-tour-${admin ? 'admin' : session.tenantId}-${session.role}`;
  const [index, setIndex] = useState(() => { try { return Number(localStorage.getItem(key) || 0); } catch { return 0; } });
  const base = admin ? '/admin' : `/loja/${state.tenants.find(t => t.id === session.tenantId)!.slug}`;
  const steps = admin ? [
    ['', 'Dashboard SaaS', 'Indicadores separados do faturamento das lojas.'],['empresas','Empresas','Gerencie situação, planos e limites de cada empresa.'],['planos','Planos','Preços e limites alimentam também o site comercial.'],['cobrancas','Cobranças SaaS','Asaas e InfinitePay são apenas simulações para assinaturas.'],['suporte','Suporte','Acompanhe os tickets demonstrativos.']
  ] : [
    ['dashboard','Seu centro de controle','Indicadores refletem vendas, estoque e ordens de serviço da filial selecionada.'],['produtos','Catálogo de produtos','Cadastre peças, custos, preços e referências.'],['estoque','Estoque por filial','Registre entradas, transferências e contagens.'],['pdv','Venda no balcão','Abra o caixa, adicione produtos e registre recebimentos simulados.'],['clientes','Clientes','Organize dados e preferências de comunicação.'],['compras','Compras','Receber um pedido gera entrada no estoque.'],['ordens-servico','Sua oficina','Acompanhe as etapas e o consumo de peças.'],['financeiro','Financeiro operacional','Receitas, despesas e contas pertencem à loja, não à plataforma.'],['whatsapp','Atendimento','Mensagens são locais; nenhum envio real acontece.'],['relatorios','Relatórios','Explore registros e exporte CSV.'],['personalizacao','Sua identidade','Personalização isolada para esta empresa.'],['minha-assinatura','Assinatura','Consulte limites e simule mudanças de plano.'],['ajuda','Ajuda','Reinicie este tour pelo menu da conta quando precisar.']
  ];
  const safeIndex = Math.max(0, Math.min(index, steps.length - 1)); const step = steps[safeIndex]; const target = `${base}${step[0] ? `/${step[0]}` : ''}`;
  useEffect(() => { navigate(target); try { localStorage.setItem(key, String(safeIndex)); } catch { /* Preferência opcional; navegação independe do armazenamento. */ } }, [target, key, navigate, safeIndex]);
  useEffect(() => { const timer = setTimeout(() => document.querySelector('.page-header, .main-content h1')?.classList.add('tour-highlight'), 100); return () => { clearTimeout(timer); document.querySelectorAll('.tour-highlight').forEach(e => e.classList.remove('tour-highlight')); }; }, [location.pathname, safeIndex]);
  return <Modal title={`Tour · ${safeIndex + 1} de ${steps.length}`} open onClose={onClose}><h3>{step[1]}</h3><p>{step[2]}</p><p className="muted">A tela real deste módulo está aberta ao fundo. Feche o tour para experimentar.</p><div className="toolbar"><button className="btn ghost" onClick={() => setIndex(0)}>Reiniciar</button><button className="btn" disabled={!safeIndex} onClick={() => setIndex(i => i - 1)}>Voltar</button><button className="btn" onClick={onClose}>Pular</button><button className="btn primary" onClick={() => safeIndex === steps.length - 1 ? onClose() : setIndex(i => i + 1)}>{safeIndex === steps.length - 1 ? 'Concluir' : 'Avançar'}</button></div></Modal>;
}
