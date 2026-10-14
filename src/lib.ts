export const money = (cents: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
export const date = (iso: string) => iso ? new Intl.DateTimeFormat('pt-BR').format(new Date(iso.length === 10 ? `${iso}T12:00:00` : iso)) : '—';
export const uid = () => crypto.randomUUID();
export const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export function parseMoney(value: string): number {
  const clean = value.trim().replace(/R\$\s*/g, '').replace(/\s/g, '');
  const normalized = clean.includes(',') ? clean.replace(/\./g, '').replace(',', '.') : clean;
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) throw new Error('Informe um valor válido com até duas casas decimais.');
  const amount = Math.round(Number(normalized) * 100);
  if (!Number.isSafeInteger(amount)) throw new Error('Valor acima do limite permitido.');
  return amount;
}
export function exportCsv(name: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const keys = Array.from(new Set(rows.flatMap(Object.keys)));
  const escape = (value: unknown) => { let text = String(value ?? ''); if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`; return `"${text.replace(/"/g, '""')}"`; };
  const blob = new Blob(['﻿', keys.map(escape).join(';'), '\r\n', rows.map(row => keys.map(k => escape(row[k])).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `${name}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function imageData(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) throw new Error('Use PNG, JPEG ou WebP de até 2 MB.');
  const data = await new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = () => reject(new Error('Falha ao ler imagem.')); r.readAsDataURL(file); });
  const image = new Image(); image.src = data; await image.decode(); if (image.width > 4096 || image.height > 4096) throw new Error('Imagem limitada a 4096 pixels.'); return data;
}
