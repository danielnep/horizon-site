# Horizon Central | Painel dos 17 agentes

## Destino operacional
- Interface responsiva/PWA em `/central/`, servida por `server.mjs` no mesmo projeto `danielnep/horizon-site`.
- **Hospedagem-alvo: VPS Hostinger com Coolify** (Node 22, Dockerfile, porta interna 3000). Esta branch/PR não é prova de implantação.
- O serviço `horizon-worker` é o **único executor** de tarefas na VPS. Em produção, iniciar o container web com `HORIZON_PY_AGENTS_ENABLED=0` e `HORIZON_MEMORY_BRIDGE_ENABLED=0` para não duplicar trabalhadores.
- O container web e `horizon-worker` devem enxergar o **mesmo diretório físico persistente da fila**. Montar o diretório real da VPS em `/data/horizon-direct-queue` no container e definir `HORIZON_DIRECT_INBOX_DIR=/data/horizon-direct-queue`. Não montar diretório vazio como se fosse fila migrada.
- **A PR #91 de `danielnep/May-Maestro-Executor` precisa estar implantada no worker da VPS** para que a ordem manual definida no painel seja obedecida pelo executor. Uma PR no GitHub, sozinha, não atualiza o serviço systemd em execução.
- Manter o site institucional, outras aplicações e DNS intactos; confirmar roteamento `/central/` pelo domínio atual antes de trocar tráfego.
- O código mantém módulos históricos referentes ao Railway, mas ele **não é a fonte nem o destino de dados dos agentes** nesta implantação.

## Interface e controles
- Login administrativo: cookie `HttpOnly`, `SameSite=Strict`; senha em `HORIZON_CONTROL_PASSWORD` nas variáveis protegidas do Coolify (sem senha em GitHub ou frontend).
- API autenticada em `/central/api/`: sessão, resumo, tarefas, agentes, histórico, telemetria, eventos SSE, análise por IA, controles da fila e configurações individuais.
- Fila: enviar, editar objetivos pendentes, atribuir responsável, mudar prioridade, mover para posição exata, pausar/retomar, cancelar, arquivar e restaurar com histórico preservado. Ações em lote exigem confirmação e retornam resultado por item.
- Agentes: pausar novas atribuições individualmente, liberar sem revogar pausas manuais, ajustar limite de pendências, repositórios permitidos e observações.
- A análise iniciada na interface mantém o estado durante atualizações SSE, refresh e reload. Erros devem ser apresentados; não inventar respostas, conclusão de tarefas nem consumo de tokens.
- A porta `/mcp` do Maestro é separada da sessão PWA e exige autenticação própria quando configurada.
- UI pode utilizar cache offline para os arquivos do PWA; `/central/api/*` **nunca** entra no cache.

## Configuração e proteção
- Expor `/health` na porta 3000; instalar dependências com `npm install` porque o repositório não possui `package-lock.json`.
- Definir `GROQ_API_KEY` no serviço web apenas para funcionalidades de análise que precisem dela; o token do worker não deve ir para o repositório.
- Somente administradores autenticados podem executar comandos mutáveis, com checagem de origem HTTPS. Escrever solicitações com IDs preservados; não apagar logs e resultados por arquivamento.
- O diretório local dos dados do worker jamais deve ser publicado como rota estática.

## Verificação antes de ativar
1. `npm test`, syntax checks e CI GitHub verdes para o commit exato.
2. Coolify: `GET /health`, `GET /central/` e `GET /central/app.js` com HTTP 200; mutações sem autenticação retornam 401.
3. Verificar que um ID sintético da fila é visto tanto pelo serviço `horizon-worker` quanto pela Central **sem duplicação de execução**.
4. Confirmar a PR #91 operando no worker e validar reordenação de uma tarefa ainda não iniciada.
5. Testar pausar/cancelar/arquivar/restaurar, parâmetros de agente, análise durante reload e controles mobile.
6. Preservar a produção antiga até que esses testes confirmem a integração na VPS.

Detalhes do build e implantação: [`../docs/deploy-vps-coolify.md`](../docs/deploy-vps-coolify.md).
