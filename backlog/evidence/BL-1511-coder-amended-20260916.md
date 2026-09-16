# BL-1511 — coder, amended round, 2026-09-16

Completes the ticket after the specifier's amendment
(`backlog/evidence/BL-1511-specifier-spec-gap-adjudication-20260916.md`),
which confirmed the coder's spec-gap finding
(`backlog/evidence/BL-1511-coder-spec-gap-20260916.md`) and changed the
ticket's own scope: the hatch stays, PREREQ names the real failing check,
scenario 02 is a fixture-based gate check.

## PREREQ/LAUNCH

Reworded PREREQ to name `role-gate-not-pass` and the two steward commands
that clear it (`compliance_battery.bb gate <role>`, then
`model_steward_cli.bb show <provider>/<model>`), dropping the old (false)
"no aider/glm entry" reason. LAUNCH keeps `PACK_STAFFING_SKIP_GATE=1`,
verified still correct against the real master checkout (below).

## Verified against the real master checkout (qa_e2e_procedure step 1)

`env -u PACK_STAFFING_SKIP_GATE bb swarmforge/scripts/pack_staffing_gate_cli.bb
/home/carillon/swarmforgevc <windows-file-derived-by-the-ticket's-own-awk-rule>`
— all 7 lines resolve a provider/model (no `seat-model-unresolved`) and
all 7 refuse `role-gate-not-pass`, citing `compliance_battery.bb gate
<role>` and `model_steward_cli.bb show <provider>/<model>` — exactly the
PREREQ text now names. (This worktree's own copy reads
`not-on-role-matrix` instead - the ticket's own text anticipates both
verdicts depending on checkout; the master checkout's `role-gate-not-pass`
is the one PREREQ documents, per the ticket's instruction.)

## Acceptance step handler

`specs/pipeline/steps/bl1511BobPackSeatsASpecifierSteps.js`:

- Scenario 01 is now explicitly a STRUCTURAL check only: sources the real
  `swarmforge.sh` against a scratch root with `SWARMFORGE_CONFIG` pointed
  at the real pack file, `PACK_STAFFING_SKIP_GATE=1` set (matching the
  pack's own LAUNCH line - `parse_config` invokes the staffing gate
  inline per window line regardless of what the scenario is testing, so
  running it with the hatch UNSET here would always refuse before ever
  reaching the specifier-line check; that unset behavior belongs to
  scenario 02's real verdict check, not this one).
- Scenario 02 builds a scratch `.swarmforge/model-steward/` (`registry.json`
  with `:models` certified entries and `:role_matrix` rankings, plus
  `scorecards/<provider>__<model>.json` with `<role>-gate: pass` entries)
  - never touching this worktree's real, stale steward state. Derives the
    windows-file from the real pack text using the qa_e2e_procedure's own
    awk field rule (role/agent/worktree, then skip an optional
    task|batch, an optional forward-only|back-one|back-all, an optional
    idle-clear; the rest is extra-cli), runs the real
    `pack_staffing_gate_cli.bb` with the hatch explicitly unset (BL-1485).
    Two rows: full steward evidence (every line passes) and the
    sensitivity row (no specifier-model entry - the specifier line alone
    refuses `not-on-role-matrix`, proving a no-op fixture cannot pass,
    BL-1445).
- Scenario 03 adds the LAUNCH/PREREQ literal check: LAUNCH carries
  `PACK_STAFFING_SKIP_GATE=1`; PREREQ names `role-gate-not-pass` and the
  `compliance_battery.bb gate` command.

Acceptance: `swarmforge/scripts/run_acceptance.sh
specs/features/BL-1511-the-bob-pack-seats-a-specifier-again.feature` -
4/4 scenarios pass (scenario 02 x2 for its two Examples rows).

The coder's earlier partial commit (`6a09fb7d06`: specifier window line,
header row, absent-prose removal) stands unchanged.
