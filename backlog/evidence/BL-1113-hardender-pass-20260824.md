# BL-1113 — hardener pass, 2026-08-24

## Inbound

Merged architect `3bca20030a` (evidence tip on cleaner `7feca3dd70` /
coder `46a9cf02ad`) into `swarmforge-hardender`.

Parcel surface (coder tip alone):
- `specs/pipeline/steps/bl1113CursorHotfixStampOffSteps.js` (new)
- `specs/pipeline/steps/index.js` (register wiring)
- `extension/test/bl1113CursorHotfixStampOff.property.test.js` (property lane)

Stamp-off only — confirms/refutes landed hotfix `27273f2b0a`; does not
rewrite it. All six HOTFIX_PATHS still `git diff --quiet` against that
commit. Ledger row remains `state: pending` / `human_decision: null`.

## Host / cooldown

`uptime` load ~2.6 on 20 cores (quiet). No orphaned `node --test` /
`stryker` processes. Parcel changes no `extension/src/**/*.ts`, so BL-149
Stryker cooldown + differential Stryker do not apply to this tip. `.bb`
hotfix surfaces remain untooled for language mutation (degraded gate;
unit suite used instead).

## BL-113 Gherkin acceptance mutation (soft)

```
status … total=20 completed=20 killed=20 survived=0 errors=0
outcome: "pass"
```

Manifest stamped into the feature file (two Outline scenarios: 16 + 4
mutants). Plain `Scenario:`s are outside Gherkin mutation by design —
covered by the hand-authored sweep below (BL-638 pattern for non-Outline
behaviour).

## Hand-authored surgical sweep (plain scenarios + wiring)

Ten single-edit behaviour mutants over the step module (restore-after-each;
kill = acceptance red). Nine killed, one skip (multiline anchor miss on
deadlock-clear expect — not a survivor):

| # | Mutant | Result |
|---|--------|--------|
| M1 | EXPECTED_ROWS `0\|0\|clear` proceed→ff-only | killed |
| M2 | `nudgeSuppressed` forced false | killed |
| M3 | cursor window regex → `claude` | killed |
| M4 | Confirm plan button text → `Confirm` | killed |
| M5 | pending.plan equality → `MUTANT` | killed |
| M6 | `&nbsp;` assert → plain space | killed |
| M7 | pack depth assert 3→4 | killed |
| M8 | deadlock-clear expect flip | skip (anchor) |
| M9 | omit `writePendingPlanConfirm` | killed |
| M10 | EXPECTED_SLUGS wrong slug | killed |

Earlier delete-assert probes (drop cursor match / Confirm / nbsp /
existsSync alone) can survive when a sibling assert still fails the
scenario — those are not treated as load-bearing survivors; the value
flips above are the gate.

Index unregister mutant (`bl1113…` → missing module) also killed
acceptance (separate check).

## Verification

- Acceptance: `node specs/pipeline/cli.js …BL-1113…` → 9/9 pass (fresh
  `npm run compile` first).
- Properties: `npm run test:properties -- test/bl1113CursorHotfixStampOff.property.test.js` → 2/2.
- Standing whole-tree guards (parcel touches `specs/pipeline/steps/` +
  `extension/test/`):
  `npx vitest run $(ls test/*Guard*.test.js | grep -v '\.property\.')` →
  13 files / 125 tests pass.
- `.bb` unit: `bb …/master_main_reconcile_lib_test_runner.bb` → ALL TESTS PASS.
- Targeted extension unit (landed hotfix surfaces): pipelineBoard +
  telegramCursorOperatorCore + telegramCursorBridgeLive → 254/254 pass.
- CRAP / DRY / Stryker on parcel: N/A — no changed `src/*.ts` production
  modules in this tip.
- Sibling bounce skim on `main` since merge-base: no BL-1113 bounce
  evidence; no matching defect pattern in this harness.

## Findings

NONE.

## Forward

`git_handoff` to `documenter`, priority `00`, task
`BL-1113-cursor-hotfix-main-sync-board-plan-stamp-off`, commit = this
hardening tip (manifest + evidence).

By hardender.
