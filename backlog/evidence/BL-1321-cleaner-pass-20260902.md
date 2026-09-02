# BL-1321 — cleaner pass, 2026-09-02

Role: cleaner. Ticket: BL-1321-swarm-stamp-seated-preferred-yield-3d70c0f4ec.

## Received
Coder commit `3e76717220`: stamp-off review of already-landed hotfix
`3d70c0f4ec`. Review-only — diff is the acceptance step handler
(`bl1321SeatedPreferredYieldStampSteps.js`), a bb decision-driver CLI
(`lib/bl1321ChaseRotateDecisionCli.bb`), the `index.js` registration, and
the coder's evidence file. No hotfix source
(`mono_router_lib.bb`, `handoffd.bb`,
`test/mono_router_lib_test_runner.bb`, `backlog/hotfix-ledger.yaml`)
touched, confirmed by `git diff --stat` over those paths across the
parcel — empty.

## Scope check
Same stamp-off shape as the other BL-848 tickets this session
(BL-1254/BL-1324/BL-1283): constraints forbid reimplementing, rewriting,
reverting the hotfix, re-line-ending anything further, or deleting the
landed duplicate assert. The only landed files are acceptance-domain
(step handler + its bb driver) — outside the cleaner's charter ("Do not
create, run, or maintain acceptance tests, Gherkin, IR, Gherkin mutation,
or property tests"). No hotfix source is in scope for cleanup either,
since none was touched.

## Verification (independent re-run)
- `node specs/pipeline/cli.js specs/features/BL-1321-swarm-stamp-seated-preferred-yield-3d70c0f4ec.feature` — 9/9 pass, including scenario 03 (marker-vs-live-identity direction), 04 (line-ending report), and 09 (review never self-certifies).
- `bb swarmforge/scripts/test/mono_router_lib_test_runner.bb` — ok.
- `bash swarmforge/scripts/test/test_handoffd_rule_proposal_rotate_wiring.sh` — ALL PASS (BL-795 redirect regression intact).

## Findings reported by coder (not mine to act on)
- Two of the hotfix's six seated-yield asserts are byte-identical (same
  input/result) — six asserts, five distinct cases. Not deleted per
  constraints; reported only.
- The commit's CRLF→LF re-line-ending of `mono_router_lib.bb` and its test
  runner is confirmed byte-identical to what landed, and the human ruling
  already accepted it with no follow-up. Nothing further for cleaner here.

## Incidental content picked up by this merge
Merging the coder's tip also brought in an unrelated in-flight
specifier spec-amendment to BL-1319 (already forwarded past cleaner
earlier this session) and BL-1298's promotion to `backlog/done/M8/` —
both are upstream history riding along with the merge, not part of this
parcel's own work, and required no action here.

## D1..Dn (Article 4.4 complete inventory)
NONE. No defect found; nothing in cleaner's domain to clean.

## Disposition
Forward unchanged to architect.

By cleaner.
