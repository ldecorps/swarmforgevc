# BL-780 — coder re-entry after QA bounce — 20260827

QA bounce D1 (entangled architect tip): prior forward of `9b96d58a67` pulled
BL-980 / BL-1084 hitchhikers via lineage (BL-506 tip purity). Functional
BL-780 slice itself was green (5/5 acceptance).

## Remediation

Re-handoff tip-pure line: `origin/main` + cherry-pick of BL-780-only commits
(`8714e834f` default/ordering + `a7ba35661` acceptance wiring). Tip diff vs
`origin/main` is BL-780 deliverables only.

## Gates (re-verified this pass)

| Gate | Result |
|---|---|
| `mono_router_lib_test_runner.bb` | ok |
| `test_bl780_rotation_actionability_ordering.sh` | ALL PASS (3) |
| Acceptance (BL-780 feature) | **5/5** |
| Tip purity (`origin/main...HEAD` paths) | BL-780 only |

By coder.
