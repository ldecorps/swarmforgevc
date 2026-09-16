# BL-1595 — architect review pass, bounce, 2026-09-16

Commit reviewed: (merge of cleaner 209a061537 into architect). Full
checklist run: dependency-gate on the two changed test files PASSED (no
forbidden edges); co-change report shows only expected sibling coupling;
`checkFileDurationBudget`/register logic is unaffected by this ticket
(BL-1595 touches only `telegramFrontDeskBotCli.property.test.js` and its
own new step handler — no production module, matches `mutation_cost: low`
/ no Stryker target); the one declared invariant (a quiet-host, one-fork
run keeps the file's 60000 ms base unchanged) is exercised by acceptance
scenario 02, which is green (3/3 examples); acceptance is 5/5 green;
`npx vitest run --config vitest.properties.config.mjs
test/telegramFrontDeskBotCli.property.test.js` is green (3/3, both
budgeted tests using `propertyLaneTimeoutMs(60000)`); the standing-red
register row and the property-suite allowlist row were both correctly
drained in the same commit, matching invariant 2's own drain-in-the-
land-that-fixes-it rule. One defect found; the full pass is this single
item.

## D1

- **Failing command**: `ls backlog/evidence/BL-1595*` (expected location empty for the cleaner's pass) vs. the file actually present at `extension/backlog/evidence/BL-1595-cleaner-20260916.md`
- **Commit hash**: 209a061537 (cleaner's own commit, "BL-1595: cleaner review pass evidence (NONE)")
- **First error excerpt**: n/a — not a test failure, a misfiled evidence artifact
- **Failure class**: process
- **Expected vs observed**: every other role's BL-1595 evidence lives at repo-root `backlog/evidence/BL-1595-*.md` (coder's own pass, the specifier's adjudication); the cleaner's own NONE-pass evidence instead landed at `extension/backlog/evidence/BL-1595-cleaner-20260916.md` — a nested, non-standard location a future `grep -rl BL-1595 backlog/` (the exact grep Article 4.4/BL-759's own out-of-parcel-check discipline relies on) will miss, since it does not search under `extension/`.
- **Blamed role**: cleaner
- **Remediation pointer**: `git mv extension/backlog/evidence/BL-1595-cleaner-20260916.md backlog/evidence/BL-1595-cleaner-20260916.md`, recommit under the ticket's own subject.

Production substance of the parcel is correct: `propertyLaneTimeoutMs`
replaces both bare `60000` third arguments exactly as the ticket's FIRM
wording requires, no floor lowered, no numRuns reduced, no assertion
deleted; the standing-red-register row and allowlist row both drain in
this same commit. This bounce is solely the misfiled evidence path.

By architect.
