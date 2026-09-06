# Art Director — Artifact Inventory

Kept by the Art Director (Article 1.10). Every human-facing artifact the
swarm produces, with its real surface, the module that produces it, and
how to view it on that surface. The Art Director reviews look and feel
directly on the surface named here, never from a mockup — this list is
what "every artifact" (Article 1.10's own wording) enumerates.

Seeded from the BL-1417 epic's own artifact list (`remaining_slices`) at
mint (BL-1440); the Art Director keeps this current from its first pass
onward, adding a row whenever a new human-facing surface ships and
updating the "Reviewed" column as each one is looked at.

| Artifact | Surface | Producer module | How to view it | Reviewed |
|----------|---------|------------------|-----------------|----------|
| Daily briefing email | Email (HTML + plain-text parts) | `swarmforge/scripts/briefing_email_lib.bb` (`render-briefing-html`), `extension/src/tools/render-briefing-diagrams.ts` | Send/inspect a real briefing render; `docs/how-to/BL-658-briefing-trigger-derived-from-closure-schedule.md` for when it fires | BL-1419 (in flight, epic BL-1417) |
| Telegram messages (pipeline board, approval asks, alerts) | Telegram, rendered in a real chat/topic | `extension/src/concierge/pipelineBoard.ts`, `extension/src/tools/telegramFrontDeskBotCore.ts`, `extension/src/concierge/topicIcon.ts` | Open the swarm's Telegram chat/topics live | Not yet reviewed |
| Static backlog-dashboard PWA | Static web page, phone-viewable, no live backend (local-engineering rule 5) | `pwa/` (generated from `backlog.json`) | Open the built PWA in a browser or on a phone | Not yet reviewed |
| Live console / Mini App screens | Live web UI, token-auth, control actions (local-engineering rule 5) | extension webview panels (`extension/src/panel/`) | Run the extension, open the panel in VS Code or the live console | Not yet reviewed |
| Rendered docs | Markdown rendered on GitHub/an editor, and any generated HTML (e.g. `docs/reference/model-compatibility.md`) | `docs/` tree, `swarmforge/scripts/model_factory_lib.bb` (compat-docs) | Open the rendered page on GitHub or a Markdown previewer | Not yet reviewed |

## Out of scope for this inventory

- Internal/operator-only tooling with no human-facing rendering (CLIs,
  raw JSON state files, log files).
- The design-exploration doc `docs/branding/icon-system.md` — that is a
  *ruled asset* (see `docs/design/system.md`), not an artifact surface in
  its own right.
