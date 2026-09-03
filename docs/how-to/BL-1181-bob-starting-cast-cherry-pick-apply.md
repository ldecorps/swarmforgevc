# BoB starting cast — steward cherry-pick export and apply (BL-1181 / BL-1337)

*How-to. Epic BL-1180 quick-start slice — steward exports one certified model
per role and applies it through existing ModelFactory / pack surfaces. BL-1337
adds a second, profile-driven mode to the same CLI and lib: a named profile in
place of the hard-coded policy, and a handshake gating every pick before the
cast is offered as runnable.*

## What runs where

| Path | Module | Behaviour |
| --- | --- | --- |
| Export | `swarmforge/scripts/bob_starting_cast_lib.bb` | `export-bob-starting-cast` cherry-picks top certified recommendation per role |
| CLI | `swarmforge/scripts/bob_starting_cast_cli.bb` | `export` / `apply` verbs for operators |
| Apply orchestration | `extension/src/tools/bobStartingCastApply.ts` | Memory transfer for changed roles, then overlay write |
| Assignment | ModelFactory overlay or pack `--model` apply | Only allowed paths — no third assignment route |
| Memory | `agentMemoryTransfer.ts` (BL-1177) | Capture/inject before live work when apply changes a role's model |

Mixed vendors across roles are allowed in the export. Apply fails closed on
inject errors (same posture as BL-1178).

## Operator flow

```bash
bb swarmforge/scripts/bob_starting_cast_cli.bb export
bb swarmforge/scripts/bob_starting_cast_cli.bb apply --cast /path/to/cast.json
```

Export names exactly one `(provider, model)` per role from Model Steward
certified rankings. Apply writes through `model-factory-overlay` (or pack
model apply when that path is selected) and runs agent-memory transfer for
roles whose model changes.

## Profile-driven mode (BL-1337)

The unprofiled verbs above use one hard-coded policy
(`export-bob-starting-cast`) and never check whether a picked model is
reachable on this host. `--profile <name>` replaces both: the policy becomes
a named, steward-owned profile, and every pick must **handshake** — pass
registry eligibility, the profile's quality floor, its provider allow-list
and (unless the profile weakens the bar) host reachability — before it can
land in the cast.

```bash
bb swarmforge/scripts/bob_starting_cast_cli.bb export --profile mono-router-anthropic
bb swarmforge/scripts/bob_starting_cast_cli.bb apply  --profile mono-router-anthropic
```

Profile source: `.swarmforge/model-steward/profiles/<name>.json`.

```json
{
  "name": "mono-router-anthropic",
  "roles": ["coder", "cleaner", "architect"],
  "quality_floor": 0.5,
  "providers": [],
  "handshake": "registry-and-host"
}
```

| Field | Meaning |
| --- | --- |
| `name` | Required. Becomes the cast's `policy` and the note's evidence header. |
| `roles` | Required, non-empty. The seats to staff. |
| `quality_floor` | Minimum recommendation score a candidate must meet (`>=`, not `>`). Defaults to `0`. |
| `providers` | Optional allow-list; empty means no restriction. |
| `handshake` | `registry-and-host` (default) probes host credential presence too; `registry-only` skips that probe — the evidence note records this explicitly as the weaker bar it is. |

For each role, the walk goes down the role's ranked recommendations in order
and accepts the first candidate whose verdict is `:accepted`; a rejected
candidate keeps its verdict (`:provider-not-allowed`,
`:below-quality-floor`, `:not-assignment-eligible`, `:unreachable`) so the
evidence note can say why a seat landed on its second choice. Host
reachability is answered by the CLI (`host-reachable?` in
`bob_starting_cast_cli.bb`), never the lib: it checks that a provider's
credential env var is non-blank and returns a boolean, so no key value ever
enters a cast or a note; a provider the credential map doesn't recognise is
**not** assumed reachable (fail-closed).

A seat with no accepted candidate gets no entry in the cast at all — never a
`null`/`nil`-valued one — and the whole cast comes back `runnable? false`,
naming every unstaffable seat plus its full candidate trail
(`generation-failure-text`). `apply --profile` refuses to install a
not-runnable cast; a runnable one still goes through the same
`apply-via-modelfactory-overlay` door the unprofiled `apply` uses, so the
handshake gates the real apply path rather than a parallel one. Generating a
cast never touches the live pack config — it is always propose, not install.

## Verify

```bash
bb swarmforge/scripts/test/bob_starting_cast_test_runner.bb
bb swarmforge/scripts/test/bl1337_profile_cast_test_runner.bb
cd extension && npm test -- bobStartingCastApply
bash specs/pipeline/scripts/run_acceptance.sh \
  specs/features/BL-1181-bob-starting-cast-cherry-pick-apply.feature
bash specs/pipeline/scripts/run_acceptance.sh \
  specs/features/BL-1337-a-profile-generates-a-handshaken-cast.feature
```

Related: [BL-1177 portable payload](BL-1177-portable-agent-memory-payload-capture-inject.md);
[BL-1178 hot-swap wiring](BL-1178-wire-agent-memory-into-hot-swap-and-trial.md).
