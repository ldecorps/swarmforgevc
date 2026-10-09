# Brief: Shared local-model prepare (Modelfile + think-off) for recruiter and steward

**Artifact**: SwarmForge local-coder onboarding / bakeoff path
**Surface**: `model_steward_cli.bb`, `recruiter_weekly.sh`, BL-1700 probe
**Filed**: 2026-10-09 (human via Cursor)

## What's wrong, as a human sees it

Bakeoffs of new HF GGUFs (XXS, Qwen3.6, …) were probed as bare tags. Live iq3
needs a Modelfile (`num_ctx` / `num_predict`) and think suppression. Empty
implement turns (~8s, `no model commit`) looked like “model useless” when the
harness/profile was wrong. A prior Cursor session claimed to land a shared
prepare lib; the files were not on disk afterward.

## What was rebuilt (draft implementation, this checkout)

Human directive: rebuild the lost work, then pass to specifier.

| Path | Role |
|---|---|
| `swarmforge/scripts/local_model_prepare_lib.bb` | Shared mechanics |
| `swarmforge/scripts/local_model_prepare_cli.bb` | Thin CLI |
| `swarmforge/packs/local-coder-prepare.Modelfile.tmpl` | Frozen template |
| `swarmforge/scripts/test/local_model_prepare_lib_test_runner.bb` | Unit tests (green) |
| `model_steward_cli.bb` | `prepare … [--reprobe]`, `probe … [--prepare]` + one empty-response retry |
| `model_steward_coder_probe_lib.bb` | `--model-settings-file` for think:false |
| `recruiter_weekly.sh` | Prepare after pull; battery/certify prepared alias (never staffs) |
| Steward prompt + BL-547 / BL-1700 how-tos | Owns / does-not-own + run notes |

Verified locally: `local_model_prepare_lib_test_runner.bb` ALL CHECKS PASSED;
`model_steward_coder_probe_lib_test_runner.bb` ALL PASS; dry-run CLI writes
Modelfile + profile.

## Standing ownership (do not invert)

| Actor | Owns | Does not own |
|---|---|---|
| Recruiter | Invoke prepare after pull | Certify, pack rewrite, seat bind |
| Steward | Probe / certify / bakeoff re-probe | HF discovery |
| Shared lib | Modelfile, `ollama create`, think-off profile | Live pack cold-swap |

Still human-gated: pack window / cold-swap / day_shift.

## What the specifier is asked to do

Mint (INVEST) or refuse-with-reason ticket(s) that:

1. Give the prepare path a real acceptance feature / qa_e2e (dry-run + wiring
   assertions; never require a live ollama create in CI if the host lacks it).
2. Decide whether the draft implementation in this tip is the parcel body
   (coder lands/amps) or must be re-done under a minted slice.
3. Cross-link paused [BL-1956](../../backlog/paused/BL-1956-a-how-to-for-onboarding-a-new-local-open-weight-model.yaml)
   (onboarding how-to) so prepare is named in the next-model runbook when that
   ticket ships — without expanding BL-1956's doc-only scope in this mint.
4. Leave out of first slice (name as follow-ups if wanted): pack conf
   generation, shim/qwen seat-stack as the only bar, VRAM/KV host tuning apply,
   cold-swap automation.

## Operator commands (for humans / steward after mint)

```bash
bb swarmforge/scripts/model_steward_cli.bb prepare 'hf.co/org/repo:TAG' --reprobe
# or
bb swarmforge/scripts/model_steward_cli.bb probe 'hf.co/org/repo:TAG' --prepare
```
