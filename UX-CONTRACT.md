# Horizon Studio interaction contract

- Canonical project identity: `central/studio-projects.json`. Every record joins the VPS URL and GitHub repository; a missing association remains null. VPS publications appear first. The same project ID drives preview, messages and project navigation. Python and Node read the same manifest.
- Canonical Select/Listbox: native HTML select. Platform menu geometry and keyboard behavior are intentional. The header is the only visible project selector; the desktop project list is an alternate navigation to the same identity.
- Canonical form: `studio-chat.mjs`, native textarea with label, explicit submission feedback, idempotency key, busy/disabled send. Validation keeps the draft; async completion only clears the submitted project's current mode. No new password prompt inside a conversation.
- Conversations persist on the VPS. Drafts persist per project and conversation/Maestra mode in sessionStorage. Maestra filters the project's real history to Maestra; ordinary conversation shows the team. Tab switching never cancels a queued message.
- Async and failure: render actual statuses from the API. Unauthorized/offline states must not fabricate activity or expose private history. No automatic app execution is claimed for consult-only messages. Tools for submitting development tasks remain accessible in the menu.
- Tabs: four labelled destinations, arrow/Home/End support, visible focus, matching aria-selected/aria-controls. Native dialog owns focus trap, Escape and focus restoration for development tools.
- Canonical Scrollbar: studio-shell.css, internal scroll for history/agents/preview. Composer and navigation must remain reachable at 360px, 412px, 768px and 1440px, including reduced viewport height.
- Canonical feedback: studio-chat-feedback live region; previews use studio-status plus compact shared status. No fake success counts.
- Locale: pt-BR text and time formatting. Inline SVG icons are decorative; icon-only actions have names.
- Visual contract: DESIGN.md. Approved reference pixels are visual evidence; functional tests and screenshots of other states are not interchangeable.
