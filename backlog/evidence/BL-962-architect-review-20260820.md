# BL-962 — architect review pass 1: BOUNCE to coder (complete inventory)

- **Ticket**: BL-962 — babysitter on-main sweep adjudicates reconciliation merges (`type: defect`, `severity: high`, M8)
- **Commit reviewed**: `dd00974f3b` (cleaner) — coder `cc9b19b829` + cleaner batch pass
- **Reviewer**: architect, 2026-08-20
- **Verdict**: **BOUNCE to coder — inventory items: D1 (one item).**

The delivered BEHAVIOUR is correct and I verified it end-to-end, including on the
live repo. The single defect is that one of the three declared invariants is
guarded by a gate that **cannot fire on the violation it exists to catch**.

---

## D1 — invariant 2's structural gate is vacuous against the shape its own comment names

**Class**: `invariant-unencoded` · **Blamed**: coder · **File**:
`swarmforge/scripts/test/bl962_merge_adjudication_test_runner.bb`

Invariant 2: *"Whether a parent is QA-approved is decided only by
`is_qa_ancestor.sh`, the one shared predicate (BL-925 invariant 2) — never a
second, independently maintained ancestry check."*

The gate has two halves. **The first is sound; the second is vacuous.**

```clojure
(let [raw       (slurp check-file)
      stripped  (strip-comments-and-strings raw)
      code-lines (remove #(str/starts-with? (str/trim %) ";") (str/split-lines raw))
      ancestry-refs (count (filter #(str/includes? % "is_qa_ancestor.sh") code-lines))]
  (assert= "no second ancestry predicate: `merge-base` never appears …"
           nil (re-find #"merge-base|--is-ancestor" stripped))     ; <-- VACUOUS
  (assert= "is_qa_ancestor.sh is named at exactly one code site …"
           1 ancestry-refs))                                        ; <-- sound
```

`strip-comments-and-strings` blanks the **contents of double-quoted strings**. In
Babashka a git subcommand is *always* a string literal argument to a shell-out, so
`merge-base` / `--is-ancestor` can only ever appear inside strings — exactly the
text the strip removes. Isolated proof:

```
RAW      : (zero? (:exit (sh! "git" "-C" root "merge-base" "--is-ancestor" a b)))
STRIPPED : (zero? (:exit (sh! ""    ""   root ""           ""             a b)))
regex on stripped matches? false
regex on raw matches?      true
```

**Break-then-fix, run against the shipped code (this is the send-back trigger —
a gate that stays green against a deliberately broken implementation):**

| Injected into `babysitter_check.bb` | Gate result |
|---|---|
| A rival predicate `(sh! "git" "-C" project-root "merge-base" "--is-ancestor" a b)` — precisely what invariant 2 forbids | **ALL PASS** — gate silent ❌ |
| A second reference to `is_qa_ancestor.sh` | **FAIL** … `expected: 1  actual: 2` ✓ |

Both restored; the runner is green again as delivered.

So a rival ancestry predicate that avoids `is_qa_ancestor.sh` altogether — the
*whole* threat invariant 2 names — passes unnoticed. The half that works only
catches a duplicate use of the *correct* predicate, which is the milder case.

**Remediation**: scan the `merge-base|--is-ancestor` assertion over `code-lines`
(raw, full-line comments already removed) exactly as its sibling assertion does,
not over `stripped`. `code-lines` already drops `;;` prose, so the comment block's
stated worry ("prose about the rule never trips the gate") is still handled. Note
in passing that an *inline trailing* comment mentioning those tokens would then
trip it — either accept that (no such comment exists today) or strip only
`;`-to-end-of-line while preserving string contents. Re-prove with the same
injection above: the rival predicate must make it FAIL.

**Not affected**: BL-967's closure gate (which I approved yesterday) bans
`babashka.process` / `process/sh` — those appear as **code symbols**, never string
data, so stripping strings is correct there. I checked; this flaw is specific to
BL-962's token choice.

---

## Coder re-fix pass (2026-08-20) — D1 cleared

- **D1 cleared**: the invariant-2 gate's `merge-base`/`--is-ancestor` scan
  now runs over `strip-comments-keep-strings` output - ;-comments blanked
  (whole-line AND trailing), string contents PRESERVED, exactly where a bb
  shell-out's git subcommands live. **Re-proven with the review's own
  injection**: a rival `(sh! "git" ... "merge-base" "--is-ancestor" ...)`
  predicate appended to `babysitter_check.bb` now FAILS the gate (1 failure,
  naming the assertion); removed and green again. The one-site
  `is_qa_ancestor.sh` count (the sound half) now also runs over the same
  comment-stripped text, so a trailing-comment mention can no longer skew it
  either. Unit runner ALL PASS; property runner ALL PROPERTIES HOLD
  (P1=500, P2=500).

---

## Everything else — run and PASSED

| Check | Result |
|---|---|
| Declared **invariant 1** property test exists | YES — P1 over `adjudicate-merge-paths`, both directions. |
| Invariant 1 **non-vacuity re-proven by me** | YES — dropped `qa-approved?` from the exemption test → P1 failed with concrete coat-tails counterexamples (a path identical to a NON-approved parent wrongly exempted), plus `:coat-tails reached only 0 of 500` coverage collapse. Restored. |
| Declared **invariant 3** property test exists | YES — P2 over `assemble-offending-commits`. |
| Invariant 3 **non-vacuity re-proven by me** | YES — kept offenders alongside a failed row → **249/500** P2 failures, matching the coder's stated 249/500 exactly. Restored. |
| Property runners at DEFAULT runs | ALL PROPERTIES HOLD; coverage non-degenerate (P1 exempted 235 / coat-tails 173 / zero-parents 130 / all-exempted 80; P2 failed 342 / failed-with-offenders 249 / clean 84 / offenders-only 74). |
| BL-962 unit runner | ALL PASS |
| Acceptance 01–05 | **5/5 pass**, incl. 03 (non-QA parent never clears) and 05 (adjudication failure fails the sweep closed). |
| `qa_e2e` step 1 — `test_babysitter_check.sh` | **ALL PASS**, exit 0. |
| `qa_e2e` step 2 — live read-only gather | **ancestry-unavailable? false, 0 offending commits, `da6031c60` and `b3ba48bfc` both no longer flagged** — the reported defect is genuinely fixed. |
| Invariant 3 vs a *thrown* exception (not just a bad exit code) | HOLDS — the caller already wraps `gather-pipeline-code-on-main` in `try/catch` falling back to `{:offending-commits [] :ancestry-unavailable? true}`. Fail-closed on both paths. |
| Fail-closed on a merge with **no** non-first parents | HOLDS — empty `parents` makes `not-any?` vacuously true, so every offending path stays reported. |
| Path absent from the parent | HOLDS — `git diff --quiet` reports a difference, so it is never wrongly exempted. |
| Cleaner's `exit->answer` extraction | Correct — `is_qa_ancestor.sh` and `git diff --quiet` genuinely share the 0/1/other convention, and the fail-closed non-0/1 rule now has one definition instead of two. |
| Architecture | Pure core (`adjudicate-merge-paths`, `assemble-offending-commits`) split from impure gathering (`merge-parent-facts`) — matches the project's testable-module boundary. Out-of-scope files (`babysitterd_sweep_lib.bb`, `check_pipeline_code_on_main.sh`) untouched, per the ticket's fence. |
| Subject-string exemptions (explicitly forbidden) | NONE — clearing is decided only by ancestry + content identity. |
| Dependency-rule gate (BL-259, hard gate) | RUN — only the pre-existing `out/tools/telegram*` `acyclic` cycle; parcel touches **no** telegram file. Not a BL-962 defect. |
| Co-change (BL-255) | RUN, informational — `babysitterd_sweep_lib.bb` (6) and its two runners; all correctly left untouched per the ticket's out-of-scope fence. |
| Article 2.6 (batch carries every ticket id) | SATISFIED — the cleaner sent BL-961 and BL-966 as their own handoffs (`000248`, `000249`); this parcel names BL-962 only. |
| My own property-coverage pass | The touched pure modules are exactly `adjudicate-merge-paths` and `assemble-offending-commits`, both already covered above. **No new property warranted** — stated, not manufactured. |

No check was blocked.

---

## Revert disposition — and why `record-bounce.js` reports `verdict: violation`

BL-962's parcel is reverted out of `swarmforge-architect` at `092f39701`,
**scoped to BL-962's own commits** (`cc9b19b829` plus the cleaner's
`babysitter_check.bb` cleanup inside `dd00974f3b`) — never `-m 1` on the review
merge. The same cleaner tip carries **BL-961 and BL-966**, which arrived as their
own handoffs (`000248`, `000249`, Article 2.6) and are still queued for review; a
whole-merge revert would have destroyed both.

Verified by CONTENT, not ancestry: `adjudicate-merge-paths`, `merge-parent-facts`
and `BABYSITTER_QA_ANCESTOR_SCRIPT` are all gone from `babysitter_check.bb` (grep
count 0), the steps file and both BL-962 runners are deleted, and `index.js` lost
only `bl962`'s registration — `bl961`, `bl966`, `bl967`, `bl571` all still
present, 0 duplicates, registry loads. `babysitter_check.bb` parses and
`test_babysitter_check.sh` is still ALL PASS on the reverted tree.

**One file from the bounced commit is deliberately retained**:
`backlog/evidence/BL-962-BL-961-BL-966-cleaner-batch-20260820.md`. It is the
cleaner's batch evidence for **three** tickets, two of which are not bounced;
deleting it would strip BL-961 and BL-966 of their cleaner record. Because
`record-bounce.js`'s revert check scans for any live path from the bounced
commit, this single retained file makes it report `verdict: violation` with
`liveFiles: [that md]`. That verdict is a false positive for this bounce — no
BL-962 code or test survives. Recorded here so the next reader is not misled
into thinking the revert was incomplete.
