# BL-1096 — architect pass, clean review (Article 4.4: NONE)

Reviewed cleaner `463f260c86` (on coder `a694bd2980`) into
`swarmforge-architect`. Merged cleanly; ancestry confirmed.

## Scope

BL-925's QA-import exemption no longer asks `is_qa_ancestor.sh` about the
incoming merge **tip** alone. Per offending path:

1. `git log -1` on that path from `MERGE_HEAD` → path anchor
2. `is_qa_ancestor.sh` on that anchor (shared predicate — invariant 3)
3. staged blob must still match the incoming parent (BL-925)

Fail-closed on absent / non-QA / bounced / undeterminable anchors. Fresh
edits on top of a multi-hop import still refuse only the edited path.

## Architecture

- Fixes the measured multi-hop reconcile failure without forking
  `is_qa_ancestor.sh` or weakening tip-unpublished refusals.
- `pipeline_path_import_exempt` is a small pure shell predicate; merge-parent
  discovery unchanged.
- Cleaner: APS memoizes one full guard suite run; restores invariant-2 note.
- No webview/host/secrets; stamp-off tip hygiene OK (`27273f2b0a`,
  BL-1113 9/9).

## Required hard gate

No `extension/src` production files. Dep-gate N/A (bash guard + APS).

## Invariants review (BL-633/BL-654) — 3 declared, encoded, green

| # | Invariant | Encoding | Verified |
|---|---|---|---|
| 1 | Per-path provenance, not tip-for-all | shell suite + feature Outline | Green |
| 2 | Unresolvable provenance never approval | per-path refuse cases | Green |
| 3 | One `is_qa_ancestor.sh` definition | still the only caller; invariant2 PASS | Green |

## Property-testing support (undeclared)

No new pure TS module. Declared behaviour covered by shell + APS. No
additional undeclared property authored.

## Correctness read-through

- Guard ALL PASS (BL-925 + BL-1096 cases); acceptance 7/7.
- No prior BL-1096 bounce evidence.

## Findings

NONE.

## Forward

`git_handoff` to `hardender`, priority `00`, task
`BL-1096-qa-import-exemption-anchors-per-path-not-the-merge-tip`, commit =
this evidence commit (BL-536 / BL-806).

By architect.
