# INTAKE — the generated systemd units cannot start, and the BL-303 crash-burst guard they claim is silently inert

Source: found 2026-07-14 while installing the operator + front-desk units on the primary
host (they had never been installed here — which is *why* the whole operator layer stayed
dead for ~9h on 2026-07-13 and Telegram went silent). Scope request for the specifier.

Both defects are in `swarmforge/deploy/generate_systemd_units.sh`. Both are mechanical and
provable with `systemd-analyze verify` — no judgement call.

## Defect A — `ExecStart=bb …` is not an absolute path, so the operator unit never starts

The operator unit renders (`generate_systemd_units.sh`, `--unit=operator`):

    ExecStart=bb /path/to/swarmforge/scripts/operator_runtime.bb /path/to/root

**systemd does not search `PATH` for `ExecStart`** — it requires an absolute path. Verified:

    $ systemd-analyze verify swarmforge-operator-primary.service
    swarmforge-operator-primary.service: Command bb is not executable: No such file or directory

So the operator unit — the whole point of BL-304 — fails on every start. On this host `bb`
is at `/home/carillon/.local/bin/bb`.

### Related, same root cause: units get a minimal PATH
The front-desk unit's own `ExecStart` *is* absolute (`launch_front_desk.sh`), so it passes
`verify` — but it is not fixed either. systemd hands units
`/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/snap/bin`, which does **not** include
`~/.local/bin`, and `launch_front_desk.sh` shells out to `bb`. Both units therefore need an
explicit `Environment=PATH=…` (or absolute paths throughout). A unit that starts and then
dies on `bb: command not found` is no better than one that refuses to start.

## Defect B — `StartLimitIntervalSec=0` is in `[Service]`, where systemd ignores it

Rendered into the `[Service]` section of both the operator and front-desk units. systemd
moved that key to `[Unit]` (v230+); in `[Service]` it is discarded with a warning:

    swarmforge-operator-primary.service:17: Unknown key name 'StartLimitIntervalSec' in section 'Service', ignoring.

The generator's own comment states the intent:

> `StartLimitIntervalSec=0` so a crash burst never permanently stops the unit — the exact
> analogue of the BL-303 sticky-give-up defect fixed at the front-desk-supervisor layer.

**That guard does not exist.** The key is ignored, so the units keep systemd's default
start limit (5 starts / 10s → unit enters `failed` and stays there). A crash burst — the
precise scenario BL-303 was about — permanently stops the daemon, with `Restart=always`
giving a false sense that it cannot. This is BL-303's sticky-give-up defect, reintroduced
one layer up, in the code whose comment claims to have fixed it.

This is the second occurrence of a defect class already seen twice (BL-215, BL-345): **a
guard whose result is discarded, so the protection is decorative.** Worth naming as such.

### What "fixed" looks like
- `ExecStart` uses an absolute interpreter path (resolve `bb`/`node` at generate time, or
  require them passed in — do not assume a login PATH).
- Units carry an explicit `Environment=PATH=` that includes the interpreter dir, so the
  scripts they launch can find `bb`/`node`/`claude` too.
- `StartLimitIntervalSec=0` moves to `[Unit]`.
- **`systemd-analyze verify` runs in the test suite against every rendered unit.** Both
  defects here are caught by it in one second; nothing in the suite runs it today, which is
  why units that cannot start shipped and sat unnoticed. That test is the actual fix — the
  other three bullets are just today's instances.

## Note for the specifier
`swarmforge/deploy/generate_systemd_units.sh` also renders a `swarm` unit (`--unit=swarm`)
which was not exercised here. It shares the `[Service]`-section `StartLimitIntervalSec` bug
and should be checked for the same PATH assumption before anyone relies on it at boot.

Hand-corrected units that DO pass `systemd-analyze verify` clean were written for the
primary host (operator + front-desk, with absolute `bb` and `StartLimitIntervalSec` in
`[Unit]`) — use them as the reference for what the generator should emit. They are a
stopgap for one host; the generator itself is still emitting the broken form.
