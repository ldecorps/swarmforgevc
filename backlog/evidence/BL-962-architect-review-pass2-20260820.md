# BL-962 — architect review pass 2 (bounce D1 re-fix): complete inventory, PASS

- **Ticket**: BL-962 — on-main sweep adjudicates reconciliation merges (`type: defect`, `severity: high`, M8)
- **Commit reviewed**: `8bfecb4ae0` (cleaner)
- **Reviewer**: architect, 2026-08-20
- **Prior bounce**: 1 — architect→coder, `behavior`, `dd00974f3b`, evidence `BL-962-architect-review-20260820.md`
- **Verdict**: **PASS — inventory items: NONE.** Forward to hardender.

---

## D1 — CLOSED, verified with the exact break that exposed it

D1 was: invariant 2's structural gate scanned text with **string contents
stripped**, but in Babashka a git subcommand can only ever appear as a string
literal — so the rival ancestry predicate the invariant forbids passed unnoticed.

The gate now strips `;`-comments only and scans string arguments. Re-running my
pass-1 experiments against the shipped code:

| Experiment | Pass 1 | Pass 2 |
|---|---|---|
| Inject `(sh! "git" "-C" project-root "merge-base" "--is-ancestor" a b)` — the rival predicate invariant 2 forbids | **ALL PASS** (gate silent) ❌ | **FAIL** — `expected: nil  actual: "merge-base"` ✓ |
| Inject a second `is_qa_ancestor.sh` reference | FAIL ✓ | FAIL ✓ |
| Gate as delivered | PASS | PASS |

**The false-positive risk I named in the remediation was handled.** I warned that
scanning raw would let an *inline trailing* comment mentioning those tokens trip
the gate. I tested it: adding `;; deliberately not merge-base / --is-ancestor` as
a trailing comment leaves the runner **ALL PASS**. Trailing comments are stripped
too, so the gate catches calls without punishing prose.

All three injections restored; the runner is green as delivered.

## The re-fix is surgical

`git diff dd00974f3b 8bfecb4ae0` over BL-962's paths touches **one file** —
`bl962_merge_adjudication_test_runner.bb`, 28 insertions / 20 deletions.
`babysitter_check.bb` is **byte-identical** to what I reviewed at pass 1. That is
the correct shape: D1 was a defect in the gate, not in the implementation, and the
implementation was already verified correct.

## Full checklist re-run (Article 4.4 — a fix can introduce new defects)

| Check | Result |
|---|---|
| Invariant 2 structural gate | **CLOSED**, non-vacuity proven above |
| Invariant 1 property (P1) | ALL PROPERTIES HOLD — 500 runs; coverage `{:exempted 235, :coat-tails 173, :zero-parents 130, :all-exempted 80}` |
| Invariant 3 property (P2) | ALL PROPERTIES HOLD — 500 runs; coverage `{:failed 342, :failed-with-offenders 249, :clean 84, :offenders-only 74}` |
| P1/P2 non-vacuity | Proven at pass 1 (dropped `qa-approved?` → coat-tails failures; kept offenders beside a failure → 249/500). **The property runner and the pure core are both unchanged since**, so that proof still covers the delivered code — stated rather than silently skipped. |
| BL-962 unit runner | ALL PASS |
| Acceptance 01–05 | **5/5 pass** |
| `test_babysitter_check.sh` | ALL PASS, exit 0 |
| Live read-only gather (`qa_e2e` step 2) | `ancestry-unavailable? false`, **0 offending commits** — `da6031c60`/`b3ba48bfc` still not flagged |
| Dependency-rule gate (BL-259, hard gate) | **RUN, exit 0, clean** |
| Merge integrity | My pass-1 revert did **not** re-suppress the re-fix: `git diff 8bfecb4ae0 HEAD` over all BL-962 paths is empty. |

## Note on the sibling gate

BL-948, reviewed in the same session, introduces a fixture gate that **keeps
string literals** and strips only comments, documenting that socket paths live in
strings. Same distinction, applied correctly there and now corrected here. Worth
recording as the shape to copy: **strip comments, keep strings, when the banned
token is data rather than a code symbol** — the inverse of BL-967's closure gate,
where the banned tokens are namespace symbols and stripping strings is right.
