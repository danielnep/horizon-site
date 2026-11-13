# Proposta Visual Lume: Horizon Studio R3 (v0-inspired | Dark & Blue/Violet)

Conforme a diretriz do proprietário expressa no briefing R3 e nos manuais normativos, o novo Studio adota uma arquitetura de **workbench profissional de alta densidade** inspirada na UX do *v0.app*, com chrome neutro escuro, tipografia técnica precisa e **azul #1F98FF e violeta #8B5CF6** como detalhes funcionais. Vermelho não pertence à marca Horizon: não aplicar o vermelho de Ronda Pro no Studio. O iframe dos aplicativos preserva a identidade individual de cada projeto.

---

## 0. Camada de identidade e bloqueio de propostas
- **Autoridade:** proprietário, decisão do Studio R3 (11/11/2026) e correção expressa de 13/11/2026.
- **Paleta:** cinza grafite muito escuro e preto em pontos, azul `#1F98FF` e violeta `#8B5CF6` como acentos; variações leves e degradês são permitidos dentro dessas famílias.
- **Proibido:** vermelho, teal, verde, ciano independente, outros matizes e cinzas coloridos no chrome do Studio.
- **Portão:** Lume/Íris só podem propor cor externa se o proprietário solicitar ou aprovar explicitamente após ser consultado. Toda proposta exibe `CAMADA DE IDENTIDADE | CONFORME/BLOQUEADO`. Em erro, corrigir antes de entregar; Argos verifica.

## 1. Sistema de Tokens Visuais (Studio Dark / Blue / Violet)

- **Superfícies & Canvas:**
  - `bg-canvas`: `#0D0D0D` (fundo mestre da janela)
  - `bg-rail`: `#111111` (trilho lateral de projetos)
  - `bg-panel`: `#181818` (painéis de chat e preview)
  - `bg-elevated`: `#222222` (menus, tooltips e dropdowns)
  - `border-hairline`: `#2A2A2A` (bordas de 1px sem sombras difusas)
  - `border-active`: `#3F3F3F` (foco e separadores ativos)
- **Acentos aprovados:**
  - `accent-blue`: `#1F98FF` (ações primárias, botões de ação e tabs ativas)
  - `accent-blue-hover`: `#3BA7FF` (variação leve autorizada)
  - `accent-blue-active`: `#168CEF` (variação leve autorizada)
  - `accent-violet`: `#8B5CF6` (destaques pontuais permitidos)
  - `accent-violet-hover`: `#996DF7` (nuance leve)
  - `accent-gradient`: `linear-gradient(135deg, #1F98FF, #8B5CF6)` (uso pontual; não substituir superfícies dark)
  - `surface-selected`: `#262626` (tags/chips; borda #1F98FF quando necessário)
- **Tipografia & Textos:**
  - Fontes: **Manrope** (marca/cabeçalhos), **Inter** (UI/labels) e **IBM Plex Mono** (código, hash, logs e endpoints).
  - `text-primary`: `#FFFFFF` (100% contraste, títulos e inputs ativos)
  - `text-secondary`: `#A1A1A1` (subtítulos e metadados)
  - `text-muted`: `#717171` (placeholders e rótulos inativos)

---

## 2. Arquitetura de Layout (Tri-Panel Workbench)

A estrutura visual abandona dashboards com cards espalhados e adota layout tri-partido com redimensionamento fluido:

1. **Header Global (48px fixo):**
   - Esquerda: Brand Studio minimalista + seletor rápido de repositório/branch.
   - Centro: Switcher de viewports do iframe (`[360 Mobile | 768 Tablet | 1440 Desktop]`) com botões monoline discretos.
   - Direita: Indicador de status da VPS (indicador neutro `#B3B3B3` com ícone e texto de status) e tabs principais do workbench: `[Preview | Code | Quality]`.
2. **Painel Esquerdo — Rail de Projetos (260px, colapsável para 48px):**
   - Agrupamento honesto VPS + GitHub.
   - Cada item possui ícone monoline, título do projeto e indicador sutil de fila ativa.
   - Item selecionado: borda esquerda 2px `accent-blue` com fundo `surface-selected`.
3. **Painel Central — Chat & Composer (largura flex 380px–460px):**
   - Cabeçalho: Avatar e identificação do agente ativo (`Maestra`, `Mosaico`, `Forja`, etc.) e status da sessão.
   - Stream de Mensagens: Balões com borda fina (`#2A2A2A`), background `#141414`, tipografia limpa, blocos de código com destaque mono e tags de tarefas.
   - Composer Dock (fixo na base): Caixa flutuante ou acoplada com `textarea` auto-expansível, atalhos de envio (`Cmd/Ctrl+Enter`), upload de contexto e o botão primário **"Solicitar Implementação"** em `accent-blue` sólido com texto `#FFFFFF`.
4. **Painel Direito — Workspace de Execução (flex 1):**
   - **Modo Preview:** Container centralizado simulando o dispositivo escolhido com background pontilhado sutil (`#181818`). Iframe isolado em sandbox. Estado vazio honesto com ilustração wireframe e botão "Iniciar Serviço" caso não haja URL ativa.
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
  - *Loading:* Skeleton pulsante em `#222222` (sem telas em branco).
  - *Erro/Offline:* Banner inline com borda `accent-blue` e ação de reconectar.

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
   - Desenhar os balões de agentes com bordas finas e micro-tipografia, além do botão de envio com estilo `accent-blue`.
4. **Passo 4 — Painel de Preview e Viewport Switcher:**
   - Construir o wrapper de preview com classes CSS `.viewport-mobile` (360x800), `.viewport-tablet` (768x1024) e `.viewport-desktop` (100%).
   - Inserir tratamento para `empty-state` com aviso real e limpo quando a URL de preview for inexistente.
5. **Passo 5 — Integração com Endpoints Reais sem Falsificação:**
   - Plugar carregamento de tarefas (`/central/api/tasks`) e sessões (`/central/api/studio/session`), garantindo manipulação de erros com cancelamento de requisição (`AbortController`).
