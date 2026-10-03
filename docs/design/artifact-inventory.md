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
| Daily briefing email | Email (HTML + plain-text parts) | `swarmforge/scripts/briefing_email_lib.bb` (`render-briefing-html`), `extension/src/tools/render-briefing-diagrams.ts`; the headless/no-agent closing-ceremony variant is composed by `swarmforge/scripts/banked_briefing_lib.bb` (`compose-banked-briefing`) but sent through the same render pipeline | Send/inspect a real briefing render; `docs/how-to/BL-658-briefing-trigger-derived-from-closure-schedule.md` for when it fires | **2026-09-06 — approved** (BL-1419). Follow-up [list-item scan weight](briefs/2026-09-06-briefing-list-item-scan-weight.md) (BL-1442) landed 2026-09-06 — leading ticket ids in list items now bold. **2026-09-28 — the headless closing-ceremony variant reviewed on its real rendered HTML** (`2026-09-26.md`, `2026-09-27.md`): defect found, see [headless briefing wall-of-text](briefs/2026-09-28-headless-briefing-wall-of-text.md) (brief sent to specifier). The coordinator/documenter-composed variant (spot-checked `2026-09-20.md`) is unaffected. |
| Telegram messages (pipeline board, approval asks, alerts) | Telegram, rendered in a real chat/topic | `extension/src/concierge/pipelineBoard.ts` (a mapped ticket's caption line now leads with BL-670's health dot, 🟢/🟡/🔴, per BL-1451), `extension/src/tools/telegramFrontDeskBotCore.ts`, `extension/src/concierge/topicIcon.ts` | Open the swarm's Telegram chat/topics live | Not yet reviewed |
| Static backlog-dashboard PWA | Static web page, phone-viewable, no live backend (local-engineering rule 5) | `pwa/` (generated from `backlog.json`) | Open the built PWA in a browser or on a phone | Not yet reviewed |
| Live console / Mini App screens | Live web UI, token-auth, control actions (local-engineering rule 5) | extension webview panels (`extension/src/panel/`) | Run the extension, open the panel in VS Code or the live console | Not yet reviewed |
| Bubble — Pipeline Board screen | Telegram Mini App, phone-viewable (grid + tap-through detail sheet) | `extension/src/bridge/bubblePipelinePageUiHtml.ts`, `extension/src/bridge/bubblePipelinePage.ts` (BL-831, landed 2026-09-18) | Open the Bubble Pipeline tab from a real Telegram session on a phone | Not yet reviewed |
| Bubble — Live Screen grid (tmux pane tiles, phone + wide) | Telegram Mini App / Bubble Live tab, phone-viewable (2-col phone, up to 5-col wide) | `extension/src/bridge/residentSpyUiHtml.ts` (`renderLiveScreenBody`, shared by both shells), `extension/src/bridge/residentPaneLive.ts`, `extension/src/bridge/bubbleLiveUiHtml.ts` | Open the Bubble Live tab from a real Telegram session, phone and wide widths | **2026-10-03 — defect found** (BL-1858 sign-off, source review at commit ad8499e1d8, no live tunnel): see [ten-tile phone row crowding](briefs/2026-10-03-bl1858-live-grid-ten-tile-phone-row-crowding.md) (brief sent to specifier). The column-count/model-label fixes BL-1858 itself landed are correct. |
| Rendered docs | Markdown rendered on GitHub/an editor, and any generated HTML (e.g. `docs/reference/model-compatibility.md`) | `docs/` tree, `swarmforge/scripts/model_factory_lib.bb` (compat-docs) | Open the rendered page on GitHub or a Markdown previewer | Not yet reviewed |
| Intake form ("File an intake", Telegram Intake topic) | Telegram Mini App, phone-viewable (BL-1732, epic BL-1731) | `extension/src/bridge/intakeFormUiHtml.ts` | Open the Intake topic's way-in from a real Telegram session on a phone, or the rendered source QA captures at `tmp/bl1732-render/intake-form.html` | **2026-09-30 — LGTM** (source review at QA's sign-off commit `bab9c7da6a`, no live tunnel): both prior findings confirmed fixed — narrative `select`s are `display: inline-block; width: auto; max-width: 100%` (no longer caught by the blanket `width: 100%` rule), and `select, textarea, input[type="text"]` are now `font-size: 16px`. See [narrative selects wrap](briefs/2026-09-30-bl1732-intake-form-narrative-selects-wrap.md) and [input font-size iOS zoom](briefs/2026-09-30-bl1732-input-font-size-zoom.md) for the original findings. |

## Out of scope for this inventory

- Internal/operator-only tooling with no human-facing rendering (CLIs,
  raw JSON state files, log files).
- The design-exploration doc `docs/branding/icon-system.md` — that is a
  *ruled asset* (see `docs/design/system.md`), not an artifact surface in
  its own right.
