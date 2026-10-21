# Horizon | supervisor operacional unico

A supervisao dos 17 especialistas e feita dentro do processo Python existente em
`maestro/railway-team.py`, no servico `horizon-site` do Railway. O processo
carrega uma revisao fixada do repositorio `May-Maestro-Executor` (variavel
`HORIZON_EXECUTOR_SHA`) e executa `horizon_core.commit_bridge`. O agente
`may-maestro` ja pertence a esse executor e delega tarefas aos especialistas.

Nao existe agenda separada de supervisor Node, consulta ao ChatGPT via navegador
ou caminho ativo DeepSeek. O frontend e o servidor nao invocam o modelo para
cada atualizacao da fila. O roteador dos especialistas usa Gemini e Groq;
os testes de inicializacao confirmam apenas conectividade, nao entrega de tarefa.

## Regras operacionais

- Uma unica instancia escritora, com GitHub Actions de execucao aposentados.
- Estado transitorio cifrado em SQLite na branch GitHub configurada; nao
  alterar `agents/checkpoints` para forcar falsos reconhecimentos.
- Em cada ciclo, verificar trabalhos realmente prontos, adiamentos, prazos de
  concessao e dependencias antes de acionar agentes. Nao clonar projetos
  finalizados a cada verificacao.
- Apos atualizacao efetiva do SHA do executor, uma unica tentativa de recuperacao
  por trabalho anteriormente falho e permitida. Checkpoints, resultados e eventos
  antigos permanecem. Repeticoes com o mesmo SHA sao bloqueadas.
- Falha por evidencia visual ausente, bloqueio de qualidade ou permissao nao
  autoriza retomar sem a prova ou decisao correspondente.
- Rejeicao de pedido gera resultado e diagnostico proprio. Nao transforma todo
  ciclo do worker em erro. Falha de persistencia GitHub continua sendo erro
  de infraestrutura e nao deve ser escondida.
- `rc=0` significa somente que o ciclo concluiu; nao comprova QA, publicacao
  ou execucao de todos os 17 especialistas.

## Validacao da instalacao

O commit do executor deve passar CI, ser integrado a `main` e depois ser
fixado em `HORIZON_EXECUTOR_SHA` no Railway. A hospedagem deve mostrar
`preflight_verified`, `source_loaded`, `cycle_summary` e, quando aplicavel,
`supervisor_recovery` e `supervisor_rejection`. Uma tarefa so sera declarada
concluida com resultado e provas individuais. Os relatorios de consumo das APIs
devem ser obtidos do uso retornado por cada provedor, nao inferidos.
