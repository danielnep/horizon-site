# Horizon Site na VPS Hostinger

A `main` de `danielnep/horizon-site` é a fonte do código publicado.

- Site: contêiner `horizon-site-web`, proxy Traefik do Coolify.
- Agentes: `horizon-worker.service` independente. O site não inicia agentes.
- API interna: `horizon-central-api.service`, socket `/run/horizon-central/control.sock`; não expõe porta.
- Segredo: `/etc/horizon-site-control.env` e `/etc/horizon-central/api.env`, nunca salvar no GitHub.
- DNS externo: apontamento A do domínio `horizonsolucoes.com` para o IPv4 da VPS, sem alterar MX, TXT ou nameservers.
- Roteamento: arquivo Traefik `/data/coolify/proxy/dynamic/horizon-site.yaml`.
- Atualizações: `horizon-site-sync.timer` busca a main, roda testes ao construir e restaura versão anterior se falhar.
- Se a API interna estiver indisponível, o painel indica desconexão, sem exibir dados antigos da Railway.

O contêiner roda sem root e acessa somente o socket da API interna.
