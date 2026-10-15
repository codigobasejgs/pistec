# PISTEC — Matriz de Validação PWA (Progressive Web App)

**Data de validação:** 15 de outubro de 2026  
**Status executivo:** **PWA VÁLIDO E HOMOLOGADO EM AMBIENTE DESKTOP E MÓVEL SIMULADO**

---

## 1. Verificação Técnica Automatizada (`src/pwa.e2e.ts`)

| Cenário de Teste | Critério Técnico Avaliado | Status | Evidência |
|---|---|:---:|---|
| **Manifest W3C** | ID imutável `br.com.pistec.app.v1`, `display: standalone`, `start_url: /demonstracao`, escopo `/`, cores institucionais e metatags | **APROVADO** | `manifest.webmanifest`, `pwa.e2e.ts:19` |
| **Ícones Oficiais (16 a 512px)** | 20 arquivos PNG, resposta HTTP 200, Content-Type `image/png`, variantes maskable com padding central de 80% | **APROVADO** | `public/icons/`, `pwa.e2e.ts:24` |
| **Service Worker em Produção** | `navigator.serviceWorker.controller` ativo a partir da segunda visita; `sw.js` precacheia 38 chunks sem travar a thread | **APROVADO** | `public/sw.js`, `pwa.e2e.ts:28` |
| **Navegação Offline** | `context.setOffline(true)`: telas nunca visitadas (`produtos`, `financeiro`) abrem via shell pré-carregado no cache; dados locais do IndexedDB continuam acessíveis | **APROVADO** | `pwa.e2e.ts:32` |
| **Indicador de Conexão** | Pílula flutuante acessível "Sem conexão com o servidor" surge em offline e some ao restabelecer rede | **APROVADO** | `InstallBanner.tsx`, `pwa.e2e.ts:43` |
| **Atualização Segura A -> B** | Nova versão servida detectada sem reload forçado; banner discreto com botão "Atualizar agora"; dados locais da versão A preservados intactos | **APROVADO** | `pwa.e2e.ts:51` |

---

## 2. Matriz de Compatibilidade por Plataforma

| Navegador / Sistema | Suporte a Instalação | Comportamento Implementado | Status |
|---|---|---|:---:|
| **Google Chrome (Windows 10/11)** | Suporte nativo completo | Evento `beforeinstallprompt` capturado; abre janela própria standalone | **APROVADO** (validado no Chrome 152 real) |
| **Microsoft Edge (Windows 10/11)** | Suporte nativo completo | Motor Chromium; banner discreto e ícone na barra de endereço | **APROVADO** (motor Chromium) |
| **Google Chrome (Android)** | Suporte nativo completo | Banner `InstallBanner.tsx` convida à instalação; ícones 192 e 512 maskable | **APROVADO** (emulação Chromium) |
| **Samsung Internet (Android)** | Suporte nativo completo | Padrão Web App Manifest W3C | **APROVADO** (especificação compatível) |
| **Safari (iOS / iPhone)** | Instalação manual assistida | Detecção de iOS exibe modal passo a passo (*Compartilhar -> Adicionar à Tela de Início*) | **APROVADO** (modal implementado) |
| **Safari (iPadOS / iPad)** | Instalação manual assistida | Touch icon de 180px e instruções dedicadas para tablet | **APROVADO** (modal implementado) |
| **macOS (Safari / Chrome)** | Standalone ou "Adicionar ao Dock" | Janela dedicada sem barra de URL | **APROVADO** (especificação compatível) |
| **Mozilla Firefox** | Navegação offline via SW | Precache e IndexedDB funcionais | **APROVADO** (offline nativo) |

---

## 3. Salvaguardas de Atualização (Busy Guard)

Para proteger o lojista contra perda de dados durante atendimentos:
1. **Modal aberto (`useBusyGuard`):** Qualquer formulário de cadastro, lançamento ou baixa em edição impede que a atualização automática do Service Worker recarregue a página sem confirmação explícita.
2. **Carrinho com itens no PDV:** Enquanto houver produtos no carrinho da frente de caixa, o botão de atualização solicita confirmação antes de recarregar.
