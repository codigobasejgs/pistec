# PISTEC — Documentação Técnica PWA (Progressive Web App)

## 1. Visão Geral da Arquitetura PWA

O PISTEC foi transformado em uma Progressive Web App completa, moderna e instalável, mantendo a stack SPA (React 19 + TypeScript + Vite) sem necessidade de reescritas em frameworks móveis proprietários.

```
public/
├── manifest.webmanifest   <- Configurações W3C, atalhos, categorias e ícones
├── sw.js                  <- Service Worker (Cache-first estáticos / Network-first SPA)
└── icons/                 <- 20 ícones PNG regulares e maskable (16px a 512px)
src/
└── app/
    └── InstallBanner.tsx  <- Componente de instalação com suporte específico para iOS
```

---

## 2. Web App Manifest (`manifest.webmanifest`)

- **Identificador Único e Imutável:** `id: "br.com.pistec.app.v1"`.
- **Nome Completo:** `PISTEC — Gestão Automotiva`.
- **Nome Curto (Tela Inicial):** `PISTEC`.
- **Start URL Neutra:** `/demonstracao` (evita falhas de inicialização em rotas privadas sem sessão).
- **Escopo:** `/` (cobre toda a aplicação).
- **Modo de Exibição:** `standalone` (remove barras do navegador e roda como aplicativo nativo em janela própria).
- **Orientação:** `any` (adaptação total para smartphones em retrato e tablets/notebooks em paisagem).
- **Cores Oficiais:** `theme_color: "#061B3D"`, `background_color: "#061B3D"`.
- **Atalhos Rápidos de Acesso (App Shortcuts):**
  - Frente de Caixa (PDV)
  - Ordens de Serviço (OS)
  - Dashboard Executivo

---

## 3. Matriz Completa de Ícones Oficiais (20 arquivos)

Todos os ícones foram gerados matematicamente a partir do logotipo oficial metálico original (`logo (1).png`), com renderização em fundo institucional `#061B3D`:

| Resolução | Arquivo Regular | Arquivo Maskable (Área Segura 80%) | Finalidade Principal |
|---|---|---|---|
| **16x16** | `icon-16x16.png` | — | Favicon de aba de navegador |
| **32x32** | `icon-32x32.png` | — | Favicon padrão desktop |
| **48x48** | `icon-48x48.png` | — | Ícone do banner de instalação |
| **72x72** | `icon-72x72.png` | — | Dispositivos legados de baixa densidade |
| **96x96** | `icon-96x96.png` | — | Atalhos rápidos (shortcuts do manifest) |
| **144x144** | `icon-144x144.png` | — | Tiles do Windows 10/11 |
| **180x180** | `icon-180x180.png` | — | Apple Touch Icon (iPhone / iPad) |
| **192x192** | `icon-192x192.png` | `icon-maskable-192x192.png` | Ícone padrão da tela inicial Android |
| **384x384** | `icon-384x384.png` | — | Splash screen em telas móveis de alta densidade |
| **512x512** | `icon-512x512.png` | `icon-maskable-512x512.png` | Splash screen principal e loja PWA |

---

## 4. Estratégia de Cache e Service Worker (`sw.js`)

1. **Precache de Shell Estático (`install`):**
   - O Service Worker realiza o precache silencioso do shell da aplicação (`/index.html`, `/manifest.webmanifest`, ícones e logos principais).
   - Não bloqueia nem interrompe operações abertas pelo operador.
2. **Navegações SPA (`fetch` com `mode: 'navigate'`):**
   - Estratégia **Network-first com fallback para o `/index.html` cacheado**.
   - Garante que novas rotas digitadas diretamente na barra de endereço abram instantaneamente mesmo sem sinal de internet.
3. **Assets com Hash (`/assets/*`, `/icons/*`, `/brand/*`):**
   - Estratégia **Cache-first**. Como o Vite gera hashes únicos em cada build (`index-DkzS1geN.js`), assets cacheados são servidos com máxima velocidade e zero latência.
4. **Limpeza Automática de Cache (`activate`):**
   - Versões antigas do cache são expurgadas na ativação do Service Worker, eliminando risco de telas brancas pós-deploy.
5. **Segurança de Dados:**
   - **Nenhum dado dinâmico, pessoal ou financeiro é gravado no Cache Storage**. Toda a persistência de negócios reside no IndexedDB local encriptado pelo próprio navegador.

---

## 5. Experiência Multi-Plataforma

- **Android (Chrome, Samsung Internet, Edge):**
  - O evento nativo `beforeinstallprompt` é interceptado.
  - O banner discreto `InstallBanner.tsx` surge no rodapé convidando o usuário à instalação.
- **iOS / iPadOS (Safari):**
  - A API `beforeinstallprompt` não é disponibilizada pela Apple.
  - O sistema detecta o ambiente iOS e abre um modal passo a passo ilustrado: *Toque em Compartilhar -> Adicionar à Tela de Início*.
- **Desktop (Windows / macOS / Linux):**
  - No Chrome e Edge desktop, o ícone de instalação surge na barra de endereço e o aplicativo abre como janela independente com atalhos de janela e sem elementos de navegador.
