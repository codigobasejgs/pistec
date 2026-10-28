# Contratação a partir de /planos (correção de 01/11/2026)

## O que mudou

- **Landing:** saiu a aba "Contrato" do menu e o link do rodapé. `/contrato` antigo redireciona para `/planos`. A página pública independente (`PublicContract.tsx`) foi removida. Termos e Privacidade continuam.
- **Planos:** o botão principal de cada card é **Contratar {plano}** → `/app/contratar/{plano}?periodo={mensal|trimestral|anual}`. A demonstração continua como link secundário ("Experimentar na demonstração"). Enterprise segue em "Falar com consultor".
- **Jornada única** (`src/features/contracts/Hire.tsx`):

| Etapa | O que acontece | Login |
|---|---|---|
| 1. Plano e condições | plano e periodicidade da URL já selecionados; valor, equivalente mensal, economia, limites, recursos; condições (renovação, cancelamento, reajuste, inadimplência, pagamento); identidade da contratada; texto integral da versão vigente (ou minuta, marcada) | não exige |
| — | "Entrar e continuar" / "Criar conta": o plano fica guardado (`localStorage` só com o caminho, sem dados pessoais) e volta após login ou confirmação de e-mail | — |
| — | sem empresa: "Cadastrar empresa" já vem com o plano escolhido e devolve para a contratação | sim |
| 2. Empresa | dados autopreenchidos do cadastro; CEP real (ViaCEP/BrasilAPI) | sim |
| 3. Representante | nome, CPF, cargo, e-mail, telefone, declaração de poderes | sim |
| 4. Contrato | servidor congela plano/preço/limites/partes (`prepare_contract`); cabeçalho do documento, quadro **SEU PLANO CONTRATADO**, índice de cláusulas, texto integral, PDF de conferência, aceite explícito (não pré-marcado) | sim |
| 5. Assinatura | Autentique (convite por e-mail); conclusão só com confirmação do provedor | sim |
| 6. Pagamento | InfinitePay após assinatura de todos; checkout idempotente | sim |
| 7. Conclusão | resumo, contrato assinado, Minha assinatura | sim |

- **Trocar plano/periodicidade ou corrigir dados** antes do envio: `discard_prepared_contract` cancela o contrato preparado (fica no histórico) e outro é gerado. Depois do envio, o plano fica travado.
- **Retomada:** ao abrir a contratação, um contrato em andamento da empresa volta na etapa certa (contrato preparado → leitura; enviado → assinatura).

## Banco (`supabase/migrations/20261101000100_contract_checkout.sql`)

- `plans.self_service` (Enterprise = `false`): fora do catálogo de autoatendimento; gatilho `contract_plan_guard` recusa contrato real de plano sob proposta.
- `discard_prepared_contract(uuid)`: só proprietário/administrador da própria empresa e só antes do envio.

## Limitações atuais

Ver `CONTRACT_KNOWN_ISSUES.md`: minuta não publicada (contratação real bloqueada), Autentique sem credenciais, signatário da contratada não configurado, licença perpétua sem contrato próprio.
