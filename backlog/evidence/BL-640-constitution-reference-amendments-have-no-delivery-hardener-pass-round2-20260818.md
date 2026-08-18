# BL-640-constitution-reference-amendments-have-no-delivery — hardener pass (round 2)

QA bounce D1 (temp-dir leak in `bl640_prompt_stability_check.bb`, blamed
coder): `backlog/evidence/BL-640-constitution-reference-amendments-have-no-delivery-qa-bounce-20260818.md`.
Coder fix `58e10ec66` reviewed by architect (round 3,
`backlog/evidence/BL-640-constitution-reference-amendments-have-no-delivery-architect-pass-round3-20260818.md`).
Merged architect's round-3 commit `bb178332df` into this worktree.

## D1 remediation re-verified independently

- `cd extension && npx vitest run test/tempDirTrapGuard.test.js` — **4/4
  PASS**, including the previously-failing "the real swarmforge/scripts
  tree has zero temp-dir-trap violations".
- `bb swarmforge/scripts/test/bl640_prompt_stability_check.bb` run directly
  with a before/after `$TMPDIR` `bl640-prompt-stability-*` dir count:
  **60 -> 60**, confirming no new leak (the 60 are pre-existing historical
  leakage from every prior pass on this ticket before the fix landed, per
  architect's own count — not something this pass needs to sweep).
- Fix is scoped: `git show 58e10ec66 --stat` touches only
  `bl640_prompt_stability_check.bb` (24 insertions / 18 deletions), no
  scope creep.

## Round-1 hardening unaffected

The D1 fix touches only test-fixture cleanup in
`bl640_prompt_stability_check.bb` — none of the 7 hand-authored mutants
from the round-1 hardening pass
(`backlog/evidence/BL-640-constitution-reference-amendments-have-no-delivery-hardener-pass-20260818.md`)
target this file; `reference_freshness_lib.bb` and `ready_for_next.bb` are
untouched since that pass. No new mutation sweep needed for this bounce.

## Full re-verification

- `bash swarmforge/scripts/test/test_reference_freshness_guard.sh` — ALL PASS.
- `bb swarmforge/scripts/test/reference_freshness_lib_test_runner.bb` — ALL PASS.
- `bb swarmforge/scripts/test/bl640_reference_freshness_property_runner.bb` — ok.
- `bb swarmforge/scripts/test/bl640_prompt_stability_check.bb` — ok (04/06),
  no leak (above).
- `node specs/pipeline/cli.js specs/features/BL-640-constitution-reference-amendments-have-no-delivery.feature`
  — 5/5 PASS.
- No orphaned `node --test`/`vitest`/`stryker`/`bb` processes before or
  after this pass; no fixture tmux servers; clean `git status --short`
  before and after.
- CRAP/DRY: N/A — this bounce touches no `extension/src/*.ts`.

D1 closed. Forwarding to documenter.

By hardender.
