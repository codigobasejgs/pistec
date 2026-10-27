# Configuração de impressoras

## Modo 1 — Navegador / PWA (padrão, implementado)
Funciona com qualquer impressora instalada no sistema operacional (Windows, macOS, Linux, Android com serviço de impressão, iPhone/iPad com AirPrint).
1. Instale o driver do fabricante e imprima uma página de teste pelo próprio sistema.
2. PISTEC → Sistema → Impressão e documentos → Configurar impressora.
3. Tipo → Método "Navegador" → nome (ex.: "Caixa 01") → papel → imprimir teste → responder como saiu → salvar.
4. No diálogo do sistema: escolha a impressora, **Margens: Nenhuma**, **Escala: 100%**, desmarque **Cabeçalhos e rodapés**. O Chrome lembra a última impressora.

O navegador **não** lista impressoras nem informa o papel carregado; o PISTEC usa o papel salvo no perfil. Cada perfil fica ligado à **estação** (nome guardado neste navegador): a impressora do computador do caixa não é assumida no celular.

## Modo 2 — Conector local (avaliado; não instalado)

| Opção | Prós | Contras / custos | Decisão |
|---|---|---|---|
| **QZ Tray** (open source, LGPL-2.1) | Lista impressoras, envia RAW (ESC/POS, ZPL, TSPL, EPL) e PDF, Windows/macOS/Linux, JavaScript no navegador | Exige instalar Java runtime + app em cada computador; para produção sem aviso de "site não confiável" é preciso certificado de assinatura (licença comercial QZ, paga) ou certificado próprio configurado em cada máquina | **Recomendado** como conector principal quando a loja quiser impressão direta |
| PrintNode (SaaS) | Fila na nuvem, impressão remota, API REST | Assinatura mensal por conta/computadores; dados do documento passam pelo provedor; cliente instala agente | Alternativa para redes/várias lojas |
| Conector próprio | Controle total | Manutenção de instalador, assinatura de código, atualização e segurança em 3 sistemas | Não justificado agora |

O PISTEC já gera os comandos (ESC/POS, ZPL, TSPL, EPL) e salva o protocolo no perfil; o envio direto via QZ Tray **não foi implementado** porque exige instalação autorizada e certificado. Enquanto isso, os comandos podem ser baixados e enviados pelo utilitário do fabricante (ex.: Zebra Setup Utilities, TSC Console, Bartender, `copy /b arquivo.zpl \\\\PC\\Impressora` no Windows com impressora compartilhada RAW).

## Modo 3 — Térmicas por protocolo
- **ESC/POS** (cupom): texto CP860, negrito, QR (GS ( k), Code 128 (GS k), corte parcial, abertura de gaveta opcional, logo por raster GS v 0 (requer conversão monocromática). Confirme no manual: nem todo modelo aceita QR nativo ou CP860.
- **ZPL** (Zebra e compatíveis), **TSPL/TSPL2** (TSC, Elgin L42, Argox em modo TSPL), **EPL2** (Zebras antigas, Argox em modo EPL). Medidas em dots: 203 dpi (8 dots/mm) por padrão; 300 dpi configurável no código.

## Modo 4 — Rede / serviço
Impressora de rede ou compartilhada: instale no sistema operacional e use o Modo 1. O backend do PISTEC **nunca** envia comandos a IP/porta informados pelo navegador (evita SSRF). IPP/CUPS direto depende de infraestrutura local (conector) — não implementado.
