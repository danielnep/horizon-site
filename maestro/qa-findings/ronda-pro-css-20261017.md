# Finding QA 2026-10-17: Ronda Pro

## Evidencia observada
- Fonte: GitHub Actions workflow May Maestro | Autonomia QA run 39080429784, job 117536079294, projeto publico danielnep/app-hondas-maxvel na branch main.
- Ambiente: Node 24, conforme engines do repositorio.
- Etapa 'source-check': PASS.
- Etapa 'unit-regression': FAIL (exit 1) em uma tentativa. Falha classificada como deterministica, portanto sem repeticao cega.
- Assertiva observada nos logs: expected: /ronda-pro\\.css\\?v=17/. O HTML atual exibido pelo teste nao corresponde a esse padrao de versao do stylesheet.

## Diagnostico ainda nao comprovado
Pode ser uma expectativa de teste desatualizada ou uma alteracao no HTML que quebrou o contrato de cache. O teste isolado NAO decide essa causa. Nao alterar numero de versao ou regra de cache sem ler consumidores e comportamento do service worker.

## Proxima acao em agente de codigo
1. Localizar o teste exato e a regra de versao do CSS e service worker.
2. Verificar os manuais e o historico recente do Ronda Pro; identificar se a versao esperada e atual.
3. Reproduzir falha em branch isolada. Corrigir a causa e/ou expectativa de teste somente apos comprovar o contrato correto.
4. Rodar npm run check e npm test sob Node 24, mais teste de cache/navegador se alterar service worker/versao do CSS.
5. Abrir PR separado, sem mexer no deploy Railway nem mesclar sem aprovacao.
