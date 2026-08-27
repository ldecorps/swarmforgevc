# BL-640-constitution-reference-amendments-have-no-delivery — architect pass (round 3)

QA bounce: `backlog/evidence/BL-640-constitution-reference-amendments-have-no-delivery-qa-bounce-20260818.md`
(D1: `bl640_prompt_stability_check.bb` leaked two temp dirs per run, tripping
`extension/test/tempDirTrapGuard.test.js`'s zero-violations gate). Coder fix
reviewed: `58e10ec66` (forwarded unchanged by cleaner via merge `022a0491a2`).

## D1 remediation verified

Both `mk-synthetic-root` call sites (scenario 04, scenario 06) now wrap
their body in `try`/`finally` with `fs/delete-tree` on the fixture root,
matching this repo's established `.bb` fixture-cleanup convention. Scoped,
single-file fix (24 insertions / 18 deletions), no other files touched —
no scope creep beyond the bounced defect.

Re-verified independently:
- `cd extension && npx vitest run test/tempDirTrapGuard.test.js` → **4/4
  PASS**, including "the real swarmforge/scripts tree has zero
  temp-dir-trap violations" (previously the deterministic failure QA
  reported).
- `bb swarmforge/scripts/test/bl640_prompt_stability_check.bb` run directly
  with a before/after `$TMPDIR` `bl640-prompt-stability-*` dir count: 60 →
  60, confirming no new leak from this run (60 pre-existing directories are
  historical leakage from before this fix, across every prior run this
  ticket accumulated in coder/architect-round-1/round-2/hardener/QA passes
  — not something this review needs to sweep).
- `bash swarmforge/scripts/test/test_reference_freshness_guard.sh` — ALL
  PASS.
- `bb swarmforge/scripts/test/reference_freshness_lib_test_runner.bb` — ALL
  PASS.
- `bb swarmforge/scripts/test/bl640_reference_freshness_property_runner.bb`
  — ok.
- `node specs/pipeline/cli.js specs/features/BL-640-constitution-reference-amendments-have-no-delivery.feature`
  — **5/5 PASS**.
- Co-change report against the fixed file: co-changes limited to its own
  BL-640 siblings, no new coupling.
- Dependency-gate hard gate: N/A, unchanged from prior rounds — the fixed
  file is under `swarmforge/scripts/`, not `extension/src`/`extension/media`.

Round-1 (D1 fixture isolation, D2 local-main-only freshness) and round-2
verification stand unchanged; QA's own evidence already re-confirmed
everything except this one item was sound. Forwarding to hardener.

By architect.
