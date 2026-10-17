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
6. No disparo real da mesma tarefa ChatGPT, May consulta os logs, executa o trabalho autorizado e grava novo checkpoint. Se disponivel, chama automations.update para a mesma tarefa, nunca cria outra.
7. Se May nao retornar evidencias, Gemini recebe contagem de ciclos sem novo checkpoint, evita ficar repetindo a mesma demanda cegamente.

## Privacidade e limitacoes reais
O arquivo maestro/checkpoint.json pode ser publico via GitHub Raw. NUNCA gravar dados pessoais, dados de clientes, IPs, chaves, conversas, documentos privados ou segredos nesse arquivo. Incluir somente metadados de repositorios publicos e status tecnico.
O script Railway NAO invoca autonomamente a tarefa ChatGPT e NAO chama Plugin Creator. O agendamento externo de Gemini e o agendamento May sao mecanismos diferentes. A conclusao exige teste real de disparo e checkpoint novo.
Em falhas de API, o executor reconsulta em uma hora e informa logs; nao assume que ChatGPT completou trabalho.

## Testes e verificacao
Rodar npm test, conferir Actions no PR, deploy Railway SUCCESS, e registro real [maestro-handoff] no log.
Confirmar se checkpointStatus e fresh ou awaiting-first-checkpoint. Se unavailable, investigar leitura publica Github Raw.
Verificar no proximo ciclo que May leu a ordem, executou um passo e registrou checkpoint atualizado com novo id; somente entao o feedback bidirecional esta validado.
