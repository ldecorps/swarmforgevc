# BL-2044 — bounce fix (coder), 2026-10-06

QA bounced 587e17842f with a complete inventory (Article 4.4), 4 defects,
routed to coder as earliest-blamed role. This fixes D1 and D2 (coder's own);
D3 (hardener) and D4 (documenter) travel forward with this parcel, unfixed
here, per Article 4.3/4.4 — the chain is coder -> hardener -> documenter -> QA.

## D1 (fixed) — re-apply ran on `:take-up` too, and never skipped candidates already on the target

`take-up!`'s candidate computation only checked `(and ticket base)` before
calling `reapply-candidates`, so a `:take-up` intent (whose `intent` map
also carries `:ticket` whenever the forwarding git_handoff's `task` field
names one — see `parcel-intent`) ran the SAME re-apply path as a `:start`.
For the commonest bounce shape (a role idle on ticket X's line receives X's
own bounce back), the parcel's commit is already the newest tip of that
exact line, so cherry-picking "X's own commits" onto a target that already
contains them is an empty cherry-pick, which git reports as a conflict —
the role was wrongly `:refused` its own bounce.

Fix: scoped candidate computation to `(= :start (:intent intent))` only (a
`:take-up` target already IS the parcel — nothing to re-apply). Also added
an ancestor-of-target filter to `reapply-candidates` itself, per the second
half of D1's remediation (a `:start` target can be the ticket's own newest
handed-off commit, which already holds the same commits a naive re-apply
would try again).

## D2 (fixed) — reapply-candidates accepted a done-ticket-only commit as "the ticket's own"

`reapply-candidates` filtered by `line-commit-ok?` alone, which is
`own-line?`'s STAY test: a commit whose subject names ONLY done tickets
(no ticket id reachable, or every id is a closed ticket) is correctly
harmless to *leave* on a line that is staying, but is NOT "the ticket's
own work" that should *follow a forced move*. Carrying a done ticket's
ORIGINAL commit across a move either (a) conflicts when the target already
holds that ticket's LANDED REPLAY (probe E/the `:start` path this ticket
fixes), or (b) injects a closed ticket's stray content into a different,
unrelated ticket's line when it doesn't (probe C's shape).

Fix: added `reapply-worthy?` — requires the commit's subject to literally
name `ticket` itself, in addition to `line-commit-ok?`'s existing
"every other id is a done ticket" check. `line-commit-ok?` itself is
UNCHANGED (still used, unmodified, by `own-line?`'s STAY decision, per the
remediation's "keep `line-commit-ok?` as the other-ids test").

## Verification

Reproduced QA's own probes (Detail section, `tmp/bl2044_probe.bb` cases
A/B/C, `tmp/bl2044_probe_e.bb` case E) against the fixed lib, scratch
fixtures removed after:

- **A** (coder idle on X's line takes up X's bounce): `:moved` (was
  `:refused`). No "re-applied" count — correctly skipped, `:take-up`.
- **B** (X parcel based AFTER Y's replay land): `:moved` (was `:refused`).
  New log carries no re-applied Y commit.
- **C** (X parcel based BEFORE Y's replay land): `:moved` (was `:refused`).
- **E** (`:start` for X; line = done Y replay-landed + unlanded other-ticket
  Z): `:moved`, log is `Land BL-9001 (replay) | init` only — neither Y's
  nor Z's commit re-applied (neither names the `:start` ticket X).

Regression checks, all green on the fixed lib:
- `bb swarmforge/scripts/test/parcel_line_lib_test_runner.bb`: ALL PASS.
- `bb swarmforge/scripts/test/bl2044_seat_commits_survive_line_move_property_runner.bb`:
  60 runs (33 clean, 27 conflicting), ALL PROPERTIES HOLD.
- `npx vitest run test/bl2044SeatCommitsSurviveLineMoveInvariants.property.test.js
  --config vitest.properties.config.mjs`: 1/1 pass.
- `node specs/pipeline/cli.js` on BL-2044's own feature: 3/3 (unchanged from
  QA's own gather row — D1/D2 are selection-internal, scenario 01/02/03 do
  not probe the `:take-up`/done-ticket/ancestor-of-target edges D3 names).
- `node specs/pipeline/cli.js` on BL-1871: 9/9. BL-1887: 4/4 (both match
  QA's qa_e2e_procedure step 2 exactly).
- `npx vitest run test/stepHandlerTmpRootGuard.test.js`: 4/4 (recompiled
  `out/` first — the parcel-line take-up onto this ticket's line brought a
  TS source snapshot newer than the previously-compiled `out/`, from an
  unrelated prior ticket on this seat; `npm run compile` alone, no tracked
  file changed).

## Not done here — travels to the next stages (Article 4.3/4.4)

- **D3 (hardener)**: no scenario, property case, or runner case in
  `specs/pipeline/steps/bl2044SeatCommitsSurviveLineMoveSteps.js` /
  `swarmforge/scripts/test/bl2044_seat_commits_survive_line_move_property_runner.bb`
  drives a `:take-up` of a received parcel, a moved line holding a done
  ticket's commit, or a candidate already contained in the target. Add
  cases for D1/D2's fix (probes A/B/C/E above are ready-made fixtures) and
  hold them in hardening, per QA's remediation pointer.
- **D4 (documenter)**: `docs/how-to/BL-1871-parcel-line-take-up.md` and
  `docs/reference/Specification.MD`'s BL-2044 entry both still say a move
  re-applies "a no-ticket merge or a done ticket's commit" — now false on
  both counts (merges are excluded from candidates; done-only commits are
  excluded by `reapply-worthy?`). Needs: re-applied = commits naming the
  ticket itself, `:start` only, merges and commits already on the target
  never.

By coder.
