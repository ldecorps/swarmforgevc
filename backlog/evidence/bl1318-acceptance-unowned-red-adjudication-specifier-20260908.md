# BL-1318 acceptance feature: unowned red, adjudication (specifier, 2026-09-08)

Inbound: coder note, priority 00, 2026-09-08T03:00:18Z, "unowned-red
bl1318PackStaffingGateSteps.js inherits pane PACK_STAFFING_SKIP_GATE",
raised from the BL-1445 parcel (forwarded to the cleaner at 03:01Z) whose
e2e step 2 runs BL-1318's feature. Handled the same pass under the
standing-red rule (2026-09-05). Outcome: **BL-1485 minted** (paused), owner
of one `acceptance` register row (BL-1318's feature).

## Reproduction on main `3dfa366fd9` (master checkout)

    specs/pipeline/scripts/run_acceptance.sh specs/features/BL-1318-pack-launch-steward-staffing-gate.feature

| environment | result |
|---|---|
| `PACK_STAFFING_SKIP_GATE=1` (every role pane, swarm.env line 46) | `# pass 3`, `# fail 4`: rows 01 [1] [2] [3], 02 not ok |
| `env -u PACK_STAFFING_SKIP_GATE` | `# pass 7`, `# fail 0` |

Cause: `runRealParse` (handler lines 195-201) spawns zsh with
`{ ...process.env, MODEL_STEWARD_STATE_DIR, ...extraEnv }`; only the
override row (line 278) sets the variable, so the refusal rows inherit the
pane's `=1`, the launcher (swarmforge.sh 567-608) warns OVERRIDE instead of
refusing, and the rows that assert a refusal fail. The gate CLI never reads
the variable (lib line 173 is a comment). Red since the hatch entered
swarm.env (~2026-09-04); hidden by the per-feature runner; green in every
offline shell, so no offline expedite ever saw it.

## Why not BL-1445 or BL-1457

BL-1445 (active, cleaner) scopes its scenario 02 to
`swarmforge/scripts/test/*.sh`; BL-1457 (paused, approved) scopes its
invariant 1 to `extension/test`. Neither names a step handler. BL-1445 is
in flight (BL-317/BL-325: never rewrite an active ticket) and BL-1457 is
approved (BL-1455: a re-pend posts no fresh ask), so a third-lane ticket is
the only route that can be approved. Note to the coder: BL-1445's e2e step
2 ("BL-1318's feature stays green") reads red in a pane for this reason
alone; with the register row naming BL-1485 the red is owned and Article
4.2 does not hold BL-1445.

## Mint-time sweep: every handler that drives parse_config, both ways

`grep -ln parse_config specs/pipeline/steps/*.js` = 19 handlers. Each
BL-prefixed one's feature run under `env -u PACK_STAFFING_SKIP_GATE` and
under `=1` from the master checkout on `3dfa366fd9`:

| feature | unset | set (=1, the pane) | class |
|---|---|---|---|
| BL-1318 pack-launch-steward-staffing-gate | 7/7 ok | 4 fail | **BL-1485** (asserts refusal; inherits the hatch) |
| BL-1324 claude-seat-qwen-cloud-context-window | ok | ok | hermetic: pins `env.PACK_STAFFING_SKIP_GATE = '1'` (line 181) |
| BL-1108 cursor-seat-readiness-hotfix | ok | ok | no gate dependency |
| BL-1078 cursor-agent-token | ok | ok | no gate dependency |
| BL-1299 reverse-hop-skips-master-resident-roles | ok | ok | no gate dependency |
| BL-448 mono-rotate-pack | ok | ok | no gate dependency |
| BL-1052 local-model-seat | 5 fail | ok | passes only WITH the hatch (BL-1457 shape) -> BL-1486 |
| BL-1218 config-off-over-window-flag | 7 fail | ok | same -> BL-1486 |
| BL-1320 operator-step-for-adding-a-seat | 3 fail | ok | same -> BL-1486 |
| BL-1418 art-director-seat-is-addressable | 7 fail | ok | same -> BL-1486 |
| BL-961 launcher-exports-pack-into-role-shells | 4 fail | ok | same -> BL-1486 |
| BL-628 bare-host-bootstrap | 1 fail | ok | same -> BL-1486 |
| BL-939 two-pack-smoke-check | 4 fail | 4 fail | red in the pane, NOT the hatch - separate owner |
| BL-982 second-seat-of-a-stage | 6 fail | 1 fail | 1 row red in the pane (separate owner); 5 more only without the hatch (-> BL-1486) |

Five handlers with no BL prefix in the file name (coordinatorProvisioning,
coordinatorProviderConfigurable, coordinatorModelConfigurable,
swarmSocketNotInTmp, syncWorktreeScriptsNeverClobbers) were not mapped to a
feature by this sweep; BL-1486's scenario derives its set by grep at test
time and covers them if they qualify.

## Decisions

- BL-1485: one ticket, one handler, fix direction UNSET-for-refusal /
  SET-for-override (BL-1445's shape). Register row added at mint.
- The six pass-only-with-the-hatch features: the opposite fix direction
  (pin the hatch explicitly in the spawn, bl1324's shape - BL-1457's
  direction), so a separate ticket, BL-1486, minted the same pass.
- BL-939 and BL-982 rows red in the pane: unowned standing reds found by
  this sweep, adjudicated separately the same pass.
