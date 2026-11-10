---
version: alpha
colors:
  background: "#191919"
  surface: "#262626"
  raised: "#303030"
  border: "#535353"
  text: "#FFFFFF"
  muted: "#B3B3B3"
  blue: "#1F98FF"
  violet: "#8B5CF6"
typography:
  display:
    fontFamily: "Manrope, Inter, system-ui, sans-serif"
  body:
    fontFamily: "Inter, system-ui, sans-serif"
rounded:
  panel: "24px"
  control: "14px"
spacing:
  compact: "8px"
  regular: "12px"
  section: "24px"
components:
  studio-navigation:
    minHeight: "54px"
---
# Horizon Studio

## Overview
Product workspace for Daniel's existing applications. Canonical references are the four generated images from 10 November 2026 at 16:01:48–16:01:57, retrieved and visually inspected during the correction. They replace the rejected administrative shell as the Studio's visual authority. The Central keeps its separate routes.

## Colors
Runtime ownership: Model B. `central/studio-shell.css` owns `--hs-bg`, `--hs-surface`, `--hs-raised`, `--hs-border`, `--hs-text`, `--hs-muted`, `--hs-blue`, and `--hs-purple`, mapped in order to the frontmatter colors. Blue/violet share emphasis; dark neutral surfaces and white text retain the latest brand manual. Client applications in the real preview keep their own identities. No recoloring of the iframe to mimic sample content.

## Typography
Use approved Manrope/Inter stacks; system sans is the runtime fallback under the existing CSP. Title 25–30px, conversation 15px, supporting labels 11–13px. Bold indicates hierarchy, not every control.

## Layout
Compact Horizon Studio header and one visible project selector. Mobile has one content panel and four bottom destinations: Prévia, Conversar, Agentes, Maestra. The reference's preview/device/conversation toolbar remains above preview and agents. Desktop adds project navigation and simultaneous preview plus chat/agents. Navigation and composer stay in the viewport; history and agent list scroll internally.

## Elevation & Depth
Use neutral surfaces with thin borders. Blue/violet gradients are restrained to feature marks and send action, as in the selected reference. No generic administrative KPI grid in the Studio.

## Shapes
24px workspace panels, 14px controls, 18px chat bubbles. The four-item navigation has a rounded shared enclosure. Agent icons alternate blue and violet.

## Components
`studio-shell.mjs` owns project navigation, panel layout and tab semantics. `studio.mjs` owns the actual application preview and dimensions. `studio-chat.mjs` owns saved conversations and live consultation state. `studio-shell.css` is the single stylesheet for this surface; the rejected Studio CSS is no longer loaded, and its obsolete block was removed from experience.css. See UX-CONTRACT.md.

## Do's and Don'ts
Compare actual screenshots against each reference, including navigation, hierarchy, spacing and color distribution. Functional checks cannot establish visual fidelity. Do not copy illustrative task counts, conversations or client-app mock content into live state. Keep unavailable data explicit. Preserve developer tools through the conversation menu and preserve the separate Central.
