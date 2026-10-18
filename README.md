# Horizon — Site institucional

Código completo do site institucional da Horizon, de Divinópolis. A página reúne a apresentação da empresa, soluções, método de trabalho, portfólio e contato pelo WhatsApp.

O site utiliza HTML, CSS e JavaScript puros. Estilos, scripts e imagens da marca estão incluídos em `index.html`; não há instalação de dependências nem etapa de compilação.

## Estrutura

| Arquivo | Finalidade |
| --- | --- |
| `index.html` | Site completo, com conteúdo, estilos, imagens e interações. |
| `docs/estrutura.md` | Guia das seções e funcionalidades existentes. |
| `.gitignore` | Evita arquivos temporários e configurações locais no repositório. |

## Executar localmente

Clone o repositório e inicie um servidor estático com Python 3:

```bash
git clone https://github.com/danielnep/horizon-site.git
cd horizon-site
python3 -m http.server 8000
```

Abra [http://localhost:8000](http://localhost:8000). Também é possível abrir `index.html` diretamente no navegador.

## Publicar no Cloudflare Pages

Configuração do projeto `horizon`:

| Campo | Valor |
| --- | --- |
| Repositório | `danielnep/horizon-site` |
| Branch de produção | `main` |
| Framework preset | `None` |
| Build command | `exit 0` |
| Build output directory | `.` |
| Root directory | Raiz do repositório |

Qualquer hospedagem de arquivos estáticos pode servir o `index.html` na raiz. O site não requer servidor de aplicação, banco de dados ou chaves de API.

## Conteúdo e manutenção

O portfólio inclui Romaneio Digital / Farmax, AirSoft / Anônimo e ProspectIA / Loja Algar. Os botões “Ver mais” abrem os detalhes de cada projeto.

O formulário de contato prepara a mensagem e abre o WhatsApp. O menu para celular, as abas de soluções e os detalhes do portfólio são controlados pelo JavaScript no final do arquivo.

Consulte [docs/estrutura.md](docs/estrutura.md) para localizar os blocos do código. O `index.html` mantém a versão completa do site existente.

## Ferramentas Horizon: Preview integrado ao domínio

A página institucional oferece a seleção em /#ferramentas e o aplicativo funcional em /ferramentas/, com oito módulos demonstráveis e combináveis. O servidor serve estes recursos por uma lista fechada sem alterar o backend Maestro. Dados de demonstração permanecem no navegador, sem sincronização externa por padrão.

Consulte docs/horizon-ferramentas.md para arquitetura, limites, fontes, atualização e testes. Use npm test para verificar o aplicativo integrado.

