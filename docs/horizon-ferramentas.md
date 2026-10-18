# Ferramentas Horizon | Integração Preview → Site

## Entrega e produto
O domínio institucional tem duas superfícies ligadas sem iframe:
- Página inicial /#ferramentas: seleção de oito capacidades, contagem, limpeza e CTA para montar uma combinação.
- Workspace /ferramentas/: aplicativo Horizon Preview funcional, apresentado como Ferramentas Horizon com retorno ao site; o visitante pode experimentar ferramentas isoladas e combinadas, compartilhar a seleção e solicitar personalização via WhatsApp.

## Procedência
Origem do workspace: danielnep/horizon-preview, main em 6434dbf2528a3de49afaac477c6580f1f29c9c6c (18/10/2026).
O catálogo está em ferramentas/core/tools.js; regras e dados em core/store.js; fluxo visual em app.js; exemplos guiados em core/demonstration.js; assistentes simulados em core/assistants.js.
O workspace é um snapshot integrado e NÃO sincroniza automaticamente com o repositório Preview. Ao atualizar os arquivos, comparar versões e preservar o retorno ao site, o nome público Ferramentas Horizon e a folha site-bridge.css. Executar testes.

## Contrato de navegação e dados
1. Botões data-builder-tool atualizam aria-pressed e a seleção local, persistida no navegador.
2. Montar ferramenta abre /ferramentas/?f=IDs#solucao com módulos pré-selecionados.
3. Montar solução original cria um ambiente de demonstração, com registros locais e acesso entre ferramentas.
4. Link Voltar ao site retorna a /, preservando a seleção no navegador.
5. Solicitação de personalização prepara mensagem para WhatsApp e exige ação do visitante.
6. Google Sheets está DESABILITADO por padrão; não há coleta de dados reais ou backend próprio para os exemplos.

O backend original do site e o processo Maestro são preservados. O servidor permite GET e HEAD apenas para os 12 arquivos listados. Caminhos externos ou não previstos retornam 404, método de gravação retorna 405, URL inválida retorna 400.

## Validação
- Suite atual do site com integração: 26 testes passando.
- Suite Preview original no snapshot: 29 testes passando; check de sintaxe e build de Pages passou.
- Browser mobile/desktop: 320, 390, 430, 768 e 1280 px, sem overflow horizontal.
- Fluxo ponta a ponta: escolha múltipla no site, workspace, montagem, uso de checklist, retorno com seleção preservada.
- Prints da implementação em docs/evidencias, realizados em Chromium real com dados de demonstração.

## Segurança e limites
Sem chaves no frontend, sem migração de dados, sem IA paga e sem alteração de produção. O Preview é simulador com dados fictícios, não entrega sistema completo sob medida automaticamente. A integração futura em main e o deploy dependem de autorização específica.

