# BL-1439 — architect pass (post-amendment), 2026-09-06

Ticket: BL-1439-the-deferred-hardening-gates-of-0819-are-run-and-discharged
Role: architect
Commit reviewed: b9516754b0 (cleaner pass — DRY fix, `find-row-idx`
extraction)

## Result: NONE — the amendment is fully and correctly implemented

## What changed since my last review

My `backlog/evidence/BL-1439-architect-pass-20260905.md` found the
original mechanics correct and forwarded the amendment (not a defect) to
coder for the specifier's `--attempt` verb / BL-1441 re-pointing
requirement. This pass reviews that implementation.

## Checks run

- **Dependency-rule gate**, full-repo: `Dependency-rule gate PASSED: no
  forbidden edges.`
- **Co-change report**: nothing suspicious.
- **jscpd caveat, independently confirmed**: `jscpd` silently analyzes 0
  files on `.bb` sources (no Clojure/Babashka parser registered) rather
  than reporting a genuine 0-clones verdict — confirmed this myself by
  running it directly against `hardening_debt_ledger_lib.bb` and getting
  a 0-files-analyzed result. The cleaner's manual line-by-line comparison
  (and resulting `find-row-idx` extraction) was the right call given this
  tooling gap, not an unnecessary refactor.
- **`find-row-idx` extraction**, independently confirmed: `grep -n
  find-row-idx` shows both `discharge-debt` and `record-attempt` now call
  the one private helper — no behavior change, same matching rule.

## Invariants Review (BL-633/654) — re-verified live, not just trusted

1. **"Never deleted, only marked"** — now true of both discharge and
   attempt: `record-attempt` only `assoc`s onto the existing row via
   `update`, confirmed by reading the function directly.
2. **"One filter... for the register and the throttle"** — `outstanding-debt`
   is unchanged (still filters on `:discharged-at` alone); confirmed an
   attempted row does NOT trip this filter by reading the function — an
   attempt is not a discharge, by design.
3. **"A gate that cannot complete... stays outstanding, never discharged
   by assertion"** — now backed by a real ledger record rather than only
   prose: independently ran `bb hardening_debt_ledger_read.bb .` myself
   and confirmed all four blocked rows carry `attempted_at: "2026-09-06"`
   and an `attempted_blocker` naming the real cause (cooldown-gate
   decision or the `constitutionDocCitations` red) plus "run belongs to
   BL-1441"; none of the four carries `discharged_at`.

## Independently confirmed non-vacuity myself (not just trusted)

Backed up `hardening_debt_ledger_lib.bb`, made `record-attempt` a no-op
(`{:rows rows :recorded? false}` unconditionally): reran the unit
suite — **4 failures** (recorded?, attempted_at, attempted_blocker, and
the round-trip test), exactly matching the class of failure the coder's
own non-vacuity proof describes. Restored the file, confirmed
byte-identical via `diff` and `git status --short` (empty), reran — `ok`
again.

## Independently re-verified the substance

- `bb swarmforge/scripts/test/hardening_debt_ledger_lib_test_runner.bb`
  — **ok**.
- `bash swarmforge/scripts/test/test_hardening_debt_ledger_cli.sh` —
  **ALL CHECKS PASSED** (30 checks, including the 7 new `--attempt`
  checks).
- `node specs/pipeline/cli.js
  specs/features/BL-1439-the-deferred-hardening-gates-of-0819-are-run-and-discharged.feature`
  — **4/4 pass** (was 3/4).
- `bb hardening_debt_ledger_read.bb .` (live) — 4 rows attempted naming
  BL-1441, 1 discharged, matching evidence exactly.
- `bb standing_red_register_cli.bb .` (live) — all 4 outstanding
  hardening rows now name `BL-1441`; the `constitutionDocCitations` row
  names `BL-1440`; `"unowned":[]`. Confirmed the register no longer
  reports any unowned row.

All matching both the coder's and cleaner's claimed counts exactly.

## required_wiring

All four anchors confirmed present: `--discharge` (unchanged),
`discharged` filter (unchanged), the new `--attempt` verb, and the step
handler discovered by directory scan (BL-1371), confirmed by the
acceptance run passing 4/4.

## Verdict

Architecturally compliant. The specifier's amendment is fully and
correctly implemented; no architecture violation, no invariant violation,
no correctness defect found. Forwarding to hardener.
