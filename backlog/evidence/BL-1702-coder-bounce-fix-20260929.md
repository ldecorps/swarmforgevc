# BL-1702 — coder bounce-fix evidence, 2026-09-29

QA bounce (evidence `BL-1702-QA-20260929.md`, commit b3e1176143) named
three defects. D1/D2 are coder's (the amendment's own text names coder as
owner of the fixture isolation); D3 is the documenter's and is left
untouched here — it travels forward with the parcel per Article 4.4, to
be fixed when the documenter's own stage is reached again.

## D1 — fixed

`swarmforge/scripts/test/test_aider_seat_launch_config.sh` stages an
aider `coder` seat (model `qwen2.5-coder:latest`, the same one across
every `window` line in this file) through the REAL `swarmforge.sh`. This
parcel's own `local_coder_probe_gate` now runs inside `parse_config` and
refused every one of those launches for "no probe summary" — the fixture
never supplied `LOCAL_CODER_PROBE_EVIDENCE_DIR`.

Fix: the same isolation `test_local_coder_probe_gate_wiring.sh` already
uses — a `mktemp -d` evidence directory holding one passing summary
(`local-coder-probe-qwen2.5-coder-latest-<stamp>.md`, `handed off 4 of 5 -
verdict pass`), `export`ed as `LOCAL_CODER_PROBE_EVIDENCE_DIR` once near
the top of the file (registered via `register_tmp_dir`, the file's own
existing cleanup convention) so every subsequent `zsh -c "source
'$SWARMFORGE_SH' ..."` invocation inherits it. The gate itself is
untouched (FIRM invariant).

## D2 — fixed

`swarmforge/scripts/test/test_ollama_ancillary_launch_gate.sh` scenario
01 stages the same aider-coder/`qwen2.5-coder:latest` shape; for the same
reason, `ensure_ollama_ancillary_for_launch` was never reached —
`parse_config` refused first. Same fix, scoped to scenario 01's own `zsh
-c` invocation only (scenario 02 is a Claude-only pack with no driver
seat at all, never gated, and needs no evidence).

### A second, PRE-EXISTING, already-owned red surfaced once the probe-gate refusal cleared

With D2's fix applied, scenario 01's `local coder probe gate refused`
line is gone (confirmed: absent from three repeated runs), but the
scenario still fails — now on `ollama-ancillary: local-model endpoint ...
never answered within 5s`. This is **not** a new defect: `backlog/
standing-reds.tsv` already carries this exact row, owned:

```
shell	swarmforge/scripts/test/test_ollama_ancillary_launch_gate.sh	BL-1797	2026-09-29	scenario 01 never answered within 5s: zsh -c sources ~/.zshenv, which puts ~/.local/bin (a real ollama since 2026-09-28) ahead of the fixture stub; not load (QA note 003343, BL-1702-QA D2)
```

Confirmed the exact cause locally: `~/.zshenv` line 7 exports `PATH="$HOME/
.local/bin:$PATH"`, and `~/.local/bin/ollama` is a real symlink (added
2026-09-28) — `zsh -c` always sources `.zshenv` even in non-interactive
mode, so it shadows the fixture's own `$ROOT1/bin/ollama` stub regardless
of what `PATH="$ROOT1/bin:$PATH"` set beforehand. `BL-1797` (still
`backlog/paused/`, unfixed) owns this; not this ticket's to fix, and QA's
own D2 remediation pointer already said so ("main's endpoint-timeout red
is not the coder's to fix"). This scenario stays red on this host until
BL-1797 lands — expected, not a gap in this pass.

## Verification

| check | result |
|---|---|
| `bash swarmforge/scripts/test/test_aider_seat_launch_config.sh` | **ALL PASS** (13/13) |
| `bash swarmforge/scripts/test/test_ollama_ancillary_launch_gate.sh` | scenario 01: probe-gate refusal cleared, still red on the pre-existing, already-owned BL-1797 (confirmed, see above); scenario 02 unreached only because `set -euo pipefail` stops at scenario 01's failure — scenario 02 touches no driver seat and is unaffected by this fix either way |
| `bash swarmforge/scripts/test/test_local_coder_probe_gate_wiring.sh` (regression) | ALL CHECKS PASSED |
| `bash swarmforge/scripts/test/test_local_model_seat.sh` (regression) | ALL PASS |
| `bash swarmforge/scripts/test/local_ollama_pack_shape_test_runner.sh` (regression) | ALL PASS |
| `bash swarmforge/scripts/test/test_alternate_runtime_launch.sh` | fails HERE on a tmux `load-buffer` error, in THIS coder sandbox session specifically - QA's own evidence (`BL-1702-QA-20260929.md`, "Other standing shell tests...") already recorded this exact test **ALL PASS on this same parcel tree**; neither file this pass touches, nor any file either touches, is in this test's own dependency chain (`agent_runtime_inject.bb`/`agent_runtime_cli.bb`), so this is a tmux/session capability difference between this sandbox and QA's environment, not a regression this pass introduced or a standing red to register |
| `bb swarmforge/scripts/test/local_coder_probe_gate_lib_test_runner.bb` (regression) | ALL PASS |
| `bb swarmforge/scripts/test/bl1702_local_coder_probe_gate_property_runner.bb` (regression) | ALL PROPERTIES HOLD, 400 draws |
| `node specs/pipeline/cli.js specs/features/BL-1702-...feature` | **5/5 pass** |

`git diff main...HEAD --name-only` for this pass: `test_aider_seat_launch_config.sh`,
`test_ollama_ancillary_launch_gate.sh`, and this evidence file only — exactly D1/D2's
own remediation pointers, nothing else.

By coder.
