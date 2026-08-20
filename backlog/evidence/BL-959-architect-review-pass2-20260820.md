# BL-959 — architect review pass 2 (re-fix): complete inventory

- **Ticket**: BL-959 APS candidate-toolchain equivalence run (`type: chore`, `severity: low`)
- **Commit reviewed**: `6b367581a7` (cleaner re-fix)
- **Reviewer**: architect, 2026-08-20
- **Prior bounce**: pass 1, `1498580a17`, class `behavior` —
  `backlog/evidence/BL-959-aps-candidate-toolchain-equivalence-bounce-20260820.md`
- **Verdict**: **PASS — D1 closed, defects found: NONE.**

## D1 is closed, and the replacement text is factually correct

Pass 1's D1: §1 claimed the candidate `write-json!` "adds `strip-empty-keys`", which is
false — the function is byte-identical at both heads and the helper exists at both.

The corrected row now reads:

> Also checked: candidate `write-json!` is UNCHANGED — byte-identical at both heads, and
> `strip-empty-keys` exists at both (pin `gherkin.clj:109-110`/`json.clj:23`; the
> candidate only refactors its internals into `strip-coll`/`keep-non-empty-entry`
> helpers). Any IR byte difference therefore comes from inference itself, not from
> stripping […] [Corrected per architect bounce D1, 2026-08-20: the first run of this
> report claimed the candidate "adds" the stripping step; verified false against the
> vendored pin copy.]

Every assertion in that replacement matches what I measured in pass 1 against real
clones of both SHAs — including the two line references (`gherkin.clj:109-110` for the
pin's `write-json!`, `json.clj:23` for its `strip-empty-keys`) and the naming of the
candidate's extracted helpers. The conclusion it now draws (byte differences trace to
inference, not stripping) is the correct one, and the correction is stamped rather than
quietly rewritten. **Closed.**

## The re-fix is exactly one line, and I checked that it is

A documentation-accuracy defect should not move code. Diffing BL-959's own files across
the bounce (`1498580a17` → `6b367581a7`):

```
backlog/evidence/BL-959-aps-equivalence-report.md | 2 +-
1 file changed, 1 insertion(+), 1 deletion(-)
```

The harness — `aps_equivalence_lib.bb`, `_cli.bb`, `_run.sh`, `_runner.bb`, both test
runners, and the step handler — is byte-identical to what I already reviewed and passed
on every other check in pass 1. No scope creep.

## The BL-954 trap fired here, and it was mine to catch

**This is the finding worth recording.** I bounced BL-959 and reverted it out of this
branch. In the meantime I merged BL-910, resolving its registry conflict by deliberately
excluding `bl959ApsEquivalenceSteps` — correct at that moment, since the file did not
exist. When the re-fix restored the FILES, git kept my earlier registry deletion **with
no conflict marker**:

```
$ git diff --stat 6b367581a7 -- specs/pipeline/steps/index.js
 specs/pipeline/steps/index.js | 1 -
```

One line short of the sender. `bl959ApsEquivalenceSteps.js` would have existed on disk
while being registered nowhere — its three acceptance scenarios silently never running,
and nothing failing to say so. Restored the `require`, re-verified the file is now
byte-identical to the sender's and that `require('./specs/pipeline/steps/index.js')`
returns a live `registerSteps`.

Exactly the failure BL-954's rule predicts: *after merging a re-fix for a ticket you
bounced-and-reverted, diff every file against the sender's tip* — ancestry and a clean
merge both looked fine here.

## Checks run — full inventory

| # | Check | Result |
|---|---|---|
| 1 | Merge lineage (`6b367581a7` ancestor of HEAD) | PASS |
| 2 | **Own revert silently re-applied over the re-fix (BL-954 trap)** | **CAUGHT AND FIXED** — registry was 1 line short; restored, now identical to sender |
| 3 | Registry loads with all handlers | PASS — `bl959` back alongside `bl957`/`bl910`; `registerSteps` live |
| 4 | D1 remediation present AND correct | PASS — replacement text matches pass-1 measurements exactly, correction stamped |
| 5 | Re-fix scoped to the defect (no code moved) | PASS — 1 line, report only; harness byte-identical to the reviewed version |
| 6 | Invariant 1 — pinned surfaces read-only | PASS — parcel touches none of `vendor/aps/`, `swarmforge.lock.json`, `upstream-watch.json` |
| 7 | Invariant 2 — absence never read as equivalence | PASS — unchanged code; P1 re-run green |
| 8 | Property tests non-vacuous | PASS — verified in pass 1 by reproducing both documented breaks; code unchanged since |
| 9 | `aps_equivalence_lib_test_runner.bb` | PASS — ALL PASS |
| 10 | `aps_equivalence_lib_property_runner.bb` | PASS — ALL PROPERTIES HOLD, 500 runs each, reachability asserted (`dotdot` 137 / `dotdot-deep` 441) |
| 11 | Acceptance: BL-959 feature | PASS — 3/3 |
| 12 | **Dependency gate (hard gate)** | RED repo-wide, **not attributable** — BL-759's pre-existing telegram cycle; 0 telegram files in this parcel |
| 13 | Never reimplement an APS command | PASS — unchanged; runs the toolchain's own namespaces off its classpath |
| 14 | Thin wrapper over a pure core / fail-closed boundary | PASS — unchanged from pass 1 |
| 15 | Architect property-coverage pass | No new property required — as pass 1 |

## Carried forward for the hardener (unchanged from pass 1, still not a bounce)

`entry-slug`'s `_`-escaping does not survive its own `..` rewrite, so
`entry-slug("a.._b") == entry-slug("a/5fb")`. A collision would make an entry vanish
from BOTH result sets and never surface as INCOMPLETE. Unreachable from the closed
corpus (the runner globs `specs/features/*.feature`), and containment — what P2 actually
claims — still holds.

## Note for QA — the corpus has moved again

The report states a **604**-file corpus; the live corpus is now **608** (was 607 at my
pass-1 review). The additions are the features that landed on `main` since the run —
BL-961, BL-962, BL-963, BL-964. A re-run per `qa_e2e` step 1 will legitimately produce
608-entry lanes. That is backlog drift, not a discrepancy in the evidence, and it will
keep drifting: the report's numbers are a dated measurement, not an invariant.

## Verdict

**PASS.** D1 closed with a correct, stamped replacement; the re-fix moved exactly the
one line it should and no code. Forwarding to the hardener under the same task name.
