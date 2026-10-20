# Horizon: 17 agentes no serviço Railway existente

## Dimensão real e limites

Na inspeção de 20/10/2026 havia três serviços de produção: horizon-site,
ronda-pro e restaurantes-teste. O plano Free documenta máximo de três
serviços por projeto e volume de 0,5 GB. As métricas do serviço horizon-site
mostraram 1 GB RAM / 2 vCPU de limite atual, cerca de 46 MB RAM e 39 MB de
disco, mas pico histórico de disco de aproximadamente 485 MB em 7 dias.
Não adicionar volume ou quarto serviço. Limite financeiro exato
não verificado.

Os 17 agentes são identidades lógicas de UM Worker Python sequencial,
não 17 containers, navegadores ou processos. Toda tarefa temporária,
download e dependência devem ficar em /tmp, NUNCA no volume persistente
/data. A memória virtual do subprocesso fica limitada a 350 MB para não
exceder a RAM do plano Free após o Trial. Testes com Docker/Android
podem não funcionar na instância Railway e exigem sandbox remoto antes
de poderem ser reportados como concluídos.

## Componentes

- maestro/shared-agents.mjs: inicia e encerra um único processo Python
  opcional, inerte por padrão. Faz preflight sem expor segredos.
- maestro/railway-team.py: baixa fonte do May-Maestro-Executor de SHA
  imutável, verifica tamanho e caminhos, armazena somente em /tmp,
  reutiliza checkpoint GitHub SQLite criptografado, roda ciclos curtos.
- railpack.json: Node 22, Python 3.12 e Git no runtime do site.
- A consulta ChatGPT usa o KERNEL remoto: não instalar Chrome no Railway.

## Segredos Railway exigidos

- GITHUB_TOKEN: token PERSISTENTE GitHub com Contents read/write na fila,
  Issues quando usar contingência e Actions read para checar workflows.
  O token efêmero do Actions não funciona em Railway.
- HORIZON_SQLITE_ENCRYPTION_KEY: exatamente o material usado pelo
  checkpoint existente na branch agent-state/runtime. Não gerar outra!
- KERNEL_API_KEY: acesso autorizado ao navegador do projeto KERNEL.
- HORIZON_EXECUTOR_SHA: SHA de 40 caracteres da revisão Python aprovada.
- HORIZON_PY_AGENTS_ENABLED=1 e HORIZON_AGENT_ACTIONS_DISABLED=1:
  permitir SOMENTE quando os workflows concorrentes estiverem inativos.

GEMINI_API_KEY e DEEPSEEK_API_KEY já têm NOMES de variáveis no site, mas
os valores/cotas não foram verificados. Nenhum segredo vai para Git,
prompts, stdout ou arquivo de diagnóstico.

## Troca de executor sem perda de estado

1. Publicar o novo código inicialmente DESLIGADO. Confirmar saúde do site.
2. Instalar segredos no Railway e validar recuperação do checkpoint
   criptografado e acesso ao KERNEL, sem imprimir segredo ou mensagem privada.
3. Desativar no GitHub os workflows chat-requests.yml e
   agent-executors.yml (ou outras rotas que gravem na mesma fila).
4. Ligar as flags no Railway. O Python também consulta o estado real
   dos workflows e RECUSA iniciar se algum ainda estiver ativo.
5. Verificar um só worker, logs de execução, retomada das tarefas
   antigas, prova de consulta e ponto na Central dos Agentes.
6. Em falha, desativar Railway antes de reativar Actions. Não apagar
   checkpoint ou dados históricos.

A publicação do módulo inerte NÃO comprova que os agentes já estão
executando fora do GitHub Actions. A migração só acaba depois da
validação de execução real e da troca do escritor.
