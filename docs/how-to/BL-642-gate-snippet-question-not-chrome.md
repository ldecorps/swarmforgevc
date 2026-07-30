# BL-642: gate snippet shows the question, not terminal chrome

When a role is gated, Telegram's `NeedsApproval` body quotes
`extractQuestionSnippet` (`extension/src/panel/needsHumanDetection.ts`) —
the same helper that feeds the git-committed topic record.

BL-395 already drops unambiguous chrome (pure box-rule lines, bare prompts,
fully-matched footers). Two word-bearing furniture shapes still leaked on
live panes:

1. **Pane title rule** — `──── SwarmForge Coder ──` (session name inside
   box runs; letters defeat the whole-line box test).
2. **Width-truncated footer** — starts as `⏵⏵ bypass permissions…` but the
   tail is cut by terminal width (`install gh… e…`), so the phrase-strip
   remainder check fails.

## Fix

- Drop a line whose non-box remainder is exactly `SwarmForge <Role>`.
- Treat a line that *begins* as the known footer as chrome (truncation only
  ever eats the end).
- Drop a bare `/rc` line (live remote-control remnant).
- If nothing survives, return
  `(no question text captured; open the pane)` — fail closed rather than
  shipping furniture or an empty body.

`detectNeedsHuman` is unchanged.

## Tests

```bash
cd extension && npm run compile && npx vitest run test/needsHumanDetection.test.js
bash specs/pipeline/scripts/run_acceptance.sh \
  specs/features/BL-642-gate-snippet-is-terminal-chrome-not-the-question.feature \
  /tmp/bl642-acceptance \
  specs/pipeline/steps/bl642Only.js
```
