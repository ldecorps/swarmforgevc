# QA's review-time entangled-tip check uses a baseline already falsified a day earlier

Recorded 2026-08-29 by the specifier, from QA's `note` (priority 00) to
specifier+coordinator, 2026-08-29T01:29:56Z: *"2 tickets bounced this pass for
entangled tip (BL-506) - see their evidence"*.

## The measurement QA ran

- BL-1247 (`BL-1247-qa-bounce-20260829.md`): `git diff --name-only origin/main b5f2489906 | wc -l` → **46**.
- BL-1238 (`BL-1238-qa-bounce-20260829.md`): `git diff --name-only origin/main...2d68050646 | wc -l` → **66**.

Both bounced as `behavior` / BL-506 entangled tip.

## The measurement is dominated by a lag that has nothing to do with either author

`git rev-list --left-right --count main...origin/main` → **28 47**. Local
`main` carries 28 commits `origin/main` has never seen; those 28 commits touch
**43 paths**. Intersecting that set with each bounced tip's path list:

| ticket | paths QA counted | explained by local-`main` lag | remainder |
|---|---|---|---|
| BL-1247 | 46 | **37** | 9 |
| BL-1238 | 66 | **38** | 28 |

Of BL-1247's remaining 9: four are the ticket's own scope
(`extension/test/bl593MutationRunTelemetry.property.test.js`,
`extension/test/support/bl593ScopeArb.js`,
`specs/pipeline/steps/bl1247PropertyGeneratorDomainAgreementSteps.js`,
`specs/pipeline/steps/index.js`), two are its own `backlog/evidence/` paperwork,
and three are BL-1238's. **Genuinely foreign: three paths, not forty-six.**

Of BL-1238's remaining 28: the bulk is BL-1238's own scope
(`idle_clear_fullness_*`, `bl1238*`) plus BL-1222 and BL-1242 — both of which
**QA itself landed in this same pass** (`1d5874a4d`, `b6cb7a951`). Sibling work
a reviewer has just approved and landed is not contamination.

## Why this baseline was already known to be wrong

`swarmforge/scripts/task_scope_gate_lib.bb` — the send-time gate BL-1192 landed
on 2026-08-28 — carries this in its own header comment:

> BL-1192 architect bounce D1 (2026-08-28): the literal `origin/main...commit`
> range explodes into a false-positive avalanche on this repo's real git
> topology … `origin/main` lags local work by design … verified against this
> repo's own real cleaner batch turn, commit `b033583c08`: `origin/main...commit`
> showed 64 paths across ~6 tickets; this scope shows 1.

The correction was applied to the automated gate and to nothing else. The
review-time check is hand-rolled at the QA seat, and `swarmforge/roles/QA.prompt`
contains **no** occurrence of `entangl`, `BL-506`, `out-of-scope`, `task_scope`,
or any diff-baseline instruction — grepped 2026-08-29. So there is no wording
for the corrected basis to have been written into, and nothing pointed QA at
`task_scope_gate_lib.bb`.

Both parcels had already **passed** that corrected gate at send time —
`task_scope_gate_lib.bb` is invoked from `swarm_handoff.bb`, so a blocking
verdict would have refused the documenter's handoff before either reached QA.
Two checks for one property, disagreeing, with the falsified one holding the
veto.

## What this is not

- **Not a criticism of QA's judgement.** With no prompt guidance for the check,
  `origin/main` is the obvious baseline to reach for, and refusing to land
  unreviewed work is the conservative call.
- **Not a claim that either bounce should be reversed.** Those are QA's
  verdicts to revisit against a corrected basis, per BL-1241's `out_of_scope`.
  BL-1247's tip does additionally carry a real retired-ticket resurrection
  (`BL-1247-retirement-never-landed-on-main-20260829.md`).
- **Not BL-1241.** That ticket owns what the LAND step does when siblings are
  *legitimately* entangled and the bounce reaches someone who cannot act. This
  finding is upstream of it: a large share of the entanglement being measured
  was never entanglement.
- **Not the `main`/`origin/main` divergence itself.** That is BL-891, and the
  standing human directive closes the specifier-push option
  (`ANSWER-2026-08-28-restart-gate-hold-do-not-push.md`). Cited here only as
  the mechanism that makes the baseline wrong.

Minted as **BL-1257**.

By specifier.
