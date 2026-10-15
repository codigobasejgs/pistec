import { useState, type FormEvent } from 'react';
import { Archive, Copy, Download, Edit, Eye, FileSpreadsheet, Package, Plus, Trash2, Upload } from 'lucide-react';
import { importProducts, saveProduct } from '../../domain';
import { money, uid } from '../../lib';
import { Badge, Button, DataTable, Empty, Modal, PageHeader, Panel, Stat } from '../../ui';
import type { ImportReport, Product, ProductImportRow } from '../../types';
import { cents, decimal, guessMapping, IMPORT_FIELDS, IMPORT_TEMPLATE, mapImportRows, matches, parseCsv, sheetToRecords, type ImportField, type ImportMapping } from './logic';
import { ExportButton, SearchBox, SelectField, TextField, useErp, useSearchQuery } from './shared';

type Strategy = 'create' | 'update' | 'upsert';

interface ImportBatch {
  fileName: string;
  headers: string[];
  records: Record<string, string>[];
  mapping: ImportMapping;
  strategy: Strategy;
  valid: ProductImportRow[];
  errors: { line: number; message: string }[];
}

export default function Products() {
  const { state, session, run, pending, notice, download, allowed } = useErp('produtos');
  const [query, setQuery] = useSearchQuery(), [category, setCategory] = useState(''), [status, setStatus] = useState('active');
  const [edit, setEdit] = useState<Product | null>(null), [detail, setDetail] = useState<Product | null>(null);
  const [costText, setCostText] = useState(''), [priceText, setPriceText] = useState('');
  const [batch, setBatch] = useState<ImportBatch | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);

  const products = state.products.filter(product => product.tenantId === session.tenantId);
  const rows = products.filter(product => matches(query, product.name, product.sku, product.barcode, product.brand) && (!category || product.category === category) && (status === 'all' || product.active === (status === 'active')));
  const fresh = (): Product => ({ id: uid(), tenantId: session.tenantId, name: '', sku: '', barcode: '', category: '', brand: '', cost: 0, price: 0, min: 0, max: 0, location: '', active: true, details: {} });
  const stock = (id: string) => state.balances.filter(balance => balance.tenantId === session.tenantId && balance.branchId === session.branchId && balance.productId === id).reduce((sum, balance) => sum + balance.quantity, 0);

  function openEdit(product: Product) {
    setEdit(structuredClone(product));
    setCostText(decimal(product.cost));
    setPriceText(decimal(product.price));
  }

  // Margem e markup calculados em tempo real com validação inline
  let costCents = 0, priceCents = 0, costError = '', priceError = '';
  try { costCents = cents(costText || '0'); } catch { costError = 'Informe um valor com até duas casas decimais.'; }
  try { priceCents = cents(priceText || '0'); } catch { priceError = 'Informe um valor com até duas casas decimais.'; }
  const profit = priceCents - costCents;
  const markup = costCents > 0 ? (profit / costCents) * 100 : null;
  const margin = priceCents > 0 ? (profit / priceCents) * 100 : null;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!edit) return;
    try {
      if (costError || priceError) throw new Error('Revise os valores monetários informados.');
      const product = { ...edit, name: edit.name.trim(), sku: edit.sku.trim(), cost: costCents, price: priceCents };
      if (!product.name || !product.sku || !Number.isInteger(product.min) || !Number.isInteger(product.max) || product.min < 0 || (product.max > 0 && product.max < product.min)) throw new Error('Nome e SKU obrigatórios; estoque mínimo/máximo devem ser inteiros válidos.');
      const ok = await run(draft => saveProduct(draft, product), 'Produto salvo.', products.some(row => row.id === edit.id) ? 'editar' : 'cadastrar');
      if (ok) setEdit(null);
    } catch (error) { notice(error instanceof Error ? error.message : 'Produto inválido.'); }
  }

  async function remove(product: Product) {
    if (!window.confirm(`Excluir permanentemente ${product.name}? Produtos com histórico devem ser arquivados.`)) return;
    await run(draft => {
      const linked = draft.balances.some(row => row.tenantId === session.tenantId && row.productId === product.id && (row.quantity || row.reserved)) || draft.movements.some(row => row.tenantId === session.tenantId && row.productId === product.id) || draft.sales.some(row => row.tenantId === session.tenantId && row.items.some(item => item.productId === product.id)) || draft.records.some(row => row.tenantId === session.tenantId && row.items.some(item => item.productId === product.id));
      if (linked) throw new Error('Produto possui saldo ou histórico. Utilize Arquivar.');
      draft.products = draft.products.filter(row => row.id !== product.id || row.tenantId !== session.tenantId);
      draft.balances = draft.balances.filter(row => row.productId !== product.id || row.tenantId !== session.tenantId);
    }, 'Produto excluído.', 'excluir');
  }

  async function handleFile(file?: File) {
    if (!file) return;
    try {
      if (file.size > 2_000_000) throw new Error('Arquivo excede 2 MB.');
      const isXlsx = /\.xlsx?$/i.test(file.name) || file.type.includes('spreadsheet') || file.type.includes('excel');
      let records: Record<string, string>[] = [];
      if (isXlsx) {
        // read-excel-file lazy: só baixa/carrega o parser se o usuário escolher XLSX
        const readXlsx = (await import('read-excel-file/browser')).default;
        const matrix = await readXlsx(file, { parseNumber: string_ => string_ });
        records = sheetToRecords(matrix as unknown as unknown[][]);
      } else {
        records = parseCsv(await file.text());
      }
      if (!records.length) throw new Error('Arquivo não contém dados de produtos.');
      if (records.length > 1000) throw new Error('Importe no máximo 1.000 produtos por lote. Divida o arquivo.');
      const headers = Object.keys(records[0] || {});
      const mapping = guessMapping(headers);
      const { valid, errors } = mapImportRows(records, mapping);
      setBatch({ fileName: file.name, headers, records, mapping, strategy: 'upsert', valid, errors });
    } catch (error) { notice(error instanceof Error ? error.message : 'Falha ao processar arquivo.'); }
  }

  function updateMapping(field: ImportField, header: string) {
    if (!batch) return;
    const nextMapping: ImportMapping = { ...batch.mapping, [field]: header || undefined };
    const { valid, errors } = mapImportRows(batch.records, nextMapping);
    setBatch({ ...batch, mapping: nextMapping, valid, errors });
  }

  function updateStrategy(strategy: Strategy) {
    if (!batch) return;
    setBatch({ ...batch, strategy });
  }

  async function confirmImport() {
    if (!batch || !batch.valid.length) return;
    let resultReport: ImportReport | null = null;
    const ok = await run(draft => {
      resultReport = importProducts(draft, session.tenantId, batch.valid, batch.strategy);
    }, 'Importação concluída.', 'cadastrar');
    if (ok && resultReport) {
      // Mescla erros de mapeamento com erros da aplicação de regras no domínio
      const mergedErrors = [...batch.errors, ...(resultReport as ImportReport).errors];
      setReport({ ...(resultReport as ImportReport), errors: mergedErrors });
      setBatch(null);
    }
  }

  function downloadTemplate() {
    const blob = new Blob([IMPORT_TEMPLATE], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'modelo-importacao-produtos.csv';
    link.click();
    URL.revokeObjectURL(url);
  }

  const set = (key: keyof Product, value: string | number | boolean) => setEdit(current => current ? { ...current, [key]: value } : current);

  // Classifica linhas válidas para visualização na prévia: novo vs já existente
  const existingSkus = new Set(products.map(p => p.sku.toLowerCase()));
  const previewNew = batch ? batch.valid.filter(row => !existingSkus.has(row.sku.toLowerCase())).length : 0;
  const previewExisting = batch ? batch.valid.filter(row => existingSkus.has(row.sku.toLowerCase())).length : 0;

  return <div className="page stack"><PageHeader title="Produtos" subtitle="Catálogo, preços, margens e importação por planilha."><ExportButton tour="products-export" onClick={() => download('produtos', rows.map(product => ({ name: product.name, sku: product.sku, barcode: product.barcode, category: product.category, brand: product.brand, cost: decimal(product.cost), price: decimal(product.price), min: product.min, max: product.max, location: product.location, active: product.active, description: product.details.description || '', application: product.details.application || '', warranty: product.details.warranty || '', unit: product.details.unit || '', ncm: product.details.ncm || '' })))} /><button type="button" className="btn" data-tour="products-template" onClick={downloadTemplate}><Download size={16} aria-hidden="true" /> Baixar modelo CSV</button><label className="btn" data-tour="products-import"><Upload size={16} aria-hidden="true" /> Importar CSV/XLSX<input aria-label="Importar produtos CSV" type="file" accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={pending || !allowed('cadastrar')} onChange={event => { void handleFile(event.target.files?.[0]); event.target.value = ''; }} /></label><button className="btn primary" data-tour="products-new" disabled={!allowed('cadastrar')} onClick={() => openEdit(fresh())}><Plus size={16} aria-hidden="true" /> Novo produto</button></PageHeader>
    <div className="grid grid-3"><Stat label="Produtos ativos" value={products.filter(product => product.active).length} icon={<Package size={20} />} /><Stat label="Valor do estoque · custo" value={money(products.reduce((sum, product) => sum + stock(product.id) * product.cost, 0))} /><Stat label="Abaixo do mínimo" value={products.filter(product => product.active && stock(product.id) < product.min).length} /></div>
    <Panel><div className="toolbar"><SearchBox value={query} onChange={setQuery} placeholder="Nome, SKU, código de barras ou marca" tour="products-search" /><SelectField label="Categoria" value={category} onChange={setCategory} tour="products-category"><option value="">Todas</option>{[...new Set(products.map(product => product.category))].filter(Boolean).map(value => <option key={value}>{value}</option>)}</SelectField><SelectField label="Situação" value={status} onChange={setStatus}><option value="active">Ativos</option><option value="archived">Arquivados</option><option value="all">Todos</option></SelectField></div>
      {rows.length ? <DataTable rows={rows} columns={[
        { key: 'name', label: 'Produto', render: (product: Product) => <button className="row-link" style={{ whiteSpace: 'normal', textAlign: 'left' }} onClick={() => setDetail(product)}>{product.name}<small className="muted" style={{ display: 'block' }}>{product.sku}</small></button> },
        { key: 'category', label: 'Categoria' },
        { key: 'cost', label: 'Custo', render: (product: Product) => money(product.cost) },
        { key: 'price', label: 'Preço', render: (product: Product) => money(product.price) },
        { key: 'stock', label: 'Estoque', render: (product: Product) => stock(product.id) },
        { key: 'active', label: 'Status', render: (product: Product) => <Badge>{product.active ? 'Ativo' : 'Arquivado'}</Badge> },
        { key: 'actions', label: 'Ações', render: (product: Product) => <div className="toolbar"><button className="btn ghost" aria-label={`Detalhes de ${product.name}`} onClick={() => setDetail(product)}><Eye size={16} /></button><button className="btn ghost" aria-label={`Editar ${product.name}`} disabled={pending || !allowed('editar')} onClick={() => openEdit(product)}><Edit size={16} /></button><button className="btn ghost" aria-label={`Duplicar ${product.name}`} disabled={!allowed('cadastrar')} onClick={() => openEdit({ ...product, id: uid(), name: `${product.name} (cópia)`, sku: '', barcode: '' })}><Copy size={16} /></button><button className="btn ghost" aria-label={`${product.active ? 'Arquivar' : 'Restaurar'} ${product.name}`} disabled={pending || !allowed('editar')} onClick={() => { if (window.confirm(`${product.active ? 'Arquivar' : 'Restaurar'} ${product.name}?`)) void run(draft => { const current = draft.products.find(row => row.id === product.id && row.tenantId === session.tenantId); if (!current) throw new Error('Produto não encontrado.'); saveProduct(draft, { ...current, active: !current.active }); }); }}><Archive size={16} /></button>{allowed('excluir') && <button className="btn danger" aria-label={`Excluir ${product.name}`} disabled={pending} onClick={() => void remove(product)}><Trash2 size={16} /></button>}</div> },
      ]} /> : <Empty text="Nenhum produto encontrado. Cadastre um produto ou ajuste os filtros." />}</Panel>

    <Modal title={edit && products.some(product => product.id === edit.id) ? 'Editar produto' : 'Novo produto'} size="lg" open={!!edit} onClose={() => !pending && setEdit(null)}>{edit && <form className="stack" onSubmit={save}>
      <section className="form-section"><h3>Identificação</h3><div className="form-grid">
        <TextField label="Nome" value={edit.name} required onChange={value => set('name', value)} />
        <TextField label="SKU" value={edit.sku} required tour="products-form-sku" onChange={value => set('sku', value)} />
        <TextField label="Código de barras" value={edit.barcode} onChange={value => set('barcode', value)} />
        <label className="field" data-tour="products-form-category"><span>Categoria</span><input aria-label="Categoria" list="erp-product-categories" value={edit.category} onChange={event => set('category', event.target.value)} /><datalist id="erp-product-categories">{[...new Set([...products.map(product => product.category), ...state.records.filter(record => record.tenantId === session.tenantId && record.kind === 'categorias' && record.status !== 'Inativa').map(record => record.title)])].filter(Boolean).map(value => <option key={value} value={value} />)}</datalist></label>
        <TextField label="Marca" value={edit.brand} onChange={value => set('brand', value)} />
        <TextField label="Unidade" value={edit.details.unit || ''} onChange={value => setEdit({ ...edit, details: { ...edit.details, unit: value } })} />
      </div></section>

      <section className="form-section"><h3>Preços e rentabilidade</h3><div className="form-grid">
        <TextField label="Custo (R$)" inputMode="decimal" required value={costText} tour="products-form-cost" error={costError || undefined} onChange={setCostText} />
        <TextField label="Preço (R$)" inputMode="decimal" required value={priceText} tour="products-form-price" error={priceError || undefined} onChange={setPriceText} />
      </div>
      <div className="grid grid-3" role="status" aria-live="polite">
        <Stat label="Lucro bruto unitário" value={money(profit)} tone={profit >= 0 ? 'green' : 'red'} />
        <Stat label="Margem sobre a venda" value={margin !== null ? `${margin.toFixed(1)}%` : '—'} tone={margin && margin >= 20 ? 'green' : 'amber'} hint="Lucro ÷ Preço" />
        <Stat label="Markup sobre o custo" value={markup !== null ? `${markup.toFixed(1)}%` : '—'} tone={markup && markup >= 25 ? 'green' : 'amber'} hint="Lucro ÷ Custo" />
      </div></section>

      <section className="form-section"><h3>Estoque e armazenagem</h3><div className="form-grid">
        <TextField label="Estoque mínimo" value={edit.min} type="number" min={0} step="1" onChange={value => set('min', Number(value))} />
        <TextField label="Estoque máximo" value={edit.max} type="number" min={0} step="1" onChange={value => set('max', Number(value))} error={edit.max > 0 && edit.max < edit.min ? 'Máximo deve ser maior ou igual ao mínimo.' : undefined} />
        <TextField label="Localização física" value={edit.location} onChange={value => set('location', value)} />
      </div><p className="muted">Saldo inicial e ajustes são realizados no módulo Estoque.</p></section>

      <section className="form-section"><h3>Fiscal e aplicação</h3><div className="form-grid">
        <TextField label="NCM" value={edit.details.ncm || ''} onChange={value => setEdit({ ...edit, details: { ...edit.details, ncm: value } })} />
        <TextField label="Garantia" value={edit.details.warranty || ''} onChange={value => setEdit({ ...edit, details: { ...edit.details, warranty: value } })} />
        <TextField label="Aplicação / compatibilidade" value={edit.details.application || ''} onChange={value => setEdit({ ...edit, details: { ...edit.details, application: value } })} />
        <TextField label="Descrição detalhada" value={edit.details.description || ''} onChange={value => setEdit({ ...edit, details: { ...edit.details, description: value } })} />
      </div></section>

      <div className="toolbar"><Button disabled={pending} onClick={() => setEdit(null)}>Cancelar</Button><Button type="submit" variant="primary" data-tour="products-save" loading={pending} disabled={!!costError || !!priceError || (edit.max > 0 && edit.max < edit.min)}>Salvar produto</Button></div>
    </form>}</Modal>

    <Modal title="Detalhes do produto" open={!!detail} onClose={() => setDetail(null)}>{detail && <div className="stack"><h3>{detail.name}</h3><p>SKU {detail.sku} · {detail.barcode || 'Sem código de barras'}</p><p>{detail.category} · {detail.brand} · {detail.location}</p><p>Custo {money(detail.cost)} · Venda {money(detail.price)} · Saldo {stock(detail.id)}</p><p>Mínimo {detail.min} · Máximo {detail.max}</p>{Object.entries(detail.details).map(([key, value]) => <p key={key}><strong>{key}:</strong> {value}</p>)}</div>}</Modal>

    <Modal title="Prévia da importação" size="lg" open={!!batch} onClose={() => !pending && setBatch(null)}>{batch && <div className="stack">
      <p>Arquivo: <strong>{batch.fileName}</strong> · {batch.records.length} linha(s) lida(s) · {batch.valid.length} válida(s).</p>
      <div className="grid grid-3">
        <Stat label="Novos SKUs" value={previewNew} tone="green" />
        <Stat label="SKUs já existentes" value={previewExisting} tone="blue" />
        <Stat label="Linhas com erro" value={batch.errors.length} tone={batch.errors.length ? 'amber' : 'green'} />
      </div>

      <section className="form-section"><h3>Estratégia de importação</h3>
        <div className="toolbar">
          <label><input type="radio" name="strategy" checked={batch.strategy === 'upsert'} onChange={() => updateStrategy('upsert')} /> <strong>Criar novos e atualizar existentes (recomendado)</strong></label>
          <label><input type="radio" name="strategy" checked={batch.strategy === 'create'} onChange={() => updateStrategy('create')} /> Apenas novos (ignorar duplicados)</label>
          <label><input type="radio" name="strategy" checked={batch.strategy === 'update'} onChange={() => updateStrategy('update')} /> Apenas atualizar existentes</label>
        </div>
      </section>

      <details><summary><FileSpreadsheet size={16} aria-hidden="true" /> Mapeamento de colunas ({Object.keys(batch.mapping).length}/{IMPORT_FIELDS.length})</summary>
        <div className="form-grid">{IMPORT_FIELDS.map(([key, label, required]) => <SelectField key={key} label={`${label}${required ? ' *' : ''}`} value={batch.mapping[key] || ''} onChange={header => updateMapping(key, header)}><option value="">(Não mapear)</option>{batch.headers.map(header => <option key={header} value={header}>{header}</option>)}</SelectField>)}</div>
      </details>

      {batch.errors.length > 0 && <details className="callout warning" open><summary><strong>{batch.errors.length} erro(s) de validação</strong> (essas linhas serão ignoradas)</summary><ul>{batch.errors.slice(0, 20).map(err => <li key={`${err.line}-${err.message}`}>Linha {err.line}: {err.message}</li>)}{batch.errors.length > 20 && <li>... e mais {batch.errors.length - 20} erro(s).</li>}</ul></details>}

      <section className="form-section"><h3>Amostra das linhas válidas</h3>
        <DataTable rows={batch.valid.slice(0, 50)} columns={[
          { key: 'line', label: 'Linha' },
          { key: 'sku', label: 'SKU' },
          { key: 'name', label: 'Nome' },
          { key: 'category', label: 'Categoria' },
          { key: 'cost', label: 'Custo', render: (row: ProductImportRow) => money(row.cost) },
          { key: 'price', label: 'Preço', render: (row: ProductImportRow) => money(row.price) },
          { key: 'status', label: 'Ação prevista', render: (row: ProductImportRow) => existingSkus.has(row.sku.toLowerCase()) ? (batch.strategy === 'create' ? <Badge>Ignorar</Badge> : <Badge>Atualizar</Badge>) : (batch.strategy === 'update' ? <Badge>Ignorar</Badge> : <Badge>Criar</Badge>) },
        ]} />
        {batch.valid.length > 50 && <p className="muted">Exibindo as primeiras 50 de {batch.valid.length} linhas válidas.</p>}
      </section>

      <div className="toolbar"><Button disabled={pending} onClick={() => setBatch(null)}>Cancelar</Button><Button variant="primary" loading={pending} disabled={!batch.valid.length} onClick={() => void confirmImport()}>Confirmar importação</Button></div>
    </div>}</Modal>

    <Modal title="Relatório de importação" open={!!report} onClose={() => setReport(null)}>{report && <div className="stack">
      <div className="grid grid-3">
        <Stat label="Produtos criados" value={report.created} tone="green" />
        <Stat label="Produtos atualizados" value={report.updated} tone="blue" />
        <Stat label="Linhas ignoradas" value={report.skipped} tone="amber" />
      </div>
      {report.errors.length > 0 ? <details className="callout warning" open><summary><strong>{report.errors.length} linha(s) com erro</strong></summary><ul>{report.errors.slice(0, 30).map((err, i) => <li key={i}>Linha {err.line}: {err.message}</li>)}{report.errors.length > 30 && <li>... e mais {report.errors.length - 30} erro(s).</li>}</ul></details> : <p className="callout">Todas as linhas do lote foram processadas sem erros.</p>}
      <Button variant="primary" onClick={() => setReport(null)}>Concluir</Button>
    </div>}</Modal>
  </div>;
}
