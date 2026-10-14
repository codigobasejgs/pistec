import type { CashRegister, Payment, ProductImportRow, SaleItem } from '../../types';
import { money } from '../../lib';

export const cents = (value: string): number => {
  const clean = value.trim().replace(/^R\$\s*/, '');
  const normalized = /^[1-9]\d{0,2}(?:\.\d{3})+(?:,\d{1,2})?$/.test(clean) ? clean.replace(/\./g, '').replace(',', '.') : clean.replace(',', '.');
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) throw new Error('Informe um valor monetário positivo com até duas casas decimais.');
  const result = Math.round(Number(normalized) * 100);
  if (!Number.isSafeInteger(result)) throw new Error('Valor monetário fora do limite.');
  return result;
};
export const decimal = (value: number) => (value / 100).toFixed(2);
export const sumItems = (items: SaleItem[]) => items.reduce((sum, item) => sum + item.quantity * item.price, 0);
export const inPeriod = (value: string, start: string, end: string) => (!start || value.slice(0, 10) >= start) && (!end || value.slice(0, 10) <= end);
export const matches = (query: string, ...values: unknown[]) => values.join(' ').normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('pt-BR').includes(query.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('pt-BR'));
export const cashExpected = (cash: CashRegister) => cash.opening + cash.movements.reduce((sum, movement) => sum + movement.amount, 0);

// ponytail: CSV UTF-8 de até 2 MB; para cargas maiores usar importação por lotes no backend.
export function parseCsv(text: string): Record<string, string>[] {
  if (text.length > 2_000_000) throw new Error('CSV excede 2 MB.');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const firstLine = text.split(/\r?\n/)[0] ?? '';
  const separator = firstLine.includes(';') ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [], field = '', quoted = false, closed = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') { quoted = false; closed = true; }
      else field += char;
    } else if (char === separator || char === '\n' || char === '\r') {
      row.push(field); field = ''; closed = false;
      if (char !== separator) {
        if (char === '\r' && text[i + 1] === '\n') i++;
        if (row.some(cell => cell.trim())) rows.push(row);
        row = [];
      }
    } else if (char === '"' && !field && !closed) quoted = true;
    else {
      if (closed || char === '"') throw new Error('CSV com aspas inválidas.');
      field += char;
    }
  }
  if (quoted) throw new Error('CSV com aspas não fechadas.');
  row.push(field);
  if (row.some(cell => cell.trim())) rows.push(row);
  const headers = rows.shift()?.map(header => header.trim()) ?? [];
  if (!headers.length || headers.some(header => !header) || new Set(headers).size !== headers.length) throw new Error('Cabeçalhos CSV vazios ou repetidos.');
  return rows.map((cells, index) => {
    if (cells.length !== headers.length) throw new Error(`Linha ${index + 2}: quantidade de colunas inválida.`);
    return Object.fromEntries(headers.map((header, i) => [header, cells[i].trim()]));
  });
}

/** amounts = valor ENTREGUE por forma. Só Dinheiro gera troco; Pix/cartão nunca excedem o total. */
export function paymentSummary(total: number, payments: Payment[]) {
  const received = payments.reduce((sum, row) => sum + row.amount, 0);
  const cash = payments.filter(row => row.method === 'Dinheiro').reduce((sum, row) => sum + row.amount, 0);
  const other = received - cash;
  const remaining = Math.max(0, total - received);
  const change = other > total ? 0 : Math.max(0, cash - (total - other));
  const error = other > total ? `Pix e cartões excedem o total em ${money(other - total)}. Troco só em dinheiro.` : remaining ? `Pagamento insuficiente: faltam ${money(remaining)}.` : '';
  return { received, cash, other, remaining, change, error };
}

export const IMPORT_FIELDS = [
  ['sku', 'SKU', true], ['name', 'Nome', true], ['category', 'Categoria', false], ['brand', 'Marca', false], ['barcode', 'Código de barras', false], ['unit', 'Unidade', false],
  ['cost', 'Custo (R$)', false], ['price', 'Preço (R$)', true], ['min', 'Estoque mínimo', false], ['max', 'Estoque máximo', false], ['location', 'Localização', false],
] as const;
export type ImportField = typeof IMPORT_FIELDS[number][0];
export type ImportMapping = Partial<Record<ImportField, string>>;
const fold = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const ALIASES: Record<ImportField, string[]> = { sku: ['sku', 'codigo', 'cod', 'referencia', 'ref'], name: ['name', 'nome', 'produto', 'descricao'], category: ['category', 'categoria', 'grupo'], brand: ['brand', 'marca', 'fabricante'], barcode: ['barcode', 'ean', 'gtin', 'codigodebarras'], unit: ['unit', 'unidade', 'un', 'und'], cost: ['cost', 'custo', 'precocusto'], price: ['price', 'preco', 'precovenda', 'venda', 'valor'], min: ['min', 'minimo', 'estoqueminimo'], max: ['max', 'maximo', 'estoquemaximo'], location: ['location', 'localizacao', 'local', 'endereco'] };
export function guessMapping(headers: string[]): ImportMapping {
  const used = new Set<string>();
  return Object.fromEntries(IMPORT_FIELDS.map(([key]) => { const hit = headers.find(header => !used.has(header) && ALIASES[key].includes(fold(header))); if (hit) used.add(hit); return [key, hit]; }).filter(([, header]) => header));
}
export const IMPORT_TEMPLATE = 'sku;name;category;brand;barcode;unit;cost;price;min;max;location\nFLT-001;Filtro de óleo exemplo;Filtros;Marca X;7890000000001;UN;12,50;29,90;5;40;A1-03\n';
const toInteger = (value: string, label: string) => { const text = value.trim() || '0'; if (!/^\d+$/.test(text)) throw new Error(`${label} deve ser inteiro ≥ 0.`); return Number(text); };
const toCents = (value: string, label: string) => { try { return cents(value.trim() || '0'); } catch { throw new Error(`${label} inválido: "${value}".`); } };

/** Converte linhas já lidas (CSV ou XLSX como texto) em ProductImportRow, validando por linha. Linha = número na planilha (cabeçalho = 1). */
export function mapImportRows(rows: Record<string, string>[], mapping: ImportMapping) {
  const valid: ProductImportRow[] = [], errors: { line: number; message: string }[] = [];
  const missing = IMPORT_FIELDS.filter(([key, , required]) => required && !mapping[key]).map(([, label]) => label);
  if (missing.length) return { valid, errors: [{ line: 1, message: `Mapeie as colunas obrigatórias: ${missing.join(', ')}.` }] };
  const seen = new Set<string>();
  rows.forEach((source, index) => {
    const line = index + 2;
    const get = (key: ImportField) => String(mapping[key] ? source[mapping[key]!] ?? '' : '').trim();
    try {
      const sku = get('sku'), name = get('name');
      if (!sku || !name) throw new Error('SKU e nome são obrigatórios.');
      if (sku.length > 60 || name.length > 200) throw new Error('SKU (60) ou nome (200) acima do limite.');
      if (seen.has(sku.toLowerCase())) throw new Error(`SKU ${sku} repetido na planilha; mantida a primeira ocorrência.`);
      const row: ProductImportRow = { line, sku, name, category: get('category'), brand: get('brand'), barcode: get('barcode'), unit: get('unit'), cost: toCents(get('cost'), 'Custo'), price: toCents(get('price'), 'Preço'), min: toInteger(get('min'), 'Mínimo'), max: toInteger(get('max'), 'Máximo'), location: get('location') };
      if (row.max > 0 && row.max < row.min) throw new Error('Máximo menor que o mínimo.');
      seen.add(sku.toLowerCase()); valid.push(row);
    } catch (error) { errors.push({ line, message: error instanceof Error ? error.message : 'Linha inválida.' }); }
  });
  return { valid, errors };
}
/** Matriz XLSX (primeira linha = cabeçalho) → registros texto. Números ficam como texto exato via parseNumber. */
export function sheetToRecords(matrix: unknown[][]): Record<string, string>[] {
  const [head = [], ...body] = matrix;
  const headers = head.map(cell => String(cell ?? '').trim());
  if (!headers.length || headers.some(header => !header) || new Set(headers).size !== headers.length) throw new Error('Cabeçalhos vazios ou repetidos na primeira linha da planilha.');
  return body.filter(row => row.some(cell => cell !== null && String(cell).trim())).map(row => Object.fromEntries(headers.map((header, i) => { const cell = row[i]; return [header, cell instanceof Date ? cell.toISOString().slice(0, 10) : String(cell ?? '').trim()]; })));
}

export function csvSafe(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, typeof value === 'string' && /^[\s]*[=+@-]/.test(value) ? `'${value}` : value])));
}
