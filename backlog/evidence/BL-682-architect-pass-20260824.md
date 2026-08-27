# BL-682 — architect pass, clean review (Article 4.4: NONE)

Arrived as an ancestor of cleaner tip `e970666a3a` (coder commit
`bdc712fb9e`, left intact by cleaner after green unit pass). Reviewed in
the same architect pass as BL-556 per Article 2.6 multi-ticket discipline.
No prior bounce on this ticket.

## Scope

Wire Mistral Vibe into the Intelligence Layer: `provider->agent` map key
`"mistral" → "vibe"`; seed `mistral/mistral-medium-3.5` with
`underlying_name` + `trace` from live vibe-config alias (not rolling
`*-latest`); pure `mistral_vibe_registration_lib.bb`; optional steward
`register-model` fields; APS + property cover.

## Architecture

- Pure registration planner (no disk IO) — callers supply parsed config.
- Factory map additive only; steward seed additive; register-model extended
  with optional trace fields without changing certification defaults.
- No extension host/webview boundary crossed.

## Required hard gate: dependency-gate.js

Same full-repo standing BL-759 only (ticketed). Parcel extension property
file scan: **PASSED**. Not re-reported.

## Co-change

New registration lib co-changes with its own seed/factory/steps/property
files only — expected.

## Invariants (both declared)

| # | Invariant | Encoding | Verified |
|---|---|---|---|
| 1 | No invented model id — tool-traceable or agent-granularity with reason | `bl682MistralVibeRouting.property.test.js` inv1 | Green; non-vacuity below |
| 2 | Existing provider resolution and non-mistral seed rows unchanged | inv2 over factory map + seed | Green |

Non-vacuity (empirical): `registration-from-vibe-config` forced to always
return `{:model "mistral-vibe"}` with no reason → inv1 RED; restored;
green; `git diff` clean.

## Property-testing pass (undeclared)

Declared invariants cover the touched pure surface. No extra undeclared
property manufactured. Vitest properties: 2 passed.

## Correctness read-through

- Unit runner `bl682_mistral_vibe_routing_test_runner.bb`: **ALL PASS**.
- Seed registers alias `mistral-medium-3.5` with underlying
  `mistral-vibe-cli-latest` in `trace` — rolling latest is not the registry
  id.

## Inventory

**NONE**

## Verdict

Pass to hardender as its own `git_handoff` (Article 2.6).
