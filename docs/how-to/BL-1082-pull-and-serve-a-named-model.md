# Pull and serve a named model on this host

Last Updated: 2026-08-23

The operator names a model; SwarmForge composes (and optionally runs) an
Ollama pull into a host store **outside** the tracked worktree, then serves
it behind a loopback OpenAI-compatible endpoint. Model identity is always a
parameter — the next model is a different id, never a second adapter.

Staffing a role seat against that endpoint is
**[BL-1052](./BL-1052-local-model-seat-launch.md)** (`local-model` agent +
`local-model-mono-router` pack). Routing work to a local-model seat is
**BL-1053**. Neither is covered here.

## Proven host (v1)

**Linux / WSL2 only** for this slice. macOS is deferred, not assumed.

First proof on this forge's WSL2 host used a 7B-class Qwen coder tag such as
`qwen2.5-coder:7b-instruct` (CPU-only host; pick the exact tag against what
Ollama publishes at pull time). A second id (for example `llama3.1:8b`) is
the same path with a different argument.

## Prerequisites

1. Ollama installed and on `PATH` (`ollama` binary).
2. Extension tools compiled so the CLI exists:

```sh
cd extension && npm run compile
```

3. Enough free disk under the model store (defaults to
   `~/.swarmforge/models/ollama`).

## CLI

From the forge repo root (or any cwd; pass `--repo` when you need the
store-outside-worktree check):

```sh
node extension/out/tools/named-model.js pull <model-id>
node extension/out/tools/named-model.js serve <model-id>
node extension/out/tools/named-model.js status
node extension/out/tools/named-model.js help
```

| Flag | Meaning |
|---|---|
| `--store <path>` | Host model store (default: `~/.swarmforge/models/ollama`) |
| `--repo <path>` | Tracked worktree root — refuse a store path inside it |
| `--endpoint <url>` | Loopback base URL (default: `http://127.0.0.1:11434`) |
| `--execute` | Run the composed `ollama` command; without it, print the plan only |
| `--present <id>` | Treat `<id>` as already in the store (repeatable; composition tests) |
| `--healthy` | Treat the endpoint as already healthy (serve reuse / composition) |

Default compose sets `OLLAMA_MODELS` to the store path on pull, and
`OLLAMA_HOST` to the endpoint host:port on serve.

## Recipe

### 1. Pull a named model

```sh
node extension/out/tools/named-model.js pull qwen2.5-coder:7b-instruct --repo .
```

Without `--execute`, the CLI prints the plan (or reports the model already
present). To download:

```sh
node extension/out/tools/named-model.js pull qwen2.5-coder:7b-instruct --repo . --execute
```

Re-run the same pull: if the model is already in the store, nothing is
downloaded and the model is reported ready.

An id the runtime does not know fails loudly and **names that id**.

### 2. Serve and check health

```sh
node extension/out/tools/named-model.js serve qwen2.5-coder:7b-instruct --execute
node extension/out/tools/named-model.js status
```

Ready output names a loopback OpenAI-compatible base URL (default
`http://127.0.0.1:11434`). Not-ready output names the endpoint it could not
reach — never a bare failure.

Requesting serve again against an already-healthy endpoint **reuses** it;
no second server is started on the same port.

### 3. Confirm weights stay out of git

```sh
git status
```

No weight, cache, or manifest path from the pull should appear as untracked
or modified under the forge worktree. The default store is under
`~/.swarmforge/models/ollama`. Passing `--store` inside `--repo` is refused.

## Out of scope here

- Installing or configuring a role pack that *staffs* a seat on this endpoint
  ([BL-1052](./BL-1052-local-model-seat-launch.md)).
- Intelligence-layer routing to a local-model seat (BL-1053).
- GPU offload, multi-model concurrent serve, or a second runtime backend.
