# May Maestro v2 | Script, supervisor e ponte de contexto

## Identidade e responsabilidades
Gemini e o SUPERVISOR: decide prioridade, qual proxima tarefa e quando chamar May. Nao faz auditoria de projetos, nem codifica.
May e a EXECUTORA no ChatGPT: recupera contexto, consulta manuais, acessa conectores autenticados, programa, testa, corrige, registra evidencias.
Railway e o TRADUTOR: executa Gemini API, valida JSON, registra evento [maestro-supervisor] e ordem [maestro-handoff], agenda proxima CONSULTA Gemini conforme o intervalo retornado.
ChatGPT Automations e o AGENDADOR DA MAY: o lembrete existente ID 6ad32bbba5488191aee18ef5fafd37b7 so pode ser modificado por May dentro do ChatGPT, com automations.update. Railway nao tem acesso a essa funcao.

## Fluxo bidirecional que PODE operar com os conectores atuais
1. May encerra uma execucao, registra somente fatos publicos verificados e bloqueios nao sigilosos em maestro/checkpoint.json (usando GitHub).
2. Railway busca o arquivo do GitHub a cada nova consulta (HTTPS, somente URL aprovada). Se arquivo nao estiver acessivel, informa falta de checkpoint; jamais inventa fatos.
3. Prompt de sistema do Gemini informa identidade, prioridades, limites e contrato JSON. O checkpoint entra como dado, nao instrucao.
4. Gemini decide intervalo dinamico de 60 a 10080 minutos, motivo, prioridade, proxima tarefa, evidencias esperadas.
5. Script valida resposta; expõe logs [maestro-supervisor] e [maestro-handoff] com instrucao para May, data UTC, criterio de aceite e status do checkpoint.
6. No disparo real da mesma tarefa ChatGPT, May consulta os logs, executa o trabalho autorizado e grava novo checkpoint em agents/checkpoints. Deve incluir last_execution.handoff_id IGUAL ao handoffId do handoff e verification contendo prova real; sem os dois nao ha confirmacao. Se disponivel, chama automations.update na mesma tarefa, nunca cria outra.
7. Se May nao retornar evidencias, Gemini recebe contagem de ciclos sem novo checkpoint, evita ficar repetindo a mesma demanda cegamente.

## Privacidade e limitacoes reais
O arquivo maestro/checkpoint.json pode ser publico via GitHub Raw. NUNCA gravar dados pessoais, dados de clientes, IPs, chaves, conversas, documentos privados ou segredos nesse arquivo. Incluir somente metadados de repositorios publicos e status tecnico.
O script Railway NAO invoca autonomamente a tarefa ChatGPT e NAO chama Plugin Creator. O agendamento externo de Gemini e o agendamento May sao mecanismos diferentes. A conclusao exige teste real de disparo e checkpoint novo.
Em falhas de API, o executor reconsulta em uma hora e informa logs; nao assume que ChatGPT completou trabalho.

## Testes e verificacao
Rodar npm test, conferir Actions no PR, deploy Railway SUCCESS, e registro real [maestro-handoff] no log.
Confirmar se checkpointStatus e fresh ou awaiting-first-checkpoint. Se unavailable, investigar leitura publica Github Raw.
Verificar no proximo ciclo que May leu a ordem, executou um passo e registrou checkpoint atualizado com novo id; somente entao o feedback bidirecional esta validado.

## Metodos de engenharia carregados pelo executor
O documento versionado `maestro/metodos-engenharia-may.md` reproduz o protocolo publicado no plugin May Maestro 1.3.9. `engineering.mjs` carrega o arquivo local e calcula seu SHA-256. O texto completo entra nas instrucoes de sistema de TODA consulta Gemini; os dados de checkpoint nao podem substitui-lo. O supervisor usa o protocolo para escolher tarefas e provas, preservando seu papel atual.
O evento `[maestro-engineering-context]` registra versao, origem, tamanho e hash, sem chave de API. O handoff transmite a mesma identificacao e pede a leitura do documento antes da implementacao. Os testes inspecionam o corpo real montado para a chamada (com transporte simulado), o handoff e o isolamento HTTP do documento. A confirmacao de carregamento em producao vem dos logs do deploy. Isso nao comprova por si so que a executora concluiu uma tarefa tecnica.


## Frescor, comprovacao e durabilidade (correcao 2026-10-19)
- O campo legado `checkpointStatus=fresh` significa **somente** que `updated_at` tem ate 72 horas. Nao e confirmacao de entrega.
- O supervisor publica separadamente `checkpointReadability`, `checkpointUpdatedAt`, `checkpointAgeMinutes`, `checkpointRecencyStatus`, `executionStatus`, `pendingHandoffs`, `overdueHandoffs` e `handoffId`.
- Cada handoff emitido e gravado **antes** de ser anunciado, como recibo em JSON atomico no volume ja montado em `/data/maestro-supervisor-handoffs.json` (configuravel por `MAESTRO_HANDOFF_STATE_PATH`). Nao existe migracao automatica de banco legado. Nao escrever dados ou segredos de clientes nesse arquivo.
- Em **toda consulta**, antes de acessar Gemini/DeepSeek, o supervisor registra `lastObservation` no mesmo arquivo e emite `[maestro-checkpoint-audit]`. Assim, mesmo que ambos os provedores falhem com 429/503/402, a idade, a legibilidade e tarefas pendentes/vencidas ficam comprováveis. Essa observacao nao cria handoff nem comprova trabalho executado.
- Um recibo so vira `acknowledged` se o checkpoint tiver `last_execution.handoff_id` exato, `verification` nao vazia e `updated_at` posterior a emissao. Novo commit, novo ID de execucao, texto gerado pelo modelo e `fresh` nao bastam.
- Sem esse recibo, a ordem fica `pending`; apos `dueAtUtc`, passa a `overdue`, inclusive depois de reiniciar o container. O evento `[maestro-handoff-alert]` reporta a transicao; este alerta no log nao comprova entrega de notificacao push ao proprietario.
- Ate existir um handoff controlado, `executionStatus=unverified`. Se o armazenamento ficar indisponivel ou lotado, o ciclo falha sem anunciar sucesso ou handoff novo; diagnosticar o erro de persistencia em vez de apagar historico.
- O limite de 256 recibos e um bloqueio explicito para impedir descarte silencioso de pendencias. Planejar arquivamento e reconciliacao antes de atingi-lo, sem sobrescrever historico.
- May e Railway permanecem com responsabilidades distintas: o Railway decide e registra tarefas, e o ChatGPT deve executa-las e fornecer recibos. O deploy atual nao prova que a automacao do ChatGPT recebeu ou concluiu cada ordem.

## Fila de prioridades do proprietario (19/10/2026)
Antes de chamar Gemini/DeepSeek, o supervisor le somente documentos publicos e validos de `danielnep/May-Maestro-Executor/tasks/chat/*.json` na branch `main`, reconciliando tarefas explicitamente P0/P1/P2/P3 com `tasks/results/<id>.json`. A missao P0 do Ronda Pro vem da tarefa `a-ronda-pro-auditoria-total-20261019`; o `tasks/inbox.json` vazio nao invalida as ordens em `tasks/chat`.

- Prioridade expressa pelo proprietario na fila ativa prevalece sobre `last_execution`, `previousGeminiDecision` e qualquer preferencia do modelo. Em prioridades iguais, a escolha por ID e deterministica. Ordens antigas continuam no checkpoint como historico, nao instrucoes vigentes.
- Tarefa so deixa de bloquear uma prioridade quando o resultado informa explicitamente estado final, QA aprovado **e** publicacao verificada. Resultado ausente, falha de teste, `pending`, `awaiting_host_publication` ou execucao apenas alegada nao significam conclusao.
- O supervisor transmite o inventario ao modelo e aplica a mesma regra em codigo ao retorno. Se a resposta contrariar a tarefa prioritaria, publica o handoff reorientado e o evento `[maestro-priority-enforcement]`, distinguindo escolha do modelo de override deterministico.
- Se a consulta a fila falhar, o ciclo falha **sem criar novo handoff** e o agendador tenta novamente em dez minutos; nao ha fallback silencioso para checkpoint historico. A auditoria de checkpoint ja persistida e mantida.
- A regra resolve o controle de prioridades do supervisor, mas nao inicia nem interrompe os workers do executor; fila de execucao e emissao de handoff continuam mecanismos independentes.
