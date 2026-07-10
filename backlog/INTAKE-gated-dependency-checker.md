# Intake request (operator, 2026-07-10, via coordinator)

## Real, GATED static dependency-rule checker the architect MUST run

**Operator ask:** enforce the architect to run a **real, tool-backed, GATED**
dependency checker — the Dependency Inversion / dependency-direction rule
(high-level policy independent of low-level IO/UI/framework/filesystem detail;
low-level adapters depend inward) — so compliance is mechanical, not left to the
architect eyeballing code.

**Today:** `architect.prompt:30` says "Check module boundaries, dependency
direction, encapsulation…" as PROSE judgment; `cleaner.prompt:13,19-21` corrects
it by hand. No tool. Grep-confirmed: no dependency-cruiser / eslint-boundaries /
madge / ts-arch in package.json. Make it a hard gate like the hardener's
no-surviving-mutants gate.

**Wanted (specifier to shape into acceptance):**
1. **TOOL:** add a real, **pinned** dependency-rule checker. Strong TS candidate:
   **dependency-cruiser** — declarative forbidden-dependency rules, non-zero exit
   on violation (gate-able), and a report. Alternatives to weigh:
   eslint-plugin-boundaries / import `no-restricted-paths`, or ts-arch (ArchUnit
   style). Pin the version per the engineering pinned-tools rule.
2. **RULESET — encode THIS project's dependency rules** (the ones architect/cleaner
   check in prose today) as machine-checkable forbidden edges:
   - high-level policy modules must NOT import IO/UI/framework/filesystem/network/
     device modules;
   - the two-layer boundary: webview/view code must NOT import extension-host I/O;
     NO direct `child_process`/process-spawn from the view layer bypassing tmux;
   - testable-core modules must NOT depend on the VS Code API surface, the webview
     context, or live tmux/PTY (the engineering "testable boundary");
   - no webview browser storage import;
   - acyclic (no dependency cycles).
3. **GATE + ENFORCEMENT:** the architect RUNS it every review; a violation is a
   HARD FAIL → bounce to the coder with the specific offending edge (file → file,
   rule name), never forward. Wire it as a required step in the architect's Review
   Order (update `swarmforge/roles/architect.prompt`), so it is not a judgment call.
   Runnable in CI / the acceptance pipeline too, not only interactively.
4. **REPORT:** deterministic, diffable output naming each violating edge + the rule
   it breaks, so the bounce note is precise and reproducible.

**Constraints / fit:**
- PINNED tool (engineering rule): exact ref in package.json / lockfile; a bump is a
  human commit.
- The ruleset config itself is project source (versioned, reviewed), not generated.
- Scope the check to changed files for the per-parcel gate, but support a
  full-repo run for CI.
- COMPLEMENTS BL-255 (temporal/co-change coupling, advisory): this one is STATIC
  (import-direction) and GATED. Keep them as two tools/lenses (specifier confirms).

**Priority:** normal (operator did not mark top-priority), but it changes a role
gate — sequence carefully; do not hot-edit the live architect protocol, run it
through the pipeline (cf. BL-247 lesson).

_Specifier: turn into a spec (prose + Gherkin acceptance), place in backlog/paused/,
remove this intake file._
