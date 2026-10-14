import type { CashRegister, SaleItem } from '../../types';

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

export function csvSafe(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, typeof value === 'string' && /^[\s]*[=+@-]/.test(value) ? `'${value}` : value])));
}
