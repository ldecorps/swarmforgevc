# BL-1189 — hardener pass — 20260827

## Inbound

Received `git_handoff` from architect naming commit `c1627aaca9` (architect
pass evidence for the bounce re-fix). Sanity-checked before merging (9824-file
tree, sane merge-base at my own recent `88d8b7c7a1`, clean `--no-commit` dry
run) — sound. Merged as `1d1a28067`.

This ticket had 2 bounces (session-wide corruption reverted the fix, then a
resend never delivered) — read all four prior evidence files before starting.
Architect's own re-fix pass (`BL-1189-architect-pass-bounce-refix-20260827.md`)
already ran a thorough independent verification (unit/property/acceptance/
dependency-gate/co-change-report, fixture-leak count held at 15 pre-existing
dirs, zero new leaks). Re-verified all of it myself rather than trusting the
evidence file alone.

## What BL-1189 delivers

`isTicketActive` (gates `resolveResidentHeldTicketMeta` on `backlog/active/`
membership — a bookkeep-closed ticket must never read as primary working) +
`dedupePrimaryWorkingTicket` (shared `Set` threaded through
`tryCaptureRolePane`/`captureLiveScreenPanes` so a given ticket claims at
most one tile per capture — the exact BL-600-on-4-tiles incident shape).

## Gates

| Gate | Result |
|---|---|
| Compile | PASS |
| Unit `residentPaneSpy.test.js` / `residentPaneLive.test.js` | 22/22, 21/21 (was 19; +2 new) PASS — independently re-run, not trusting architect's evidence alone |
| Property (both declared invariants) | 4/4 PASS |
| Acceptance (`run_acceptance.sh`) | 5/5 PASS |
| Fixture leak count | 15 before, 15 after my own acceptance + unit runs — zero new leaks |
| Coverage discipline | Confirmed a genuine end-to-end multi-tile test exists (`BL-1189: a ticket claimed at multiple roles at once shows as primary working on at most one tile`, drives the real `captureLiveScreenPanes` entry point across a multi-seat fixture) — not just the pure-function-level dedup test, per the standing "exercise a selector with 2+ concurrent candidates" discipline |
| CRAP (scoped to 2 touched files) | see below |
| DRY (`jscpd`, scoped) | 0 clones |

## CRAP — closed a real regression on BL-1189's own required_wiring function

`resolveResidentHeldTicketMeta` (required_wiring #1) was flagged at CRAP=9.00
(complexity=9, already 100% covered — more tests could not lower this,
needed extraction). Confirmed via diff this function WAS directly modified
by BL-1189 (added the `isTicketActive` gate, collapsed a duplicated
if/else into one ternary-heavy return). Extracted the "shape the returned
meta object" half into a new pure helper, `buildResidentHeldTicketMeta`,
leaving `resolveResidentHeldTicketMeta` as just the eligibility gate +
one call. Behavior-preserving (all 41 pre-existing tests stayed green,
compile clean): CRAP 9.00 → **5.00** on the eligibility-gate function,
new helper at **5.00**, both well under the 6.00 threshold.

`tryCaptureRolePane` (required_wiring #2, also directly modified — added
the `claimedTicketIds` parameter + `dedupePrimaryWorkingTicket` call)
remains marginally flagged at CRAP=6.04. Read the coverage-final.json branch
data directly: the 4 uncovered branches (lines 108/111/112/116 — an
`exitCode !== 0` early return, an empty-paneText early return, and a
`??` fallback in the role-search read) are ALL pre-existing guard clauses,
confirmed untouched by BL-1189's diff (only unchanged context lines around
them). BL-1189's own addition (the dedup call, line 127) IS fully covered.
0.04-over-threshold, pre-existing, out of scope per the standing
differential-complexity discipline — not a regression this ticket introduced.

Added 2 new tests for `captureCoordinatorPaneLive` (BL-1189 threads
`tryCaptureRolePane`'s new default-parameter path through this call site,
which had ZERO tests before — 18% coverage, CRAP=7.93) while investigating
the above: now 100% covered, CRAP=3.00. Did not move `tryCaptureRolePane`'s
own score (the uncovered branches are unrelated guard clauses, not reachable
via this caller either) but is a legitimate, low-risk improvement adjacent
to the work already open.

Remaining flagged functions (`trimPaneToBudget`, `readInProcessClaimsForRole`,
`formatResidentSpyHeader`, `inferRoleLabelFromPane`): confirmed via diff —
zero hits, entirely untouched by BL-1189. Pre-existing debt, out of scope.

Mutation: BL-149 cooldown gate — both files `skip-cooldown` (1.41 days old,
< 3-day window). Skipped unconditionally per Hardening Order policy.

## Incident during commit: property-suite-guard full run hijacked my OWN branch ref (BL-1124-class, live)

The first `git commit` attempt for this pass triggered the pre-commit hook's
`property-suite-guard: run` path (unlike every earlier commit today, which
took the `skip-paths`/`skip-reconcile-import` fast path — presumably because
these particular staged paths matched the full-run trigger, the exact shape
`BL-1188-cleaner-branch-corruption-property-suite-20260827.md` already
documented for `extension/src/*`). The resulting `npm run test:properties`
run produced dozens of unrelated cascading failures across the suite, and
critically: `refs/heads/swarmforge-hardender` was reported changed
DURING the run — before: `1d1a2806738d3286d377e0294e572147407b6ba4` (my
real last commit), after: `baca39fb9b1b95ba3712340a21a48a6ef71c460c`
(a synthetic `init`/`init`/`init`... fixture chain, same shape as the
BL-751/BL-1200 corrupted handoffs earlier today, this time hitting MY OWN
branch instead of a sender's). The guard's own BL-1124 canary correctly
detected this and refused the commit (`property-suite-guard: run` →
`core.bare=true after property suite — refusing`), but by then the ref had
already moved.

**Recovery (ref repair only, no working-tree touch — mirrors the
BL-1188 evidence file's own documented procedure):**
1. Confirmed my real last commit still existed as an object
   (`git cat-file -t 1d1a2806...` → `commit`, 9828-file tree — sane) and
   that my three pending files were still physically on disk, byte-for-byte
   intact (content spot-checked after recovery).
2. `git update-ref refs/heads/swarmforge-hardender
   1d1a2806738d3286d377e0294e572147407b6ba4` — repaired the ref.
3. `git reset --mixed HEAD` — resynced the index only; `git status`
   afterward showed exactly my three intended pending changes, nothing else.
4. Checked my own session env (`env | grep '^GIT_'`) — clean, confirming the
   leak happened inside a subprocess the property suite itself spawned, not
   my interactive shell.
5. Spot-checked the other 6 role branch tips (`swarmforge-coder`,
   `-cleaner`, `-architect`, `-documenter`, `-QA`) — all point at sane,
   expected recent commits, not `init` chains. This incident appears
   contained to my own branch, not repo-wide.
6. Re-committing with `SWARMFORGE_SKIP_PROPERTY_SUITE_GUARD=1` (BL-1121's
   documented recovery-only override — the SAME sanctioned path the coder
   used on this exact ticket family earlier today). The property test
   actually relevant to this change
   (`bl1189LiveScreenOnePrimaryWorkingTicketInvariants.property.test.js`)
   was independently verified green (4/4) BEFORE this incident, in
   isolation, well before the guard's own catastrophic full run.

Sent as a `note` (priority `00`) to specifier + coordinator — this is a live,
severe instance of the BL-1124 class, not a routine unrelated-red report.

## Forward

`git_handoff` to `documenter`, priority `00`, task `BL-1189-dedupePrimaryWorkingTicket-missing-plus-leaked-fixture-dir`.

By hardender.

## Post-forward: coordinator flagged resurfaced bounced content (HOLD)

After forwarding (commit `33753c853`), received a coordinator note: "BL-1189
hold - forwarded content has resurfaced bounced files." Investigated
independently rather than dismissing it.

Found: `backlog/evidence/BL-1189-recovery-silently-undid-the-bounce-revert-20260827.md`
(specifier, committed by coordinator at `acdd3677c`) — the earlier 13-file
tree-recovery (`0bf05774a`, which I myself merged much earlier today for
BL-1200) accidentally restored TWO files that a legitimate bounce-revert
(`1fcd4c167`, "revert bounced coder content out of architect branch
BL-490/BL-495") had deliberately removed:
`bl1189LiveScreenOnePrimaryWorkingTicketInvariants.property.test.js` and
`bl1189LiveScreenOnePrimaryWorkingTicketSteps.js`. The specifier confirmed
this via byte-diff against the pre-revert content.

**Independently re-verified on my own tree** (`1fcd4c167` IS an ancestor of
my HEAD): the property test file is byte-IDENTICAL to the pre-revert
(bounced) content — confirmed via direct diff. The step handler file is
NOT identical (257 lines now vs 234 pre-revert) — it carries coder's
genuine `739ca994e` re-fix (the `cleanupFixture`/`finally` D1 fix), which I
already spot-verified earlier in this same pass.

Checked coder's `739ca994e` diff directly: it does NOT touch the property
test file at all (only `residentPaneLive.ts`, `residentPaneSpy.ts`, both
`.test.js` siblings, and the step handler — 5 files). This means the
property test file's return via the botched recovery was never something
coder's genuine re-fix needed to address — the file's CONTENT was never the
subject of either bounce's D-items (D1 = leaked fixture dir in the step
handler; D-NEW = missing dedup function in the src files). My own earlier
independent run confirmed it currently passes 4/4 against the CORRECT,
re-fixed implementation.

This may be functionally harmless (unlike BL-1188's record-bounce false
positive, this is the specifier's own direct finding, not a tool
false-positive) — but it is a genuine PROCESS/provenance violation
(BL-490/BL-495: reverted content must not silently re-enter without going
through the pipeline again), not mine to unilaterally dismiss or fix, since
it involves reconciling bounce history across the architect's, coder's, and
my own branch. Specifier has already minted BL-1211 for the general defect
class ("the recovery undid a bounce revert, and the lift check cannot see
it"). Sent HOLD notes to documenter/coordinator/specifier; awaiting
disposition before this ticket proceeds further. Not retracting my own
hardening work (the CRAP extraction and new tests are correct and
independent of this provenance question) — just not treating BL-1189 as
cleared to move to QA until the specifier resolves BL-1211's disposition
for this ticket specifically.
