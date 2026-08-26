# telegram-board-nbsp-reapply — QA bounce — 20260824

## Review inventory (Article 4.4)

Tip `c2d84f5423` ("Fix Pipeline Board: emit &#160;…") changes a BL-1113
HOTFIX_PATH while ledger `27273f2b0a` is still `state: pending` /
`human_decision: null`. Same class of hitchhiker previously bounced on the
BL-1094 land (`35c36037f`). Tip also renames the stamp-off step handler
without updating the feature text, so the harness neither confirms the
stamped blob nor runs a coherent scenario.

### D1 — acceptance — blamed: coder

- **Failing command:**
  `specs/pipeline/scripts/run_acceptance.sh specs/features/BL-1113-cursor-hotfix-main-sync-board-plan-stamp-off.feature`
- **Commit hash checked:** `c2d84f5423`
- **First error excerpt:**
  ```
  ✖ Pipeline Board HTML keeps stage spacing and uses three-word slugs
    Error: no step handler matched
    "And the stage header uses an HTML nbsp entity between DC and QA"
  ```
- **Failure class:** `acceptance`
- **Expected vs observed:** Feature still asks for "HTML nbsp entity"; tip
  retitled the step to "HTML numeric nbsp entity" and asserts `&#160;`.
  Stamped hotfix `27273f2b0a` emits named `&nbsp;`.
- **Remediation:** Do not land board entity changes until BL-848 / human
  certify-waive of `27273f2b0a` (or a new stamp-off for this tip). Keep
  HOTFIX_PATH blob identity; do not rewrite stamp-off steps to rubber-stamp
  divergence. If Telegram truly needs `&#160;`, mint a ticket + stamp-off
  after human decision — not an ad-hoc `telegram-board-nbsp-reapply` land.

### D2 — behavior (HOTFIX_PATHS invariant) — blamed: coder

- **Failing command:**
  `npx vitest run --config vitest.properties.config.mjs test/bl1113CursorHotfixStampOff.property.test.js`
- **Commit hash checked:** `c2d84f5423` (after `npm run compile`)
- **First error excerpt:** assertion at
  `extension/test/bl1113CursorHotfixStampOff.property.test.js:64` — HEAD blob
  for `extension/src/concierge/pipelineBoard.ts` diverges from `27273f2b0a`.
- **Failure class:** `behavior`
- **Expected vs observed:** Stamp-off invariant 1 — all HOTFIX_PATHS match
  `27273f2b0a`; `pipelineBoard.ts` DIVERGED (`&nbsp;` → `&#160;`). Pack MATCH.
- **Remediation:** Same as D1 — strip/revert board change off the land path
  or complete human stamp-off first. Ledger must not be written certified/
  waived by the swarm.

By QA.
