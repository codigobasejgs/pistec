# Impressão no PWA, tablet e celular

| Ambiente | Validação feita | Resultado |
|---|---|---|
| Desktop Chrome (1440 px) | Playwright + capturas | Central, janela Documento, prévia 80 mm e A4, etiquetas: OK |
| Tablet (820 px) | Captura | Etiquetas sem rolagem lateral |
| Celular (390 px) | Playwright + capturas | Central sem rolagem lateral; janela Documento com ações em 2 colunas |
| 320–2560 px | Suíte de responsividade existente | OK (inclui a nova rota) |
| Android / iOS / iPadOS / Windows / macOS físicos | **Não validado** | Sem aparelhos disponíveis |

Comportamento esperado por plataforma:
- **Desktop**: Imprimir abre o diálogo do sistema dentro de um iframe isolado (só o documento, sem sidebar/topbar). Conector local: não instalado.
- **Android (Chrome/PWA)**: diálogo de impressão do Android (serviço de impressão/Mopria); PDF baixado; Link usa o compartilhamento nativo (`navigator.share`).
- **iPhone/iPad (Safari/PWA)**: AirPrint pelo diálogo; PDF abre no visualizador.
- **Offline**: a venda real não é registrada offline (PDV 4.0); documentos da conta real exigem o servidor para emissão; e-mail/WhatsApp/link ficam desabilitados sem conexão. A demonstração gera documentos locais, marcados como demonstração.
- Service worker: o mesmo `sw.js` (nenhum novo). `pdf-lib` é carregado só ao gerar PDF (chunk separado, ~426 KB) e entra no precache como os demais chunks.
- "Enviado ao navegador" não significa impresso: o navegador não informa se o papel saiu.
