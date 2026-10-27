# Matriz de compatibilidade de impressão

**Nenhuma impressora física foi testada nesta entrega** (não havia equipamento disponível). Estados possíveis: Validado fisicamente · Validado por emulação · Compatível por driver sem teste físico · Não validado · Incompatível conhecido.

| Fabricante | Modelo (exemplos) | SO | Driver | Conexão | Protocolo | Papel | Método | Resultado | Limitações | Evidência |
|---|---|---|---|---|---|---|---|---|---|---|
| Qualquer | Impressora comum instalada | Windows/macOS/Linux | do fabricante | USB/rede | — | A4/A5/Carta | Navegador | Compatível por driver sem teste físico | Escolha no diálogo do sistema | Prévia/PDF gerados (docs/print-samples) |
| Epson | TM-T20X, TM-T88 | Windows | Epson APD | USB | ESC/POS | 80 mm | Navegador / Conector | Compatível por driver sem teste físico; ESC/POS validado por emulação (bytes) | QR nativo depende do firmware | `escpos` unit test; `venda-80mm.escpos.bin` |
| Elgin | i7, i9 | Windows | Elgin | USB | ESC/POS | 80/58 mm | Navegador / Conector | Não validado | Confirmar code page (CP860/CP850) | — |
| Bematech | MP-4200 TH | Windows | Bematech | USB | ESC/POS (modo) | 80 mm | Navegador | Não validado | Modelos antigos usam ESC/Bema | — |
| Daruma | DR800 | Windows | Daruma | USB | ESC/POS (modo) | 80 mm | Navegador | Não validado | Verificar modo ESC/POS | — |
| Gertec / Control iD | G250 / Print iD | Windows | do fabricante | USB | ESC/POS | 80 mm | Navegador | Não validado | — | — |
| Zebra | ZD220, GC420t | Windows | ZDesigner | USB | ZPL / EPL | 40×30, 100×150 | Arquivo ZPL / Navegador | ZPL validado por emulação (comandos) | Envio direto exige conector; GC420 usa EPL ou ZPL conforme config | `etiquetas-*.zpl`, unit test |
| TSC / Argox / Elgin L42 | TE200, OS-214, L42 Pro | Windows | Seagull/do fabricante | USB | TSPL / EPL | 40×30, 50×30 | Arquivo TSPL / Navegador | TSPL validado por emulação (comandos) | Argox pode estar em PPLA/PPLB (não suportado) | `etiquetas-*.tspl` |
| Godex / Honeywell | G500, PC42t | Windows | do fabricante | USB | EZPL/ZPL (emulação) | etiqueta | Navegador | Não validado | Emulação ZPL depende do modelo | — |
| Brother / Dymo | QL-800 / LabelWriter | Windows/macOS | do fabricante | USB | raster proprietário | etiqueta contínua | Navegador | Compatível por driver sem teste físico | Sem protocolo aberto: só via driver | — |
| HP / Canon / Samsung | laser/jato | Todos | do fabricante | USB/Wi-Fi | — | A4, folhas de etiqueta | Navegador | Compatível por driver sem teste físico | Folha de etiqueta exige "Escala 100%" | Prévia A4 |
| Qualquer | Android (serviço de impressão) / iPhone (AirPrint) | Android/iOS | Mopria/AirPrint | Wi-Fi | — | A4 | Navegador | Não validado | Sem impressão silenciosa | — |

Para registrar uma homologação física: imprimir a página de teste e um comprovante, anotar modelo/firmware/driver/papel e anexar foto em `docs/evidence/`.
