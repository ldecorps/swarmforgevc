# BL-1334 — cleaner pass, 2026-09-02

Role: cleaner. Ticket: BL-1334-a-landed-replay-is-qa-approved-when-it-lands.

## Received
Coder commit `34ca0b2d5a`: records the land-step replay-to-approved-source
mapping (`land_step_lib.bb::record-land-approval!`), reads it from the
shared predicate (`is_qa_ancestor.sh`), and has `build_freshness_cli.bb`
defer to that predicate instead of computing its own approval opinion
(human_ruling option 2 — record the mapping, do not advance the QA ref).

## Verification (independent re-run)
- `bb swarmforge/scripts/test/land_step_lib_test_runner.bb` — ALL PASS.
- `bb swarmforge/scripts/test/build_freshness_lib_test_runner.bb` — ALL TESTS PASSED.
- `bash swarmforge/scripts/test/test_is_qa_ancestor_land_replay_store.sh` — ALL CHECKS PASSED (10/10, including corrupt/unreadable/absent-store fail-closed cases).
- `bash swarmforge/scripts/test/test_build_freshness_land_replay_approved.sh` — ALL CHECKS PASSED (8/8).
- `bash swarmforge/scripts/test/test_land_step_records_approval.sh` — ALL CHECKS PASSED (9/9, the end-to-end wiring proof).
- `node specs/pipeline/cli.js specs/features/BL-1334-a-landed-replay-is-qa-approved-when-it-lands.feature` — 5/5 pass.
- `bb swarmforge/scripts/test/bl1334_land_replay_approval_property_runner.bb` — 48 exhaustive cases, ALL PROPERTIES HOLD.

## Cleanup review
- `record-land-approval!` hand-builds the JSONL line via string
  concatenation rather than a JSON encoder (e.g. cheshire, used elsewhere
  in this repo such as `expedite_lib.bb`). Checked whether this is a
  defect: it is not — the reader (`is_qa_ancestor.sh`) is a POSIX shell
  script that parses the fixed two-hex-field shape with `grep`/`sed`
  regexes, the same convention this file already uses for its other
  verdict stores (BOUNCE_TOKENS/EXPEDITE_TOKENS). The only interpolated
  values are git SHA abbreviations (regex-constrained hex) and a ticket id
  (always `BL-\d+`-shaped) — neither can contain a quote or backslash, so
  there is no injection/malformed-JSON risk in practice, and a real JSON
  encoder would buy nothing a shell-side regex reader could additionally
  trust. No change needed.
- `build_freshness_cli.bb::qa-approved-shas!` batches the predicate call
  (`--batch`, BL-1086) instead of one process per sha — already the
  efficient shape, no rework needed.
- `land_step_cli.bb`'s new block records-then-reports-on-failure without
  disturbing the existing success path; CLI stays a thin wrapper over
  `land_step_lib.bb`.
- `build_freshness_lib.bb::offending-shas` doc-comment and filter change
  are minimal and correctly explain the BL-925 invariant-3 fail-closed
  posture (absent `:qa-approved?` means unapproved).
- No duplication introduced between the three touched files; each is a
  single well-scoped change at its own layer (writer / predicate /
  consumer).
- Babashka has no mutation/CRAP/DRY tooling (BL-472 deferred) — the
  hardening/cleanup pass for these `.bb`/`.sh` files is gated by their own
  unit suites only, all of which are green above; recorded, not implied
  to have run mutation.

## D1..Dn (Article 4.4 complete inventory)
NONE. No defect found.

## Disposition
Forward unchanged to architect.

By cleaner.
