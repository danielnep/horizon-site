# Paleta superada (11/11/2026)
**AVISO DE PRECEDÊNCIA:** as menções abaixo a vermelho como tema do Horizon Studio foram revogadas pela decisão do proprietário em 13/11/2026. Paleta ativa: dark/grafite neutro + preto pontual, azul #1F98FF e roxo #8B5CF6 como acentos, com pequenas variações e degradês permitidos. Vermelho é específico de projetos que o autorizem, como Ronda Pro. Em caso de conflito, prevalece esta correção e /opt/horizon-manuals/manuals/01-MARCA-DESIGN-DECISOES.md.

# Horizon Studio R3 | reconstrução real 11/11/2026

## Autoridade
O proprietário determinou substituir a interface antiga sem flash/loading da Central anterior, com experiência inspirada em v0.app, porém própria e utilizável sem serviços pagos adicionais, VPS + GitHub + Antigravity canônico. Tema preto/cinzas neutros e VERMELHO protagonista. Não retornar roxo ou azul ao chrome do Studio; não aplicar tema Studio aos clientes.

## Projeto e limites
Repo danielnep/horizon-site. Worktree /opt/horizon-site/worktrees/studio-red-v0-20261111, branch feat/studio-red-v0-20261111. NÃO editar /opt/horizon-site/source, serviços, deploy, banco, segredo, DNS, outros projetos.
Ler manuais atuais em /opt/horizon-manuals/manuals: 00-AUTORIDADE-E-ESCOPO.md, 01-MARCA-DESIGN-DECISOES.md, 02-ENGENHARIA-DE-APLICATIVOS.md, 03-AGENTES-OPERACAO-ESTUDIO.md, 04-TESTES-QUALIDADE-E-APRENDIZADO.md.
Sem senha inesperada no meio da conversa. Somente autenticação existente no início. Preservar sessão real, histórico SQLite, filas, projetos, autorização.
APIs existentes: /central/api/studio/session, /central/api/studio/projects/:id/messages, /central/api/studio/agents, /central/api/tasks, /central/api/studio/apps, /central/api/studio/preview, /central/api/repositories, /central/api/overview, /central/api/evidence/list. Não usar nenhuma credencial no browser.
Agentes válidos: maestra, iris, lume, forja, mosaico, tatil, elo, argos. Consultas não executam código; tarefas de desenvolvimento são registradas na fila autorizada. Sem simular IA, telemetria, compilações ou deploy.

## Defeito P0 confirmado
central/index.html mostra shell antigo ("Carregando a central"), importa app.js monolítico, depois JS troca para Estúdio conforme hash. Remover da entrada o shell antigo e parar de importar app.js. Fazer o novo shell diretamente no HTML da resposta inicial, sem FOUC, em /central/ e /central/#estudio; hash legado nunca ressuscita a Central antiga. Preservar endpoints /central/api/* e site institucional /.

## Experiência R3
1. IDE/workbench profissional: trilho/lista de projetos à esquerda; chat/edit de agentes e composer fixo no centro; prévia de aplicativo real e opções Code/Preview/Quality à direita, barra superior de projeto, estado, mobile/tablet/desktop; mobile com navegação apropriada, scroll e toque estáveis.
2. Selecionar VPS + projetos GitHub no mesmo catálogo sem duplicatas. App sem URL: estado vazio honesto, não falsificar preview.
3. Chat privado real por projeto, agente, mensagens persistentes, retorno/erro, sessão no início. Botão solicitar implementação cria tarefa real (quando repo disponível) pela API.
4. Prévia real da VPS com iframe seguro e tamanho de viewport. Código: navegador de arquivos GitHub e leitura de fonte read-only pelo backend seguro se possível; painel de qualidade e fila com dados reais, nada de widgets falsos.
5. Estética refinada v0-like sem copiar: dark #111113/#1d1d20/#2a2a2d, vermelho #ec4047, branco, fonte Inter/Manrope, bordas finas, hierarquia editorial, sem cards gigantes ou oito abas de dashboard. Respeitar marca de apps renderizados.
6. Robustez: fetch cancelável, loading/vazio/erro, escapamento HTML, sem senhas surpresa, sem service worker/cache antigo servindo a Central, sem violar dados.

## Critérios
- HTML inicial já é R3 e não contém texto, DOM, stylesheet ou script da Central antiga.
- Sem loop de renderização ou flash; sem scroll horizontal a 360, 412, 1440.
- Tests node --check, npm test, Python quando afetado. Verificar com Chromium real 360x800, 412x915, 1440x900, cliques, URL, console, screenshot. Iterar até passar.
- Desenvolvimento por Mosaico/Lume/Forja; Argos testa continuamente; Maestra coordena, May/GPT é dona da publicação de VPS.
- Branch isolada, código real, commit/QA, não tocar produção sem May/GPT.
