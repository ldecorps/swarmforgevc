# BL-1127 — architect bounce (Article 4.4 inventory) — 20260825

**Tip reviewed:** cleaner `7bfad85221` (coder `cb937db891` + harness seams)
**Handoff:** `00_20260825T135609Z_000817_from_cleaner_to_architect`

## Scope

Product range covers battery script, steward eligibility helpers, Ollama pack/
start script, APS, units. Hitchhike with other in-flight lineage — authorize
BL-1127 only when rematching.

## Architecture — structure OK; live staffing gate missing (D1)

- Pure eligibility in `model_steward_lib.bb` (`bl1127-coder-battery-eligibility`
  / camelCase wiring alias) — dependency direction fine.
- Dep-gate on APS steps: PASSED.
- No webview / spawn-bypass issues.

## Checks run

| Check | Result |
|-------|--------|
| APS BL-1127 | 3/3 green (advisory — see D1/D2) |
| `test_local_coder_battery.sh` | ALL PASS |
| `model_steward_test_runner.bb` | ALL PASS |
| Declared invariants | none (no-op) |
| Live call sites of eligibility | **none outside tests/APS/docs** |

## Inventory

### D1 — `behavior` (blame: coder)

Ticket / feature require that **fail does not staff** the production local
forge pack. `bl1127CoderBatteryEligibility` returns ineligible for fail/absent,
but `start-swarm-ollama-qwen.sh` and `ollama-qwen3-mono-router.conf` never
consult eligibility or evidence. Fail/absent cannot prevent a launch —
staffing remains on vibes plus an unused pure helper.

**Remediation:** Gate the documented local forge launch (or pack admission)
on a cited **pass** battery evidence path; fail/absent must refuse to staff
coder (and document the gate). Wire `apply-coder-battery-to-scorecard` (or
equivalent) into that live path — not APS-only.

### D2 — `behavior` (blame: coder)

Ticket WHAT and feature Given name a coder battery of
**claim / edit / test / handoff**. `local_coder_battery.sh` only runs an
`ollama run … BATTERY_OK` probe (or harness `--result` /
`FORCE_RESULT`). That does not exercise claim/edit/test/handoff or reject
flaky tool use (human approval_context).

**Remediation:** Implement (or explicitly stage) a battery that drives the
named coder-role loop on this host and records pass/fail from that run;
keep harness seams for APS. If the specifier intends a probe-only MVP,
that must be a **spec change** — do not leave the feature Given naming a
workflow the script does not run.

## Property support (undeclared)

No declared invariants. Undeclared properties on pure eligibility are
**BLOCKED BY D1/D2** until the live gate and real battery exist to lock.

## Findings summary

| Item | Class | Blamed | Action |
|------|-------|--------|--------|
| D1 | behavior | coder | bounce |
| D2 | behavior | coder | bounce |

## Forward

`git_handoff` to `coder`, priority `00`, task
`BL-1127-local-coder-steward-evidence-bar`, commit = this tip.
Do **not** forward to hardender.

By architect.
