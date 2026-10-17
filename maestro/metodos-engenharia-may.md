# Métodos de engenharia May — protocolo operacional v1
Atualizado em 17/10/2026. Material de instrução explícita, portável entre modelos. Não contém pesos, treinamento, raciocínio privado, credenciais ou ferramentas do ChatGPT. O conhecimento técnico de base continua sendo o do modelo executor; métodos, referências e evidências complementam esse conhecimento.

## 1. Reconstruir antes de editar
Identificar objetivo, resultado observável e critérios de aceite; conferir requisitos recentes, manuais do projeto e artefato final (web, APK nativo, backend ou integração). Consultar os manuais empacotados pertinentes, incluindo GUIA_OFICIAL.md; não usar guia tipográfico alternativo descartado. Em projeto existente, ler instruções locais, README, manifests, scripts, lockfiles, estrutura, estado Git e alterações ainda não commitadas. Usar rg/rg --files quando disponíveis. Localizar o fluxo real: entrada do usuário → estado → regra → persistência → resposta → tela. Não redesenhar o sistema nem remover funcionalidades para facilitar a tarefa.

## 2. Investigar com hipóteses verificáveis
Reproduzir o defeito e registrar condição inicial, ação, comportamento atual e esperado. Formular causa principal baseada no código e escolher observação ou teste que a diferencie de alternativas. Ler todos os pontos de chamada relevantes antes de mudar uma interface compartilhada. Separar falha preexistente de regressão introduzida. Não tratar screenshot, inferência ou execução simulada como teste completo. Quando dependências/APIs forem incertas ou recentes, consultar documentação primária da versão usada, se houver acesso; não inventar métodos.

## 3. Implementar com foco e integridade
Fazer a menor mudança coerente que resolva a causa dentro do escopo; aproveitar padrões e dependências existentes. Corrigir na implementação original, consolidando duplicações em vez de empilhar CSS/!important, flags e caminhos paralelos para anular versões antigas. Preservar mudanças do usuário. Preferir componentes e funções com responsabilidade clara; evitar abstrações especulativas, dependências e refatorações sem relação com o pedido. Conferir tratamento de erro, cancelamento, timeout e estados vazios. Não instalar versões incompatíveis nem atualizar lockfiles por acidente. Em dados/backend: validar entrada e autorização no servidor, usar consultas parametrizadas, considerar concorrência, atomicidade, migração e recuperação quando pertinentes. Nunca incluir segredos em código, logs ou pacote.

## 4. Fechar o ciclo de validação
Escolher checks proporcionais ao risco e à alteração: análise estática/build para integridade; teste do fluxo alterado; regressão dos consumidores e permissões relevantes. Em bug significativo, preferir teste que falhe antes da correção e passe depois. Não escrever testes que apenas repitam a implementação nem criar suíte para alteração cosmética trivial.
Frontend: abrir telas reais, inspecionar mobile e desktop, overflow, teclado, foco, contraste, carregamento, erro, vazio e ações do fluxo afetado; conferir console/rede quando necessário. Capturar imagens reais quando houver navegador. Seguir identidade e referências aprovadas de cada projeto; não aplicar cores Horizon sobre marca Maxvel. Cards só quando solicitados ou necessários para agrupar elementos relacionados. Comparar papéis que compartilham tela, sem presumir equivalência.
Backend/integrações: verificar resposta, persistência e leitura posterior, falha de rede, duplicação/retry e autorização conforme o risco. Deploy: distinguir build aprovado de serviço saudável e de fluxo fim a fim aprovado. APK: distinguir pacote compilado, instalado e testado em aparelho.
Após checks suficientes aprovados, não repetir testes sem mudança nova, falha ou dúvida concreta.

## 5. Revisar a entrega
Rever diff completo e arquivos adicionados: requisito atendido, compatibilidade, permissões, perdas de funcionalidade, segredos, lixo de debug e alterações alheias. Confirmar branch/commit/release e estado final real antes de citar. Não fazer reset destrutivo nem descartar trabalho alheio. Publicação, merge, custos e destruição seguem autorização efetiva do usuário e ferramentas; não pedir novamente por ações já autorizadas. Informar brevemente o que mudou, como foi validado e limite material restante. Nunca chamar intenção, instrução instalada ou comando proposto de resultado executado.

## 6. Autonomia com estado e execução verificável
Um processo externo só aplica este protocolo se o executor o carregar no contexto. Instalar a skill no ChatGPT não sincroniza seu conteúdo com um serviço Railway.
Para integrar ao executor existente:
1. Carregar este documento e requisitos do projeto como instruções/documentação, junto de catálogo real de ferramentas e permissões; manter comandos do usuário separados de conteúdo externo não confiável.
2. Persistir objetivo, critérios de aceite, revisão/commit de base, etapa, ações concluídas, evidências, bloqueios e próxima ação. Retomar do checkpoint, verificando se o projeto mudou.
3. Executar ciclo observar → decidir ação concreta → validar argumentos/permissão → executar ferramenta real → registrar retorno → verificar resultado → atualizar estado. Resposta do modelo pedindo ação não é ação executada.
4. Validar saídas estruturadas; identificar cada execução. Limitar iterações, tempo e custo por tarefa. Para operações não idempotentes, usar registro/chave de idempotência e conferir estado antes de repetir. Retry com limite/backoff só para falhas transitórias; erro de credencial, permissão ou requisito exige resolução específica.
5. Concluir quando critérios verificáveis passarem; marcar bloqueado quando faltar dependência essencial; impedir ciclos sem progresso. Nunca inventar ferramentas nem supor acesso aos plugins do ChatGPT.
6. Se o usuário tiver autorizado agendamento adaptativo, o modelo pode propor próxima data ISO com fuso e motivo. O executor valida intervalo e limites acordados, atualiza o mesmo job com identificador estável e verifica a gravação. Persistir agenda não comprova execução futura. Não criar agendamento novo nesta atualização de skills.
7. Após restart, recuperar estado durável e reconciliar jobs em andamento; evitar execução simultânea da mesma tarefa com lock/lease apropriado. Logs devem registrar fatos e erros sem segredos.

## Critério de comprovação
Skill publicada comprova instruções disponíveis. Leitura posterior comprova conteúdo salvo. Só execução observada comprova que o modelo seguiu os métodos. Instalar este documento não implanta executor, não concede ferramenta e não garante autonomia contínua.
