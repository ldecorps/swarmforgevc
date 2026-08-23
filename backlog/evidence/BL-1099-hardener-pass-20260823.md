# BL-1099 — hardener pass — 20260823

## Context

Received from architect (`c6bdbb4408`, Article 4.4 inventory NONE). Merged into
the hardener worktree as `aaf82cb593` (merge commit also names BL-1097/BL-1100
because the tip carried their `paused → hold` moves; `hold/` is outside
BL-901's survivor path set). Parcel task name is BL-1099 only.

## BL-149 cooldown gate

```
bb swarmforge/scripts/mutation_cooldown_gate.bb <root> \
  specs/pipeline/scripts/bl1099GiveUpCooldownRetirement.js
DECISION: run
file_age_days: 20688.48 (cooldown: 3 days)   # no history on main yet (BL-463)
load_avg: ~1.8–2.6 cores: 20 busy_threshold: 2.00x (quiet)
```

Brand-new helper (first pipeline landing) → eligible. Host quiet.

No `extension/src/**` production change for BL-1099 (architect inventory);
CRAP/DRY/Stryker (scoped to `extension/src` → `out/`) do not apply to the
parcel's helper. BL-1087's `namedPackConfDrift.ts` rode along in the cleaner's
multi-ticket commit but is not this parcel's task.

## BL-113 soft Gherkin acceptance mutation

```
bash specs/pipeline/scripts/run_gherkin_mutation.sh \
  specs/features/BL-1099-retire-the-superseded-giveup-cooldown-scenario.feature \
  tmp/bl1099-gherkin-mutation \
  specs/pipeline/steps/index.js \
  soft
```

Result (embedded manifest, `tested_at: 2026-08-23T11:28:30Z`): **8/8 killed,
0 survived, 0 errors** on the Scenario Outline's four Examples rows × two
columns. Case-flip mutants fail the `KNOWN_*` step anchors (BL-421/BL-908).
Manifest committed into the feature file.

## Hand-authored surgical sweep — `bl1099GiveUpCooldownRetirement.js`

Stryker cannot see `specs/pipeline/scripts/` (mutate is `out/**` from
`extension/src`). Per BL-638 / BL-567: 16 single-edit mutants against the
working copy, restored between trials; unit + property suites as oracles.

| mutant | result |
|---|---|
| knownElapsed: drop throw | killed (unit) |
| knownProcessState: drop throw | killed (unit) |
| listScenarios: skip body append | killed (unit) |
| bodyMentionsNotElapsed: always false | killed (unit) |
| bodyMentionsElapsed: drop not-elapsed exclusion | **equivalent** (see below) |
| bodyMentionsProcessState: dead always matches | killed (unit) |
| bodyHasProcessStateExample: always false | **equivalent** (see below) |
| bodyAssertsSupervisorDecision: always true | killed (unit) — new test |
| scenarioCoversCase: drop decision gate | killed (unit) — same test |
| scenarioCoversCase: not-elapsed ignores process state | killed (unit) |
| ELAPSED_REARM cover: never re-arm | killed (unit) |
| extractDefinePatternSources: return empty | killed (unit) |
| patternReferencedInFeatureTexts: always true | killed (unit) |
| orphanedRegistrations: always empty | killed (unit) |
| hasScenarioNamed: always true | killed (unit) |
| expandAlternationFragments: never expand | killed (unit) |

**Final: killed=14, survived=0 (non-equivalent), skipped=0.**

### Survivors closed this pass

`bodyAssertsSupervisorDecision: always true` and `scenarioCoversCase: drop
decision gate` both survived the coder's suite: the existing decision-less
fixture omitted process-state text, so the decision guard was never the
failing conjunct. Added a case in
`extension/test/bl1099GiveUpCooldownRetirement.test.js` — not-elapsed +
`dead`, no decision wording. Both mutants now red on that test; restored
source byte-identical after the sweep.

### Equivalent mutants (BL-234 — code-level reason)

1. **`bodyMentionsElapsed: drop not-elapsed exclusion`** — the comment claims
   `/has elapsed/` also matches `"has not elapsed"`. Empirically it does not
   (`/has elapsed/.test('has not elapsed') === false`, same for
   `"has not yet elapsed"` / `"has not elapsed yet"`). With the current
   `ELAPSED_RE`, the `!bodyMentionsNotElapsed(body) &&` conjunct is dead.
   No assertion can distinguish the mutant; not a test gap.

2. **`bodyHasProcessStateExample: always false`** — `bodyCitesProcessState`
   is `mentions OR examples`. Example cells with `dead` / `still alive` are
   already matched by `bodyMentionsProcessState` over the same body string
   (`\bdead\b` / `still alive`), so the Examples-only helper is subsumed.
   Demonstrable redundancy, not a coverage hole.

## Verification (fresh this pass)

| check | result |
|---|---|
| `vitest` BL-1099 unit | 11/11 |
| `vitest` BL-1099 property (`test:properties` lane) | 2/2 |
| `run_acceptance.sh` BL-1099 | 7/7 |
| `run_acceptance.sh` BL-303 | 1/1 (healthy-uptime only) |
| `run_acceptance.sh` BL-1088 | 5/5 |
| standing Guard tests (13 files; steps touched) | 125/125 |

## Orphaned processes

None. `pgrep` for vitest/stryker/mutation workers scoped to this worktree was
clean after the pass; helper restored after every mutant; gherkin work dir
left under `tmp/bl1099-gherkin-mutation` (scratch only).

## Forward

Hardening commit (this evidence + decision-gate killer + Gherkin manifest) →
documenter, priority 00.

By hardener.
