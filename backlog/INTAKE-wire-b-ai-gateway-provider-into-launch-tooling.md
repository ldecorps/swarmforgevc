# INTAKE — Wire the b.ai gateway (tencentcloud2/glm-5.3-flash) into launch tooling

**Source:** coordinator, 2026-09-08, following an operator request to build
and start a GLM mono-router pack (GLM on every seat except specifier, which
stays `anthropic/claude-fable-5-1`).
**Status:** new intake, not minted
**Priority:** high — blocks starting the requested pack; no other work
depends on it today, but the operator wants to launch as soon as this lands.

## What already happened (no re-derivation needed)

- `tencentcloud2/glm-5.3-flash` is now `certified` in the model steward
  registry for coder/cleaner/architect/hardender/documenter/QA, via a live
  battery run against the b.ai gateway (`https://api.b.ai/v1`,
  `B_AI_API_KEY`, already exported in `~/.zshenv`): the coder-task-01
  wordFrequency fixture (implement + refactor, both green), a substantive
  architect review note, a documenter commit touching both doc+code, and a
  QA verdict matching the real `run_acceptance.sh` outcome on
  `specs/features/BL-1445-...feature`. Evidence:
  `.swarmforge/model-steward/evidence/tencentcloud2-glm-5.3-flash-all-roles-20260908.json`
  (gitignored runtime state — re-derivable from this description, not lost
  if unreadable).
- `anthropic/claude-fable-5-1` is now `certified` for `specifier` the same
  way (a Gherkin feature-authoring task, clean `gherkin_lint_gate.sh`
  parse). Evidence:
  `.swarmforge/model-steward/evidence/anthropic-claude-fable-5-1-specifier-20260908.json`.
- `docs/reference/model-compatibility.md` regenerated and committed
  (`6caa0e402c`) to reflect both.

## What is missing — two real code gaps, not registry data

1. **`swarmforge/scripts/pack_staffing_gate_lib.bb`'s `api-base-host-providers`
   table** (around line 62) only maps `api.deepseek.com` and Alibaba's
   Token Plan host to a steward provider. It has no entry for `api.b.ai`.
   Without one, `resolve-seat` returns `:unresolved` for any window line
   using `--openai-api-base https://api.b.ai/v1`, and the launch gate
   refuses the seat (`seat-model-unresolved`) even though the model is
   certified. Needs: `"api.b.ai" "tencentcloud2"` added to that table.

2. **`swarmforge/scripts/swarmforge.sh`'s pane-launch provider-env
   injection** (the block around line 2190-2246 that builds
   `provider_env_flags` per seat) hardcodes cases for Qwen Token Plan,
   DeepSeek, Perplexity, and local-model endpoints, mapping each provider's
   own secret env var (`QWEN_API_KEY`, `PERPLEXITY_API_KEY`, etc.) onto the
   pane's `OPENAI_API_KEY`/`OPENAI_API_BASE`/`OPENAI_BASE_URL`. There is no
   case for `api.b.ai`. Without one, a window line pinning
   `--openai-api-base https://api.b.ai/v1` boots an aider pane with no
   `OPENAI_API_KEY` in its environment at all (`B_AI_API_KEY` sits unused
   in the shell), and the seat fails to authenticate on its first live
   call. Needs a case detecting `*api.b.ai*` in the window's extra-cli args
   (mirroring the existing DeepSeek/Perplexity host-sniffing pattern) that
   injects `OPENAI_API_KEY=${B_AI_API_KEY}`,
   `OPENAI_API_BASE=https://api.b.ai/v1`,
   `OPENAI_BASE_URL=https://api.b.ai/v1` — gated on `B_AI_API_KEY` being
   set, same as the Perplexity/Qwen cases guard on their own key.

## Verification path once both land

`swarmforge/packs/glm-mono-router.conf` (not yet authored — the specifier
or coder can author it alongside this fix, or the coordinator will once
this ticket closes) with GLM (`openai/glm-5.3-flash`,
`--openai-api-base https://api.b.ai/v1`) on coder/cleaner/architect/
hardender/documenter/QA/coordinator, and
`claude-fable-5-1` on specifier, should launch via
`SWARMFORGE_PACK=glm-mono-router ./start-swarm.sh` with the staffing gate
resolving every seat to `pass` (not `override`, not `refuse`) and the
first live aider call in each role's pane succeeding without a "Wrong API
Key"/missing-key error.

## Constraints

- Never write `B_AI_API_KEY` into any committed file, pack conf, or launch
  script — env var only, same discipline as every other provider key in
  this repo.
- Do not touch the Qwen/DeepSeek/Perplexity/local-model cases already in
  either file — additive only.
