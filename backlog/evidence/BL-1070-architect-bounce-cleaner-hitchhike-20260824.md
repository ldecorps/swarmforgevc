# BL-1070 — architect bounce (cleaner re-hitchhiked clean tip) — 20260824

## Review inventory (Article 4.4)

### D1 — behavior (hitchhiker reintroduced) — blamed: cleaner

- **Failing contract:** QA bounce `b497f5bad2` /
  `BL-1070-qa-bounce-docs-rematch-20260824.md` close-by required BL-1070 on
  clean `origin/main` **without** BL-1112 / ACP / ledger / INTAKE /
  mass-done hitchhike. Coder tip `af2a853d9b` met that: tree vs
  `d5c922407f` is **17 paths**, all BL-1070 pane-tree / docs / APS.
  Cleaner tip `0ac6f8713b` is a merge of that tip **into** hitchhiked
  `swarmforge-cleaner` ancestry; tree vs `d5c922407f` is **138 paths**
  (tracked INTAKEs, hotfix ledger, BL-1112 surfaces, mass `done/` moves,
  …) — same failure class as the prior QA bounces.
- **Commit hash checked:** `0ac6f8713b` (merged at architect
  `a2fe0694a7`)
- **Failure class:** `behavior`
- **Close by:** Forward tip `af2a853d9b` (or an evidence-only tip whose
  `origin/main...TIP` name-list stays the BL-1070-only set). Do **not**
  `git merge` the clean tip into a cleaner branch that still carries
  bounced BL-1112 lineage. Reset / replace the rematch tip so the landable
  commit is hitchhike-free before returning to architect.

## What is otherwise sound (BL-1070 surface)

| Gate | Result |
|---|---|
| Unit (`agent_process_marker_lib_test_runner.bb`) | OK |
| Acceptance (BL-1070) | **9/9** |
| Stamp-off (BL-1113) | **9/9** |

Pane-tree descendant liveness and RC UNAVAILABLE when gated off remain
correct on the clean tip. Do not rework the behavioural surface — only
strip the hitchhike from the tip that will land.

## Verdict: BOUNCE — do not land.

By architect.
