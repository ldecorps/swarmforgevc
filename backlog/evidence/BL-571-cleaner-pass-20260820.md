# BL-571 — cleaner complete review inventory (Article 4.4)

- **Ticket**: BL-571 — `rotation sequential` packs are invisible to ensure's declared signal (`type: defect`, `severity: medium`, M8)
- **Parcel**: from coder, commit `5b22ed2204` (the re-fix for QA bounce D1)
- **Reviewed by**: cleaner, 2026-08-20
- **Prior bounces**: 2 — architect→coder (`behavior`, `bbb14382d8`, CLOSED at `71f250cb26`); QA→coder (`integration`, `affac4f828`, this re-fix)

## Verdict

**FORWARD — inventory items: NONE.**

No item in either prior bounce inventory was blamed on `cleaner`, so none travelled
to me to clear. This pass found no defect of its own.

## Inventory items blamed on cleaner

None, in either bounce.

## Gates run this pass

| # | Gate | Result |
|---|---|---|
| C1 | Merge integrity — every BL-571 path vs sender tip `5b22ed2204` | PASS — `git diff 5b22ed2204 HEAD` over all BL-571 paths is EMPTY; the merge dropped nothing (BL-954 class) |
| C2 | Silent re-revert — QA's scoped revert `d1af26f8b8` is in this branch's lineage via the BL-935 merge-up, so the re-fix merge could have re-applied it | PASS — verified by CONTENT, not ancestry, inverting QA's own disposition table: `single-resident-rotation` in mono_router_lib 5, `BL-571` in test_swarm_ensure.sh 6, `bl571` in steps/index.js 1, parity gate in mono_router_lib_test_runner 24, Specification.MD 2; steps file, property runner and feature all present |
| C3 | Received-commit ancestry | PASS — `git merge-base --is-ancestor 5b22ed2204 HEAD` |
| C4 | D1 remediation present and PARSING (the BL-935 flow-style trap QA called out) | PASS — `abandoned_commits: ["17ae8a4822", "b7a6e580d7"]` in flow style at top level; `yaml.safe_load` returns both ids, `bounce_count: 2`, both `bounce_history` entries present |
| C5 | `qa_e2e` step 1 — `test_swarm_ensure.sh` | PASS — 45/45, ALL PASS, exit 0 (matches QA's G4 count exactly) |
| C6 | `qa_e2e` step 2 — `mono_router_lib_test_runner.bb` | PASS — `ok` |
| C7 | `qa_e2e` step 3 — `bl571_single_resident_rotation_property_runner.bb` (separate lane) | PASS — `ok (500 runs, 246 positive, 120 sequential, 254 negative)` — a real distribution, not vacuous |
| C8 | Fixture daemon leaks | PASS — no fixture-rooted `handoffd`/`babysitterd`/`supervisor` left behind |
| C9 | Functional change present (no-op rule, Article 1.9) | PASS — the received commit restores the whole BL-571 parcel onto this branch, which carried QA's scoped revert |

## Cleanup performed

**None, deliberately.** The parcel's code was already cleaned in this ticket's
earlier pass (`87d4c64013`) and QA passed every code gate on it; the re-fix delta
(`97d1d0e92..5b22ed2204`) is ticket-YAML rationale only, with no code to clean.

One duplication remains visible and is deliberately LEFT: `swarm_ensure.bb`'s
`rotation-router-mode?` repeats the identity-else-conf resolution that
`mono_router_lib/resolve-rotation-router-mode?` already performs, differing only
in which accepted-values set it applies. Consolidating it here is refused on
three independent grounds — the ticket's own "Out of scope" section defers the
four-call-site refactor to its own ticket and names it as the scope creep
"An Approval Authorizes Only Its Ticket's Work" forbids; the shared resolution
feeds the ROTATE_HOME backstop the ticket explicitly fences; and QA already
passed `resolve-rotation-router-mode?` as untouched at its G11. Recorded here so
the deferral is a decision on the record, not an oversight.

## Babashka lane

No mutation / CRAP / DRY tooling is wired for Babashka (BL-472 deferred). This
pass is gated on the unit, property and shell suites above — the degraded
fallback, recorded per the engineering rules.

By cleaner.
