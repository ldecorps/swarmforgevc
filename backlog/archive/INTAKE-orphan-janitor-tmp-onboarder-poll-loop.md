> **Dispositioned 2026-08-18 by the specifier: minted 1:1 as BL-930**
> (`backlog/paused/BL-930-orphan-janitor-never-reaps-tmp-rooted-onboarder-poll-loops.yaml`).
> Nothing split off, nothing merged in. The open design question in Goal 4
> (front-desk fast path vs ordinary age gate) was settled as ORDINARY AGE GATE,
> on evidence: `--check-once` exits after `tick!`, so a live fixture's poll-loop
> is PPID 1 within milliseconds and parent-orphaned carries no signal for this
> class. Rationale in the ticket's `approval_context`.

# Raw intake — orphan janitor never reaps tmp-rooted onboarder poll-loops

Status: new intake, not minted. Capture only (human via Cursor 2026-08-18
~22:06 CEST). Follow-on to the host-repo leak already queued as **BL-928**.

## Human ask (verbatim)

After a host-load check found leftover `onboarder-reconcile.js poll-loop`
processes, the human asked which ticket would clear the onboarder noise.
Answer: **BL-928** for leftovers whose command line names THIS swarm repo
root. Then: "Is there a ticket to take care of the other poll loop?"
Answer: no — the `/var/folders/…/T/tmp.KTEWg2bJ/` process is a disposable
fixture root, out of BL-928 by invariant 2, and not in the janitor
catalog. Then:

> Add an intake for that, and kill it by hand

## Related (do not conflate)

- **BL-928** (active, coder, queue-jump) — host-repo
  `onboarder-reconcile.js poll-loop` siblings left at PID 1 when
  `onboarder_supervisor.bb` dies without `finally`. Invariant 2: a
  poll-loop for any other root, **including a tmp fixture root**, is
  never reaped. Out of scope there, locked: do **not** add a janitor
  class for **host-repo** `onboarder-reconcile.js`.
- **BL-879** (done) — parent-orphaned tmp front-desk bridge/bot skip the
  age gate. Catalog is still only babysitter / tmux / `start-bridge-
  headless.js` / `telegram-front-desk-bot.js` / `claude -n Babysitter`.
- **BL-458** (done) — acceptance mini-swarm fixture leaks (claude agents
  + front desk). Did not add onboarder.
- **BL-885** (done) — janitor class for leaked `caffeinate -dims`. Same
  *kind* of catalog extension, different process class.
- **BL-817** (paused) — leaked fixture tmux from acceptance steps.
  Tmux-only.

## Observable incident (this host, 2026-08-18 ~21:44 CEST)

Live swarm up. Load ~47 on a 2-core / 4-thread i7. Distinct from the
host-repo leftovers BL-928 already tabulated (pids 25731, 50175, live
child 5356):

| PID  | PPID | Age (then) | Role |
|------|------|------------|------|
| 1415 | (live test / leftover) | ~24 min | `bb …/tmp.KTEWg2bJ/swarm/onboarder_supervisor.bb …/tmp.KTEWg2bJ/swarm` |
| 10948 / 8982 / 7566 (same class, successive samples) | supervisor or PID 1 | seconds–minutes | `node …/tmp.KTEWg2bJ/swarm/extension/out/tools/onboarder-reconcile.js …/tmp.KTEWg2bJ/swarm poll-loop` — ~15% CPU |

Root was Darwin `$TMPDIR`:
`/var/folders/ks/zpyf9vpn15s2vjwzq52p958c0000gn/T/tmp.KTEWg2bJ/swarm`.

By ~22:06 CEST the directory and those pids were already gone (a later
`test_onboarder_supervisor_tick.sh` run under the hardender used a
different tmp name, `tmp.D4vowqPP`, and finished). The leak class is
still real: the same producer was observed live minutes later, and
nothing in the janitor would have reaped `tmp.KTEWg2bJ` had it stayed.

Host-repo pids 5343 / 5356 / 25731 / 50175 were **not** killed. BL-928
forbids ad-hoc kill of those; they wait for the supervisor startup sweep.

## Root cause

`orphan_janitor_lib.bb` `tmp-ancillary-cmdline?` requires an extractable
disposable root **and** one of: babysitter tmux/launch, `babysitterd.sh`,
any `tmux`, front-desk bridge/bot, or `claude -n Babysitter`.
`onboarder-reconcile.js` and `onboarder_supervisor.bb` are not in that
list, so a tmp-rooted onboarder never becomes a candidate — parent
orphaned or not, stale or not.

Producer of tonight's leftover:
`swarmforge/scripts/test/test_onboarder_supervisor_tick.sh`. It
`mktemp -d`s a fixture, copies a fake `onboarder-reconcile.js` that
`setInterval`s a heartbeat forever, and starts it via `--check-once`.
`cleanup_children` is an inline `pkill` on the success path only.
`lib/tmp_cleanup.sh`'s EXIT trap **removes directories** and does not
signal processes (its own BOUNDARY note: SIGKILL/OOM residue is a
periodic sweeper's job). An interrupted hardener/mutation run therefore
deletes the fixture dir and leaves the poll-loop (and often the
supervisor bb) running against a deleted cwd.

## Goal

1. Specifier mints a defect to add **tmp-rooted** onboarder processes to
   the existing orphan-janitor ancillary catalog
   (`tmp-ancillary-cmdline?` / `reapable-tmp-ancillary?`), disposable-root
   gated the same way front-desk already is. Host-repo
   `onboarder-reconcile.js` must remain unmatched — that is BL-928's
   locked prohibition, not this ticket.
2. Candidates are at least:
   - `node …/onboarder-reconcile.js <disposable-root> poll-loop`
   - `bb …/onboarder_supervisor.bb <disposable-root>`
   whose command line extracts a disposable root (`disposable-root-re`:
   `/tmp/tmp.|aps-|sfvc-` and Darwin `$TMPDIR/…/T/tmp.|aps-|sfvc-|bl*-`).
3. Acceptance must prove: a PPID-1 (or dead-parent) tmp-rooted onboarder
   poll-loop is reaped; a live-parented fixture (a test still running)
   is not; a host-repo poll-loop is never a candidate, however orphaned.
4. Open design question for the specifier, not locked: whether
   parent-orphaned tmp onboarder skips the multi-hour `stale?` gate the
   way BL-879's front-desk class does. Onboarder does **not** steal host
   `:8765`, but tonight's leftover sat at ~15% CPU on a 2-core box while
   a live test was still in flight. Front-desk fast path vs ordinary
   age gate is the specifier's call.

## Out of scope

- Host-repo onboarder leftovers (pids 25731, 50175, live 5356). BL-928.
- Widening the janitor to hunt host-repo `onboarder-reconcile.js` by
  command line alone. Same decapitation class BL-928 / BL-879 already
  refused.
- Replacing BL-928's supervisor startup sweep.
- Ad-hoc killing those host-repo pids.
- Rewriting `test_onboarder_supervisor_tick.sh` teardown unless the
  specifier keeps a narrow prevention slice beside the janitor (BL-458
  had both halves; not required here).

## Locked human decisions

1. File this as raw intake for the specifier; do not mint the ticket
   from Cursor.
2. Kill the tmp leftover by hand tonight rather than waiting for a
   janitor class. (Attempted 2026-08-18 ~22:06 CEST: those pids were
   already gone. Scoped pkill for tmp-rooted onboarder only; host-repo
   processes left untouched.)
3. Do **not** fold this into BL-928. That ticket's invariant 2 and
   host-repo janitor ban stay.
