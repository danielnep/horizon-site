# Horizon Studio V2 — Conversas Antigravity

Incremento de 10/11/2026 sobre a base 727655a. Preserva Prévia / Conversar / Agentes, prévias reais dos cinco aplicativos na VPS, PWA, ferramentas e histórico anterior.

## Funcionamento

- Conversar usa o executor real /usr/local/bin/horizon-agy com um dos oito agentes canônicos, modelo configurado pelo executor e modo plan.
- História e rascunhos separados por project_id. Os projetos são permitidos explicitamente; o cliente não fornece diretórios, executáveis ou URLs de execução.
- SQLite persistente em /var/lib/horizon-studio, fora do repositório e do container web. Estados queued/running/completed/failed/interrupted com eventos sequenciais.
- Reenvio após falha de rede usa client_id idempotente. Fila sequencial limitada; pendências persistem, consultas interrompidas por reinício não são apresentadas como concluídas nem repetidas silenciosamente.
- Agentes mostra somente atividade observada no serviço de consultas. Não representa outros processos Antigravity nem as filas históricas.
- Consulta concluída significa resposta recebida, não aplicativo construído ou homologado.
- Este incremento NÃO habilita edição/publicação automática de apps pela conversa. As ferramentas anteriores da Central não foram migradas nem reativadas como Antigravity.
- Sem revisão HTTP disponível, a prévia não se recarrega periodicamente e não perde o estado do aplicativo. Atualizar provoca recarga explícita.

## Acesso e implantação

Serviço: deployment/panel/horizon-studio.service. Usa o token privado já configurado, socket Unix studio.sock no diretório compartilhado, ProtectSystem=strict e /opt somente leitura. Nenhum segredo vai ao navegador, GitHub ou resposta de erro.

O painel legado público não autoriza acesso a conversas. As novas rotas exigem cookie proprietário assinado, cookie de sessão/evidência válido ou convite assinado de duração limitada. Desbloqueio e escrita exigem mesma origem HTTPS. Cookie HttpOnly, Secure, SameSite=Strict. Convite é recebido via fragmento, removido da URL antes de navegação e trocado por cookie.

Build do painel pelo Dockerfile existente. O serviço de consultas não substitui nem reinicia a ponte antiga. Site institucional e apps de clientes ficam intactos.

Rollback: restaurar a imagem anterior do painel; parar horizon-studio.service se necessário. Preservar SQLite e diretório de autenticação. Não apagar filas ou conversas.

## Verificação realizada

- 104 testes Node, incluindo rejeição de acesso anônimo mesmo em modo painel público, origem externa, convite expirado e sessão assinada.
- 7 testes Python com SQLite real: isolamento de histórico/eventos, idempotência concorrente, rejeição de projetos/agentes inválidos, recuperação após reinício, atividade real, parsing e limite de fila.
- Resposta real da Maestra pelo serviço e persistência no projeto Horizon Studio.
- Playwright em 360×800, 412×915, 768×1024 e 1440×900: conversa persistida, rascunhos por projeto, troca de abas, oito agentes, reload, preview VPS, acesso anônimo negado, overflow e botão Enviar.
- Revisão estática independente pelo Argos real do Antigravity. Inspeção visual de screenshots pela May.
- APK e emulador continuam em standby, conforme decisão do proprietário.

Não confundir cobertura medida com aprovação de recursos que não foram implementados.
