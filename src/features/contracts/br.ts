// Validações e máscaras brasileiras (espelho de app.valid_cpf / app.valid_cnpj; o servidor sempre revalida).
export const digits = (v: string) => v.replace(/\D/g, '');
export function cpfValid(v: string) {
  const d = digits(v); if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const dv = (n: number) => { let s = 0; for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}
export function cnpjValid(v: string) {
  const d = digits(v); if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const dv = (n: number) => { const w = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]; const r = w.reduce((s, x, i) => s + x * Number(d[i]), 0) % 11; return r < 2 ? 0 : 11 - r; };
  return dv(12) === Number(d[12]) && dv(13) === Number(d[13]);
}
export const maskDoc = (v: string) => { const d = digits(v).slice(0, 14);
  return d.length <= 11 ? d.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2') : d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{0,2})/, '$1.$2.$3/$4-$5'); };
export const maskPhone = (v: string) => { const d = digits(v).slice(0, 11); return d.length > 10 ? d.replace(/^(\d{2})(\d{5})(\d{0,4})/, '($1) $2-$3') : d.replace(/^(\d{2})(\d{4})(\d{0,4})/, '($1) $2-$3'); };
