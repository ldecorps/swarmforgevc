# BL-1694 — QA verification pass, 2026-09-24

## Ticket's own gates: ALL GREEN
1. `bash swarmforge/scripts/test/test_handoffd_role_context_clear_wiring.sh`
   — exit 0, all 8 cases `ok` (including new `context-clear-all-roles-07`
   fullness case).
2. `node specs/pipeline/cli.js specs/features/BL-316-context-clear-generalize-all-roles.feature`
   — `# pass 7`, `# fail 0`.
3. Both `required_wiring` pins present:
   - `specs/features/BL-316-context-clear-generalize-all-roles.feature`
     line 39: `# BL-316 context-clear-all-roles-07`.
   - `swarmforge/scripts/test/test_handoffd_role_context_clear_wiring.sh`
     lines 119-135: fake tmux answers `capture-pane` per-session instead
     of blanket `exit 0`.
4. Ancestry verified: `git merge-base --is-ancestor 222d884006
   (BL-1694 coder commit) 7f3c280598` (QA's held tip) — OK. Documenter
   doc commit `b05f797237` also confirmed an ancestor.
5. Commit range `d87a9948df..7f3c280598` diffed; BL-1694's own scope
   files (`test_handoffd_role_context_clear_wiring.sh`,
   `BL-316-context-clear-generalize-all-roles.feature`,
   `contextClearAllRolesSteps.js`) and its evidence/docs are present as
   the ticket's scope requires.

## Blocking red: OUTSIDE this parcel's scope

Failing command: `npm test` (run from `extension/`)
Commit tested: 7f3c280598 (QA's current held tip)

First error excerpt:
```
FAIL  test/pricingTable.test.js > BL-627: the current repo roster passes the pricing coverage check
AssertionError: PRICING_TABLE missing entries for swarm-referenced model(s): claude-opus-5-5
false !== true
```

Failure class: `unit`.

Expected vs observed: expected `checkPricingCoverage(REPO_ROOT).ok === true`
(every swarm-referenced model priced); observed `false` because
`claude-opus-5-5` (referenced by `swarmforge/packs/full-forge.conf:274`,
landed in commit `db5d1313e4` "Operator: specifier seat on
claude-opus-5-5 in the live pack") has no `PRICING_TABLE` entry.

Reproduced twice (full suite run, then isolated
`npx vitest run test/pricingTable.test.js -t "BL-627..."`) — deterministic,
not flaky.

Not BL-1694's: `git diff d87a9948df..7f3c280598 --name-only` touches
none of the pricing table, `PRICING_TABLE`, or
`swarmforge/packs/full-forge.conf`. The red predates this parcel — it
was introduced by the unrelated operator model-swap commit `db5d1313e4`
already on this branch before BL-1694's own work landed.

Grepped for an owning ticket before reporting (BL-1063 discipline):
`grep -rl "pricingTable\|claude-opus-5-5" backlog/` (excluding evidence)
returns only closed/`done/` tickets (BL-627, BL-740, BL-742, BL-743,
BL-771, BL-1056, BL-1436, BL-511, BL-551) — none open, none for
`claude-opus-5-5` specifically. `grep -n "pricingTable" backlog/standing-reds.tsv`
is empty. No open ticket owns this red.

## Disposition
Per Article 4.2 / the 2026-09-05 standing-red-register amendment: QA
approves no parcel whose evidence names a red with no open ticket. This
red is unowned, so BL-1694 WAITS rather than being approved or bounced —
BL-1694 did not cause it and has no fix to make. Sending `unowned-red`
note to specifier + coordinator naming this failure, and opening a QA
hold on the parcel per BL-1566.

By QA.
