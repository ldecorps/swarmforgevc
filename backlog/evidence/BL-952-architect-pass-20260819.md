# BL-952 architect pass — 2026-08-19

Reviewed: coder's `afa87c484` ("a parcel QA bounced never reads as
QA-approved"), merged by cleaner in `9a118001e`, plus cleaner's own
`ba746bde1c` (dedupe of the two bounce-token prefix-match loops in
`is_qa_ancestor.sh`).

## Scope
`is_qa_ancestor.sh` now consults two durable bounce-verdict stores
(`.swarmforge/bounces/*.jsonl`, tracked ticket-YAML `bounce_history`) in
addition to ancestry; `handoffd.bb`'s gatherer threads `:bounced?` per
commit and drops the tip-is-ancestor fast path; `push_sweep_lib.bb`'s
`qa-gate-decision` vetoes on `:bounced?` before the bookkeeping allowlist
or trivial-merge exemption can launder it. `check_pipeline_code_on_main.sh`
and `babysitter_check.bb` need no code change — both already shell the same
predicate script, so they inherit the fix automatically (confirmed by
reading both call sites, not assumed).

## Dependency-rule gate (BL-259, hard gate)
Parcel touches no `extension/src`/`media` file — the tool's whole scope.
`node extension/out/tools/dependency-gate.js` against the actual changed
files errors ("can't open") because none resolve under `extension/`;
correct, there is nothing here for it to check. Full-repo mode
(`node extension/out/tools/dependency-gate.js`, no args) reports the same
3 pre-existing `telegram-front-desk-bot`/`telegramCursorOperatorExec`/
`telegramCursorOperatorLiveness` acyclic violations seen on recent passes
(BL-947/BL-949/BL-950) — already tracked as BL-759, none of the 3 files
touched by this parcel.

## Co-change report (informational)
`is_qa_ancestor.sh` alone: every co-change is at frequency 1-2, all below
the suspected-coupling threshold — its historical co-changes are exactly
its own consumers/tests, unsurprising. `handoffd.bb` alone: many
high-frequency co-changes, but `handoffd.bb` is the central daemon touched
by nearly every ticket in this repo; nothing in the list points at a
missed edit specific to this fix (`check_pipeline_code_on_main.sh` and
`babysitter_check.bb`, the two other predicate consumers, both sit far
below threshold too — consistent with them needing no change here).

## Invariants (all 3 declared)
1. "A parcel QA bounced never reads as QA-approved... whatever refs its
   commits are reachable from": encoded as a genuine property in
   `push_sweep_lib_property_runner.bb` — `:bounced?` drawn on equal footing
   with every other generated flag (never a rare corner), oracle asserts
   the veto fires over `:qa-ancestor?`/bookkeeping/trivial-merge alike, and
   a reachability-floor assertion fails the run if the generator never
   actually produces a bounced-and-otherwise-approved shape. Ran it here:
   500 runs, ALL PROPERTIES HOLD, reachability floor satisfied.
2. "Every consumer... one definition, no private notion of approved":
   correctly treated as a wiring claim, not a generated-input property.
   Verified myself, not taken on the commit message: read
   `check_pipeline_code_on_main.sh` and `babysitter_check.bb` directly,
   confirmed both shell `is_qa_ancestor.sh` and neither reimplements
   ancestry. Acceptance scenario 05 exercises two real consumers (the
   predicate itself, and `check_pipeline_code_on_main.sh`'s merge-head
   exemption path) via real subprocess spawns, not a stub.
3. "An undeterminable verdict fails CLOSED... unknown is never approved":
   lib half rides the existing `facts-complete?` oracle; script half is
   acceptance scenario 04 (unresolvable sha, obstructed store, corrupt
   record — each asserted to name its cause on stderr, not a bare
   refusal).

## Correctness — independently reproduced, not taken on the commit message
Built a throwaway fixture repo by hand (bounced commit recorded only in a
ticket YAML's `bounce_history`, in the exact `by: QA ... commit: <hex>`
inline-map shape `bounceHistory.ts`'s `formatBounceHistoryEntry` writes) and
ran `is_qa_ancestor.sh` directly against both the bounced and an approved
sha: bounced → exit 1, `bounced: ... appears in a ticket's bounce_history`;
approved → exit 0. Confirms the YAML-store branch — the one path this
parcel's own test suite never exercises (see gap below) — is genuinely
correct, not just plausible.

## Gap flagged for hardener (not a send-back — nothing is broken)
`is_qa_ancestor.sh` documents and implements TWO independent bounce stores
("each store has missed entries the other held"), but every test in this
parcel (unit, property, acceptance) drives only the JSONL-store path
(`recordBounce()` in the step file). The ticket-YAML `bounce_history` path
is completely unexercised by automated tests — I verified by hand above
that it works, so this is a coverage gap on a safety-critical fail-closed
gate, not a demonstrated defect. Hardener: add an acceptance/unit case that
records a bounce via a ticket's `bounce_history` only (no JSONL record) and
confirms the predicate still refuses.

## Minor note (not bounce-worthy)
Cleaner's `match_bounce_token()` extraction in `ba746bde1c` changes the
JSONL-store stderr wording from `"... on file ($f, recorded as $token)"` to
`"... on file ($f) (recorded as $token)"` — the commit message says wording
is unchanged, which is true of the "recorded as $token" substring but not
of the surrounding punctuation. No test asserts the exact string either
way, so this is cosmetic only.

## Property testing
No new pure TS/JS module introduced or touched by this parcel (all changes
are Babashka/bash/BDD-step-JS) — no fast-check property-coverage action
needed here; the project's own Babashka generative-property harness is the
right tool for `push_sweep_lib.bb` and is already exercised above.

## Unit/acceptance runs (reproduced live, not taken on the commit message)
- `bb swarmforge/scripts/test/push_sweep_lib_test_runner.bb`: ALL TESTS
  PASSED (includes the 5 new BL-952 truth-table rows).
- `bb swarmforge/scripts/test/push_sweep_lib_property_runner.bb`: 500 runs,
  ALL PROPERTIES HOLD, including 6 non-vacuity confirmations.
- `./specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-952-a-bounced-parcel-never-reads-as-qa-approved.feature`:
  first run 9/10 (1 `ENOTEMPTY` `afterEach`-hook race removing a live
  daemon's tmp dir — the same pre-existing daemon-fixture flake class the
  coder's own commit message documents for the sibling wiring test);
  re-ran clean, 10/10.

## Verdict
COMPLIANT. Forwarding to hardender, with the YAML-store coverage gap noted
above for their pass.
