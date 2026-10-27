/** Perfis de papel em milímetros. "printable" = largura útil (bobinas térmicas não imprimem até a borda). */
export type PaperKind = 'thermal' | 'page' | 'label';
export interface Paper { id: string; name: string; kind: PaperKind; width: number; height: number | null; printable: number; margin: number; columns?: number }
export interface Calibration { offsetX: number; offsetY: number; scale: number; gap: number; density?: number; speed?: number }
export const DEFAULT_CALIBRATION: Calibration = { offsetX: 0, offsetY: 0, scale: 100, gap: 2 };

export const PAPERS: Paper[] = [
  { id: 'thermal-58', name: 'Bobina 58 mm', kind: 'thermal', width: 58, height: null, printable: 48, margin: 2, columns: 32 },
  { id: 'thermal-80', name: 'Bobina 80 mm', kind: 'thermal', width: 80, height: null, printable: 72, margin: 3, columns: 48 },
  { id: 'a4', name: 'A4 (210 × 297 mm)', kind: 'page', width: 210, height: 297, printable: 190, margin: 10 },
  { id: 'a5', name: 'A5 (148 × 210 mm)', kind: 'page', width: 148, height: 210, printable: 132, margin: 8 },
  { id: 'a6', name: 'A6 (105 × 148 mm)', kind: 'page', width: 105, height: 148, printable: 93, margin: 6 },
  { id: 'letter', name: 'Carta (216 × 279 mm)', kind: 'page', width: 216, height: 279, printable: 196, margin: 10 },
  { id: 'legal', name: 'Ofício/Legal (216 × 356 mm)', kind: 'page', width: 216, height: 356, printable: 196, margin: 10 },
  { id: 'label-30x20', name: 'Etiqueta 30 × 20 mm', kind: 'label', width: 30, height: 20, printable: 28, margin: 1 },
  { id: 'label-40x30', name: 'Etiqueta 40 × 30 mm', kind: 'label', width: 40, height: 30, printable: 38, margin: 1 },
  { id: 'label-50x30', name: 'Etiqueta 50 × 30 mm', kind: 'label', width: 50, height: 30, printable: 48, margin: 1 },
  { id: 'label-60x40', name: 'Etiqueta 60 × 40 mm', kind: 'label', width: 60, height: 40, printable: 58, margin: 1 },
  { id: 'label-100x150', name: 'Etiqueta 100 × 150 mm', kind: 'label', width: 100, height: 150, printable: 96, margin: 2 },
];
export const paperOf = (id: string, custom?: { width: number; height: number | null; kind: PaperKind }): Paper =>
  PAPERS.find(p => p.id === id) ?? (custom ? { id, name: `Personalizado ${custom.width} × ${custom.height ?? '∞'} mm`, ...custom, printable: Math.max(10, custom.width - 4), margin: 2 } : PAPERS[1]);

/** Folha de etiquetas (A4 Pimaco e similares): posição de cada etiqueta em mm, começando de uma posição inicial. */
export interface Sheet { columns: number; rows: number; top: number; left: number; labelWidth: number; labelHeight: number; gapX: number; gapY: number; start: number }
export function sheetSlots(sheet: Sheet, count: number) {
  const perPage = sheet.columns * sheet.rows; if (perPage < 1) throw new Error('Folha sem etiquetas.');
  return Array.from({ length: count }, (_, i) => { const n = i + Math.max(0, sheet.start - 1); const slot = n % perPage;
    return { page: Math.floor(n / perPage), x: sheet.left + (slot % sheet.columns) * (sheet.labelWidth + sheet.gapX), y: sheet.top + Math.floor(slot / sheet.columns) * (sheet.labelHeight + sheet.gapY) }; });
}

/** mm → pontos da impressora (8 dots/mm = 203 dpi; 12 = 300 dpi). */
export const dots = (mm: number, dpi = 203) => Math.round(mm * dpi / 25.4);
