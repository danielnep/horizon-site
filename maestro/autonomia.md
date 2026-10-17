# May Maestro | Autonomia executavel e testes multicamadas (v1)
Atualizado em 17/10/2026. Este documento complementa o agente editor, os metodos de engenharia e o supervisor Gemini ja existentes. **Instrucoes de agente nao executam codigo sem runtime e permissoes.**

## O que o executor autônomo FAZ
O workflow `.github/workflows/maestro-autonomia.yml` inicia sozinho a cada seis horas (apos merge em main), ou manualmente. Inicia **tres jobs GitHub Actions isolados**, um por projeto publico:
- `danielnep/horizon-site` (Maestro/site)
- `danielnep/app-hondas-maxvel` (Ronda Pro)
- `danielnep/romaneio-digital` (Romaneio Digital)

Cada job faz checkout do **main real** do projeto, sem fornecer credenciais de escrita, prepara dependencias e executa verificacoes distintas: sintaxe, contratos/checks, testes automatizados/regressoes. Registra codigo de saida, duracao, historico de tentativas, causas e status. **Falha deterministica de teste nao repete as cegas**; falha comprovadamente transitoria de rede permite mais uma tentativa. Nao faz deploy, alteracao de codigo, merge, exclusao ou upload de segredo.

Ao fim, envia relatorios JSON e registros de eventos tecnicos como artefatos do GitHub Actions. Eles sao preservados por 60 dias. Esse historico e acessivel aos especialistas no ChatGPT por ferramentas GitHub autorizadas. As informacoes nao ficam automaticamente presentes no contexto do Gemini; a May ou um conector validado tem que recupera-las e fornecer o resumo adequado.

## Memoria duravel para trabalhos de longa duracao
`maestro/memory-store.mjs` implementa uma memoria por eventos, append-only, com idempotencia, busca por projeto/tipo/texto e verificacao basica de segredos. Cada especialista pode compartilhar o MESMO contrato tecnico e registrar observacoes, testes, decisoes e checkpoints quando tiver acesso efetivo ao armazenamento.
- No GitHub Actions, os eventos de cada job sao salvos dentro do artefato daquele ciclo (60 dias).
- Num executor persistente, configurar `MAESTRO_MEMORY_ROOT` para caminho de volume persistente, **nao** diretório efemero do container. O servico atual Horizon ainda nao tem volume dedicado confirmado; nao alegar memoria Railway permanente ate montar e validar.
- Para historico sem prazo de expiracao, manter checkpoints tecnicos revisados no GitHub ou armazenamento privado com politicas de acesso/backup. **Nao** gravar conversas particulares, dados de clientes, senhas ou chaves num repositório publico.

Memoria externa pode guardar milhares de eventos e arquivos, mas o modelo so recebe o que o recuperador selecionar por tarefa. Aumentar a memoria em disco nao aumenta o limite de contexto da API, nem substitui API/ferramenta/cota.

## Metodos estilo Codex, ja presentes nos SETE plugins privados
Os especialistas carregam manuais, identificam consumidor/definicao, reproduzem erro, formulam hipotese causal, corrigem na origem, percorrem etapas sintaxe -> testes direcionados -> regressao -> integracao/navegador conforme risco e revisam diff. Falhas geram checkpoint para retomar, nao uma repeticao infinita. Testar repetidamente significa usar niveis e cenarios **diferentes**, nao rodar comando identico ate aparecer verde.

## Proximos niveis de autonomia
1. **Ativo com esta entrega se publicado:** QA autonomo de leitura, registro e report de falhas, mesmo com Gemini 429/503.
2. **Agente que propoe e corrige PR:** precisa de processo de codigo autorizado, ferramenta de escrita isolada em branch, validacao por testes e permissao de abrir PR sem merge automatico. Gemini supervisor nao tem, por si so, acesso ao Plugin Creator; plugins ChatGPT nao sao chamados por um server so por terem uma skill.
3. **Correcao automatica dos sete plugins:** May/ChatGPT deve executar Plugin Creator autenticado, ou deve existir uma API externa documentada e autorizada; nao inventar uma ponte.
4. **Deteccao de problemas via conversas:** apenas mensagens explicitamente enviadas ao Maestro por conector autorizado e politica de privacidade definida. Nao existe varredura independente de todas as conversas do ChatGPT pelo Railway.

## Politica de alteracao
Autonomia de leitura/testes/diagnostico pode ser agendada. Correcao de codigo fica em branch isolada, com PR e testes; nunca modificar producao, client data, credenciais, permissao ou merges sem autorizacao atual. Retry maximo 2 para falhas transitórias do QA. Acoes novas precisam contrato e criterio de aceite verificavel. Corrigir problema comprovado, nao promover alucinacao do modelo a acao.

## Verificacao do rollout
- Primeiro validar o PR do workflow usando GitHub Actions e conferir logs reais dos tres jobs.
- A frequencia agendada so comeca quando o workflow estiver na branch default (main), obedecendo preferencias atuais de publicacao.
- Se um repo deixar de ser publico, checkout falhara: isso nao autoriza contornar autenticacao. 
- O workflow nao chama Gemini nem o ChatGPT; e apenas a **primeira capacidade autonomamente executavel** do Maestro.
