# PISTEC — Tecnologia que move seu negócio

Frontend SaaS multiempresa para oficinas mecânicas, oficinas de motocicletas, motopeças e autopeças.

**Versão 2.0 Homologada:** PWA instalável, troco no PDV, baixas parciais no financeiro, cupons promocionais SaaS, importação de planilhas XLSX e CSV, tour guiado interativo sobre os elementos reais, sessão demonstrativa persistida no navegador e 140 testes automatizados aprovados.

---

## 🚀 Como Executar

```bash
# 1. Instalar dependências
npm install

# 2. Iniciar servidor de desenvolvimento (http://127.0.0.1:5173)
npm run dev

# 3. Gerar build de produção e testar prévia local
npm run build
npm run preview
```

---

## 🧪 Suíte de Testes e Homologação

```bash
# Checagem estrita de tipos TypeScript (zero erros)
npm run typecheck

# Auditoria de código ESLint (zero erros e zero avisos)
npm run lint

# Testes unitários e de integração (140 testes passando)
npm test

# Testes de ponta a ponta no navegador Chrome real (18 testes passando)
npm run test:e2e
```

Para recapturar todas as telas reais em alta resolução para a Landing Page (com `npm run dev` ativo):

```bash
npm run screenshots && python scripts/assets.py
```

---

## 📱 PWA (Progressive Web App Instalável)

O PISTEC pode ser instalado como aplicativo dedicado em computadores e celulares:

- **Android (Chrome/Edge):** Toque em "Instalar PISTEC" no banner ou no menu do navegador.
- **iPhone / iPad (Safari):** Toque no botão de compartilhar do Safari e selecione *"Adicionar à Tela de Início"*.
- **Windows / macOS / Linux (Chrome/Edge):** Clique no ícone de instalação na barra de endereço para abrir em janela própria sem abas.

---

## 🏢 Ambientes e Rotas

| Ambiente | Rota | Como Acessar na Demonstração |
|---|---|---|
| **Site Comercial** | `/`, `/planos`, `/funcionalidades`, `/oficinas`, `/motopecas`, `/autopecas`, `/contato`, `/cadastro`, `/licenca-perpetua`, `/termos`, `/privacidade` | Acesso público direto |
| **ERP da Loja** | `/loja/:tenantSlug/*` (ex.: `/loja/moto-prime/dashboard`) | Em `/demonstracao`: selecione a empresa e o papel desejado |
| **Super Admin** | `/admin/*` | Em `/demonstracao`: clique em *"Entrar como Super Admin"* |

Empresas de demonstração prontas:
1. **Moto Prime Peças** (`moto-prime`): Motopeças, Plano Premium, matriz e filial centro.
2. **Oficina Rota 88** (`oficina-rota-88`): Oficina mecânica, Plano Profissional.
3. **Auto Center Peças** (`auto-center`): Autopeças, Plano Essencial.
E mais 5 empresas cadastradas em diferentes situações (em teste, vencida, suspensa, cancelada) para visualização no Super Admin.

Para reiniciar todos os dados: Menu Sistema -> **Configurações** -> *"Restaurar todos os dados demo"*.

---

## 📚 Documentação Técnica

- `docs/QA_FINAL_REPORT.md`: Relatório completo de homologação e matriz módulo por módulo.
- `docs/PWA_IMPLEMENTATION.md`: Arquitetura do PWA, Web App Manifest, Service Worker e ícones oficiais.
- `docs/UX_USABILITY_REPORT.md`: Desafio do usuário iniciante (12 tarefas), termos simples e acessibilidade WCAG.
- `docs/SUPABASE.md`: Roteiro e checklist para futura conexão com banco Supabase e autenticação real.
- `docs/CONTRACT.md`: Contratos de domínio, assinaturas de funções e regras transacionais.
