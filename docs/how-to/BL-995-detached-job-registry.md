# Running a >120s job that survives the orphan reaper (BL-995)

## The problem this solves

`hardender.prompt:1010` is explicit that the only sanctioned way to run a
job that legitimately needs more than ~120s (a Stryker mutation root, a
`node --test` batch, a property-lane vitest run) is a `python3` double-fork
with `os.setsid()` between the two — the Bash tool's own timeout, its
`run_in_background` option, and `nohup … & disown` all fail to detach on
this host and cap at 120s regardless.

That detach produces a PPID-1 orphan **by construction** — that is the
whole point of `setsid()`. `handoffd_supervisor.bb`'s BL-108 orphan reaper
kills any PPID-1 process whose command line matches its job pattern
(Stryker, `node --test`, `npx vitest`, `npm exec vitest`,
`vitest.properties.config.mjs`) once it looks orphaned — which is exactly
every job the hardener detaches. Before BL-995, the reaper killed the
detached job within seconds, silently: the job's log simply stopped
growing, with no error, and the only record was a `reap-job-orphan` line in
`.swarmforge/daemon/handoffd-supervisor.log` that the owning agent had no
reason to open. The natural (wrong) reading was "the suite is flaky" or
"the host is overloaded."

## The fix: register the detach

`swarmforge/scripts/detach_job.sh` is now the **single sanctioned way** to
run one of these jobs. It wraps the double-fork/`setsid()` sequence and
registers the detached process group so the reaper can tell deliberate
detachment from abandonment, instead of hand-rolling the python3
incantation yourself.

```
detach_job.sh <log-file> [--expires-minutes N] -- <command...>
```

- `<log-file>` — where the job's stdout/stderr land. Use an absolute path,
  or a path relative to the current working directory (embed the absolute
  `cd` for the command itself, per BL-815 — a detached job that starts from
  the wrong directory keeps running there for the life of the job).
- `--expires-minutes N` — optional, default 120. How long the registration
  stays valid before the job becomes reapable even if still running.
- Everything after `--` is the command to run.

Example:

```
detach_job.sh ./tmp/stryker-run.log -- npx stryker run
```

The helper returns immediately (the whole point is not blocking the
caller); the job runs detached and appends to `<log-file>`.

## What registration guarantees, and what it doesn't

- **A registered, unexpired job is spared.** The reaper's BL-108 protection
  against genuine crash orphans is unchanged for everything else —
  narrowing the reaper's job pattern or disguising a job's argv to dodge it
  is explicitly refused; the reaper still matches these processes, it just
  learns to spare the registered ones.
- **Registration is not immunity.** Once an entry ages past its
  `--expires-minutes` limit, the job is reaped exactly like an unregistered
  orphan and its registry entry is removed — a crashed owner's job cannot
  run forever just because it once registered. Pick an expiry that covers
  the job's real runtime with margin, not an arbitrarily long one.
- **A reaped job is never silent to its owner.** Whether a killed job was
  registered or not, the reaper appends a `[handoffd_supervisor] REAPED
  pgid group…` notice into the job's own log file, and the job's bash
  wrapper separately traps `SIGTERM` to append `[detach_job] KILLED by
  SIGTERM …` before dying. Collecting a run means tailing its log — if it
  stopped mid-run, the log itself says why.
- **No race window.** The registration entry is written by the
  intermediate (post-`setsid()`) process before the worker is forked, so
  the worker can never become orphan-visible to a reaper sweep before its
  registration exists.

## Where the registry lives

Registration entries are JSON files under
`.swarmforge/daemon/detached-jobs/<pgid>.json` (pgid, owner role, log path,
cwd, command, start time, expiry). They are housekept automatically — an
entry is removed once its process group is confirmed dead and it is past a
short grace period — so the registry never accumulates stale files on its
own. You do not need to clean these up by hand.
