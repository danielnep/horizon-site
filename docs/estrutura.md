# Estrutura do site Horizon

O site completo está em `index.html`. O arquivo contém o documento HTML, um bloco de estilos no cabeçalho, imagens incorporadas e um bloco de JavaScript ao final da página.

## Seções

| Identificador | Conteúdo |
| --- | --- |
| `inicio` | Apresentação inicial e chamadas para contato e soluções. |
| `portfolio` | Projetos Romaneio Digital, AirSoft e ProspectIA, com detalhes em janela modal. |
| `solucoes` | Apresentação das soluções e demonstração com abas. |
| `metodo` | Etapas do método de trabalho. |
| `sobre` | Apresentação da Horizon. |
| `contato` | Formulário que prepara uma mensagem para o WhatsApp. |

## Estilos e imagens

O bloco `<style>` contém cores, tipografia, componentes, ajustes para telas menores e regras de animação. As imagens da marca estão incorporadas em URLs `data:`, sem arquivos externos a copiar para a hospedagem.

## Interações

| Elemento do código | Responsabilidade |
| --- | --- |
| `.menu` e `nav` | Abrir e fechar a navegação no celular. |
| `examples`, `.tab` e `choose()` | Alternar os exemplos de pedidos, estoque e entregas; permitir navegação pelo teclado nas abas. |
| `contactForm` | Ler os campos e encaminhar a mensagem para `wa.me`. |
| `IntersectionObserver` | Revelar elementos durante a rolagem, considerando a preferência de movimento reduzido. |
| `projects` | Textos detalhados dos três projetos do portfólio. |
| `projectDialog`, `projectContent` e `closeProject` | Abrir, preencher e fechar os detalhes do projeto selecionado. |

## Conferência após uma alteração

- Verificar a navegação em uma tela larga e em uma tela de celular.
- Alternar as três abas de soluções, inclusive com as teclas de direção.
- Abrir e fechar os detalhes dos três projetos do portfólio.
- Preencher o formulário e conferir a mensagem preparada para o WhatsApp.
- Confirmar que imagens, cores e textos permanecem coerentes com a versão desejada.

Para publicar, mantenha `index.html` na raiz e utilize as configurações do [README](../README.md).
