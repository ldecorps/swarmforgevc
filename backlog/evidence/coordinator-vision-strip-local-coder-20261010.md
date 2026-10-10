# Coordinator note: strip vision/projector from local-coder prepared aliases

2026-10-10, by the coordinator, operator directive ("Yes and bake that in
the prepare lib so that next time the projector/vision are stripped off
straight away").

## Problem

`hf.co/slevinw/Qwen3.6-35B-A3B-GGUF:Qwen3.6-35B-A3B-IQ3_S-3.00bpw` (and its
`prepared-slevinw-...` alias) ships a bundled CLIP vision projector
(`application/vnd.ollama.image.projector` layer, 902,822,240 bytes) that
`local_model_prepare_lib.bb`'s `prepare!` currently carries straight through
into the prepared alias. The coder seat is text/code-only — the projector is
dead VRAM weight with no consumer.

Manifest showing the two layers (`~/.ollama/models/manifests/hf.co/slevinw/
Qwen3.6-35B-A3B-GGUF/Qwen3.6-35B-A3B-IQ3_S-3.00bpw`):

```json
"layers": [
  {"digest": "sha256:fba3d8c9d782401940755383c9d20f5a4f3398cab24579e196f84f331440cfdf",
   "mediaType": "application/vnd.ollama.image.model", "size": 13014656416},
  {"digest": "sha256:1c625f05cd52e90abc76a5f756226c3a5fe279593379c22f6c6846c970a0cd18",
   "mediaType": "application/vnd.ollama.image.projector", "size": 902822240}
]
```

## Fix verified live (manual, not yet in the lib)

Pointing `FROM` at the bare model blob file (not the tag, not a path with
the projector attached) excludes the projector entirely:

```
FROM /home/carillon/.ollama/models/blobs/sha256-fba3d8c9d782401940755383c9d20f5a4f3398cab24579e196f84f331440cfdf
PARAMETER num_ctx 65536
PARAMETER num_predict 4096
```

`ollama create prepared-slevinw-qwen3.6-35b-a3b-gguf-qwen3.6-35b-a3b-iq3-novision:latest -f Modelfile`
then `ollama show` on the result lists `Capabilities: tools, thinking,
completion` only — no `vision`, no `Projector` section — versus the
vision-carrying alias which lists `vision` plus a `Projector` section
(`architecture clip, parameters 446.57M, embedding length 1152, dimensions
2048`).

## Context-window headroom gained

- Freed VRAM ≈ 861 MiB (projector blob size).
- KV cache cost computed from the model's own architecture
  (`qwen35moe.attention.head_count_kv=2`, `block_count=40`, head_dim=128
  from `embedding_length/head_count` = 2048/16, q8_0 cache = 1 byte):
  `2 (K+V) × 40 × 2 × 128 × 1 byte = 20 KiB/token`.
- Live GPU readout (RTX 5060 Ti, 16311 MiB total) with vision + ctx 32768:
  14259 MiB used / 1794 MiB free.
- Doubled `num_ctx` to 65536 (KV cost ~1.28 GiB) on the no-vision alias and
  it landed at 13549 MiB used live — lower than the OLD vision-carrying
  32768-ctx footprint (14259 MiB), despite double the context.
- Headroom math put 98304-131072 ctx as plausibly reachable too, but that
  wasn't load-tested live; 65536 is the one actually running now.

## What the ticket should do

In `swarmforge/scripts/local_model_prepare_lib.bb`'s `prepare!`:
1. Resolve `base`'s manifest, identify the `application/vnd.ollama.image.model`
   layer's blob digest (skip any `application/vnd.ollama.image.projector`
   layer), and render the Modelfile's `FROM` against that bare blob path
   instead of the tag — so a multimodal base's projector is never carried
   into the prepared alias, period (not slevinw-specific).
2. Decide (and record in the ticket) whether `num_ctx`'s default should stay
   32768 or whether `prepare!` should probe freed headroom and raise it —
   my live change was a manual one-off, not derived by the lib.
3. A real acceptance scenario: prepare a vision-capable base through the
   lib, assert `ollama show <alias>` lists no `vision` capability and no
   `Projector` section, with a fake/stubbed `ollama` (per the model's own
   "never a real ollama create" testing rule).
4. Live alias already swapped by hand (not through this lib) at
   `swarmforge/packs/full-forge.conf`'s `window coder` line, pointing at
   `prepared-slevinw-qwen3.6-35b-a3b-gguf-qwen3.6-35b-a3b-iq3-novision:latest`
   — once the lib does this by default, a future `prepare!` call for the
   same base tag should naturally reproduce (and could replace) this
   hand-built alias.
