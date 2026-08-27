# BL-631 hardener pass — 2026-08-19

## Reviewed commit
`3493f994ca` ("BL-631: architect pass - all three invariants hold, bounce
fix reconfirmed"), merged into hardener as this parcel. Bounce history: 1
cleaner bounce (D1, integration — a pre-existing standing test's
git-independent fixture broke against the new check's correct fail-closed
behavior), fixed by coder, re-verified by architect against the cleaner's
own full checklist.

## Tooling scope check
No `extension/src/*.ts` touched (only `extension/test/` is absent from
this diff entirely — the one JS file changed is the acceptance step
handler, IO-driving not pure). Stryker/CRAP/DRY inapplicable. Both
production files (`babysitterd_sweep_lib.bb`, `babysitter_check.bb`) are
Babashka — no mutation/CRAP/DRY tool wired at this language boundary,
same carve-out as every `.bb` ticket this session.

## Checks run (complete inventory, not first-failure-stop)

1. **Host load / BL-149 cooldown gate**: load averages 11–22 on 4 cores.
   5 of 6 changed files reported `DECISION: skip-cooldown` (all under
   0.05 days old — the whole parcel is today's work); the one older file
   (`test_babysitter_check.sh`) reported `skip-busy`. No formal mutation
   tooling applies to `.bb` regardless.
2. **Independent re-run of every existing suite** (not trusted from
   either evidence file):
   - `bb swarmforge/scripts/test/babysitterd_sweep_lib_test_runner.bb` —
     PASS.
   - `bb swarmforge/scripts/test/babysitter_lib_test_runner.bb` — PASS.
   - `bb swarmforge/scripts/test/babysitter_assess_lib_test_runner.bb` —
     PASS.
   - `bb swarmforge/scripts/test/babysitterd_freshness_lib_test_runner.bb`
     — PASS.
   - `bash swarmforge/scripts/test/test_babysitterd_lifecycle.sh` —
     8/8 PASS.
   - `bash swarmforge/scripts/test/test_babysitter_check.sh` — **9/9
     PASS (A–I)**, including scenario A ("fully green snapshot") — this
     is the cleaner-bounced scenario, independently reconfirmed fixed
     under my own run, not just the architect's.
   - `run_acceptance.sh
     specs/features/BL-631-babysitter-detects-pipeline-work-on-main.feature`
     — **17/17 PASS**, including scenario 17 ("the 2026-07-25 regression
     set reproduces exactly") — direct proof this detector would have
     caught the real BL-590 incident that motivated the ticket.
3. **Leak/process check**: 0 leaked `sfvc-bl631-*` fixture dirs, no
   lingering fixture tmux servers, no orphaned `node --test`/`stryker`
   processes from my own runs, `git status --short` clean.
4. **Own correctness read of the impure gatherer**
   (`gather-pipeline-code-on-main` in `babysitter_check.bb`), beyond the
   architect's already-thorough enumeration of fail-closed branches:
   - `qa-exclusive-paths` reads `--list-paths` output directly — verified
     it prints `extension/src/`, `extension/test/`,
     `specs/pipeline/steps/` with trailing slashes, so
     `offending-paths`'s `str/starts-with?` prefix match cannot
     false-positive on a similarly-named sibling directory (e.g. a
     hypothetical `extension/srcfoo/`).
   - **One narrow, non-blocking observation**: `commit-touched-paths`
     failure for a single already-ancestry-confirmed sha is absorbed via
     `(or touched [])` — that one sha would read as "no offending paths"
     rather than escalate the sweep to UNAVAILABLE. This differs from
     every other failure branch, which the architect confirmed all fail
     closed. In practice this requires `git diff-tree` to fail on a sha
     that `git rev-list` and `is_qa_ancestor.sh` already resolved
     successfully moments earlier in the same sweep — a corrupted-object/
     git-crash class of failure, not a reachable state via any normal
     fixture (manufacturing it would mean killing a git subprocess or
     corrupting the object store mid-run, which the engineering rules
     rule out as a test technique). Not something either the ticket's
     three declared invariants or the architect's own enumeration
     names as in scope (invariant 3 is specifically about
     `swarmforge-QA` ancestry resolution). Recorded for the record, not
     bounced — same disposition class as the architect's own narrow,
     non-blocking observations elsewhere this session (e.g. BL-914 item
     11, BL-944's D1 routing).
5. **Required wiring, independently re-confirmed**: `pipeline-code-on-main`
   present in both `.bb` files; `check_pipeline_code_on_main.sh` present
   in `babysitter_check.bb` as the single-source shell-out (grepped
   directly, not trusted from the commit message).

## Outcome
No defects found that warrant a bounce. No applicable Stryker/CRAP/DRY
tooling (Babashka boundary). All existing suites (4 bb unit runners, 1
shell lifecycle suite, the bounced-and-fixed `test_babysitter_check.sh`,
and the 17-scenario acceptance feature, including the historical
regression-reproduction scenario) independently re-run green under my own
hand. One narrow, unreachable-by-normal-fixture fail-open path noted for
the record in the touched-paths lookup, not blocking.

Forwarding to documenter.

By hardener.
