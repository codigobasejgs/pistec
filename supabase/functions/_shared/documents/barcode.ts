/** Códigos de barras sem dependência: Code 128 (B/C automático) e validação EAN-13. Saída = larguras de barras/espaços. */

const PATTERNS = '212222,222122,222221,121223,121322,131222,122213,122312,132212,221213,221312,231212,112232,122132,122231,113222,123122,123221,223211,221132,221231,213212,223112,312131,311222,321122,321221,312212,322112,322211,212123,212321,232121,111323,131123,131321,112313,132113,132311,211313,231113,231311,112133,112331,132131,113123,113321,133121,313121,211331,231131,213113,213311,213131,311123,311321,331121,312113,312311,332111,314111,221411,431111,111224,111422,121124,121421,141122,141221,112214,112412,122114,122411,142112,142211,241211,221114,413111,241112,134111,111242,121142,121241,114212,124112,124211,411212,421112,421211,212141,214121,412121,111143,111341,131141,114113,114311,411113,411311,113141,114131,311141,411131,211412,211214,211232,2331112'.split(',');

/** Codifica texto ASCII imprimível (32–126) em Code 128; pares de dígitos usam o conjunto C (código mais curto). */
export function code128(value: string): number[] {
  if (!value || !/^[\x20-\x7e]+$/.test(value)) throw new Error('Code 128 aceita só caracteres ASCII imprimíveis.');
  const codes: number[] = []; let set: 'B' | 'C' | '' = ''; let i = 0;
  const digitsAhead = (from: number) => { let n = 0; while (from + n < value.length && /\d/.test(value[from + n])) n++; return n; };
  while (i < value.length) {
    const run = digitsAhead(i);
    if (run >= 4 || (run >= 2 && set === 'C')) {
      if (set !== 'C') { codes.push(set ? 99 : 105); set = 'C'; }
      const pairs = Math.floor(run / 2) * 2;
      for (let k = 0; k < pairs; k += 2) codes.push(Number(value.slice(i + k, i + k + 2)));
      i += pairs; continue;
    }
    if (set !== 'B') { codes.push(set ? 100 : 104); set = 'B'; }
    codes.push(value.charCodeAt(i) - 32); i++;
  }
  const check = codes.reduce((sum, code, index) => sum + code * (index || 1), 0) % 103;
  return [...codes, check, 106].flatMap(code => PATTERNS[code].split('').map(Number));
}

/** EAN-13 válido = 13 dígitos com dígito verificador correto. Nunca geramos GTIN: só validamos o cadastrado. */
export function isEan13(value: string) {
  if (!/^\d{13}$/.test(value)) return false;
  const sum = value.slice(0, 12).split('').reduce((s, d, i) => s + Number(d) * (i % 2 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === Number(value[12]);
}

/** Código para etiqueta: GTIN válido do cadastro ou o SKU (código interno, Code 128). */
export function labelCode(product: { barcode: string; sku: string }) {
  return isEan13(product.barcode) ? { value: product.barcode, kind: 'EAN-13' as const } : { value: product.barcode && /^[\x20-\x7e]+$/.test(product.barcode) ? product.barcode : product.sku, kind: 'Code 128' as const };
}

/** Code 128 em SVG (para HTML/impressão do navegador). */
export function code128Svg(value: string, height = 40, module = 1.6) {
  const widths = code128(value); let x = 10 * module; const bars: string[] = [];
  widths.forEach((w, i) => { if (i % 2 === 0) bars.push(`<rect x="${x.toFixed(2)}" y="0" width="${(w * module).toFixed(2)}" height="${height}"/>`); x += w * module; });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${(x + 10 * module).toFixed(2)} ${height}" preserveAspectRatio="none" role="img" aria-label="Código de barras ${value.replace(/[<&"]/g, '')}"><g fill="#000">${bars.join('')}</g></svg>`;
}
