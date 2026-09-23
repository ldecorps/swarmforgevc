# Aider seats: context budget, silent truncation, and what never reaches the model

- stamped: 2026-09-23
- scope: Phase 0 (instrument only) of the plan to make aider local models work as swarm agents
- host: this WSL2 CPU host, Ollama 0.32.15, aider 0.86.2, live pack ollama-qwen2.5-coder-mono-router

## 1. Turn-1 budget of a coder seat, measured

Measured with aider's own `/tokens` (no model call), in a scratch worktree, with the
exact argv of the live coder seat and the files it holds after turn 1. The bootstrap
text names `swarmforge/runtime/handoff-draft.txt` and `swarmforge/scripts/ready_for_next.sh`,
so `--yes-always` auto-adds both as EDITABLE files before the first request.

| component | tokens |
|---|---:|
| aider system prompt | 456 |
| repo map | 996 |
| swarmforge/roles/coder.prompt | 3,392 |
| swarmforge/PIPELINE.md | 1,507 |
| swarmforge/scripts/ready_for_next.sh (auto-added, editable) | 449 |
| swarmforge/constitution.prompt | 390 |
| swarmforge/runtime/handoff-draft.txt | 54 |
| **total, before the bootstrap message** | **7,244** |

With the model metadata this change passes to aider, aider itself reports:
`948 tokens remaining in context window ... 8,192 tokens max context window size`.
Before it, aider had no window at all ("Input tokens: ~3,097 of 0" in an earlier pane).
The live seat's first request was logged as "Tokens: 7.7k sent". At the default
4,096 Ollama serves on a CPU host (the IQ3_S seats ran at 4,096 until mid-day), turn 1
is 177% of the window.

## 2. Ollama drops messages silently: confirmed

Controlled test on an ISOLATED Ollama instance (port 11435, scratch model store,
`qwen2.5:0.5b`, `OLLAMA_DEBUG=1`; the live instance and store were not touched).
Messages shaped like aider's: system, three files as user/"Ok." pairs, latest message.

- `num_ctx=2048`: prompt_eval_count 761 (everything).
- `num_ctx=512`: prompt_eval_count 291.
- 291 matches exactly one subset: **system + the newest file pair + latest message**
  (re-measured per subset with the same tokenizer/template). The two OLDEST files were dropped.
- The only trace: `level=DEBUG source=prompt.go:77 msg="truncating input messages which exceed context length"`.
  At the default log level the drop is invisible.

aider orders chunks `system, examples, read-only, repo map, history, added files, current,
reminder` (`aider/coders/chat_chunks.py`). So under pressure a seat loses its repo map and
conversation history first, then the whole added-files block (constitution, PIPELINE, role
prompt: ~5.8k tokens in one message, which cannot fit a 4,096 window at all), while aider's
own system prompt always survives. That prompt says the model *MUST* ask the user to add
any file it needs that is not in the chat (`editblock_prompts.py`). "Please paste the
handoff file / the BL-1687 entry" from the IQ3_S coder was that instruction, obeyed.

## 3. What never reaches an aider seat

- **Model settings.** `.aider.model.settings.yml` is untracked at the repo root; aider only
  looks in its own git root, i.e. the seat's worktree. Only the coordinator (at the root)
  ever read it: the same IQ3_S model ran "diff" format as coordinator and "whole" as QA,
  and the pack's required `think: false` never reached coder/QA. Fixed here: the launcher
  passes `--model-settings-file` / `--model-metadata-file` by absolute path.
- **The constitution.** Aider seats get `constitution.prompt`, a 390-token index that says its
  articles are "inlined right after this file". That is true for Claude seats (the prompt
  engine expands it) and false here: the 10 articles (364 KB) are never delivered, and the
  model has no way to open them.
- **An action channel.** aider runs shell commands only from fenced ```bash blocks in
  diff/editblock format (`editblock_coder.py`); `wholefile_coder.py` has none. A model reply
  line starting with `!` is inert text. The live qwen2.5-coder coder runs **whole** format.
  The only commands that ever run in an aider pane are the ones handoffd types into the REPL
  (`> ` prefix in captures). The coordinator comment "`!` still runs under --dry-run" holds
  for typed input, not for model output. So no aider seat can run merge_and_process,
  swarm_handoff.sh or done_with_current.sh itself.

## 4. Changed in this commit set

- Launcher (`swarmforge.sh`, aider case): absolute `--model-settings-file`,
  `--model-metadata-file`, and per-role `--llm-history-file` under
  `.swarmforge/aider-llm-history/` (test: `test/test_aider_seat_launch_config.sh`).
- Host-local (gitignored): `.aider.model.metadata.json` with `max_input_tokens` 8192 for
  `openai/qwen2.5-coder:latest`, matching what the live Ollama serves today. That value is
  only true while Ollama runs with `OLLAMA_CONTEXT_LENGTH=8192`, which nothing persists yet
  (see the ollama-supervision intake, INTAKE-operator-question-1790153120168).
- `coder-tool_capability_denial` withdrawn from the certification gate and the battery: it
  graded the aider-mandated "please add file X" as unsafe.

## 5. Loose ends found on the way

- The Let's Talk / Telegram local seat still uses IQ3_S (`SWARMFORGE_LOCAL_SEAT_MODEL` in
  `.swarmforge/swarm.env`); reverting the mono-router pack did not move it.
- `test_openrouter_provider_support.sh` fails identically on unmodified main (staffing gate,
  `seat-model-unresolved`); unrelated to this change.
- The live Ollama log is unreliable for today: a duplicate `ollama serve` start (bind
  failure) truncated the file the running server writes to.

## 6. Next, measured rather than guessed

- Room: qwen2.5-coder-7B's KV cache is about 30 KB/token at q8_0 (28 layers x 4 KV heads x
  128 dims x K+V), so a 32k window costs about 1 GB. Do it per model (a Modelfile variant
  with `PARAMETER num_ctx 32768`), not with the global `OLLAMA_CONTEXT_LENGTH`, which would
  raise the window, and the KV cost, of every model on the host, including the 12 GB IQ3_S.
- Content: coder.prompt alone is 47% of turn 1; a compact aider-specific role card, and not
  naming pipeline scripts in the bootstrap text (so aider stops auto-adding them as editable).
- Channel: the harness, not the model, runs the protocol steps (Phase 2 of the plan).
