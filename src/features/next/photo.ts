/** Comprime foto no navegador (JPEG, lado maior ≤ 1280 px) para caber no limite do servidor (~500 KB). */
export async function compressPhoto(file: File, max = 1280, quality = 0.72): Promise<string> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Use foto JPEG, PNG ou WebP.');
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas'); canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  for (let q = quality; q >= 0.4; q -= 0.12) { const data = canvas.toDataURL('image/jpeg', q); if (data.length <= 680_000) return data; }
  throw new Error('Foto muito grande mesmo após compressão.');
}
