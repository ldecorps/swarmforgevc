# BL-1700 — the model steward's coder probe

Whether a local model can do the coder's job the DRIVER-ERA way (BL-1697's
real driver against a real aider seat) is measured by running it against
five committed coder fixture tickets in a throwaway repository, never the
live one. This is a bar for taking a coder seat, not a suite that runs on
every commit.

## Prerequisites

- BL-1082 pull + serve for the model id you will probe (an OpenAI-compat
  endpoint reachable at `--endpoint-url`, default
  `http://127.0.0.1:11434/v1`).
- `aider` on `PATH`. No local router running at the same time (two
  `ollama serve`/llama-server processes starve each other on CPU).

## Run

```sh
bb swarmforge/scripts/model_steward_cli.bb probe qwen2.5-coder:latest \
  --endpoint-url http://127.0.0.1:11434/v1
```

Prints the run's JSON result (`endpointOk?`, per-fixture `scorecards`, and
`summary`) and exits 0 only when the summary's verdict is `pass` (at least
4 of the 5 fixture tickets handed off with the spec untouched). Also
always writes `backlog/evidence/local-coder-probe-<model>-<UTC>.md`
(BL-1700 QA D1, 2026-09-26: `--evidence-dir` defaults to
`backlog/evidence` — omitting the flag never means "write nothing").
Pass `--evidence-dir <dir>` to redirect the summary elsewhere instead.

The endpoint is checked FIRST: a silent endpoint refuses before anything
starts (exit 1, naming the endpoint, no scorecard or summary written).

### Scoping to fewer fixtures

```sh
bb swarmforge/scripts/model_steward_cli.bb probe <model> --scenario 01-one-line-fix
```

`--scenario` may repeat; the five fixture ids are `01-one-line-fix`,
`02-two-line-two-functions`, `03-new-function`, `04-two-files`,
`05-keep-existing-test-green`
(`swarmforge/scripts/model_steward_probe_fixtures/`).

### Caps

`--fix-turns-limit N` (default 3, the driver's own `default-fix-turns`),
`--max-ticks N` (default 400, counts real MODEL TURNS — `fixTurnsUsed` —
never the harness's own internal polling ticks), `--wall-clock-seconds N`
(default 900, per fixture, the ONE cap that bounds real elapsed time). A
run that exceeds either cap is stopped and scored accordingly; a hung real
aider process and its tmux session are both torn down before the run
returns. Omitting a cap flag falls back to its documented default, never
an error — every combination is exercised, no cap flag included, by
`model_steward_coder_probe_lib_test_runner.bb`.

## What a scorecard means

Each scorecard also carries `turns` (the real turn count, whatever the
outcome) and `llmHistoryPath` (the real aider run's `--llm-history-file`,
an absolute path outside the throwaway repo so it survives after the run
- `nil` for a stand-in run, which never launches a real aider).

| Outcome | Meaning |
|---|---|
| `handed off` | the driver's own green gate passed: a commit exists, acceptance passes, the ticket YAML and acceptance file are byte-identical to what was promoted, and every touched path was in the ticket's own editable scope. |
| `spec changed` | the model "fixed" the ticket by editing its own acceptance test or YAML — never counted as handed off, whatever the acceptance run then reports. |
| `acceptance still failing` / `no model commit` / `edited outside its files` | the driver's own green-gate reasons (`local_parcel_driver_lib.bb`'s `green-gate-decision`) — surfaced verbatim once `--fix-turns-limit` is exhausted. |
| `merge conflict` | the driver's own merge step failed (should not happen against a fresh fixture repo; investigate the fixture template first). |
| `turn cap` | `--max-ticks` real model turns passed with no terminal state — a seat that IS responding, just not resolving the ticket. |
| `wall-clock cap` | `--wall-clock-seconds` elapsed with no terminal state — covers a genuinely hung seat (zero turns) as much as a slow one. |

## How it works (never a reimplementation of BL-1697)

`swarmforge/scripts/model_steward_coder_probe_lib.bb`:

1. **Endpoint first.** A bare HTTP GET against `<endpoint-url>/models`; no
   answer, no run. The model id is then RESOLVED against that same
   `/models` list (a bare name like `qwen3-14b` becomes `qwen3-14b:latest`
   when that is what the endpoint actually serves) — every scorecard, the
   summary, and the evidence file name the resolved id, not the raw CLI
   argument.
2. **Per fixture:** a fresh `mkdtemp` git repository, seeded from a
   committed fixture (`files/`, `accept.test.js`, `ticket.yaml`) as an
   `in_process` `git_handoff` parcel exactly like a real coder seat would
   receive one; a fresh tmux socket; a real aider seat launched with the
   same launch-line shape `swarmforge.sh`'s aider branch uses (BL-1699:
   `--yes-always`, the coder-only `--test-cmd .../seat test --auto-test`,
   an OpenAI-compat endpoint, no repository path in the bootstrap); the
   REAL `local_parcel_driver_lib.bb`'s `drive-to-end!`, called in-process
   with the sandbox's own root and socket — never a whole `handoffd` loop.
3. **Cleanup, always:** the tmux session (and its whole server) is killed
   and the throwaway repository removed, whatever the outcome.
4. **Summary:** `handed off` count out of 5, verdict `pass` at 4 or more
   (`summarize`).

## Fixtures (`swarmforge/scripts/model_steward_probe_fixtures/`)

Five committed coder tickets of rising difficulty (a one-line fix; a
two-line fix across two functions; a new function; a fix spanning two
files; a fix that must not break a sibling assertion in the same file),
each with a starting `files/` tree, a RED `accept.test.js`, and a
known-good `solution/` tree used only by the harness's own `selftest!`
(never by a real or acceptance run):

```sh
bb -e '(load-file "swarmforge/scripts/model_steward_coder_probe_lib.bb") (println (model-steward-coder-probe-lib/selftest!))'
```

## Acceptance (a stand-in, never a real model)

`specs/features/BL-1700-the-model-steward-probes-a-local-coder-model-through-the-real-driver.feature`
drives the SAME real CLI and the SAME real driver against a scripted
stand-in in place of aider (`--stand-in solve|never|edit-spec|hang`, a
test-only flag never used by a real probe invocation) — never a
reimplementation of the probe's own scoring or gate logic.

## Related

| Doc / ticket | What it covers |
|---|---|
| [BL-1697 local parcel driver](./BL-1697-local-parcel-driver.md) | the real driver this probe calls directly |
| [BL-1699 aider launch](./BL-1052-local-model-seat-launch.md) | the launch-line shape this probe's real path reuses |
| [BL-1127 coder battery](./BL-1127-local-coder-steward-evidence-bar.md) | the non-driver, hand-run claim/edit/test/handoff battery this probe measures the driver-era job BEYOND |
