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
- maestro/railway-team.py: baixa o executor Python por SHA imutável,
  verifica tamanho/caminhos, usa /tmp e acessa checkpoints CIFRADOS no
  GitHub, agora por uma branch separada após importação comprovada.
- maestro/checkpoint-migration-key.mjs: gera uma chave RSA somente no
  volume existente do Railway e publica APENAS sua chave pública.
- maestro/railway-checkpoint-import.py: importa o backup AES-GCM recebido
  como artefato GitHub Actions, valida SHA e SQLite, grava nova branch
  GitHub com chave Fernet exclusiva Railway, verifica leitura de volta.
- A memória PERMANECE no GitHub, não é movida para Heroku/Railway.

- railpack.json: Node 22, Python 3.12 e Git no runtime do site.
- A consulta ChatGPT usa o KERNEL remoto: não instalar Chrome no Railway.

## Segredos Railway exigidos

- GITHUB_TOKEN: token PERSISTENTE GitHub com Contents read/write na fila,
  Issues quando usar contingência e Actions read para checar workflows.
  O token efêmero do Actions não funciona em Railway.
- HORIZON_STATE_BRANCH: branch cifrada separada que o Railway deve ler,
  por exemplo agent-state/railway-staging.
- O segredo original da memória NÃO será movido, copiado ou exibido:
  o GitHub Actions faz uma exportação CIFRADA uma única vez para a chave
  pública gerada DENTRO do serviço Railway. Um importador verifica o
  mesmo SHA do checkpoint de origem antes de gravar a nova branch.
  A chave nova de leitura é derivada da chave privada persistente no
  Railway e nunca publicada. O antigo checkpoint fica preservado.
- KERNEL_API_KEY: acesso autorizado ao navegador do projeto KERNEL.
- HORIZON_EXECUTOR_SHA: SHA de 40 caracteres da revisão Python aprovada.
- HORIZON_PY_AGENTS_ENABLED=1 e HORIZON_AGENT_ACTIONS_DISABLED=1:
  permitir SOMENTE quando os workflows concorrentes estiverem inativos.

GEMINI_API_KEY e DEEPSEEK_API_KEY já têm NOMES de variáveis no site, mas
os valores/cotas não foram verificados. Nenhum segredo vai para Git,
prompts, stdout ou arquivo de diagnóstico.

## Troca de executor sem perda de estado

1. Publicar o novo código inicialmente DESLIGADO. Confirmar saúde do site.
2. Ativar só HORIZON_MEMORY_BRIDGE_ENABLED=1, não ativar os agentes.
   GitHub Actions exporta estado com cifragem para a chave pública do Railway.
   Confirmar o mesmo SHA da origem, 56+ registros, importação e leitura da
   nova branch GitHub agent-state/railway-* sem tocar na antiga.
3. Desativar no GitHub os workflows chat-requests.yml e
   agent-executors.yml (ou outras rotas que gravem na mesma fila).
4. Ligar as flags no Railway após prova de memória e exclusividade.
   O Python também consulta o estado real
   dos workflows e RECUSA iniciar se algum ainda estiver ativo.
5. Verificar um só worker, logs de execução, retomada das tarefas
   antigas, prova de consulta e ponto na Central dos Agentes.
6. Em falha, desativar Railway antes de reativar Actions. Não apagar
   checkpoint ou dados históricos.

## Observabilidade separada do checkpoint da May
O arquivo `horizon-site/agents/checkpoints/maestro/checkpoint.json` continua historico e pertence ao registro da May. A importacao `migration_verified` apenas certifica a memoria SQLite cifrada em `May-Maestro-Executor/agent-state/railway-staging`.
O observador `maestro/operational-state.mjs` valida SHA e HMAC da memoria e passa o SQLite autenticado por stdin a `maestro/operational-state.py`, que o examina em modo somente leitura e devolve exclusivamente totais e horarios de eventos. O supervisor armazena essa observacao junto aos handoffs locais SEM reconhece-los automaticamente. Codigo 0 do worker e snapshot SQLite recente nao substituem prova de QA/publicacao ou recibo da May.

A publicação do módulo inerte NÃO comprova que os agentes já estão
executando fora do GitHub Actions. A migração só acaba depois da
validação de execução real e da troca do escritor.
