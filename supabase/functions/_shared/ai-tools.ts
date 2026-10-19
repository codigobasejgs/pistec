import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { HttpError, text, uuid } from './http.ts';

export const toolModules: Record<string,string> = {
  searchProducts: 'produtos', getStockAlerts: 'estoque', getOpenServiceOrders: 'ordens-servico',
  getPendingQuotations: 'orcamentos', getSalesSummary: 'vendas', searchHelpArticles: 'ajuda',
};
export function toolArgs(raw: unknown, tenant: string, branch: string) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new HttpError(400, 'Argumentos inválidos.');
  const p = raw as Record<string,unknown>;
  if (Object.keys(p).some(key => !['query'].includes(key))) throw new HttpError(400, 'Ferramenta recebeu argumento não autorizado.');
  const query = p.query == null ? '' : text(p.query,'Busca',120);
  return { tenant: uuid(tenant), branch: uuid(branch), query };
}
export async function runTool(client: SupabaseClient, name: string, raw: unknown, tenant: string, branch: string) {
  if (!Object.hasOwn(toolModules,name)) throw new HttpError(400,'Ferramenta desconhecida.');
  const args = toolArgs(raw,tenant,branch);
  // O cliente traz o JWT do usuário. Filtros explícitos complementam RLS, nunca substituem autorização.
  const { data: allowed, error: authorizationError } = await client.rpc('authorize_ai_tool', { p_tenant: tenant, p_branch: branch, p_module: toolModules[name] });
  if (authorizationError || allowed !== true) throw new HttpError(403,'Ferramenta não autorizada para este perfil.');
  let result;
  switch (name) {
    case 'searchProducts':
      result = await client.from('products').select('name,sku,price,active').eq('tenant_id',args.tenant).eq('active',true).ilike('name',`%${args.query.replace(/[%_\\]/g,'')}%`).order('name').limit(20); break;
    case 'getStockAlerts':
      result = await client.rpc('stock_alerts', { p_tenant: args.tenant,p_branch: args.branch }); break;
    case 'getOpenServiceOrders':
      result = await client.from('records').select('id,title,status,date').eq('tenant_id',args.tenant).eq('branch_id',args.branch).eq('kind','ordens-servico').not('status','in','("Entregue","Cancelada")').order('date',{ascending:false}).limit(20); break;
    case 'getPendingQuotations':
      result = await client.from('records').select('id,title,status,amount,date').eq('tenant_id',args.tenant).eq('branch_id',args.branch).eq('kind','orcamentos').in('status',['Aberto','Enviado','Rascunho']).order('date',{ascending:false}).limit(20); break;
    case 'getSalesSummary':
      result = await client.rpc('sales_summary', { p_tenant: args.tenant,p_branch: args.branch }); break;
    case 'searchHelpArticles':
      result = await client.from('knowledge_articles').select('title,body').or(`tenant_id.is.null,tenant_id.eq.${args.tenant}`).textSearch('search',args.query,{config:'portuguese',type:'plain'}).limit(5); break;
    default: throw new HttpError(400,'Ferramenta não implementada.');
  }
  if (result.error) throw new HttpError(503,'Consulta da ferramenta indisponível.');
  return result.data;
}
