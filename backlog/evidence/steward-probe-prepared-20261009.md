# Steward task: re-probe two local coder candidates through the prepare path

Requested by the human in the specifier's session, 2026-10-09, verbatim:
"Cursor passed down the libs... can you instruct steward to probe the 2
models using these libs?" Earlier the same evening: "let's get those other
models properlybtested first."

The specifier writes this brief; the coordinator assigns it as a discrete
Model Steward task (swarmforge/roles/model-steward.prompt: run on demand
when assigned, CLI only, from any role's worktree).

## The two models and their baseline

Both were probed on their bare Hugging Face tags at 17:45Z and 17:47Z and
handed off 0 of 5 scenarios (verdict fail):

- `hf.co/ISTA-DASLab/Qwen3.8-27B-GSQ-RCO-GGUF:IQ3_XXS`
  (backlog/evidence/local-coder-probe-hf.co-ISTA-DASLab-Qwen3.8-27B-GSQ-RCO-GGUF-IQ3_XXS-2026-10-09T17-45-49.824453591Z.md)
- `hf.co/slevinw/Qwen3.6-35B-A3B-GGUF:Qwen3.6-35B-A3B-IQ3_S-3.00bpw`
  (backlog/evidence/local-coder-probe-hf.co-slevinw-Qwen3.6-35B-A3B-GGUF-Qwen3.6-35B-A3B-IQ3_S-3.00bpw-2026-10-09T17-47-05.224235475Z.md)

## What to run

The prepare path Cursor landed in 1e64496d93 (local_model_prepare_lib.bb:
Modelfile from the frozen template, an Ollama alias, a think-off profile)
is what changes between the baseline and this run. One model at a time:

```
bb swarmforge/scripts/model_steward_cli.bb probe 'hf.co/ISTA-DASLab/Qwen3.8-27B-GSQ-RCO-GGUF:IQ3_XXS' --prepare
bb swarmforge/scripts/model_steward_cli.bb probe 'hf.co/slevinw/Qwen3.6-35B-A3B-GGUF:Qwen3.6-35B-A3B-IQ3_S-3.00bpw' --prepare
```

## Constraints

- The GPU is shared with the live local seats. Run when no local seat
  holds the decode slot (`curl -s 127.0.0.1:11439/shim/health`: `slot.holder`
  null), one probe after the other, never both at once.
- Data only: no `certify`, no pack window, no cold-swap, no day_shift
  default. Those stay human-gated (model-steward.prompt, Does Not Own).
- Commit the new `backlog/evidence/local-coder-probe-*` files the probes
  write (and the two baseline files above, still uncommitted at 19:45Z),
  and report each verdict (handed off N of 5) beside its 0 of 5 baseline
  to the human.
