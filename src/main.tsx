import { StrictMode, Suspense, lazy, Component, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { DemoProvider, useDemo } from './store';
import { NoticeProvider } from './ui';
import Layout from './app/Layout';
import PwaNotices from './app/InstallBanner';
import { initPwa } from './pwa';
import './styles.css';

const Public=lazy(()=>import('./features/public/Public'));
const Admin=lazy(()=>import('./features/admin/Admin'));
const Dashboard=lazy(()=>import('./features/dashboard/Dashboard'));
const Products=lazy(()=>import('./features/erp/Products'));
const Inventory=lazy(()=>import('./features/erp/Inventory'));
const Pos=lazy(()=>import('./features/erp/Pos'));
const Records=lazy(()=>import('./features/erp/Records'));
const Finance=lazy(()=>import('./features/erp/Finance'));
const Reports=lazy(()=>import('./features/erp/Reports'));
const WhatsApp=lazy(()=>import('./features/erp/WhatsApp'));
const Settings=lazy(()=>import('./features/settings/Settings'));
const recordModules=['clientes','categorias','aplicacoes','vendas','crm','veiculos','orcamentos','ordens-servico','agenda','compras','fornecedores','automacoes','funcionarios','filiais','notificacoes','tarefas','garantias'];
function Module(){const {module}=useParams(); if(recordModules.includes(module??''))return <Records key={module}/>;return <NotFound/>;}
function NotFound(){return <div className="error-page"><h1>404 · Caminho não encontrado</h1><p>Este endereço não corresponde a uma página do PISTEC.</p><Link className="btn primary" to="/demonstracao">Abrir demonstração</Link></div>;}
class ErrorBoundary extends Component<{children:ReactNode},{error:boolean}>{state={error:false};static getDerivedStateFromError(){return {error:true};}render(){if(this.state.error)return <div className="error-page"><h1>Não foi possível abrir esta tela</h1><p>Seus dados locais não foram apagados. Recarregue para tentar novamente.</p><button className="btn primary" onClick={()=>location.reload()}>Recarregar</button></div>;return this.props.children;}}
// Tela de boot/erro só antes da primeira carga; mutações não desmontam páginas.
function App(){const {initialized,error}=useDemo();if(!initialized&&!error)return <div className="boot-screen"><img src="/brand/symbol.webp" alt="PISTEC"/><p>Preparando sua demonstração...</p><div className="loading-line"/></div>;if(!initialized)return <div className="error-page"><h1>Armazenamento indisponível</h1><p>{error}</p><p>Permita o armazenamento local neste navegador. Nenhum dado será descartado automaticamente.</p><button className="btn primary" onClick={()=>location.reload()}>Tentar novamente</button></div>;
return <Suspense fallback={<div className="skeleton-page" aria-label="Carregando página"/>}><Routes>{['/','/funcionalidades','/oficinas','/motopecas','/autopecas','/planos','/demonstracao','/contato','/login','/cadastro','/recuperar-acesso','/termos','/privacidade','/licenca-perpetua'].map(path=><Route key={path} path={path} element={<Public/>}/>)}<Route path="/admin" element={<Layout admin/>}><Route index element={<Admin/>}/><Route path=":module" element={<Admin/>}/></Route><Route path="/loja/:tenantSlug" element={<Layout/>}><Route index element={<Navigate to="dashboard" replace/>}/><Route path="dashboard" element={<Dashboard/>}/><Route path="produtos" element={<Products/>}/><Route path="estoque" element={<Inventory/>}/><Route path="inventario" element={<Inventory/>}/><Route path="pdv" element={<Pos/>}/>{['financeiro','contas-pagar','contas-receber','caixa'].map(p=><Route key={p} path={p} element={<Finance key={p}/>}/>)}<Route path="relatorios" element={<Reports/>}/><Route path="whatsapp" element={<WhatsApp/>}/>{['configuracoes','personalizacao','minha-assinatura','ajuda'].map(p=><Route key={p} path={p} element={<Settings key={p}/>}/>)}<Route path=":module" element={<Module/>}/></Route><Route path="*" element={<NotFound/>}/></Routes></Suspense>;}
initPwa();
createRoot(document.getElementById('root')!).render(<StrictMode><ErrorBoundary><DemoProvider><NoticeProvider><BrowserRouter><App/><PwaNotices/></BrowserRouter></NoticeProvider></DemoProvider></ErrorBoundary></StrictMode>);
