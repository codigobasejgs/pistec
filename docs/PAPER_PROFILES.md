# Perfis de papel (`supabase/functions/_shared/documents/paper.ts`)

| Perfil | Tipo | Tamanho (mm) | Área útil / margem |
|---|---|---|---|
| Bobina 58 mm | térmico | 58 × contínuo | 48 mm úteis (32 colunas) |
| Bobina 80 mm | térmico | 80 × contínuo | 72 mm úteis (48 colunas) |
| A4 / A5 / A6 | página | 210×297 / 148×210 / 105×148 | margem 10 / 8 / 6 |
| Carta / Ofício (Legal) | página | 216×279 / 216×356 | margem 10 |
| Etiquetas | rolo | 30×20, 40×30, 50×30, 60×40, 100×150 | 1–2 mm |
| Folha de etiquetas | A4 | colunas, linhas, margens, espaçamentos, posição inicial configuráveis (padrão 3×10, 66,7×25,4 mm) | — |

Formato personalizado: `paperOf(id, { width, height, kind })` (perfil da impressora guarda `custom`).

## Calibração (por impressora)
Deslocamento X/Y (mm), escala (%), espaço entre etiquetas (mm), densidade e velocidade (enviadas só em ZPL/TSPL, quando definidas). HTML aplica X/Y/escala por `transform`; ZPL usa `^LH`, `~SD`, `^PR`; TSPL usa `REFERENCE`, `GAP`, `DENSITY`, `SPEED`.

## Detecção de papel — comportamento real
1. **Automático**: só via conector (QZ Tray informa tamanhos suportados pelo driver). Não implementado. "Suportado" ≠ "carregado".
2. **Perfil salvo**: o padrão — "Caixa 01 — Bobina 80 mm".
3. **Confirmação manual**: o operador troca o papel na janela Documento, vê a prévia e calibra.
O PISTEC nunca afirma ter detectado o papel.
