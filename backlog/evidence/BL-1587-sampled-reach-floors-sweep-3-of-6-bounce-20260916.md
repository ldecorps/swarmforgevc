# BL-1587 sampled-reach-floors-sweep-3-of-6 — architect review pass, 2026-09-16

Reviewed commit `0a6d9b6053` (cleaner's tip, merged into this worktree as
`4e75fa3e12`). Full checklist run:

- `dependency-gate.js` on all changed files: PASSED, no forbidden edges.
- `co-change-report.js` on all changed files: informational only, no
  suspected coupling above threshold (each pairing is with the file's own
  earlier ticket history, expected).
- Floor audit (`git diff main...HEAD -- extension/test | grep -E
  '(numRuns|assertReachFloor|>= *[0-9]|> *0|runsPerCell)'`, 132 lines) read
  line by line against the coder's evidence table
  (`backlog/evidence/BL-1587-coder-20260916.md`): every removed `numRuns`
  literal reappears as the budget handed to `runsPerCell` at the same value;
  every removed floor value reappears as the floor argument to
  `assertReachFloor`; no numeric value went down. Invariant 1 holds.
- Invariant 2 (reached by construction): spot-verified `bl1254` (chained
  `hitCommit` draw from the non-empty `created` set — `existed` now
  guaranteed every run, `miss` already guaranteed from the disjoint `ABSENT`
  pool) and `bl1495` (outer loop over `PROVIDER_KEYS` with `fc.constant`;
  `aider-present`/`aider-absent` cells via `fc.subarray` with `minLength`
  chosen so each cell's shape is guaranteed, `fc.pre` correctly dropped as
  no longer needed) by hand against source — both genuinely reach by
  construction, not by hope.
- `bl1305FixtureAgentBinary.property.test.js`: confirmed unchanged in the
  diff and confirmed by reading its source that invariant 1's property
  (`numRuns: 12`) has no reach-counter/threshold pattern at all, and its own
  "reach floor" test is a fixed non-generative non-vacuity proof, not a
  sampled-population floor. **Architect confirms the exclusion** (coder's
  evidence table asked for this): the census (BL-1583) should drop
  `bl1305FixtureAgentBinary.property.test.js` from the reach-floor count.
- `extension/src` and `extension/test/helpers/reachFloors.js`: confirmed
  unchanged (empty diff) — matches the ticket's constraint.
- `git diff main...HEAD --name-only`: only the 10 migrated test files, the
  step handler, and evidence — matches scope; nothing from the epic's other
  slices touched.
- Acceptance: `specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-1587-sampled-reach-floors-sweep-3-of-6.feature` — 12/12
  pass.
- Standalone green spot-checks: `bl1343ReplayNeverDropsOwnPathInvariants`,
  `bl1495BaiGatewayInvariants`, `bl1445StaffingGateWiringTestDecidesOverrideInvariants`
  — all green under `vitest.properties.config.mjs`.
- Commit bylines present on every commit in the chain (`By coder.`, `By
  cleaner.` x2).

## D1 — cleaner's own evidence file committed at the wrong path

`0a6d9b6053` ("BL-1587: cleaner review pass evidence (NONE)") added
`extension/backlog/evidence/BL-1587-cleaner-20260916.md` instead of
`backlog/evidence/BL-1587-cleaner-20260916.md` — the cleaner's shell was
almost certainly in `extension/` (npm runs from there per
local-engineering.prompt) and the relative path resolved against that cwd
instead of the repo root.

This is not a one-off: `git log --all -- extension/backlog/` currently shows
17 commits by four roles since 2026-09-07, and `git ls-tree -r HEAD --
extension/backlog/` shows **seven tracked strays still on main today**
(BL-1278, BL-1464, BL-1478, BL-1503, BL-1558, BL-1569, and now this parcel's
BL-1587). The class is already ticketed —
**`backlog/paused/BL-1552-a-nested-backlog-tree-never-enters-a-commit.yaml`**
(a commit-time guard + a three-file move) — but that ticket is not yet
active, is pinned to only 3 of the now-7 strays (it was minted 2026-09-13
against main at `083d055ece`, before BL-1503/BL-1558/BL-1569/BL-1587
recurred), and its own "Not in scope" section explicitly leaves prevention
to the future guard, not to editing role prompts. This bounce is therefore
about THIS parcel's own instance only — BL-1552 remains the tracking ticket
for the systemic guard and the pre-existing backlog of strays; I am not
proposing a new ticket.

**Remediation**: move
`extension/backlog/evidence/BL-1587-cleaner-20260916.md` to
`backlog/evidence/BL-1587-cleaner-20260916.md` (`git mv`), remove the now-
empty `extension/backlog/` tree, and recommit from the repo root. No other
change needed — the cleaner's review content itself (a NONE inventory) is
correct, only its path is wrong.

## Verdict

Bounced on D1 alone; everything else in the checklist passed clean. Not a
`rule_proposal` — BL-1552 already exists for the class; this bounce is the
in-parcel fix.

By architect.
