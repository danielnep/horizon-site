# Horizon Central PWA (caminho /central/)
- Hospedagem: mesmo serviço Node do site institucional em Railway; não cria quarto serviço nem banco.
- A interface usa arquivos estáticos em /central. O worker continua funcionando independentemente do PWA.
- Login: cookie HttpOnly + SameSite=Strict; reutiliza HORIZON_MCP_TOKEN existente (ou HORIZON_CONTROL_PASSWORD, caso o proprietário decida defini-la). Não incluir segredos no HTML ou GitHub.
- API: /central/api/session, login, logout, overview, tasks, agents, usage, history, events (SSE), ai/interpret. A entrada `/mcp` do Maestro suporta `horizon_submit_task` e `horizon_task_status`, sem commits de tarefas no GitHub.
- Envio de tarefa: autenticado e durável diretamente em `/data/horizon-direct-queue/requests` no Railway. O painel e a ferramenta MCP `horizon_submit_task` usam a mesma fila; o Maestro detecta novas solicitações em até um segundo após estar disponível (sem consultar GitHub para receber tarefas).
- Não usar GitHub Pages para esta primeira implantação; tudo servido pelo site já existente.
- Eventos SSE: atividade do worker capturada dos logs com metadados permitidos; histórico curto em memória. Presença por agente é lida de tasks/attendance/equipe.json, caso exista.
- Tokens: sem telemetria por resposta do worker, mostrar 'não informado'. Análises individuais da IA retornam contagem quando o provedor fornecer. Não inventar números.
- Arquivos PWA disponíveis offline, mas respostas /central/api/* nunca entram no cache.
- Segurança: mesma origem no painel, Bearer no MCP, validação da missão e dos caminhos, escrita atômica sem sobrescrever IDs existentes. Solicitações e resultados permanecem no volume privado do Railway, não na fila pública do GitHub. Nunca incluir credenciais em objetivos ou logs.
- O sistema não habilita automaticamente supervisor, não altera filas, não faz deploy nem redistribui tarefas até uma solicitação autenticada explícita.
- Testes: npm test; consulta HTTP a /health, /central/, /central/api/session; autenticação; SSE; HTTP method deny; regressão /ferramentas/ e site institucional.

- Código dos agentes e checkpoints técnicos permanecem no GitHub; isso é separado do transporte imediato de solicitações, que é exclusivamente Railway.
