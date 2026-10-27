# Modelos de documentos

Todos usam o mesmo layout neutro (`buildDoc`) e o estilo da empresa (Elite, Comercial, Oficina, Minimalista; cor, tamanho/alinhamento do logo). Bobina usa automaticamente o modelo térmico (monoespaçado, logo em cinza/alto contraste).

| Tipo | Origem | Conteúdo (só campos registrados) | Avisos fixos |
|---|---|---|---|
| `sale` Comprovante de venda | Venda | Empresa/filial, nº, data, operador, cliente, itens (SKU), subtotal, desconto, acréscimo, total, pagamentos (entregue), troco, agradecimento | Não fiscal; 2ª via; cancelada |
| `payment` Comprovante de pagamento registrado | Venda | Totais e formas | "Não substitui comprovante bancário/Pix/cartão" |
| `sale-cancel` Comprovante de cancelamento | Venda cancelada | Data, motivo (se registrado), itens, valor estornado | Só existe se a venda estiver cancelada |
| `cart` Prévia de carrinho | Carrinho suspenso | Itens, total estimado | "Venda NÃO concluída" |
| `quote` Orçamento | Orçamentos | Validade, cliente, veículo, itens, mão de obra, total, condições, QR do link, assinatura | "Visualizar não é aceite" |
| `os-entry` OS de entrada | OS | Técnico, previsão, km, cliente, veículo, relato, checklist/objetos, termo, assinaturas | — |
| `checklist-in` / `checklist-out` | OS | Itens do checklist registrados (ou lista padrão para marcação), km, combustível em branco | — |
| `os-diagnosis` | OS | Sintomas, diagnóstico, peças sugeridas, estimativa | — |
| `os-progress` | OS | Serviço, peças previstas, totais, últimos 12 eventos | — |
| `pick-list` Requisição/separação | OS | Peças e quantidades com caixa de conferência | — |
| `os-done` OS concluída | OS | Serviço, peças, totais, garantia comercial configurada | Garantia legal do CDC (art. 26 e 50) |
| `os-delivery` Termo de entrega | OS | Cliente, veículo, km/data da retirada em branco, termo, assinaturas | — |
| `warranty` Termo de garantia | OS | Garantia comercial configurada | CDC |
| `purchase-order` / `purchase-receipt` | Compras | Fornecedor, previsão, vencimento, NF, itens / conferência com divergência | "Não substitui a NF do fornecedor" |
| `cash` Resumo de caixa | Caixa | Fundo, movimentos (vendas em dinheiro, sangrias, suprimentos), esperado, contado, diferença, motivo | — |
| `settlement` Recibo de recebimento | Baixa financeira | Valor, data, forma, responsável, original, saldo pendente | "Não comprova liquidação bancária"; estornada |
| `statement` Extrato do lançamento | Lançamento | Todas as baixas e saldo | Cancelado |
| `inventory` Folha de inventário | Estoque da filial | SKU, produto, local, saldo, coluna "Contado" | Documento interno |
| `test` Página de teste | — | Acentos, régua, Code 128, QR | — |

Textos editáveis (texto puro, até 1.500 caracteres): aviso de cabeçalho, rodapé, agradecimento, condições do orçamento, termo da OS, garantia comercial, termo de entrega. Avisos legais e de natureza não fiscal **não** são removíveis. Sem HTML do usuário (tudo escapado).

Cenários de moto/carro (troca de óleo, kit transmissão, freios, revisão etc.) usam os mesmos modelos: o conteúdo vem dos itens e campos da OS — nada é pré-preenchido com serviços ou valores inventados.

## Etiquetas
Produtos: preço, código de barras, prateleira, caixa, identificação interna, promocional, inventário. Oficina: peça da OS, chave do veículo, identificação do veículo (sem nome do cliente; QR para a rota autenticada da OS). EAN-13 só com dígito verificador válido; caso contrário Code 128 com o código interno (nunca gera GTIN).
