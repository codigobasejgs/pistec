/** Geração dos ícones do aplicativo da loja a partir do logotipo (canvas no navegador, saída PNG). */
export type AppIcons = Record<'192' | '512' | 'maskable' | 'apple' | 'favicon', string>;

/** Zona segura de ícone maskable: o conteúdo cabe no círculo central de 80% (spec W3C). */
export const SAFE = { any: 0.82, maskable: 0.62 };

/** Encaixa (contain) uma imagem w×h numa caixa quadrada `size`, ocupando `scale` dela, centralizada. */
export function fit(w: number, h: number, size: number, scale: number) {
  const box = size * scale, ratio = Math.min(box / w, box / h);
  const dw = Math.round(w * ratio), dh = Math.round(h * ratio);
  return { x: Math.round((size - dw) / 2), y: Math.round((size - dh) / 2), w: dw, h: dh };
}

async function load(src: string) { const img = new Image(); img.src = src; await img.decode(); return img; }

function render(img: HTMLImageElement, size: number, scale: number, background: string | null) {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Navegador sem suporte a desenho de imagens.');
  if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, size, size); }
  ctx.imageSmoothingQuality = 'high';
  const r = fit(img.naturalWidth, img.naturalHeight, size, scale); ctx.drawImage(img, r.x, r.y, r.w, r.h);
  return canvas.toDataURL('image/png');
}

/** iOS e maskable exigem fundo opaco; os ícones "any" mantêm transparência do logotipo. */
export async function makeIcons(logo: string, background: string): Promise<AppIcons> {
  const img = await load(logo);
  if (img.naturalWidth < 64 || img.naturalHeight < 64) throw new Error('Logotipo muito pequeno: use pelo menos 512 × 512 px para um ícone nítido.');
  return {
    192: render(img, 192, SAFE.any, null), 512: render(img, 512, SAFE.any, null),
    maskable: render(img, 512, SAFE.maskable, background), apple: render(img, 180, SAFE.any, background), favicon: render(img, 48, 0.9, null),
  };
}
