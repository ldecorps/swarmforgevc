# BL-959 — architect review pass 1: complete inventory

- **Ticket**: BL-959 APS candidate-toolchain equivalence run (`type: chore`, `severity: low`)
- **Commit reviewed**: `1498580a17` (cleaner) — merged as `5b84c3bc36`
- **Reviewer**: architect, 2026-08-20
- **Verdict**: BOUNCE to coder — **1 defect (D1)**, a false factual claim in the
  ticket's primary deliverable.

Article 4.4 complete-inventory pass: every check below was run BEFORE sending, and
D1 did not stop the sweep. This is strong work otherwise — see the inventory, and
see "what I verified and found accurate", which is most of the report.

---

## D1 — §1 claims the candidate "adds `strip-empty-keys`"; it exists at the pin too

- **Class**: `behavior` (a false statement in the deliverable this ticket exists to produce)
- **Blamed role**: coder (the report is `— By coder (BL-959), 2026-08-20`)

### What is wrong

`backlog/evidence/BL-959-aps-equivalence-report.md` §1, in the `3a1d7b063` row:

> Also relevant: candidate `write-json!` adds `strip-empty-keys` — IR bytes differ
> even where semantics do not

`write-json!` is **byte-identical** at both heads, and `strip-empty-keys` is defined
at both.

### Reproduction (run against real checkouts of both SHAs, not reasoned)

```
$ git -C <pin-clone> rev-parse HEAD          # accaa33d5033... (== swarmforge.lock.json)
$ git -C <cand-clone> rev-parse HEAD         # 1001283af353...

PIN       bb/src/aps/gherkin.clj:109-110
CANDIDATE bb/src/aps/gherkin.clj:126-127
  (defn write-json! [path feature]
    (aps-json/write-pretty-file! path (aps-json/strip-empty-keys #{:background :parameters} feature)))
                                        ^ identical line, identical key set

$ grep -n "defn strip-empty-keys" <pin>/bb/src/aps/json.clj   # 23:  present
$ grep -n "defn strip-empty-keys" <cand>/bb/src/aps/json.clj   # 37:  present
```

The vendored copy was confirmed to BE the pin first (`diff -q` of
`swarmforge/vendor/aps/bb/src/aps/gherkin.clj` against a fresh clone at
`accaa33d5033…` → identical), so this is not a stale-vendor artifact.

What the candidate actually does to `strip-empty-keys` is **refactor** it — the pin
has one recursive `cond`; the candidate delegates to extracted `strip-coll` /
`keep-non-empty-entry` helpers. Same intent, restructured. "Refactors" is true;
"adds" is not.

### Consequence

Bounded but real, and it lands in the one place this ticket exists to serve. The
report's stated purpose is "producing the evidence a human pin-bump decision needs",
and §4 recommends **bump-with-shims**. A human reading §1 would believe the bump
introduces byte-level IR churn from a newly-added stripping step; that mechanism
predates the candidate entirely. It does not change the row's classification
(`3a1d7b063` IS a behavior change — confirmed below) and does not change the
recommendation, which is why this is one sentence to correct rather than a rebuild.

### Remediation

Correct the parenthetical — e.g. "candidate `write-json!` is unchanged;
`strip-empty-keys` is refactored into helpers at both heads, so IR byte differences
come from inference, not from stripping." If a byte-level claim is still wanted, back
it with a measured example rather than a mechanism that exists on both sides.

---

## What I verified and found ACCURATE (the report is otherwise sound)

I re-derived every cheaply-checkable claim against real clones of both SHAs rather
than reading the report's word for it:

| report claim | verified |
|---|---|
| Branch sits directly on the pin (bump = fast-forward) | ✓ `git merge-base` of the two SHAs returns exactly `accaa33d5033…` |
| Exactly seven commits, listed subjects/order | ✓ `git log pin..candidate` matches all seven |
| `db9818e69` docs only; `445efe487` README only | ✓ diffstats are `.md` files only |
| `1847a252e` bb/src edits are usage-string wording only | ✓ every `bb/src` hunk is `usage: X` → `usage: bb X` |
| `1dd6bc09a` `parse-duration-ms`: pin THREW on `10x`, candidate silently returns 0 | ✓ pin's `:else (Long/parseLong text)` raises NumberFormatException (executed); candidate's `re-matches #"(\d+)(ms\|s\|m)?"` fails to match → `default-duration-ms` = 0 |
| …and that edge is unreachable from our wrapper | ✓ `run_gherkin_mutation.sh:76` passes `--status-interval 1s` |
| **`3a1d7b063` inference is ON BY DEFAULT** (the report's load-bearing claim) | ✓ candidate `parse-file` 1-arity is `{:infer? true}`, AND the CLI computes `infer? (not (some #{"--do-not-infer"} args))` — so the runner's 1-arity call genuinely mirrors the CLI default. Run 1's whole measurement rests on this and it holds |
| Pinned `parse-file` has no options arity (so the uniform 1-arity call is right for both sides) | ✓ pin defines `(defn parse-file [path])` only |
| `1001283af` stops writing in-feature metadata; sidecar only | ✓ `write-mutation-metadata!` writes only `(mutation-metadata-path work-dir feature-path)`; no write-back to the feature |
| Our wrapper defaults `--work-dir` to a fresh `mktemp` (so soft reuse breaks) | ✓ `run_gherkin_mutation.sh:64` is `WORK_DIR="$(mktemp -d)"` |
| The three in-feature metadata readers named in §3 exist | ✓ `gherkinMutationOutcome.js`, `gherkinMutationManifest.js`, `scripts/finalize_gherkin_mutation.js` |

I also note the report's own "top three ways this evidence could be wrong" section is
honest and correctly names its real coverage limits (library-entry-point vs CLI arg
handling; one mutation fixture; unexercised legacy fallback). That is the right
posture for a decision document and I am not asking for it to change.

---

## Checks run — full inventory

| # | Check | Result |
|---|---|---|
| 1 | Merge lineage (`1498580a17` ancestor of HEAD) | PASS |
| 2 | Registry union preserved, loads | PASS — `bl959` added alongside `bl571`/`bl958`/`bl960`/`bl957`; `require` returns a live `registerSteps` |
| 3 | **Merge not silently reverting sibling content (BL-954 trap)** | PASS — no BL-959 file differs from the sender's tip |
| 4 | Prior bounce on this ticket still unfixed | PASS — none; first pass |
| 5 | **Invariant 1 — pinned surfaces read-only** | PASS — parcel touches none of `swarmforge/vendor/aps/`, `swarmforge.lock.json`, `upstream-watch.json`; encodable half is P2 (containment), non-encodable remainder (harness CHOOSING its work dir) correctly recorded as a stated reason + qa_e2e step 3 |
| 6 | **Invariant 2 — absence is never equivalence** | PASS — P1; `load-result-set` missing dir → `{}`; recorded null treated as absent; `exit-code` fails closed on an EMPTY matrix |
| 7 | **Property tests exist AND are non-vacuous** | PASS — I reproduced BOTH documented breaks: candidate-absent→EQUIVALENT (P1 fails), `entry-slug` sanitizing dropped (P2 fails) |
| 8 | End-to-end fail-closed at the boundary | PASS — `set -euo pipefail` aborts before `compare` if either runner dies, so a symmetric crash cannot yield a green matrix |
| 9 | Never reimplement an APS command | PASS — the toolchain's OWN namespaces run off its classpath (`aps.gherkin`, `aps.dry`, `aps.mutation`), plus the REAL spawned `gherkin_lint_gate_cli.bb`; nothing is ported. The library-vs-CLI gap is disclosed by the report itself |
| 10 | Thin wrapper over a pure core | PASS — `aps_equivalence_lib.bb` spawns nothing and touches no network; fetch/dual-invocation live in `aps_equivalence_run.sh` / `aps_equivalence_runner.bb` |
| 11 | Candidate fetched at EXACTLY the ticket SHA, refuses otherwise | PASS — `rev-parse HEAD` compared to `CANDIDATE_SHA`, exit 2 on mismatch; never copied into `vendor/` |
| 12 | Live gates still consume the pinned vendor copy | PASS — no gate wired to the candidate |
| 13 | `aps_equivalence_lib_test_runner.bb` | PASS — ALL PASS |
| 14 | `aps_equivalence_lib_property_runner.bb` | PASS — ALL PROPERTIES HOLD, 500 runs each, reachability asserted (P2 reaches `dotdot` 137 / `dotdot-deep` 441) |
| 15 | Acceptance: BL-959 feature | PASS — 3/3 |
| 16 | Scenario Outline validated against explicit KNOWN_VALUES | PASS — `KNOWN_CANDIDATE_OUTCOMES` / `KNOWN_VERDICTS`, throwing by name on an unrecognized cell |
| 17 | Fixture cleanup discipline | PASS — `afterEach` drains a tracked-roots stack |
| 18 | Report has all four required sections | PASS — per-commit classification (all 7), verdict matrix, entry-point compat, recommendation |
| 19 | Report claims re-derived against real clones | **D1** — one false claim; everything else checked is accurate (table above) |
| 20 | **Dependency gate (hard gate)** | RED repo-wide, **not attributable** — BL-759's pre-existing telegram cycle; zero telegram files in this parcel |
| 21 | Co-change coupling | Informational — a brand-new module set whose only partners are its own files; nothing stale |
| 22 | Two-layer boundary / secrets / host owns I/O | PASS — swarm machinery only |
| 23 | Architect property-coverage pass (undeclared properties) | No new property required — see below |

### Check 23 — no new property, with a reason

The pure surface is the comparator (`verdict-matrix`, `exit-code`, `load-result-set`)
and the path derivation (`entry-slug`, `write-targets`). P1 quantifies the comparator
across all five cell constructions; P2 quantifies containment across hostile entry
names. The one property-shaped claim NOT quantified is `entry-slug` **injectivity** —
and that is deliberately noted below as a hardener item rather than encoded here,
because it is unreachable from this ticket's closed corpus.

---

## Observation for the hardener (NOT a defect, NOT part of this bounce)

`entry-slug` is documented as making a separator's `__` "stay distinct from" literal
underscores by escaping `_` → `_5f` first. That escaping does not survive the next
step: `..` → `_` injects an *unescaped* underscore afterwards, so two different
entries can forge the same slug.

```
entry-slug("a.._b")  => "a__5fb"
entry-slug("a/5fb")  => "a__5fb"     ← collision
```

If two corpus entries ever collided, both sides would write to the same result file,
the losing entry would be absent from BOTH sets, and — because `verdict-matrix` unions
only what is PRESENT — it would never surface as INCOMPLETE. That is invariant 2's
failure mode, reached through the back door.

**It is not reachable today and I am not bouncing on it**: the corpus is machine-built
by the runner from `specs/features/*.feature`, and I measured all **607** live entries
→ **607 distinct slugs**, no collision. Containment (P2's actual claim) is unaffected
and still holds. Worth closing cheaply — anchor the escape after the `..` rewrite, or
assert injectivity over the entry list — before anything ever feeds this a
caller-supplied corpus.

---

## Note for QA (not a defect)

The report's corpus count is **604**; the live corpus is now **607**. The three new
files are BL-961, BL-962 and BL-963, whose features landed on `main` after the
report's run. A re-run per `qa_e2e` step 1 will legitimately produce 607-entry lanes,
not 604 — that is drift in the backlog, not a discrepancy in the evidence.
