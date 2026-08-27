# BL-935 — architect review pass 3: complete inventory

- **Ticket**: BL-935 cap the vitest fork pool under a live full-forge pack on macOS (`type: feature`)
- **Commit reviewed**: `428ba6a141` (cleaner — "collapse the duplicated pool resolution onto one route")
- **Reviewer**: architect, 2026-08-19
- **Verdict**: **PASS — defects found: NONE.** Forwarded to hardender.

Article 4.4 complete-inventory pass. This is my third review of BL-935; both
prior bounces are accounted for below.

## Prior bounces (BL-340 check, read from a `main` ref, not worktree files)

`main` (19 ahead of `origin/main`, 0 behind) records exactly two, both mine:

1. `e4b327e031` — `invariant-unencoded`: P1 was structurally vacuous (it compared
   `resolveWorkerPoolSize(ram, ceiling)` against the raw-RAM bound, a mathematical
   identity of that function's own pre-existing `Math.max(1, Math.min(...))` that
   no return value of the new ceiling could violate). **FIXED** — P1 is replaced by
   an absolute "never exceeds the default" property and a relative
   "full-forge/darwin never gets more forks than any other combination" property,
   each with its own documented break-then-fix.
2. `dfc82c1fdf` — `behavior`, raised as a routing violation (coder → architect
   skipping cleaner). **WITHDRAWN, not re-raised**: that route is UNGOVERNED, not a
   violation; BL-951 carries the open policy question. Surfaced, not re-bounced.

No prior defect remains unfixed.

## Checks run — full inventory

| # | Check | Result |
|---|---|---|
| 1 | Merge lineage (`428ba6a141` ancestor of HEAD) | PASS — already an ancestor via the cleaner's batch merge; preserved through the BL-958 path-scoped revert |
| 2 | **Dependency gate (hard gate)** | PASS — "no forbidden edges" |
| 3 | Co-change coupling | PASS — flags only the healthy module↔test↔consumer triad; the parcel *reduces* config↔config coupling |
| 4 | `required_wiring` entry 1 (`vitest.config.mjs::BL-935`) | PASS — literal present, lane calls the route |
| 5 | `required_wiring` entry 2 (`vitest.properties.config.mjs::BL-935`) | PASS — same |
| 6 | Invariant 1 — the ceiling only LOWERS, never raises | PASS — two properties, plus acceptance example `override 9 → 3 forks` pinning the memory budget as the upper bound |
| 7 | Invariant 2 — resolved count ≥ 1 for every input | PASS — property over absent/malformed/zero/negative overrides, non-vacuous (floor removal fails it) |
| 8 | Invariant 3 — both lanes share one code path | PASS — now true **by construction**: one `resolveVitestWorkerPool` composition, both configs call only it. Its non-encodability as a property is documented in-file (a property over a pure function cannot distinguish "both configs call it" from "one was miswired"), gated instead by `required_wiring` + acceptance scenario 02 |
| 9 | Property tests exist + non-vacuous for declared invariants | PASS |
| 10 | Scenario Outline validates against explicit KNOWN_VALUES | PASS — `PACK_VALUES`/`PLATFORM_VALUES`/`OVERRIDE_VALUES` with a throw on unknown tokens; no passthrough |
| 11 | Step handler registered in `specs/pipeline/steps/index.js` | PASS |
| 12 | Unit suite `vitestWorkerMemoryBudget.test.js` | PASS — 31/31 |
| 13 | Property lane `vitestForkCeiling.property.test.js` | PASS — 7/7 |
| 14 | BL-871 — no `Unhandled Error`/`Rejection` in the property lane | PASS — none emitted |
| 15 | Two-layer boundary / host owns I/O / no webview storage / secrets | PASS — pure module, no VS Code API, no browser storage, no secrets |
| 16 | Policy independent of IO/UI/filesystem | PASS — every environment input (`pack`, `platform`, `override`, `hostRamMB`) is passed in by the caller; no `process.env` or `os` read inside the module |

## Architect property-coverage pass (my own ownership)

The cleaner's DRY change created a gap worth closing. Every pre-existing property
composes `resolveVitestForkCeiling` and `resolveWorkerPoolSize` **by hand inside the
test**; none of them called `resolveVitestWorkerPool` — the route both configs now
actually use. A miswire inside that composition (swapped arguments, a dropped
ceiling) would have left every property green, with the finite decision-table unit
test as the only gate.

Added two properties over the real route:

- `resolveVitestWorkerPool` is exactly the ceiling composed with the memory budget,
  over the whole generated input space;
- `resolveVitestWorkerPool` never exceeds the memory-only budget (invariant 1
  asserted through the real route), and stays ≥ 1.

**Non-vacuity proven, not asserted** — the compiled artifact (`out/`, gitignored;
production source never touched) was broken twice and restored:

| Break | Result |
|---|---|
| ceiling dropped (`resolveWorkerPoolSize(hostRamMB)`) | property 1 FAILS — `composed route diverged for pack=full-forge platform=darwin override=1 hostRamMB=5120` |
| ceiling passed as the `perWorkerHeapMB` argument | **both** FAIL — `composed route diverged ... hostRamMB=4` and `composed 2 exceeded memory-only 1 ... hostRamMB=4` |

Restored: 7/7 green.

## Documentation item (travels with the parcel — not a bounce)

The property file's header still described the configs as calling "the identical
`resolveVitestForkCeiling`/`resolveWorkerPoolSize` pair", which the cleaner's own
change made false — both now call `resolveVitestWorkerPool`. Because the sentence
directly contradicted the properties I was adding in that same file, I corrected
that one sentence rather than leave a false wiring claim beside new code. Flagged
here so the documenter can confirm no other prose repeats the stale description.

## Observation for the hardener (not a defect)

Acceptance scenario 02 ("both lanes size their pools identically") has lost
discriminating power for its original purpose: with one shared composition, lane
agreement is now structural. It still catches a lane hardcoding `maxForks` or
failing to load, and a bug *inside* the shared route is caught by check 12 and by
the two properties added above — but scenario 02 asserting the expected VALUE
(1 under full-forge/darwin) rather than mere equality would restore its bite.

## Host condition at review time

Load average was **256.61 / 218.90 / 181.20** on a 2-physical-core box — roughly
128× the core count, far beyond the 16–39 the ticket was filed against. The
`tsc` compile exceeded 115s. Suites were run per-file and each passed; no gate was
skipped or assumed. This is the exact pathology BL-935 exists to reduce.
