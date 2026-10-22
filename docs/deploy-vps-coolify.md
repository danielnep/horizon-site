# Central Horizon no Coolify (VPS Hostinger)

Este repositório é a origem do código. O painel é uma aplicação Node.js 22 servida no caminho `/central/` por `server.mjs`.

## Contrato de produção

- Usar build **Dockerfile** e porta interna `3000`. A checagem `GET /health` precisa responder HTTP 200.
- Manter `HORIZON_PY_AGENTS_ENABLED=0` e `HORIZON_MEMORY_BRIDGE_ENABLED=0` no container web: o Maestro já roda em um único serviço systemd `horizon-worker` na VPS. Evitar segundo executor.
- Preservar o diretório persistente real da fila usado por `horizon-worker`. O container deve montar **o mesmo diretório do host** em `/data/horizon-direct-queue` e ter acesso de leitura/gravação. Definir `HORIZON_DIRECT_INBOX_DIR=/data/horizon-direct-queue`.
- Não copiar estado vivo da fila de outro host nem criar um volume vazio achando que foi migrado. Antes do tráfego real, verificar um ID de tarefa visível simultaneamente no worker e na API da Central.
- Configurar `HORIZON_CONTROL_PASSWORD` somente nas variáveis protegidas do Coolify, nunca no Git. As rotas mutáveis exigem sessão administrativa e origem HTTPS correspondente.
- Configurar `GROQ_API_KEY` para análises com IA; `GITHUB_TOKEN` no serviço web apenas se a telemetria necessitar acesso autenticado. O token do worker fica no arquivo restrito do serviço systemd, não no Git.
- Associar hostname público e TLS gerenciados pelo Coolify, respeitando o site principal já existente. Não alterar DNS, rota padrão ou aplicações vizinhas para publicar `/central/`.
- O serviço web não pode receber automaticamente configurações de Railway. O projeto ainda possui código legado de integração com Railway; isso não representa destino de implantação.

## Teste de aceite do destino

1. `/health` HTTP 200; `/central/` e `/central/app.js` HTTP 200.
2. Sessão anônima recebe 401 nas mutações; sessão administrativa consegue editar configurações sem expor credenciais.
3. Criar uma tarefa de teste, observar o mesmo ID no diretório do worker e na Central.
4. Mover tarefa ainda pendente e conferir a ordem utilizada pelo executor **com a PR de ordenação já implantada no worker**.
5. Verificar edição, atribuição, limites do agente, pausa manual independente, cancelamento, arquivamento e restauração.
6. Recarregar a Central durante uma análise e conferir persistência do resultado, estados de erro e execução no celular.
7. Só trocar rotas de produção depois de comprovar todos esses comportamentos; manter dados e instalação antiga intactos até então.
