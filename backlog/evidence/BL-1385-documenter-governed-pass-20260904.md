# BL-1385 — documenter governed pass (QA-directed), 2026-09-04

## Received
`1ee168e20c` (hardener governed pass — re-anchored a stale mutation-sweep
mutant the cleaner's `firstOnTree(cands)` refactor had orphaned; full
sweep now 9/9 killed, 0 skipped; checks independently re-run: guard exit
0, acceptance 13/13 including the concurrency scenario, registration
check, both `required_wiring` anchors).

## Merge
Resolved a feature-file scenario-numbering conflict (both sides carried
the same four scenarios under different numbering — a leftover from an
earlier duplicate-tag merge before this ticket was bounced). Adopted
hardener's numbering (07-10, matching this pass's fresh mutation-stamp);
content was identical either way.

## Doc-domain review
This pass is a pure QA-directed governance loop: a required-stage gap
(cleaner/architect/hardener never ran against the coder's earlier
concurrency-fix rework) plus a stale mutation-test anchor, both internal
to the hardening/testing machinery. No production behavior changed beyond
what my earlier pass
(`backlog/evidence/BL-1385-documenter-rework-20260904.md`) already
documented — the cleaner's `firstOnTree` consolidation is a pure refactor
(same require-graph resolution logic, same guard output). Re-checked both
owning doc pages
(`docs/how-to/BL-1371-step-handlers-register-by-discovery.md`,
`docs/how-to/BL-1252-commit-guard-chain-reports-every-violation.md`) and
the Specification.MD entry against the current
`check_handler_module_graph.sh` and the merged feature file — all still
accurate.

## Verdict
NONE — doc already accurate, re-verified. Forwarding to QA.
