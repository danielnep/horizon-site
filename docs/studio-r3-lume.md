# Proposta Visual Lume: Horizon Studio R3 (v0-inspired | Dark & Red)

Conforme a diretriz do proprietário expressa no briefing R3 e nos manuais normativos, o novo Studio adota uma arquitetura de **workbench profissional de alta densidade** inspirada na UX do *v0.app*, com chrome neutro escuro, tipografia técnica precisa e **vermelho protagonista** como acento funcional. O azul e o lilás institucionais ficam terminantemente banhados do chrome do Studio, preservando identidades apenas dentro do iframe dos aplicativos testados.

---

## 1. Sistema de Tokens Visuais (Studio Red)

- **Superfícies & Canvas:**
  - `bg-canvas`: `#0D0D0E` (fundo mestre da janela)
  - `bg-rail`: `#111113` (trilho lateral de projetos)
  - `bg-panel`: `#18181B` (painéis de chat e preview)
  - `bg-elevated`: `#222226` (menus, tooltips e dropdowns)
  - `border-hairline`: `#2A2A2E` (bordas de 1px sem sombras difusas)
  - `border-active`: `#3F3F46` (foco e separadores ativos)
- **Acentos Vermelho Protagonista:**
  - `accent-red`: `#EC4047` (ações primárias, botões de ação e tabs ativas)
  - `accent-red-hover`: `#F85158` (estado hover)
  - `accent-red-active`: `#D32F2F` (estado pressionado)
  - `accent-red-muted`: `rgba(236, 64, 71, 0.12)` (tags, chips de status e seleção de itens)
- **Tipografia & Textos:**
  - Fontes: **Manrope** (marca/cabeçalhos), **Inter** (UI/labels) e **IBM Plex Mono** (código, hash, logs e endpoints).
  - `text-primary`: `#FFFFFF` (100% contraste, títulos e inputs ativos)
  - `text-secondary`: `#A1A1AA` (subtítulos e metadados)
  - `text-muted`: `#71717A` (placeholders e rótulos inativos)

---

## 2. Arquitetura de Layout (Tri-Panel Workbench)

A estrutura visual abandona dashboards com cards espalhados e adota layout tri-partido com redimensionamento fluido:

1. **Header Global (48px fixo):**
   - Esquerda: Brand Studio minimalista + seletor rápido de repositório/branch.
   - Centro: Switcher de viewports do iframe (`[360 Mobile | 768 Tablet | 1440 Desktop]`) com botões monoline discretos.
   - Direita: Indicador de status da VPS (bolinha verde `#10B981` ou neutra) e tabs principais do workbench: `[Preview | Code | Quality]`.
2. **Painel Esquerdo — Rail de Projetos (260px, colapsável para 48px):**
   - Agrupamento honesto VPS + GitHub.
   - Cada item possui ícone monoline, título do projeto e indicador sutil de fila ativa.
   - Item selecionado: borda esquerda 2px `accent-red` com fundo `accent-red-muted`.
3. **Painel Central — Chat & Composer (largura flex 380px–460px):**
   - Cabeçalho: Avatar e identificação do agente ativo (`Maestra`, `Mosaico`, `Forja`, etc.) e status da sessão.
   - Stream de Mensagens: Balões com borda fina (`#2A2A2E`), background `#141416`, tipografia limpa, blocos de código com destaque mono e tags de tarefas.
   - Composer Dock (fixo na base): Caixa flutuante ou acoplada com `textarea` auto-expansível, atalhos de envio (`Cmd/Ctrl+Enter`), upload de contexto e o botão primário **"Solicitar Implementação"** em `accent-red` sólido com texto `#FFFFFF`.
4. **Painel Direito — Workspace de Execução (flex 1):**
   - **Modo Preview:** Container centralizado simulando o dispositivo escolhido com background pontilhado sutil (`#18181B`). Iframe isolado em sandbox. Estado vazio honesto com ilustração wireframe e botão "Iniciar Serviço" caso não haja URL ativa.
   - **Modo Code:** Árvore de arquivos à esquerda (180px) e visualizador read-only monospaced com sintaxe escurecida.
   - **Modo Quality:** Feed das checagens do Argos (linter, testes, snapshots e métricas reais da fila).

---

## 3. Comportamento Responsivo & Estados Críticos

- **Desktop (1440px+):** 3 painéis simultâneos sem sobreposição; área de trabalho aberta e focada.
- **Mobile (360px e 412px):**
  - O layout colapsa em visualização de aba única alternável via **Bottom Navigation Bar** fixa (48px): `[Projetos | Chat | Prévia]`.
  - Composer mobile com suporte a `env(safe-area-inset-bottom)` para não colidir com o teclado virtual.
  - Zero estouro de viewport ou scroll horizontal.
- **Estados Visuais P0:**
  - *Sem FOUC:* Estrutura HTML/CSS inicial carrega imediatamente com tema dark nativo, eliminando qualquer flash de "Carregando a central".
  - *Loading:* Skeleton pulsante em `#222226` (sem spinners azuis ou telas em branco).
  - *Erro/Offline:* Banner inline com borda `accent-red` e ação de reconectar.

---

## 4. Passos de Implementação para o Mosaico

1. **Passo 1 — Limpeza do Shell Inicial (`central/index.html`):**
   - Purgar completamente o DOM legado ("Carregando a central"), descartar a importação de `app.js` monolítico e scripts de tema legados.
   - Inserir no `<head>` o CSS crítico de tokens (variáveis CSS `:root`) e layout base do Studio R3 para pintura imediata no primeiro frame.
2. **Passo 2 — Construção do Grid Tri-Panel:**
   - Criar estrutura semântica `div.studio-root` com `display: grid; grid-template-columns: var(--rail-w) var(--chat-w) 1fr; height: 100vh; overflow: hidden;`.
   - Adicionar classes de colapso mobile via container queries / media queries para 360px e 412px.
3. **Passo 3 — Implementação do Composer e Chat Stream:**
   - Montar o container do chat conectando-se a `/central/api/studio/projects/:id/messages`.
   - Desenhar os balões de agentes com bordas finas e micro-tipografia, além do botão de envio com estilo `accent-red`.
4. **Passo 4 — Painel de Preview e Viewport Switcher:**
   - Construir o wrapper de preview com classes CSS `.viewport-mobile` (360x800), `.viewport-tablet` (768x1024) e `.viewport-desktop` (100%).
   - Inserir tratamento para `empty-state` com aviso real e limpo quando a URL de preview for inexistente.
5. **Passo 5 — Integração com Endpoints Reais sem Falsificação:**
   - Plugar carregamento de tarefas (`/central/api/tasks`) e sessões (`/central/api/studio/session`), garantindo manipulação de erros com cancelamento de requisição (`AbortController`).
