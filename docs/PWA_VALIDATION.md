# PISTEC — Validação do PWA

**Data:** 15/10/2026 · **Estado:** APROVADO COM RESSALVAS (critérios técnicos validados no Chrome; instalação real não executada).

## 1. Testes executados (`src/pwa.e2e.ts`, build de produção, Chrome headless)

| Cenário | Estado |
|---|---|
| Manifest: nome, `id`, `start_url=/demonstracao`, `scope=/`, `standalone`, cores, ícones 192/512 e maskable servidos como PNG | APROVADO |
| Service worker registrado e controlando a página a partir da 2ª carga | APROVADO |
| Offline: rotas nunca visitadas (Produtos, Financeiro) abrem do precache; dados do IndexedDB disponíveis; aviso "Sem conexão com o servidor" aparece e some ao reconectar | APROVADO |
| Atualização A→B: aviso "Nova versão disponível", página não recarrega sozinha, dados da versão A preservados, cache antigo removido | APROVADO |

Arquitetura: `public/sw.js` + plugin de ~20 linhas em `vite.config.ts` que grava a lista de precache e uma versão derivada do conteúdo. Sem Workbox. HTML e chunks ficam na mesma versão até o usuário clicar em "Atualizar agora". Capturas da landing ficam fora do precache.

## 2. Salvaguarda de atualização

`useBusyGuard` marca a operação como em andamento quando há modal aberto ou carrinho com itens no PDV; "Atualizar agora" pede confirmação nesses casos. **Implementado, sem teste automatizado do pedido de confirmação.**

## 3. Matriz por plataforma

| Plataforma | Mecanismo no código | Estado |
|---|---|---|
| Chrome Windows | `beforeinstallprompt` → botão "Instalar" | NÃO TESTADO (instalação exige navegador com interface) |
| Edge Windows | Mesmo mecanismo (Chromium) | NÃO TESTADO |
| Chrome Android | Mesmo mecanismo; ícones maskable | NÃO TESTADO |
| Safari iPhone/iPad | Sem `beforeinstallprompt`; detecção de iOS/iPadOS abre instruções (Compartilhar → Adicionar à Tela de Início) | NÃO TESTADO (modal implementado, não visto em Safari) |
| Safari macOS | Adicionar ao Dock (nativo do Safari) | NÃO TESTADO |
| Firefox | Service worker/offline; Firefox desktop não instala PWAs | NÃO TESTADO |

## 4. Como validar manualmente (pendente)

1. `npm run build && npm run preview` e abrir em `http://localhost:4173`.
2. Chrome/Edge: ícone de instalar na barra → abre em janela própria com ícone PISTEC.
3. Android (Chrome, mesma rede, via HTTPS ou `chrome://inspect` com port-forward): banner "Instalar".
4. iPhone (Safari, HTTPS): banner "Como instalar" → seguir instruções.
5. Em cada um: modo avião → reabrir → navegar → voltar online.
