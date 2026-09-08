# test_handoffd_supervisor.sh: unowned red, adjudication (specifier, 2026-09-08)

Inbound: coder note, priority 00, 2026-09-08T08:12:31Z, "unowned-red:
test_handoffd_supervisor.sh 01 hard-stop never kill-session", raised from the
BL-1490 parcel. Handled the same pass under the standing-red rule
(2026-09-05): `type: defect`, `severity: high`, register row in the mint
commit. Outcome: **BL-1498 minted** (paused), owner of one row.

## Reproduction on main `974f03e9e1` (master checkout, `RESEND_API_KEY` unset)

    $ bash swarmforge/scripts/test/test_handoffd_supervisor.sh
    FAIL: 01: hard-stop never killed any tmux session
    (exit 1; every later case never runs - `fail` exits)

    $ ZDOTDIR=<empty dir> bash swarmforge/scripts/test/test_handoffd_supervisor.sh
    PASS: 01 ... PASS: 03 ... PASS: 04 ... recovered daemon marked healthy ...
    FAIL: 02: hung pid was not terminated

`standing` row, `suite-manifest.tsv` line 327. Not in the register before
this pass.

## Cause 1 - the fixture's fake tmux is shadowed by the operator's zsh rc

- `halt-swarm!` (`handoffd_supervisor.bb:539`) runs `swarm-cleanup.sh`,
  `#!/usr/bin/env zsh`, unchanged since 2026-07-04 (`fc49521b6f`).
- `~/.zshenv` line 7: `export PATH="$HOME/.local/bin:$PATH"` - the recipe
  `docs/how-to/BL-tmux-wsl-segfault-upgrade.md` line 41 gives. zsh sources
  it for every invocation, shebang included.
- `~/.local/bin/tmux` is the static 3.7b from BL-1069, mtime 2026-08-22
  17:04 (landed `42ae26a505`, 2026-08-23). BL-977 recorded this file ALL
  PASS on 2026-08-20; red from 08-22 by mechanism.
- Discrimination, fake `tmux` dir first on PATH:
  `bash -c 'command -v tmux'` -> fake; `zsh -f -c` -> fake;
  `zsh -c` -> `~/.local/bin/tmux`; `ZDOTDIR=<empty> zsh -c` -> fake.
- Direct call of `swarm-cleanup.sh` with the fake first: exit 0, fake log
  empty - the real client ran `kill-session` on the dead fixture socket and
  `2>/dev/null || true` swallowed it.
- `prefer_local_tmux_bin` (`swarmforge.sh:78`) is not a cause: it prepends
  only when `~/.local/bin` is absent from PATH (the panes carry it), and
  `swarm-cleanup.sh` does not source `swarmforge.sh`. Verified under
  `zsh -f` with the function alone: fake stays first.
- Known and deferred: BL-1342 step (7), 2026-09-02: "scenario 01 fails
  identically on unmodified main (tmux shim shadowing) ... its own chore".
  No chore was minted.
- Precedent for the fix: BL-1305 and `test_idle_clear_respawn.sh` lines
  34-44 (`ZDOTDIR` exported to an empty mktemp dir).

## Cause 2 - case 02 presents a newborn daemon, so the startup grace holds

Hotfix `27d6ab8630` (2026-09-02, stamped by BL-1342) added
`within-startup-grace?`: pid file younger than one stall window -> `:healthy`.
Case 02 (`test_handoffd_supervisor.sh:164-181`) writes the hung pid into
`handoffd.pid` milliseconds before `check_once` at `SUPERVISOR_STALL_MS=500`
and ages only the heartbeat and the outbox parcel. Deterministic red since
2026-09-02, hidden behind cause 1. The grace is correct; the fixture's
observation is stale by construction. Fix: `touch -t 202601010000` the pid
file beside the two existing `touch -t` lines.

## Census of the class (fake tmux via PATH, reaching a zsh script)

    grep -rl 'FAKE_BIN\|tmux-calls.log' swarmforge/scripts/test/*.sh
      | filter: names a zsh entry point (swarm_handoff.sh, ready_for_next,
        done_with_current, swarmforge.sh, swarm-cleanup, handoffd_supervisor,
        reroute, redo_from, pre_qa_gate.sh, swarm-window-watchdog)

25 files. All run on main `974f03e9e1` from the master checkout
(`RESEND_API_KEY` unset), every red one re-run under `ZDOTDIR=<empty dir>`:

| file | main | isolated | verdict |
|---|---|---|---|
| test_handoffd_supervisor | FAIL 01 | FAIL 02 | cause 1 + cause 2, **BL-1498** |
| test_handoffd_chase_sweep_wiring | FAIL 01 sidecar never written | same | other cause, unowned |
| test_handoffd_notify_verified | FAIL 02 typed 0 | same | other cause, unowned |
| test_handoffd_role_context_clear_wiring | FAIL setup: initial clear never fired in 30 s | same | other cause, unowned |
| test_build_freshness_cli | FAIL 02/03(compiled) merge never reached the running process | same | other cause, unowned |
| test_handoffd_supervisor_job_reaper | FAIL 04 setup: no reparent to PPID 1 (got 12777) | same | other cause; may be the harness subreaper, needs a pane run |
| test_rotate_recomposes_role_prompt | FAIL 05 no respawn-pane at the idle boundary | not re-run | other cause, unowned |
| test_redo_from | every case PASS, exit 2 | not re-run | exit-status defect, unowned |
| the other 17 | exit 0 | - | green |

The seven other reds have causes unrelated to zsh startup files (six stay
red isolated; two were not re-run because the census finished after the
isolation batch started). They were sighted from the specifier's harness
shell, not a pane; the job-reaper one in particular may be an artifact of
the harness acting as child subreaper. They are NOT owned by BL-1498 and
carry no register row from this pass: each needs its own diagnosis before
a ticket that a coder can estimate. Recorded here so the next pass starts
from the assertion, not from the census.

## Lean-pass candidates (recorded, not ticketed)

- Third occurrence of "operator zsh rc reaches a fixture through a
  zsh-shebang script" (BL-1305, test_idle_clear_respawn, this): a shared
  helper in `swarmforge/scripts/test/lib/` and a derived census with a
  pinned count (BL-1445's shape).
- A red written down in a stamp ticket as "its own chore" produced no
  chore for six days: a stamp ticket's deferral is an unowned-red note.
