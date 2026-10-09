# Judge a settings change from a local seat's own work (BL-1851)

Last Updated: 2026-10-08

[BL-1842's seat report](BL-1052-local-model-seat-launch.md#judge-a-seats-health-from-its-records-not-its-pane)
tells you how a seat is doing right now. This report answers a different
question: **did the settings change actually help?** It groups a seat's
own requests by the settings that were in force when each one ran, and by
how Ollama actually served the model, so a before/after comparison comes
from the seat's real work rather than a guess.

## Run it

```sh
bb swarmforge/scripts/local_seat_tuning_report_cli.bb <project-root> --seat coder@iq3
```

Read-only: it touches no file, pane or process, and every number it
prints comes from a record on disk. A field no record carries prints as
`unknown`, never as `0` — a round number in the output is a real
measurement, not an absence dressed up as zero.

Optional flags, each overriding one of its sources (for fixtures or a
non-default host layout — never needed on the live swarm):
`--since <iso-date>` (drop requests before it), `--qwen-home <dir>`,
`--qwen-projects-dir <dir>`, `--ollama-log <path>`, `--settings-file
<path>`.

## How requests are grouped

1. **By the settings fingerprint in force when each request ran** — the
   latest [BL-1850 settings row](BL-1052-local-model-seat-launch.md#a-local-model-seat-records-the-settings-it-starts-with-bl-1850)
   at or before the request's own timestamp, including a row written by
   hand mid-session (the human's GPU power-limit change, 180 W → 150 W,
   on 2026-09-30). A **session is not the unit**: a settings change made
   outside the swarm mid-session splits that session's own requests into
   two groups at the row recording it. A request made before the seat's
   first settings row groups under `unrecorded settings`.
2. **Within one fingerprint, by how Ollama actually served the model** —
   read from the Ollama log's own load line (layers on the GPU of the
   total, KV cache type) in force when the request ran, read the same
   way [BL-1842's report](BL-1052-local-model-seat-launch.md#judge-a-seats-health-from-its-records-not-its-pane)
   does. A model served `57/65 layers, f16 KV` and later restarted
   `65/65 layers, q8_0 KV` under the *same* settings splits into two
   groups even though nothing in the settings record changed.

## What each group prints

- Sessions and requests in the group.
- Median time to first token, prefill speed (input tokens / time to
  first token) and decode speed (output tokens / (duration − time to
  first token)).
- Median output tokens, and thinking as a share of output.
- Chat compressions per 10 requests and the median tokens saved per
  compression — each compression counted in the group in force when it
  happened, not the group its enclosing session started in.
- Tool-call failure rate and the tool that failed most, plus total tool
  calls and failures.

Between two consecutive groups, it names what changed as `<field> <old>
-> <new>` — a settings-fingerprint difference, a served-label difference
(e.g. `served 57/65 layers, f16 KV -> 65/65 layers, q8_0 KV`), or both.

## Running a before/after

1. Record the seat's current settings (`local_seat_settings_snapshot_cli.bb`,
   by hand or from its own launch — see
   [BL-1052's how-to](BL-1052-local-model-seat-launch.md#a-local-model-seat-records-the-settings-it-starts-with-bl-1850)).
2. Change the one setting you want to judge (a GPU power limit, a KV
   cache type, `num_ctx`, …) and record it again so the before/after rows
   bracket the change.
3. Let the seat do real work under the new setting — this report reads
   actual requests, never a synthetic benchmark.
4. Run the tuning report for the seat. The change you made should show up
   as the `Difference:` line between the two groups it prints, with each
   group's own numbers on either side of it to read whether it helped.

## The daily-briefing mode (BL-2084)

```sh
bb swarmforge/scripts/local_seat_tuning_report_cli.bb <project-root> --briefing [--days N] [--now <iso>]
```

This is the mode the documenter's morning briefing pastes verbatim into
its Local LLM section. Unlike `--seat`, it needs no `--seat` and no
`--since`: it discovers every seat on its own and the window *is* the
filter.

- Discovers every seat with a [BL-1850 settings record](BL-1052-local-model-seat-launch.md#a-local-model-seat-records-the-settings-it-starts-with-bl-1850)
  under `.swarmforge/local-agent/seat-settings/` — by that file's own
  stem, never by inverting a qwen directory name.
- For each such seat that made at least one request in the last `--days`
  days — host-local days ending at the host-local midnight that starts
  `--now`'s own date (default 7; `--now`'s own day, today, is never in
  the table) — prints a heading naming the seat and a markdown table with
  one row per
  host-local date it made a request: requests, median time to first
  token, median prefill and decode speed, median output tokens, thinking
  share of output, chat compressions per 10 requests, and tool-call
  failure rate — the same figures and the same grouping math as `--seat`
  (above), just bucketed by day instead of by settings fingerprint. A
  field no record carries prints `unknown`, never `0` (same invariant as
  `--seat`).
- When no local-model seat made a request in the window, it prints the
  single line `No local-model seat ran in the last <N> days.` instead of
  any table.
- `--qwen-home`, `--qwen-projects-dir` and `--ollama-log` still override
  their sources per seat, same as `--seat` mode.

## Sources it reads (never a second parser for the same record — BL-1811)

| Source | What it carries |
|---|---|
| `~/.qwen/projects/<cwd-key>/chats/<session>.jsonl` | Per-request time to first token, duration, input/output/thinking tokens, tool calls, and chat-compression events — parsed once, in `local_seat_report_lib.bb` (BL-1842), never re-parsed here |
| `.swarmforge/local-agent/seat-settings/<seat>.jsonl` | BL-1850's settings rows, including any written by hand after an outside-the-swarm change |
| The Ollama server log resolved by `local-seat-report-lib/default-ollama-log` (the seat's own `.swarmforge/ollama/serve.log` when it exists, otherwise `.swarmforge/ollama-serve-operator.log`; when both exist, the newer mtime wins) | Each model load's layers-on-GPU and KV cache type |

## Related

| Doc / ticket | What it covers |
|---|---|
| [BL-1052: seat health from its records](BL-1052-local-model-seat-launch.md#judge-a-seats-health-from-its-records-not-its-pane) | `local_seat_report_cli.bb` — one seat's latest session right now, not a before/after comparison |
| [BL-1052: settings snapshot](BL-1052-local-model-seat-launch.md#a-local-model-seat-records-the-settings-it-starts-with-bl-1850) | How a settings row gets recorded, and how to record one by hand after an outside-the-swarm change |

Acceptance: `specs/features/BL-1851-a-local-seats-tuning-report-compares-its-work-across-the-settings-it-ran-with.feature`
(`--seat` mode); `specs/features/BL-2084-the-tuning-report-briefing-prints-each-local-seats-days.feature`
(`--briefing` mode).
