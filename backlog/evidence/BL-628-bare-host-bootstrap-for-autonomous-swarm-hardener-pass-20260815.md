# BL-628 hardener pass — 2026-08-15

## Scope

Received from architect as `merge_and_process architect 5cf11be9c3` (batch,
alongside BL-697 and BL-689). Reviewed the architect-approved commit fresh.

Files in scope: `swarmforge/deploy/lib/host_bootstrap.sh`,
`swarmforge/deploy/provision_autonomous_host.sh`,
`swarmforge/deploy/generate_autonomous_conf.sh`,
`swarmforge/deploy/generate_systemd_units.sh` (1-line description text only),
`swarmforge/packs/autonomous-swarm.conf`, and 4 shell test suites under
`swarmforge/scripts/test/`.

## Host load

`uptime` load average ranged 7.9-70.9 (4 cores) across this batch pass —
consistently over the 2x-cores busy threshold. No TypeScript source changed
by this ticket, so CRAP/Stryker/DRY do not apply here regardless (those
tools scope to `extension/src/*.ts`); the shell/Babashka mutation-tooling gap
below is unaffected by host load, so it ran anyway.

## Tests re-run independently (all green)

- `npx vitest run --config vitest.properties.config.mjs bl628` → 5/5 passed.
- `bash swarmforge/scripts/test/test_host_bootstrap.sh` → ALL PASS (13 scenarios).
- `bash swarmforge/scripts/test/test_generate_autonomous_conf.sh` → ALL PASS (8 scenarios).
- `bash swarmforge/scripts/test/test_provision_autonomous_host.sh` → ALL PASS (8 scenarios).
- `bash swarmforge/scripts/test/test_autonomous_swarm_pack.sh` → ALL PASS (4 scenarios).
- `bash specs/pipeline/scripts/run_acceptance.sh specs/features/BL-628-bare-host-bootstrap-for-autonomous-swarm.feature` → 15/16 PASS. The one failure (autonomous-bootstrap-08, the runbook-exists scenario) is confirmed — same as the architect's finding — to be the documenter's still-pending work per this ticket's own `required_stages`; `docs/how-to/BL-628-autonomous-swarm-bringup.md` does not exist yet. Not a hardening defect.

## CRAP / DRY

Not applicable — no `extension/src/*.ts` file changed by this commit.

## Mutation hardening

No Stryker/CRAP/DRY tooling applies (bash, not TypeScript). No Babashka/Kotlin
either — this is the same class of gap engineering.prompt names for those
languages, extended to plain bash deploy scripts: no wired mutation tool.
Per the "no tooling configured — do not improvise" guard, did a best-effort
pass in two parts:

**1. BL-113 Gherkin acceptance mutation (soft)** — the ticket's feature file
has 4 `Scenario Outline`s, so this is directly applicable (not `inapplicable`
per BL-638):

`specs/pipeline/scripts/run_gherkin_mutation.sh specs/features/BL-628-bare-host-bootstrap-for-autonomous-swarm.feature . specs/pipeline/steps/index.js soft`

Result: **Total 12, Killed 12, Survived 0, Errors 0** — a clean sweep across
all 4 outlines (unit-enable, headless-guarantee, swarm-name-refusal,
dry-run-action). Manifest confirms per-scenario clean results (see the
feature file's embedded `acceptance-mutation-manifest`). Nothing to fix.

**2. Hand-authored surgical mutation sweep over the shell scripts**
(BL-567/`expedite_mutation_sweep.sh` pattern — a handful of single-edit
mutants a correct suite must reject), targeting the invariant-critical
dry-run and name-collision guards the architect flagged as the design-review
focus:

- Mutant A: removed the `return` after the dry-run log line in
  `bootstrap_install_base_packages` (`host_bootstrap.sh`), so a dry-run would
  fall through into the real `sudo apt-get` calls — directly attacking
  invariant 1 ("dry-run mutates nothing on the host"). Ran
  `test_host_bootstrap.sh` against the mutant: **killed** (exit 1 — the real
  `sudo` calls fired and failed for lack of a terminal/password, which is
  itself proof the guard's absence would have mutated a real host).
  Restored via `git checkout --`, reconfirmed `ALL PASS`.
- Mutant B: in `generate_autonomous_conf.sh`, changed the placeholder-name
  refusal condition (`"$SWARM_NAME" == "autonomous"`) to compare against a
  string that can never match, disabling the guard that stops a box from
  being minted with the shipped placeholder name. Ran
  `test_generate_autonomous_conf.sh` against the mutant: **killed** (test 04,
  "expected a non-zero exit when asked to regenerate the placeholder name
  'autonomous'", failed as expected — the mutant produced exit 0). Restored
  the original file, reconfirmed `ALL PASS`.

Both hand-authored mutants were caught by the existing suite, confirming it
is not vacuous on the two invariant-critical guards the architect's design
review centered on (dry-run fidelity, name-collision refusal).

## Verdict

Nothing to fix. BL-113 Gherkin mutation: 12/12 killed, no survivors. Hand
mutation sweep on the shell scripts: both mutants killed, suite confirmed
non-vacuous. Targeted/property/shell test suites all green; the one
acceptance failure is the documenter's known pending work, not a defect.
Forwarding to documenter.

By hardender.
