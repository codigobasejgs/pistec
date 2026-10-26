# PDV Elite 4.0 + White Label PWA 5.0 (2026-10-28)

Capturas reais (dados demo): `docs/screenshots/pdv/` (desktop, tablet, celular; pagamento, recibo, Meu Aplicativo). Gerar de novo: `npm run dev` e `node scripts/pdv-screenshots.mjs`.

## 1. PDV Elite 4.0 (`src/features/erp/Pos.tsx`)

| Item | Implementação |
|---|---|
| Cabeçalho compacto | Loja · filial · operador · horário de abertura · dinheiro esperado; Abrir caixa / Fechar caixa (modal com contagem e motivo da diferença, mesma RPC `close_cash`) |
| Layout | Catálogo 60% / carrinho 40% (fixo ao rolar); ≤ 760 px vira etapas Produtos → Carrinho → Pagamento com barra "Ver carrinho" |
| Catálogo | Busca por nome/SKU/código/marca, categorias em chips, favoritos (por empresa, no navegador), cartões ou lista, estoque da filial com aviso de baixo/zerado |
| Leitor de código | Leitor USB/Bluetooth = teclado: código + Enter adiciona (código de barras exato → SKU exato → resultado único); código inexistente avisa |
| Câmera | Só quando o navegador tem `BarcodeDetector` (Chrome Android); sem suporte o botão não aparece. `Permissions-Policy` liberou `camera=(self)` |
| Carrinho | + / − / quantidade digitada (limite = disponível), remover, limpar, cliente com cadastro rápido (`save_customer`), desconto/acréscimo recolhidos |
| Cobrar | Gaveta lateral de pagamento (F9): pagamentos mistos, "Completar", troco só em dinheiro — regras e mensagens anteriores mantidas |
| Idempotência | Mesmo `requestId` por carrinho; reenvio após timeout não duplica (servidor compara hash). Renova só após concluir/limpar |
| Offline | Conta real sem conexão: "Finalizar venda" bloqueado com aviso; nenhuma venda offline |
| Recibo | Escolha 58 mm / 80 mm / A4 (salvo no aparelho) + CSS de impressão; "Nova venda" volta o foco à busca |
| Atalhos | F2 busca · F4 cliente · F6 desconto · F8 suspender · F9 cobrar/finalizar · Esc fecha pagamento; painel de atalhos no ícone de teclado |
| Suspensos | Faixa compacta com retomar/descartar (RPCs inalteradas) |
| Tour / ajuda | Tour PDV com 13 passos (inclui pagamento via `before: 'pdv-charge'`); 6 artigos novos de PDV |

Sem mudança de banco no PDV: `complete_sale`, `save_record`, `transition_record`, `open_cash`, `close_cash`, `save_customer` continuam validando tudo no servidor.

## 2. White Label PWA 5.0

**Arquitetura escolhida:** caminho por empresa na mesma origem — `https://<app>/app/m/<slug>`. Subdomínio por empresa (preferido) exige domínio próprio + DNS curinga, que ainda não existem; não declarado como funcionando.

| Parte | Arquivo |
|---|---|
| Tabela `tenant_apps` (RLS forçada; leitura só membros e Super Admin), `save_tenant_app` (permissão `personalizacao/editar`, plano com `custom_branded_pwa` ou `*`, valida 5 ícones PNG, versão incremental, auditoria), `tenant_app_public` (anônimo; só identidade visual de apps ativos), `admin_set_tenant_app` (perfil `tenants.edit`, justificativa, notifica a loja) | `supabase/migrations/20261028000100_tenant_apps.sql` |
| Manifest e ícones por empresa (Vercel Function, mesma origem; `id` e `start_url` = `/app/m/<slug>`, `scope` `/app/`, ícones com `?v=<versão>`) | `api/tenant-app.ts` |
| "Meu Aplicativo" em Personalização: nome, nome curto (12), cores com contraste, ícones gerados do logotipo (192, 512, maskable com zona segura, Apple 180 com fundo sólido, favicon), prévias, publicar, link, QR Code (`qrcode-generator`, MIT, sem dependências) | `src/features/settings/MyApp.tsx`, `appIcons.ts` |
| Entrada da marca: troca manifest/ícones/título/cor; logado → loja; não logado → login com a marca ("Tecnologia PISTEC") | `src/real/BrandApp.tsx` |
| Super Admin → Clientes e empresas → **Aplicativos personalizados** (lista, versão, endereço, suspender/reativar) | `src/real/admin/Apps.tsx` |
| Tour "Meu Aplicativo" (10 passos), categoria de ajuda "Meu Aplicativo Personalizado" (3 artigos) e artigo no Super Admin | `tours.ts`, `help.ts`, `helpContent.ts` |

Mantido: um único service worker (`/sw.js`), logotipo oficial PISTEC intacto, demonstração local (lá o Meu Aplicativo só gera prévia; publicar exige conta real). Ícones guardados como PNG base64 no banco (`ponytail`: migrar para Storage quando houver volume).

## 3. QA executado

| Verificação | Resultado |
|---|---|
| `tsc -b`, `eslint .`, `npm run build` | OK |
| Vitest | 224/224, incluindo `supabase/tests/tenant-apps.test.ts` (A e B isolados, plano Essencial recusado, ícone SVG recusado, suspensão/reativação com auditoria, leitura pública mínima) e `api/tenant-app.test.ts` (manifests diferentes para A e B, slug/asset inválidos, 404) |
| Playwright (local) | Rodada completa: 39/40. A falha (rolagem lateral de 14 px no PDV a 320 px) foi corrigida, e os 26 testes de responsividade, ERP e PWA foram rodados de novo e passaram. Fluxos de venda atualizados para o botão Cobrar; novos: leitor + Enter, F2/F9/Esc, celular 390 px sem rolagem lateral, Meu Aplicativo gera ícones/QR e não publica na demo; 320–2560 px sem rolagem lateral |

### Não feito / pendente
- **Migration não aplicada no Supabase remoto e nada enviado ao GitHub/Vercel** (aguardando autorização). Sem isso, `/api/tenant-app` e "Publicar aplicativo" não funcionam em produção.
- Instalação real em Android/iPhone/desktop não testada em aparelho físico; troca dinâmica do manifest pelo JavaScript é suportada pelo Chrome, mas não verificada aqui.
- iPhone não atualiza ícone já instalado (precisa remover e adicionar de novo).
- Push continua com o ícone do PISTEC (o service worker é único); personalizar por empresa exige enviar o ícone no payload.
- Leitura por câmera depende do navegador (sem biblioteca de fallback para iOS).
- Subdomínio por empresa, Storage para ícones, impressão direta em impressora térmica (ESC/POS) e teste com leitor de tela.
