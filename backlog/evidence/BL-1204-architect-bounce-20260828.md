# BL-1204 — architect bounce — 20260828

## D1: acceptance step handler missing entirely

1. **Failing command:**
   `bash specs/pipeline/scripts/run_acceptance.sh specs/features/BL-1204-redeploy-targets-are-reachable-and-listed.feature`
2. **Commit reviewed:** `24c22bbb79` (cleaner's evidence commit, merged into
   architect worktree this pass).
3. **First error excerpt:**
   ```
   Error: Scenario "A built redeploy target is reachable from Telegram":
   no step handler matched "Given the Cursor bridge is accepting Telegram
   commands"
   ```
   All 4 scenarios in the ticket's own declared `acceptance:` feature fail
   identically — 0/4 pass.
4. **Failure class:** `acceptance`.
5. **Expected vs observed:** the ticket declares
   `acceptance: specs/features/BL-1204-redeploy-targets-are-reachable-and-listed.feature`;
   expected a registered step handler exercising it. Observed: no
   step-handler file exists anywhere in the delivered work —
   `find specs/pipeline/steps -iname "*1204*"` and
   `find . -iname "*1204*Steps*"` are both empty, and
   `specs/pipeline/steps/index.js` carries no `1204` reference. Same shape
   as this session's own BL-1198 QA bounce (D1): a mechanism built,
   unit-tested, green, never exercised at the acceptance layer.

## Everything else checked — genuinely clean (Article 4.4 full inventory)

| Check | Result |
|---|---|
| Dependency gate (`extension/out/tools/dependency-gate.js`, run from `extension/`) | PASSED — no forbidden edges on `telegramCursorBridgeCore.ts` / `telegramCursorOperatorExec.ts` |
| Co-change report | No new suspected coupling — the flagged pairs are this module family's known pre-existing cluster (`telegramCursorBridgeLive.ts`, `telegramCursorOperatorCore.ts`, etc.) |
| `npm run compile` (from `extension/`) | Clean |
| `telegramCursorBridgeCore.test.js` | 125/125 pass, including the new BL-1204 help/parity assertions |
| `telegramCursorOperatorExec.test.js` | 23/24 pass — the one failure (`BL-698: ambulance engage and release`) is confirmed pre-existing and unrelated: same test content byte-identical before/after this parcel's commit (`d2a5f68f3^`), fails on backlog fixture state ("ticket sits in paused/, not active/"), not on anything this parcel touched |
| `telegramCursorBridgeRedeployTargets.test.js` | 4/4 pass |
| `telegramCursorBridgeLive.test.js` | 120/120 pass |
| `telegramCursorBridgeRedeploy.test.js` | 10/10 pass |
| Declared invariant ("every accepted target listed, every listed target accepted") | Encoded as a real, non-vacuous unit test derived from each module's own real parser function — confirmed by reading `telegramCursorBridgeCore.test.js:899` |

**Note on my own first pass:** my first run of these suites showed the two
new BL-1204 dispatch tests failing (`Redeploy script not found at
.../redeploy_cursor_bridge.sh`). That was a stale `extension/out/` in this
worktree from an earlier `npm run compile` invoked from the repo root
instead of `extension/` (this project's own convention: npm runs from
`extension/`, never the repo root). Rebuilding from `extension/` directly
made both tests pass. Not a coder/cleaner defect — recorded here only so a
future reviewer isn't misled by the same stale-build trap.

**The underlying wiring fix itself is solid and well-verified** — this
bounce is narrowly about the missing acceptance layer, not a doubt about
the dispatch fix's correctness.

## Routing

Per Article 4.3 and this session's own BL-1198 precedent, owning stage
defaults to **coder** — the step handler is mechanical wiring against
already-correct, already-tested logic (`parseFrontDeskRedeployCommand`,
`parseAllRedeployCommand`, `executeOperatorVerb`'s dispatch), no new
production logic needed.

By architect.
