# Staff a role seat with a downloaded local model

Last Updated: 2026-10-06 (BL-1992: a third missed write releases the parcel to another coder seat)

Pull and serve the model first ([BL-1082](./BL-1082-pull-and-serve-a-named-model.md)).
This guide staffs every mono-router window with the **`local-model`** agent
against that loopback OpenAI-compatible endpoint. Routing work to the seat
is [BL-1053](./BL-1053-route-work-to-a-local-model-seat.md).

## What this is (and is not)

| | |
|---|---|
| **This pack** | `swarmforge/packs/local-model-mono-router.conf` — agent token `local-model`, shell-capable, model id on the window line |
| **Not this pack** | `qwen-mono-router.conf` — agent `aider`, file-editor shape, no autonomous shell. Keep both; pick by what the seat must **do**, not by the model catalog they may share. What an aider seat receives at launch: [BL-1697's how-to](./BL-1697-local-parcel-driver.md#what-an-aider-seat-receives-at-launch-bl-1699) |
| **First-quest binary** | `qwen` from `@qwen-code/qwen-code` (OpenAI-compat auth against loopback). The agent **token** stays `local-model`; babysitter/`./swarm ensure` look for argv needle `qwen` via `agent_process_marker_lib.bb` |
| **Not the old qwen-code seat** | The withdrawn `qwen-code-mono-router` / Token Plan cloud path was superseded; see `backlog/evidence/BL-1052-BL-1053-supersede-disposition-20260823.md` |

Invariants: a capability entry describes the **agent**, never the model;
swapping to a second downloaded model is a window-line `--model` change
only; secrets never land in the pack, generated launch script, or prompt.

## Prerequisites

1. BL-1082 pull + serve for the model id you will put on the window line
   (default first quest: `qwen2.5-coder:7b-instruct`). OpenAI-compat base
   URL ready at loopback (default `http://127.0.0.1:11434/v1`; override with
   `SWARMFORGE_LOCAL_MODEL_ENDPOINT_URL`). The seat's own requests do not
   reach that endpoint directly — see "A local-model seat's requests go
   through a tool-call shim (BL-1917)" below — but the window-gate reads
   and the health check named here still read Ollama's own endpoint. The
   launcher forces `OPENAI_API_BASE` / `OPENAI_BASE_URL` to the seat's URL
   in the pane — never a Token Plan cloud host.
2. `qwen` on `PATH` (`npm i -g @qwen-code/qwen-code`).
3. No cloud provider API key required. An optional local OpenAI-compat
   client token may sit in the launching environment and reaches the pane
   only via tmux `-e` (BL-130) — never written into pack or launch files.

## Launch

```sh
source ~/.zshenv   # or whatever exports optional local client token
SWARMFORGE_TERMINAL=none ./swarm <scratch-root> --pack local-model-mono-router
```

Every role window names agent `local-model` and a `--model <id>`. Launch is
**refused** when the local endpoint health check is not ready — the refusal
names the endpoint.

### A local-model seat's qwen runs interactive (BL-1845)

Before this fix, the launch handed qwen its kickoff as a bare argument;
qwen 0.22.2 copies a bare argument into `--prompt`, and any `--prompt`
runs one headless pass — no screen, no keyboard. On 2026-09-30 the
coder@iq3 pane showed nothing of qwen's work, had no input box for the
human to steer it, and never read the wakes handoffd typed into it — the
seat picked up new mail only when relaunched (six qwen runs between
15:36 and 16:14 BST that day).

The launch now hands the kickoff to qwen as the value of `-i`
(`--prompt-interactive`) instead: `qwen --auth-type openai -y <cli> -i
"<kickoff>"`. qwen opens its interactive screen with the kickoff as the
first message, so the pane shows its tool-call lines and keeps a text
input box, the same qwen process spans multiple turns (no new
RESUME-ON-START chat record every parcel), and a typed wake reaches a
live `ready_for_next.sh` call instead of sitting unread until the next
relaunch. The kickoff text itself, including the resume note when the
seat's `in_process` mailbox holds a parcel, is unchanged — only how it
reaches qwen changes. `-y` still stays, so qwen still runs shell commands
unattended. Every other agent's generated launch script is
byte-identical before and after this change. qwen's own auto-update
stays on (the human's ruling): an interactive qwen installs updates
under `~/.qwen/updates/npm/` and runs them from its next launch.

### A local-model seat's card path never carries an "@" (BL-1837)

qwen (and gemini, which shares its handling) reads `@<path>` in a prompt
as a file reference and rewrites it before the model ever sees it. A
seat named `coder@iq3` had its kickoff name the compact card (BL-1798) at
the bare path `.../prompts/coder@iq3.md`; qwen's own record of each
2026-09-30 `coder@iq3` session shows the first user message reading
`.../prompts/coder @iq3.md` — a space inserted before `@iq3.md` — so
every session's first `read_file` failed with "File not found", globbed
`.swarmforge/prompts/*`, and only then read the card (two of three
sessions went on to also read the constitution, PIPELINE, and the role
prompt, which the kickoff's own generic wording invited).

`role_prompt_card_path(role, agent)` in `swarmforge.sh` is now the single
source of truth for where a role/agent's card lives: for agent
`local-model` it maps every `@` in the role name to `-` before joining
`$PROMPTS_DIR` (`coder@iq3` → `.../prompts/coder-iq3.md`), and every other
agent's card path is unchanged (a Claude seat named `coder@2` still gets
`.../prompts/coder@2.md`). `write_agent_instruction_file`'s callers and
`write_role_launch_script`'s own `prompt_file` all compute the path
through this one function, so a future agent's own "@"-sensitivity is a
one-line change, not several call sites. The local-model kickoff's
parenthetical also no longer describes the file as "(constitution,
pipeline, role, pack)" — the generic composition's own wording, not the
compact card a local-model seat actually gets — saying "(your card)"
instead.

`handoff_lib.bb`'s `prompt-file-path` (used by `recompose-role-prompt!`
on a BL-911 idle-boundary respawn or a rotation) is a separate,
bb-side reader of the same path — a different language than
`role_prompt_card_path`, so it cannot call through it and must agree
with it independently instead (a QA bounce, 2026-10-01, caught the first
pass leaving it unmapped: a respawned `coder@iq3` recomposed the dead
pre-fix `coder@iq3.md`, not the card the launch script actually reads).
It now takes the same `(role, agent)` shape and applies the identical
`@`-to-`-` mapping for agent `local-model` only, with a test asserting
the bash and bb mappings agree (BL-897's constant-across-a-language-
boundary rule). `respawn_bootstrap_lib.bb` carries the same unmapped
shape but is never reached for a local-model seat (its bootstrap style
is `:embedded`, not the bootstrap-step style that function serves), so
it is left as-is.

### A local-model seat runs with a short system prompt (BL-1952)

qwen's own base prompt (about 17.5k characters) plus its tool
declarations (about 15k characters) left a seat's fixed, every-request
overhead at 12487 tokens before it had read a single ticket file — more
than a 1200-char compaction-dead-zone bounce could fit under the
27852-token compaction trigger before the seat even had room to write.

The generated launch script exports `QWEN_SYSTEM_MD`, pointing at the
master checkout's `swarmforge/roles/local-model/qwen-system.md` (1680
chars) — never the worktree's own copy, so it doesn't drift with
whatever parcel line the seat holds. qwen reads that export and replaces
its own base prompt with the named file's contents instead of appending
to it. A captured first request fell from 12487 to 4761 tokens with this
and the managed-auto-memory key above both set; the seat still calls
`read_file` on its card as usual, since the short prompt replaces qwen's
own boilerplate, not the role's own kickoff or card.

### Ollama is started by the swarm (BL-1703)

Before any seat starts, the launch path probes the local endpoint for any
pack whose seats use it — either a `local-model` agent window, or an
`aider` window naming the endpoint directly on its own line (e.g.
`--openai-api-base http://127.0.0.1:11434/v1`, the shape every
`ollama-*-mono-router.conf` pack uses):

- **Answers** — recorded `external` and the launch proceeds. Something
  else (for example the Local Agent, or a hand-started server) is already
  serving it, and the swarm leaves it alone.
- **Silent** — the swarm starts `ollama serve` detached, waits for it to
  answer (bounded wait, polled), and records `swarm-owned` with its pid
  and start time.
- **Never answers** — the swarm stops whatever it started, writes no
  record, and refuses the launch before any seat exists, naming the
  endpoint and the server log path.
- **No seat on the local endpoint** — no probe, no record, launch
  unchanged.

The record lives at `.swarmforge/ollama/serve.json` (`owner`: `external` or
`swarm-owned`, `pid`, `startedAt`, `endpoint`) — read by the stop path so a
server the swarm did not start is never stopped by the swarm (it may be
serving something else, like the Local Agent chat).

### A local-model seat's requests go through a tool-call shim (BL-1917)

qwen2.5-coder writes a tool call as text — a ```` ```json ```` fence naming
the tool and its arguments — rather than starting the reply with Ollama's
own `<tool_call>` template tag. Ollama only parses a reply into
`tool_calls` when it starts with that tag, so without a fix the seat
printed the call as plain content and the turn stalled (every one of 5
captured replies, at both a 4096 and a 32768-token window).

`swarmforge/scripts/local_model_tool_call_shim.py` (stdlib Python, no
dependencies) now sits between a local-model seat and Ollama:

- Every request is forwarded upstream unchanged **except** a chat
  completion that declares `tools`. That one request goes upstream
  unstreamed so the shim can read the whole reply, and a fenced, bare, or
  `<tool_call>`-tagged JSON object naming one of the request's own
  declared tools is rewritten into a real `tool_calls` entry; any other
  text is passed through as plain content. A streaming client still gets
  an SSE response back, with a keepalive comment sent while Ollama works.
- `GET /shim/health` names `local-model-tool-call-shim` and the upstream
  URL it forwards to.
- The seat's generated launch script starts it (reusing one that already
  answers on the port) right before qwen starts — never babysitterd, the
  Ollama ancillary, or BL-1711's crash restart; none of those manage its
  lifetime.
- `swarmforge.sh`'s `local_model_seat_url` gives the seat the shim's own
  URL (`http://127.0.0.1:<port>/v1`) in place of Ollama's endpoint;
  `local_model_qwen_provider_cli.bb --base-url` sets that URL on the
  provider entry qwen actually uses (over `OPENAI_BASE_URL`), while
  `--endpoint-url` still names Ollama's own endpoint for the window-gate
  reads above.
- Its log lands at `.swarmforge/local-model-shim/shim.log`; a line reading
  `rewritten=1` is one turn where the shim turned printed text into a
  real tool call.

| `swarm.env` key | Meaning | Default |
|---|---|---|
| `SWARMFORGE_LOCAL_MODEL_SHIM_PORT` | the shim's own loopback port | `11439` |
| `SWARMFORGE_LOCAL_MODEL_SHIM` | `off` sends the seat to Ollama's endpoint directly, bypassing the shim | `on` |

### The shim caps a compaction summary, drops the ask for `<analysis>`, and runs it with thinking off (BL-1952)

qwen's own compaction side-query — the request it sends itself to
summarize the chat before a compaction — is not exempt from the shim's
usual request path, and three of its properties cost the seat most of
its model time with no edit made: a summary ran 2.7-3.8k output tokens at
about 26 tokens/s (146-188 s each); the reply often opened `<analysis>
Chronological ...`, spent its whole budget there and never reached
`<state_snapshot>` (qwen strips an `<analysis>` block, so a reply that
never leaves it summarises to nothing); and a reply cut at its budget
mid-`<state_snapshot>` left that tag open.

`is_compaction_request` recognises the side-query by its summarizer
system prompt or the directive qwen sends as its last message — never by
reading the history between them, so a prior summary or a file the seat
read that happens to quote either marker is not mistaken for a new
compaction. A recognised request is sent upstream unstreamed through
`_compact`, which applies, in order:

- **`without_analysis_request`** — rewrites the paragraph asking for an
  `<analysis>` block (in the system messages and the last message, where
  qwen puts it) into `NO_ANALYSIS_DIRECTIVE`, asking the reply to start at
  `<state_snapshot>`/`<next_step>` instead. The history in between, and
  the original (non-compaction) request shape, are untouched.
- **`compaction_budget`** — caps the output budget at `COMPACTION_OUTPUT_CAP`
  (1200 tokens), setting `max_tokens` to the cap when the request named
  none.
- **`COMPACTION_NO_THINKING`** (`think: False, reasoning_effort: "none"`)
  merged into the capped request, so the model's reasoning budget goes to
  the summary itself, not hidden thinking. `_compact` logs the client's own
  `think` value, the reply's reasoning length, and the reply's first 24
  characters (`head=`) — this is a diagnostic, not a behavior fix on its
  own: a replay that first seemed to need `think:false` turned out to
  already receive it; the real cause was the `<analysis>` block above.
- **`salvage_analysis_only`** — a reply that is still analysis only (no
  `<state_snapshot>` tag at all) is wrapped as the snapshot's
  `<current_work>` instead of returned as-is, so a stubborn analysis-only
  reply still gives the seat a snapshot to resume from (logged
  `salvaged=True`) rather than compacting to nothing.
- **`close_cut_snapshot`** — a reply cut at the budget cap whose
  `<state_snapshot>` opened and never closed gets its closing tag
  appended, so a capped summary is never left malformed.

None of this touches a request the shim does not recognise as the
compaction side-query: a tool-calling request keeps the client's own
`think`/`reasoning_effort` knobs exactly as before this hotfix (the same
path the tool-call rewriting above already used).

### Ollama is stopped by the swarm (BL-1704)

Both `stop_ancillary_services.sh` (the full-stack stop) and
`kill_all_swarm.sh` (the endless-loop hard stop and the closing
ceremony's sleep path both call this) source `ollama_ancillary_lib.sh`
and call `ollama_ancillary_stop_swarm_owned` once, reading the same
`serve.json` record the launch wrote:

- **`swarm-owned`, pid alive, still `ollama serve`.** Stops the server's
  runner children first (direct children whose command line reads like
  `ollama runner` or `llama-server` — `pgrep -P`, never a host-wide
  pattern sweep, BL-1385/1390), then the server itself: TERM, a bounded
  wait, then KILL if it hasn't gone. The record is removed. The invariant:
  a pid is signalled only after its **live** command line is confirmed
  still `ollama serve` (or a runner child of that pid) — never from the
  record alone, so a pid recycled by an unrelated process is never
  touched.
- **`external`.** Signals nothing; the stop log names the server by
  **endpoint only** — an external record carries no pid to name.
- **`swarm-owned`, but the pid is gone or no longer `ollama serve`.**
  Signals nothing; clears the stale record; the stop log says which.
  Two distinct cases share this outcome: the pid is gone, or it now
  belongs to a different command line.
- **No record.** Nothing, silently — a Claude-only pack never had one.

A stop-side failure (a runner or the server outliving TERM **and** KILL)
is logged and never fatal to the stop path itself — both call sites guard
the call with `|| true`, the same posture the launch-time probe already
had (BL-1727).

`swarm.env` keys (all optional; the defaults reproduce the previous
hand-run shape — bare `ollama serve`, native context length):

| Key | Meaning | Default |
|---|---|---|
| `SWARMFORGE_OLLAMA_BINARY` | the `ollama` binary to run | `ollama` |
| `SWARMFORGE_OLLAMA_MODELS_DIR` | `OLLAMA_MODELS` for the started server | unset (binary default) |
| `SWARMFORGE_OLLAMA_CONTEXT_LENGTH` | `OLLAMA_CONTEXT_LENGTH` for the started server | unset (binary default) |
| `SWARMFORGE_OLLAMA_WAIT_SECONDS` | bound on how long the launch waits for a newly started server to answer | `30` |
| `SWARMFORGE_OLLAMA_POLL_INTERVAL_SECONDS` | how often the wait re-probes | `1` |

### Serving a GPU-fitting local seat: flash attention, KV cache, reading the log (BL-1839 stamp-off)

Every Ollama server the swarm starts (`ollama_ancillary_start_server`,
used by both the launch-time probe above and BL-1711's crash restart)
sets two environment variables before `ollama serve` runs, unless the
caller already set them:

| Variable | Default | Why |
|---|---|---|
| `OLLAMA_FLASH_ATTENTION` | `1` | required for a quantized KV cache |
| `OLLAMA_KV_CACHE_TYPE` | `q8_0` | halves the KV cache's memory, which is what lets a large context window fit on a fixed-size GPU |

Measured on the ISTA IQ3_S coder seat (a 16 GiB GPU, a 49152-token
window): with the default `f16` KV cache, 8 of 65 layers could not fit
and ran on the CPU, at ~3.5 tokens/s; with `q8_0`, all 65 layers fit on
the GPU, at ~18.5 tokens/s. Both variables honor a caller-set value
first — a hand-started `ollama serve` that wants different behavior
(or the `f16` default) sets them itself before starting the server;
the swarm's own start only fills in what the caller left unset.

Ollama's own log (the path `ollama_ancillary_start_server` was given —
`.swarmforge/ollama/serve.log` for a swarm-owned server, or wherever a
hand-started one redirects its output) names the serving facts a role
judges a local seat by, as plain lines:

- `load_tensors: offloaded N/M layers to GPU` — how many of the
  model's layers actually fit on the GPU (N of M; M minus N ran on the
  CPU, the slow path above).
- `llama_kv_cache: size = ... (q8_0)` (or `f16`, etc.) — which KV cache
  type actually took effect for this load.
- `llama_context: n_ctx = ...` — the context window Ollama actually
  served, which may differ from what a Modelfile or client requested.
- `slot print_timing: ... tg = X t/s` — the most recent generation's
  measured tokens/s.

`bb swarmforge/scripts/local_seat_report_cli.bb` (BL-1842) reads these
same lines for you, already correctly handling a stale vs. live log
file (D1) — see "Judge a seat's health from its records, not its pane"
below for its full output.

### The seat's qwen settings carry its served context window (BL-1829, BL-1838)

Each `local-model` seat gets a worktree-local `.qwen/settings.json`
(`<worktree>/.qwen/settings.json` — never the operator's own
`~/.qwen/settings.json`), written fresh at every launch. Two things live
in it:

- **BL-1829's tool scope** — `coreTools`/`excludeTools` restricted to the
  six tools the seat's loop actually needs, cutting the qwen CLI's own
  per-turn tool-definition overhead from ~105k characters to ~52-55k so it
  fits a 32k-token local window at all.
- **BL-1838's provider entry** (`modelProviders.openai`) — the seat's
  model gets a `contextWindowSize` set to the window Ollama is actually
  serving it (read the same way the launch-time window gate already
  reads it — `local_model_window_gate_lib.bb`'s served-window, never a
  second parser), falling back to `SWARMFORGE_OLLAMA_CONTEXT_LENGTH` only
  when Ollama reports no window at all. Before this, the entry lived only
  in the operator's own `~/.qwen/settings.json`, written once and never
  updated — a model re-served at a larger `num_ctx` (e.g. a coordinator
  bump from 32768 to 49152) left the CLI still budgeting to the old,
  smaller number and crashing well short of the real window
  ("hard limit" below the true limit). With neither a served window nor a
  configured context length available, no provider entry is written and
  one warning line names the seat — never a guessed value.
- **BL-1952's compaction-retention key**
  (`model.chatCompression.maxRecentFilesToRetain: 0`) — qwen's default,
  `5`, re-attaches the full text of the five most recently read files to
  the chat history after every compaction; the iq3 coder's bounce session
  re-attached 24-36k chars (more than its compacted summary) across three
  compactions, leaving 22324-25598 tokens after each one against a
  27852-token trigger in a 32768 window, and one call that re-read two
  files at once was refused outright: "Context is too large to send
  safely after automatic compression" — a stall qwen does not recover
  from itself; the seat waits for Ctrl+Y, and a retry resends the same
  history. `0` keeps only the compaction's own summary and the most
  recent turn; the seat re-reads a file it still needs. `context.
  autoCompactThreshold` is never written: the hardener proved it inert at
  every window in the BL-1840 dead zone below and earlier than qwen's own
  default elsewhere.
- **BL-1952's managed-auto-memory key**
  (`memory.enableManagedAutoMemory: false`) — qwen's auto-memory section
  added about 6.2k characters to every request's fixed prompt; off, with
  BL-1952's short system prompt below, a captured first request fell from
  12487 to 4761 tokens.
- **BL-1949's PreCompact hook** (`hooks.PreCompact`) — every local-model
  seat's settings register the master checkout's
  `swarmforge/scripts/local_model_precompact_hook.sh` (never the seat's
  worktree copy, which follows whatever parcel line the seat holds) for
  every compaction trigger. qwen appends the hook's `additionalContext`
  to its compaction prompt, so the summary the seat resumes from is
  bounded: no `<analysis>` block, `<next_step>` first, the whole snapshot
  under 900 words, and `</state_snapshot>` closed. Without it, a summary
  that hits the model's output cap is cut off before the three sections
  the agent resumes from (coordinator note 016208: 0 of 24 snapshots in
  one coder session closed). The hook changes only the instructions qwen
  appends — never when qwen compacts or what history it compacts.
- **BL-1970's edit hook** (`hooks.PostToolUse`, matcher `edit|write_file`)
  — every local-model seat's settings register the master checkout's
  `swarmforge/scripts/local_model_edit_hook.bb` the same way (never the
  seat's worktree copy). After an `edit` or `write_file` call, the hook
  reads the edited file; if it is Clojure source (`.bb`, `.clj`, `.cljc`,
  `.cljs`, `.edn`) and a delimiter no longer closes, its
  `additionalContext` names the file and the reader's own line and
  column for the open form, in the same turn as the edit. It prints
  nothing for a file that reads, for any other kind of file, or for a
  reader error that is not a delimiter error. The hook only adds
  context: it never blocks, undoes, or rewrites the edit. Without it,
  the iq3 coder spent over twenty minutes and two compactions counting
  parentheses by hand on a form the reader had already named (BL-1902,
  `bl1360_ceremony_handoff_property_runner.bb:239`, "EOF while reading,
  expected ) to match ( at [239,1]").
- **BL-1971's repeat guard** (`hooks.PostToolUse`, matcher `""` — every
  tool) — every local-model seat's settings register the master
  checkout's `swarmforge/scripts/local_model_repeat_guard.bb` the same
  way. After a tool call, the hook reads the session transcript; when
  the seat has already made that exact call (same tool, same arguments,
  ignoring `description`/`is_background`/`timeout`) twice since the
  last edit, `write_file`, compaction, or state-changing shell command
  (`git commit`/`merge`/`checkout`/`switch`/`restore`/`reset`/`rebase`/
  `cherry-pick`/`revert`/`stash`, or `swarm_handoff.sh`/
  `done_with_current.sh`/`ready_for_next.sh`), its `additionalContext`
  carries a `REPEAT:` note with the count and the latest compaction
  summary's `<next_step>`. The call still runs and its real result is
  still returned — the guard never refuses a call. An edit, a write, or
  a state-changing command is never warned about. The first version
  (hotfix 66bd85171f) refused the call outright as a `PreToolUse` deny;
  the iq3 coder re-sent the identical call every five seconds, which
  tripped qwen's own always-on consecutive-identical-call check
  (`skipLoopDetection` does not turn that one off) and halted the
  one-shot seat's turn. Hotfix d19171aeb6 made it this warning instead:
  a result the model already has gives it nothing to retry.

### A seat that skips its named write is restarted on it (BL-1991)

The same `local_model_repeat_guard.bb` hook also watches for a seat that
answers a compaction's own instructions by reading instead of writing: on
2026-10-05 the iq3 coder's BL-1928 turn ran 261 model steps (185
`read_file`, 63 shell commands, 6 compactions, 0 edits) — five
compaction summaries in a row named the same `<next_step>` (write a
named file), and each was answered with more reads.

When the latest compaction's `<next_step>` names a write or an edit of a
file, and the seat then makes **three** tool calls that are not that
write, the hook ends qwen — its own parent process — instead of only
warning. It leaves a pending override message (that next step, plus an
instruction to make the named write and not read it first) under
`.swarmforge/local-seat-restart/<in_process handoff file>.json.msg|.json`,
keyed by the parcel's own in-process handoff file so the count survives
a restart but starts fresh for a different parcel. **At most two**
restarts per parcel; a seat that makes the named write before the third
non-write call is left alone, and none are triggered once the write has
already happened since that compaction. A missing `cwd`/`in_process`
dir on the hook's own event leaves the whole restart path inert — never
a fallback to the hook process's own cwd, which in an earlier draft let
a stray test invocation write real state and kill a real seat's process
in this very worktree.

The named write is matched by resolved path, not by the summary's
literal string (BL-2056): the summary may name the file as an absolute
or a relative path, and the seat's own calls carry whatever form the
model used, so the hook resolves both against the event's `cwd`
(absolute paths pass through, relative ones join under it) and
compares the canonicalized results — a seat that edited the named file
at its absolute path counts as having made the write. The override
message distinguishes the two cases, and the existing-file wording
deliberately does **not** tell the seat to skip reading (amended
2026-10-07, QA spec-gap note 003910: "do not read it first" on an
existing file invites exactly the whole-file `write_file` this ticket
exists to stop — that is how the iq3 coder replaced
`check_merge_deletion.sh` on 2026-10-06, BL-2055's own incident):
- a file that already exists in the seat's worktree is named at its
  **absolute** path and the seat is told to `Read only the lines you
  will change first (grep -n, then read_file with offset and limit),
  then edit them` — a fresh restart session has none of the file in
  context, so some reading is unavoidable, but only the lines it is
  about to touch;
- a file that does not exist yet keeps BL-1991's original wording:
  `Write <path> now. Do not read <path> first - it does not exist yet.`

The generated local-model launch script's `qwen` invocations both end
`|| true` (both the first kickoff and the loop's own relaunch) so a
qwen process the hook killed for a restart — a non-zero or signalled
exit — never trips the script's own `set -euo pipefail` before the
pending-override check runs; an earlier version aborted the whole
script on exactly the exit this feature produces, silently defeating
itself on its own trigger. After qwen exits for any reason, the script
relaunches qwen only with the override for the handoff **currently** in
the seat's `in_process` (BL-2055) — never whichever pending override
happened to sort first by name. An override outlives its parcel (a
respawned pane can leave one on disk, read only at the *next* qwen
exit, which may already be on another parcel), so the script re-derives
the held parcel's name from `in_process`'s own real-time contents each
time it is about to relaunch (skipping a sidecar — `.nudge`,
`.chase.json`, `.claim-progress.json`, `.batch-claim-progress.json`,
`handoff_lib.bb`'s own `sidecar-suffixes`, BL-897 — which never counts as
a held parcel), discards every *other* pending override outright, and
relaunches with the held parcel's own override as the sole message,
consuming the file so an ordinary exit never loops. A seat whose
`in_process` holds nothing but sidecars is not holding a parcel at all —
no relaunch, whatever pending overrides happen to be lying around.

The restart count itself is kept the same way, in
`local_model_repeat_guard.bb`'s `in-process-handoff-name`: before BL-2055
it picked the first name in `in_process` by sort order, sidecars
included, so a claim-progress sidecar a release left behind (BL-1992's
release moves only the handoff file) read as a brand-new parcel with no
restarts spent and could restart the seat on the ticket it had just
released. It now filters out the same four sidecar suffixes before
picking a name, so the count is keyed on the actual held handoff file or
not restarted at all.

No tool call is ever refused by this check, same invariant as the
repeat guard above — a restart ends the whole process rather than
denying one call, and `skipLoopDetection` stays on.

### A third missed write releases the parcel to another coder seat (BL-1992)

The same missed-write predicate that drives a restart above (`missed-write`:
the latest compaction names a write/edit, that write hasn't happened since,
this call isn't it, and it's the third such call) also drives what happens
once both of BL-1991's restarts are already spent: `restart-decision` and
`release-decision` share it, gated only by which side of `restart-count <
max-restarts` (2) the parcel is on. A third miss with restarts still left
asks for a restart as before; a third miss with no restarts left releases
the parcel instead — never a third restart, per the human's trial
(`.swarmforge/operator/INTAKE-iq3-coder-restart-20261005.md`, "On the third
miss, do not restart").

Releasing sends the coordinator a `note` (via `swarm_handoff.sh`, never a
direct `inbox/new/` write) naming the released ticket FIRST, and only on a
confirmed send moves the seat's own `in_process` handoff file to its
`inbox/abandoned` — the same destination the coordinator's own pull already
uses, so nothing keeps routing the parcel back to this seat. A refused or
failed send (e.g. a stable task name whose note would exceed Article 2.2's
80-character limit, or `swarm_handoff.sh` itself refusing) leaves the parcel
exactly where it was, in `in_process`, rather than stranding it already
moved with nothing sent — `release-parcel!` checks the send's own exit
status, never fires the move on a best-effort basis (2026-10-06 bounce
D2).

The ticket named is always a bare id, never raw header text embedded
whole: the handoff's own `task:` header (a bare id or a full
stable-task-name slug, resolved to its leading id the same way
`chase_sweep_lib.bb`'s dispatch-trail-ticket-id already does) or, absent
one, a Work note's `message:` header (`Work BL-1843: ...`, the shape a
coordinator dispatch note actually uses, with no `task:` header at all) —
falling back to the literal "its ticket" only when neither names one
(2026-10-06 bounce D1). A seat that makes the named write on its last
chance keeps its parcel and no note is sent, same as a restart. Both the
send and the move use the event's own `cwd`, never this hook process's
working directory — the same restart-only discipline BL-1991 established,
now extended to release.

No tool call is ever refused by this check either, same invariant as the
repeat guard and the restart above.

### The window gate refuses qwen's compaction dead zone (BL-1840)

qwen 0.24.7 auto-compacts a seat's chat at `min(0.85 * window, window -
33000)` once that second term is positive, else `0.85 * window` alone —
both the 0.85 share and the 33,000 (20,000 max-output plus 13,000 buffer)
are fixed inside qwen; no settings key or env var moves either. The
formula is not monotonic: the trigger falls from 27,852 tokens at a
32768-token window to 0 at 33,001, then climbs back up, not reaching
27,852 again until 60,852. A window anywhere from 33,001 to 60,852 tokens
therefore compacts sooner than the smaller 32768 window does, while
costing more memory for no benefit — the dead zone `coder@iq3` sat in at
49152 tokens on 2026-09-30, compacting at 16,152 and losing most of a
turn's context on nearly every exchange.

`local_model_window_gate_lib.bb` computes qwen's own trigger for each
local-model seat's served window (reading it the same way BL-1838's
provider entry does) and compares it against the trigger a 32768-token
window gives. A window the gate cannot learn is never flagged, same as
the fit check above. A flagged window refuses the launch, naming the
window, its trigger, and the two window sizes (32768 and the dead zone's
own upper bound, 60852) that avoid it; `SWARMFORGE_LOCAL_WINDOW_OVERRIDE=1`
lets it start anyway, same override as the fit check, now logged as a
warning instead of a refusal. The gate's formula is proven against the
pinned qwen's own `--debug` `cheap-gate ... auto=<n>` log line, so a qwen
update that changes the constants turns the check red rather than going
silently stale.

An earlier version of this fix wrote `context.autoCompactThreshold: 0.8`
into the seat's qwen settings; the hardener proved with qwen's `--debug`
log and the coder confirmed in qwen's installed source that this key is
inert at every window in the dead zone and only makes compaction happen
sooner outside it (0.8 compacts earlier than qwen's own 0.85 default at
32768). The settings writer no longer writes that key — the real fix is
refusing the window at launch, above.
### A local-model seat records the settings it starts with (BL-1850)

Every local-model seat's generated launch script runs
`local_seat_settings_snapshot_cli.bb` just before qwen starts (`|| true`,
logged to `.swarmforge/launch/<role>.seat-settings.log`, never holding up
the start). It appends one JSON row to
`.swarmforge/local-agent/seat-settings/<seat>.jsonl`:

- `at`, `seat`, `model`;
- Ollama's version, `/api/show`'s `parameters` (num_ctx, num_predict,
  temperature, …) and `details.quantization_level`;
- qwen's version, the provider entry it will use for the model (the
  seat worktree's own `.qwen/settings.json`, BL-1838's reading), and any
  chat-compression settings — credentials dropped from both;
- the card's path, byte size and sha256;
- the GPU's name, enforced power limit and default power limit
  (`nvidia-smi`);
- `fingerprint`: a sha256 of every field above except `at`, so two rows
  with the same fingerprint started from the same settings.

A source that does not answer within its own bound is recorded as
`"unknown"` rather than stopping or delaying the seat's start — the
whole snapshot is bounded to 3 seconds. Run the same command by hand
after changing a setting outside the swarm (for example the GPU power
limit) so the before/after rows bracket the change:

```sh
bb swarmforge/scripts/local_seat_settings_snapshot_cli.bb <root> \
  --seat coder@iq3 --model ista-iq3s-coder:latest \
  --endpoint-url http://127.0.0.1:11434 \
  --card .swarmforge/prompts/coder@iq3.md \
  --worktree .worktrees/coder-iq3
```

This records a seat's own settings only — it reports nothing about how a
session actually ran (that is the seat report above). Grouping sessions
by the settings row in force at the time is a later slice (BL-1851).

### A crashed ollama server is restarted (BL-1711)

While `serve.json` exists (a local-endpoint pack is running), handoffd's
own poll loop runs an `ollama-crash-restart-sweep!` every cycle: it
resolves the same `swarm.env` keys the launch used and shells once to
`ollama_ancillary_restart_cli.sh` (`ollama_ancillary_lib.sh`'s
`ollama_ancillary_restart_if_crashed` — the same lib the launch and stop
paths use, so start/restart can never drift).

- **Establishing "process gone".** A `swarm-owned` record is checked by
  its own pid (`ollama_ancillary_pid_is_ollama_serve`). An `external`
  record carries no pid at all (BL-1703 writes `"pid": null` for one), so
  there is nothing to pin a pid check to — a bare TCP connect to the
  recorded endpoint's own host/port (`ollama_ancillary_any_ollama_serve_alive`,
  bash's own `/dev/tcp`, no curl round-trip, read-only, never a signal)
  substitutes for it: something listening on that port counts as alive,
  gone counts as not, scoped to the ONE process this record actually
  names. (QA D1, 2026-09-26: a first cut piped `ps -eo args=` to `grep`,
  which matched grep's own argv line and read "alive" on every host
  regardless of any real server; a fix scanning `ps` output for the
  pattern was still a host-wide sweep and a false positive for this
  record's own external process on any host already running an unrelated
  `ollama serve` — the port-scoped connect is what actually pins the
  check to this one record, matching what `ollama_ancillary_probe`
  already keys off of.) Without this, an external server that is merely
  alive-but-silent (loading a large model) would look permanently
  "crashed" and a second server would start alongside it.
- **Crash** = "process gone" by the check above **and** the endpoint has
  stayed silent for the whole confirmation window
  (`OLLAMA_ANCILLARY_CRASH_CONFIRM_SECONDS`, default `10`). On a
  confirmed crash: the dead server's orphaned runners are reaped first
  (BL-1705's `reapable-ollama-ghost?` classification — an 11 GB runner
  left behind would starve the new server of memory), then a new server
  is started the BL-1703 way (same binary, models directory, context
  length) and recorded `swarm-owned` with the new pid — even if the
  crashed one had been `external`, since a local pack still depends on
  it.
- **A live-but-silent server is never killed or restarted** — a large
  model can take minutes to load on a CPU host, for both a swarm-owned
  and an external record. One missed probe changes nothing; only a full
  silent confirmation window counts as a crash.
- **Restart bound.** At most `OLLAMA_ANCILLARY_RESTART_MAX_IN_WINDOW`
  (default `3`) restarts in any `OLLAMA_ANCILLARY_RESTART_WINDOW_SECONDS`
  (default `1800`) — timestamps logged to `.swarmforge/ollama/restarts.log`
  so the bound survives a handoffd restart.
- **No record** (a Claude-only pack, or after a stop removed it): no
  probe, no restart.

**The alert** (Telegram + email, the same channel the endless-loop halt
uses) has one wording per outcome, parsed from the CLI's own token line
rather than echoed verbatim (a raw `ESCALATED 1 1800 …` line reads the
same for "one restart's new server never came up" as for "the bound is
exhausted" — the human could not tell them apart):

| CLI token | Alert says |
|---|---|
| `RESTARTED <old-pid> <new-pid> <log>` | ollama crashed and was restarted: pid `<old>` → `<new>`, server log: `<log>` |
| `RESTART_FAILED <old-pid> <new-pid> <log>` | ollama crashed (old pid `<old>`); the restart (new pid `<new>`) never answered — server log: `<log>` |
| `ESCALATED <count> <window> <log>` | ollama restarts exhausted (`<count>` in `<window>`s) — not restarting, server log: `<log>` |

Reaping ghost runners and detached run clients with no live server at all
(BL-1705, narrowed by BL-1726) is documented in
`docs/reference/Specification.MD`'s BL-1705/BL-1726 entries.

## Judge a seat's health from its records, not its pane

On 2026-09-30 the coordinator read the coder@iq3 seat as stuck (CPU near
0%, the same pane lines, no commits). It was in fact generating at
3.5 tokens/s with 8 of 65 layers offloaded to CPU, then later compressing
its chat every turn — every one of those facts was already on disk. BL-1842
reads them for you:

```sh
bb swarmforge/scripts/local_seat_report_cli.bb <project-root> --seat coder@iq3 [--sessions N]
```

Prints the seat's latest session (requests, recorded conversation turns,
chat compressions with their before/after token counts, api errors, total
output and reasoning tokens, and the longest single request), how
Ollama is serving the model (layers on GPU out of total, context, KV cache
type, latest tokens/s), and a state — `generating` (the Ollama log shows a
generation in progress in the last minute), `idle`, or `down` (no process
for the seat's worktree). Read-only: it never touches a seat, a pane or the
Ollama server, and every path it reads defaults to the real locations
(`~/.qwen/usage`, `~/.qwen/projects/.../chats`, the swarm's own Ollama log
or `.swarmforge/ollama-serve-operator.log`) — each overridable
(`--qwen-home`, `--qwen-usage-dir`, `--qwen-projects-dir`, `--ollama-log`,
`--now-ms`) so a fixture never reads the operator's own records.

## Repair

```sh
SWARMFORGE_TERMINAL=none ./swarm ensure <scratch-root> --pack local-model-mono-router
```

Expect `agent:<role>` HEALTHY when the `qwen` child is present;
`rc:<role>: OFF` (remote control is off for this pack — heal via `agent:`,
not Claude `/rc`). A shell-only pane with no `qwen` descendant is repaired
by respawning the persisted role launch script.

## Swap the model (generic path)

Edit the window lines (and coordinator model) in
`local-model-mono-router.conf` — change only the model id. No second launch
branch, capability entry, or pack family. Serve the new id with BL-1082
before relaunch.

## Related

| Doc / ticket | What it covers |
|---|---|
| [BL-1082 pull and serve](./BL-1082-pull-and-serve-a-named-model.md) | Ollama store + loopback endpoint |
| [BL-514 remote-control / ensure](./BL-514-remote-control-health-and-ensure-wiring.md) | `rc:` OFF + `agent:` heal |
| [babysitterd runbook](./BL-611-babysitterd-runbook.md) | Process marker for `local-model` → `qwen` |
| [BL-1053 route to local-model seat](./BL-1053-route-work-to-a-local-model-seat.md) | Intelligence-layer routing (`local`→`local-model`) |

Acceptance: `specs/features/BL-1052-a-role-seat-can-be-staffed-by-a-downloaded-local-model.feature`.
