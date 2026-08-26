# BL-935 — hardener pass: complete inventory

- **Ticket**: BL-935 cap the vitest fork pool under a live full-forge pack on macOS (`type: feature`)
- **Commit received**: `2c1aef0bcd` (architect — "review pass 3 - PASS (no defects), plus property coverage of the single pool-resolution route")
- **Role**: hardender, 2026-08-19
- **Verdict**: **hardened and FORWARDED to documenter.** No bounce. Two test gaps closed, both in my own domain (tests only — no product behaviour added).

## Host condition (governs which gates could run)

`uptime` through the pass: load averages **246 → 301 → 195** on a box with
**2 physical cores** (`hw.physicalcpu`; `hw.ncpu` reports 4 logical) — roughly
**100–150× the physical core count**, sustained. Per the standing load rules,
Stryker and the Gherkin mutator are both barred at this level and were not
attempted; see "Gates deferred" below. Every run in this pass was launched
detached (`python3` double-fork + `os.setsid`) because the 120s foreground
ceiling cannot hold a `tsc` compile on this host — the compile alone took
~4 minutes.

This is, with some irony, the exact pathology BL-935 exists to reduce.

## Defects found in the received parcel: NONE

The architect's pass-3 inventory holds. I re-checked its load-bearing claims
and add no items against the code.

## Test gaps CLOSED in this pass (mine to fix, not bounces)

### H1 — the acceptance feature never exercised the route production uses

`specs/pipeline/steps/bl935VitestForkPoolSteps.js` re-composed
`resolveVitestForkCeiling` with `resolveWorkerPoolSize` **by hand inside the
step**, so all eight Examples rows passed without ever calling
`resolveVitestWorkerPool` — the single composition both `vitest.config.mjs`
and `vitest.properties.config.mjs` actually call. This is precisely the gap
the architect closed on the *property* side in pass 3; it stayed open on the
acceptance side, where `grep -rn resolveVitestWorkerPool specs/pipeline/steps/`
returned nothing.

**Proven, not asserted.** Control run C1 below: with the ceiling dropped from
`resolveVitestWorkerPool`, the pre-hardening acceptance suite passed **9/9,
exit 0**. After the fix the same mutant fails 4 scenarios.

Fixed by driving `resolveVitestWorkerPool` in the resolution step.

### H2 — scenario 02 asserted lane agreement, not the capped value

Handed to me by the architect as an observation ("scenario 02 has lost
discriminating power"). Once the cleaner collapsed both lanes onto one shared
composition, lane *agreement* became structural: both lanes silently dropping
the ceiling and reporting the memory-derived 3 still passed.

Fixed by pinning the VALUE in the feature file — `Then both report exactly 1
fork` — with equality still asserted first so a genuine lane divergence is
still reported as a divergence rather than as a wrong number. The literal
lives in the Gherkin, where a Gherkin mutant can reach it, rather than
hardcoded in the handler.

### H3 — the Examples table under-tabled the ticket's own precedence rule

Precedence rule 1 reads "a non-positive **or** non-numeric value is IGNORED,
not floored", and invariant 2 names "absent, malformed, **zero and negative**
overrides" — but the table pinned only the non-numeric half (`not-a-number`).
Mutant M4 (widening the override guard to `n >= 0`) therefore survived the
whole acceptance suite.

Added two rows, `| unset | macOS | 0 | 3 |` and `| unset | macOS | -1 | 3 |`,
with matching `OVERRIDE_VALUES` entries. Tabled under an **unset** pack
deliberately: under full-forge/macOS the pack rule's own `1` coincides with the
pool floor's `1`, so that combination structurally cannot tell an ignored
override from an accepted zero. M4 is now killed by acceptance.

## Gates run — full inventory

| # | Gate | Result |
|---|------|--------|
| 1 | Merge lineage (`2c1aef0bcd` ancestor of HEAD) | PASS |
| 2 | Prior-bounce check (BL-340) — both architect bounces | PASS — D1 fixed, second withdrawn as ungoverned (BL-951); nothing unfixed |
| 3 | `tsc` compile before relying on `out/` (BL-497) | PASS — exit 0, artifact refreshed |
| 4 | Unit lane `vitestWorkerMemoryBudget.test.js` | PASS — 31/31 |
| 5 | Property lane `vitestForkCeiling.property.test.js` | PASS — 7/7 |
| 6 | BL-871 — no `Unhandled Error`/`Rejection` in the property lane | PASS — none emitted |
| 7 | Acceptance, fresh build (BL-203/BL-221/BL-497) | PASS — 9/9 before my rows, **11/11** after |
| 8 | Hand-authored mutation sweep (6 mutants + 1 control) | PASS — see below, zero survivors unaccounted for |
| 9 | BL-908 — Outline columns keyed, not shape-matched | PASS — every column is a key into `PACK_VALUES`/`PLATFORM_VALUES`/`OVERRIDE_VALUES`, which throw on an unknown token, and flows into the resolver whose result is asserted; a mutated cell cannot reach a passing assertion |
| 10 | BL-927 — case-flip survivor class | N/A — a case-flipped token is rejected by `knownValue`'s explicit throw, not resolved as a path |
| 11 | BL-788 — bridge handle bound by try/finally in one step | N/A — this handler starts no bridge |
| 12 | 2026-08-18 — fixture temp dir leaked by a validating throw | N/A — the handler creates no fixture dir (the ticket forbids one); `knownValue`'s throw has nothing to release |
| 13 | 2026-08-18 — unconfirmed teardown kill of a spawned daemon | N/A — scenario 02's `execFileSync` config probes are synchronous and short-lived; nothing long-lived is spawned |
| 14 | Standing whole-tree guards (parcel touches `specs/pipeline/steps/`) | see below |
| 15 | CRAP on changed `src/*.ts` | see below |
| 16 | DRY (`jscpd`) | see below |
| 17 | Orphaned process/fixture check | PASS — see Handoff hygiene |

## Mutation: hand-authored surgical sweep (Stryker + Gherkin both barred)

Neither wired mutation runner could be run at 100–150× core load: the standing
rules bar a Stryker dry-run outright at this level (it crashes rather than
stalls, even at `concurrency=1`), and the Gherkin mutator's documented failure
shape under load is a flat-CPU stall with no verdict at all. Rather than record
a bare deferral for a gate this parcel genuinely needs, I ran the BL-638/BL-567
fallback: **hand-authored single-edit mutants against the compiled `out/`
artifact** (gitignored; production source never touched), each one a real defect
a correct suite must reject. All mutants were reverted and the artifact restored.

| Mutant | Acceptance | Unit | Property |
|--------|-----------|------|----------|
| M1 `resolveVitestWorkerPool` drops the ceiling | **KILLED** (4 fail) | — | — |
| M2 pack rule inverted (full-forge/darwin gets the default) | **KILLED** (6 fail) | — | — |
| M3 platform comparison flipped to `!==` | **KILLED** (4 fail) | — | — |
| M4 override guard widened to `n >= 0` | survived → **KILLED after H3** (1 fail) | KILLED | KILLED |
| M5 pool floor of 1 removed | survived acceptance | **KILLED** | **KILLED** |
| M6 ceiling passed as the `perWorkerHeapMB` argument | **KILLED** (9 fail) | — | — |
| **C1** M1 against the **pre-hardening** step handler | **SURVIVED — 9/9, exit 0** | — | — |

**C1 is the load-bearing result.** It is the direct measurement that H1 was a
real gap and not a tidiness preference: before this pass, deleting the CPU
ceiling from the one route both vitest configs call passed every scenario of
the ticket's own acceptance feature.

**M5 is recorded as covered-elsewhere, not closed in acceptance, and not an
equivalent mutant.** It is genuinely killed by both the unit lane and the
property lane (measured above, not reasoned). Reaching the pool floor from
acceptance would require a second fixture host with RAM low enough that
`safeCount` is 0, i.e. a second Background contradicting the feature's single
pinned "memory-derived worker budget is 3 forks" premise. The invariant is
gated; the gate is simply not in this file. I record it explicitly rather than
let a silent omission read as a pass.

## Finding that leaves as a note, NOT as a bounce (spec-gap class)

**The delivered cap is inert on this host: `SWARMFORGE_PACK` is unset in every
live agent shell.**

The ticket's own premise is that no new wiring is needed — "SWARMFORGE_PACK is
already exported into every agent's environment (verified live 2026-08-19: a
role shell reports SWARMFORGE_PACK=full-forge)". That does not hold now.
Measured three independent ways:

1. My own role shell: `SWARMFORGE_PACK` is empty.
2. All **8** live sessions (`swarmforge-{QA,architect,cleaner,coder,coordinator,documenter,hardender,specifier}`):
   `tmux show-environment` reports `unknown variable: SWARMFORGE_PACK`.
3. Source trace: the only `export SWARMFORGE_PACK` statements in the repo are in
   the five alternative-provider wrappers (`start-swarm-{gpt,mistral,qwen,anthropic,gemini}.sh`),
   each setting a `*-mono-router` value — never `full-forge`. The default
   `start-swarm.sh` only **reads** it (`resolve_launch_pack`, line 135) and
   passes the resolved value as `--pack`, which `swarmforge/scripts/swarmforge.sh`
   consumes as a **config-file selector** (`swarmforge/packs/NAME.conf`), never
   re-exporting it. `PACK` is a plain local, never `export`ed.

So on a default-launched full-forge swarm the resolver reads `undefined`, the
pack rule never fires, and every agent's `vitest run` keeps the memory-derived
3 forks. The feature is correct, well-tested, and does not engage.

This is **not** a defect in the parcel and **not** a bounce: the code satisfies
its `required_wiring` (both configs call the resolver), and supplying the env
var is launcher behaviour — new product behaviour, outside my domain and
outside this ticket's declared scope. Per Article 4.4 it leaves as a `note`
(priority `00`) to the **specifier and coordinator** so it can be ticketed.

It also front-runs a QA bounce: this ticket's own `qa_e2e_procedure` step 1 is
"Confirm the pack signal the change keys off is really present in an agent
shell: `echo "$SWARMFORGE_PACK"` reports full-forge." On this host it reports
empty, so QA would hit it at step 1 with no context.

## Files changed by this pass

- `specs/pipeline/steps/bl935VitestForkPoolSteps.js` — drive the real route (H1); pin the value in scenario 02 (H2); `0`/`-1` override tokens (H3).
- `specs/features/BL-935-vitest-fork-pool-is-capped-under-a-live-full-forge-pack.feature` — scenario 02 asserts the capped value; two Examples rows for the zero/negative override halves.

No production source was touched.
