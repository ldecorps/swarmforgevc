# BL-629 — architect SEND BACK #1, 2026-07-25

Parcel: `a80251e800` "BL-629: sync refuses a main tip that is not QA-approved",
forwarded by the cleaner (handoff `20260725T151208Z_000535`, task
`BL-629-sync-refuses-non-qa-approved-main`).

**Verdict: SEND BACK to coder.** Four findings, all reproduced against the real
CLI or the real repo — none are eyeballed.

The architecture itself is sound and I want to say so before the findings: the
pure/adapter split is exactly what spec resolution item 7 asked for. The
deployed-surface predicate is ONE definition used by both the historical-drift
and working-tree paths, `sync-gate-decision` takes gathered facts and touches no
git or fs, and putting `execute-sync!` in the lib with injected
`recompile!`/`restart-group!` adapters is what makes "the refusal precedes and
suppresses every dispatch" provable rather than asserted. Dependency direction
points inward; the full-repo dependency gate passes. Keep all of that.

## Why this parcel was NOT merged into the architect branch

Reviewed from the commit directly (`git show` / fixture runs), deliberately
without `git merge`. Finding 1 is that the parcel carries parked BL-590 content;
merging it would import exactly that content into `swarmforge-architect` and
then require the BL-490/BL-495 revert dance to get it back out. Stated here as
the deviation it is.

---

## Finding 1 — BLOCKING. The parcel would land 26 commits of PARKED, unreviewed BL-590 work on `main`

`git log --oneline main..a80251e800` is 28 commits. Two are BL-629's
(`a80251e80` and its spec merge `67dd40e67`). The other **26 are the BL-590
rework family**, including `01562217be`, the bounce-#6 rework that has never been
reviewed by any stage.

What QA approval of this parcel would put on `main`:

```
extension/src/onboarding/onboardingFacilitatorState.ts        |  60 ++-
extension/src/onboarding/onboardingFacilitatorStateStore.ts   | 125 ++++++-
extension/src/tools/telegram-front-desk-bot.ts                |  19 +-
extension/test/onboardingFacilitator.property.test.js         | 413 +++++
extension/test/onboardingFacilitatorState.test.js             |   9 +-
extension/test/onboardingFacilitatorStateStore.test.js        |  53 ++-
extension/test/telegramFrontDeskBotCli.test.js                |  64 +++
7 files changed, 703 insertions(+), 40 deletions(-)
```

BL-590 was **parked to `backlog/hold/` by explicit operator decision at 13:05
BST today** (`d8cb1318c`; rationale in
`backlog/evidence/BL-590-parked-20260725.md`). Its rework is durable but
unreviewed — six architect send-backs, the last one never re-reviewed. Carrying
it to `main` on BL-629's coattails silently reverses that park decision and lands
six-times-bounced code with no review pass.

This is the Article "An Approval Authorizes Only Its Ticket's Work" (BL-506)
case, and there is a sharp irony in it: **BL-629 is the ticket that exists to stop
unapproved code reaching `main`.** It must not be the vehicle for it.

### Remediation

`a80251e80` is a single non-merge commit touching exactly six BL-629 files, so it
cherry-picks onto `main` cleanly:

```sh
git branch bl590-parked-rework 01562217be     # preserve the parked work first
git checkout swarmforge-coder
git checkout -B swarmforge-coder main
git cherry-pick a80251e80                      # BL-629's own six files only
```

Verify before forwarding: `git log --oneline main..HEAD` must show BL-629
commits **only**, and `git diff main...HEAD --stat` must name no
`extension/src/onboarding/` or `telegram-front-desk-bot.ts` path.

Do not delete or squash the BL-590 commits — the operator parked that work
intending to resume it. Preserve them on a branch/tag and say where.

**Note for the coordinator:** the same parked BL-590 content sits on
`swarmforge-coder`, `swarmforge-cleaner` and (per the park evidence)
`swarmforge-QA`'s upstream path. Every future parcel off those branches inherits
it until BL-590 either lands or is lifted out. That is a branch-level decision
above my altitude — raised, not resolved here.

---

## Finding 2 — BLOCKING. The gate refuses the ROUTINE post-QA sync, naming QA's own landing merge

Spec resolution item 2 is explicit that a literal ancestry check is wrong because
it "refuses the routine post-QA sync every single day", and that "a daily-refused
gate becomes a daily-overridden gate, which item 3 forbids". The implementation
avoids the literal check but **reintroduces the same daily refusal** through
`changed-paths-for-commit!`'s `git diff-tree -m`.

`-m` diffs a merge against *each* parent and unions the paths. For the merge that
lands QA's approved commit on `main`, the diff against `main`'s prior tip is all
of QA's own code — so the landing merge is flagged as offending drift.

### Reproduced with the real CLI, not by reading

Fixture modelling the ordinary pipeline step ("QA lands the approved commit on
`main`", PIPELINE.md §5) followed by routine bookkeeping:

```
* 31b242c Close BL-XXX; promote next            <- bookkeeping drift
*   709e185 Merge QA-approved commit for BL-XXX <- routine --no-ff landing
|\
| * e5a7f43 QA-approved work (BL-XXX)           <- == merge-base, the approved tip
|/
* 09b3929 c0 base
```

Nothing here is unapproved. The parcel's own CLI:

```
$ bb build_freshness_cli.bb <fixture> report
... "qa_approval":{"approved":false,"offending_shas":["709e185…"],"qa_ref_missing":false}
```

It names **the QA landing merge itself** as the offending commit. `sync` would
refuse, and the only way past would be `--override` — every single day, which is
precisely the failure mode the spec forbids.

On the live repo the same predicate flags `4e9cd883d "Merge QA-approved commit
a7d328805 (BL-575)"` and `f0be69ac8 "Merge QA-approved 343d6f787 for BL-567"` —
two real routine landings.

> To be fair to the implementation: the gate refusing on the live repo *today* is
> CORRECT — the BL-590 and BL-567 drift is real. This finding is about the state
> after that clears, which the fixture isolates.

### Why the acceptance suite did not catch it

The Scenario Outline's `KNOWN_VALUES` are `empty | bookkeeping-only`. No scenario
models drift that contains a QA landing merge, so 11/11 green is consistent with
this defect. **The regression scenario is missing, not failing.**

### Remediation (verified, not guessed)

Use the combined diff `-c` instead of `-m`: a merge that introduces nothing of
its own reports no paths, while an evil merge still reports its own resolutions.
Single-parent commits are unaffected by either flag.

```
$ git diff-tree --no-commit-id --name-only -r -m 709e185   ->  extension/src/a.ts   (refuses)
$ git diff-tree --no-commit-id --name-only -r -c 709e185   ->  (empty)              (correct)
```

I checked this does not open the gate on the incident it exists for. Re-running
the real repo with `-c`, every BL-590 incident commit is still flagged —
`4851901ed` (6 surface paths), `73706d79e` (3), `ebd12542d` (1) — and all six
merge commits correctly drop out. `f8dc07963 "Merge commit '73706d79ed'"` stops
being named, but its content commit `73706d79e` is still named, which is the more
useful message anyway.

Add the missing scenario in the same parcel: drift containing a QA landing merge
plus bookkeeping ⇒ **approved**. Extend `KNOWN_VALUES` accordingly.

---

## Finding 3 — BLOCKING. `report`'s shape change breaks a live acceptance gate

`run-report!` changed from a bare JSON array to
`{"processes":[…],"qa_approval":{…}}`. `specs/pipeline/steps/shippedButInvisibleSteps.js`
(BL-335's acceptance handler) shells out to the very same command and asserts:

```js
// shippedButInvisibleSteps.js:90
const report = runFreshnessReport(ctx);
if (!Array.isArray(report) || report.length === 0) {
  throw new Error('expected build_freshness_cli.bb report to return real process entries');
}
```

Verified live, same call the handler makes:

```
main's CLI:     [{"name":"bridge",…            -> Array.isArray === true
parcel's CLI:   {"processes":[{"name":"bridge" -> Array.isArray === false
```

BL-335's scenario throws. The ticket's own note — "No other production consumer
parses report's JSON (verified at spec time), so the shape change is contained to
that suite" — is true of *production* consumers and missed this acceptance
consumer; the parcel updated `test_build_freshness_cli.sh` but not this file.
"11/11 BL-629 scenarios pass" would not surface it; the full acceptance suite
would.

The co-change tool corroborates it independently: `shippedButInvisibleSteps.js`
appears in `build_freshness_cli.bb`'s co-change history (below the flag threshold,
but it is there, alongside `specs/pipeline/steps/index.js` at 4 and
`test_build_freshness_cli.sh` at 3 — both of which the parcel *did* update).

**Remediation:** update `shippedButInvisibleSteps.js` to the new shape
(`report.processes`) in this parcel, and run the FULL acceptance suite, not just
BL-629's feature. Per the engineering guardrail, `grep`-enumerate shared-component
call sites before changing an output contract.

---

## Finding 4 — BLOCKING. Every fact-gatherer fails OPEN, in a gate specified to fail closed

Spec resolution item 4: "Missing `swarmforge-QA` ref fails CLOSED — absence must
never buy a deploy." That posture holds for the ref, and only for the ref. Each of
the four gatherers converts a git failure into "no evidence of drift", which
`sync-gate-decision` cannot distinguish from "no drift" and reads as approved:

| gatherer | on git failure | consequence |
|---|---|---|
| `drift-facts!` (`merge-base!` → nil) | `{:qa-ref-exists? true :drift-commits []}` | **approved** |
| `commit-shas-since!` | `[]` | **approved** |
| `changed-paths-for-commit!` | `[]` | commit reads as bookkeeping-only |
| `dirty-surface-paths!` | `[]` | working-tree check silently skipped |

Reproduced for the `merge-base` case — `swarmforge-QA` resolves, no common
ancestor, `main` carrying nothing but unapproved code:

```
merge-base exit: 1  (no common ancestor)
$ bb build_freshness_cli.bb <fixture> report
{'approved': True, 'offending_shas': [], 'qa_ref_missing': False}
```

A `main` whose every commit is unapproved reports **approved**. The facts contract
has no "could not determine" state, so the pure decision is structurally unable to
fail closed on it.

**Remediation:** give the facts an explicit indeterminate state (e.g.
`:facts-complete?` false, or reuse `:reason :missing-ref` with a distinct
`:gather-failed`) and have `sync-gate-decision` refuse on it, with unit coverage
per gatherer. This is the same fail-closed posture item 4 already legislates,
applied to the other three ways the answer can be unknown.

---

## Gates run

- **Dependency gate (required):** full-repo scan — `Dependency-rule gate PASSED:
  no forbidden edges` (exit 0). Note the tool runs `depcruise` with cwd
  `extension/`, so it cannot open paths outside `extension/`; BL-629's six changed
  files are all outside it (`swarmforge/scripts/`, `specs/pipeline/steps/`) and are
  outside the gate's jurisdiction. The full scan is the meaningful run here.
- **Co-change (informational):** flagged `specs/pipeline/steps/index.js` (4) and
  `swarmforge/scripts/test/test_build_freshness_cli.sh` (3) as suspected coupling —
  both correctly updated by the parcel. Its lower-ranked entries surfaced
  `shippedButInvisibleSteps.js` (Finding 3).
- **Property testing:** deferred to re-review, per the role contract that property
  work follows a PASSED architectural review. BL-629's touched pure module is
  `build_freshness_lib.bb` (Babashka), which the fast-check `*.property.test.js`
  harness does not cover — but BL-567 shipped `expedite_lib_property_runner.bb`
  today, so a `.bb` property runner is now an established pattern. On re-review I
  intend to assess: `code-drift-shas` ⊆ input shas and order-preserving;
  `sync-gate-decision` never returns `:refuse? false` without an override when any
  refusal condition holds; `:override-used?` true ⟹ a refusal condition held.

## Re-entry

Fix all four, then forward to the architect under the same task name
`BL-629-sync-refuses-non-qa-approved-main`. Findings 2, 3 and 4 are code; Finding
1 is the parcel's base. Finding 1 is the one to do first — the other three are
easier to verify on a clean base.

By architect.
