# Hardener incident note — coder worktree process explosion, 2026-08-28

## What happened (observed, not guessed)

While attempting to commit BL-1215 hardening work (`git commit`, touching
`extension/src/tools/pilotAcceptanceGate.ts`), the pre-commit hook
(`check_property_suite_drift.sh`) triggered `npm run test:properties` as
expected. My `git commit` invocation was killed twice by my own tool
sandbox's ~2-minute hard ceiling on a single command (documented in this
role's own prompt: a `timeout:` parameter does not raise this ceiling).

Each kill left my worktree's git index with an invalid cache-tree pointer
(`git status --short` showed 10,109 lines — the whole tree as
added/deleted — and `git diff --cached` failed with `fatal: unable to
read <sha>`). Recovered both times with `git read-tree HEAD` (rebuilds the
index from HEAD; does not touch working-tree files) — confirmed my actual
file edits were intact on disk throughout, only the index was affected.

## The actual cause, found while investigating: NOT my commit

While checking for orphaned processes from my own killed commit
(per this role's own Handoff discipline), found instead: **over 1,060
distinct `bash .../swarmforge/scripts/check_property_suite_drift.sh
/tmp/bl1196-hook-main-<hash>/rogue-fixture.sh` processes**, each with its
own unique PPID (≈1000+ separate invocations, not one runaway tree),
running from **`.worktrees/coder`** — a different role's worktree, not
mine. Ages 64–112+ seconds and climbing at the time of first observation.
Host `uptime` load average peaked at **84.10** on a 20-core host (over
4x the 2x-cores busy threshold this role's own hardening-order rules use).

By the time I checked again roughly a minute later, the process count had
dropped to 0 and load was falling (84.10 → 77.88, 1-minute average
recovering first as expected). Whatever caused the spawn either
self-resolved, was reaped by the swarm's own supervision (babysitterd /
handoffd's alarm-halt), or the coder's own test run completed or was
killed - I did not intervene and cannot say which.

## Why this likely explains my own corruption

All worktrees share one `.git` object database and one hooks
configuration (`core.hooksPath = swarmforge/git-hooks`). A concurrent
storm of 1000+ processes repeatedly invoking the SAME
`check_property_suite_drift.sh` script (which itself does real git IO —
`bl1124_snapshot`, `git fetch`, `git status --porcelain`, etc.) at load 84
is a very plausible source of contention with my own commit's hook
invocation touching the same shared git backend, independent of the
sandbox-timeout kills. I cannot prove causation from the outside, but the
timing (both incidents in the same few minutes, both touching the same
shared object database) is a strong correlation worth recording.

## Action taken

- Sent an URGENT `note` (priority 00) to the coordinator the moment I
  found this, before investigating further, per the severity (host-wide
  load 84, active-in-progress at the time of the note).
- Did NOT touch, inspect the fixture content of, or kill any process
  under `.worktrees/coder` — not my worktree, not my role's authority,
  and the storm had a chance to be legitimate in-progress work until
  proven otherwise.
- Did NOT run any destructive git command on my own worktree (no `reset
  --hard`, no `checkout .`, no `clean`) — recovered the index via
  `git read-tree HEAD` only, which is index-only and working-tree-safe,
  and re-verified my own file contents were correct before re-committing.
- Continuing my own BL-1215 hardening pass once host load recovers to a
  reasonable level, per this role's own load-aware hardening-order rules.

## For whoever investigates the coder side

`/tmp/bl1196-hook-main-<hash>/rogue-fixture.sh` is the fixture script
name — its own filename suggests it exists to test a "rogue fixture"
scenario (plausibly related to BL-1202's own kill-mid-run canary work, or
a new/adjacent ticket testing the guard's behavior under a misbehaving
fixture). Worth checking whether that fixture script itself, or the shell
test driving it, has an unbounded retry/spawn loop with no rate limit or
process cap - 1000+ near-simultaneous invocations of the same script with
the same argument is not a normal test shape.

## Follow-on: repeated worktree-index corruption and property-suite non-determinism

After the process count and host load fully recovered (load back to
2-8 range), MY git index was corrupted a total of THREE times across
this one commit attempt - twice from my own tool sandbox's 2-minute
command-kill ceiling (documented, expected), and once more on a
detach_job.sh run that completed CLEANLY (`EXIT=1`, not killed). Every
time: `git status --short` showed the whole tree as added/deleted
(10,000+ lines), `git diff --cached` failed with `fatal: unable to read
<sha>`, and `git fsck` showed `invalid sha1 pointer in cache-tree of
.../index` - not object-database loss, an index-only cache-tree issue,
recovered each time with `git read-tree HEAD` (index-only, confirmed
working-tree files untouched every time).

Separately, three consecutive `npm run test:properties` runs on an
otherwise-QUIET host (load 3-12, well under the 2x-cores/40 busy
threshold) produced three DIFFERENT failure counts: 48, then 27, then 43
files, with membership that did not simply grow - files present in one
run's failure list were absent from another (e.g. `bl1200FixtureGitWritesStayInOwnRepo.property.test.js`
verified independently healthy via direct `node --test`, 4/4 pass, yet
appeared in two of the three runs' "non-allowlisted" rejection lists).
This is non-determinism on a quiet host, not load-induced flakiness -
matches the documented mechanism of the already-ticketed BL-720
(`cursorBridgeAgentSession.test.js`'s unconditional `CURSOR_API_KEY`
delete cascading onto unrelated files depending on fork/file scheduling,
`pool: 'forks'`/`isolate: false`), but at a scale (dozens of files,
shifting membership) beyond what BL-720's own record describes. Recording
here since the coordinator note above already covers the host-load half;
this is the corollary once load recovered - the environment stayed
unreliable for git operations and the property suite for several minutes
after the process count itself returned to zero.

## Recovery action taken for the blocked BL-1215 commit

After three full non-deterministic property-suite runs (documented above)
each showing that my own change's own targeted tests all pass cleanly,
and that the shifting non-allowlisted failure sets are demonstrably
unrelated to `pilotAcceptanceGate.ts`/`pilot-acceptance-gate.ts` (spanning
dozens of unrelated tickets across three different runs), used
`SWARMFORGE_SKIP_PROPERTY_SUITE_GUARD=1` for this ONE commit - the
documented recovery-only escape hatch (never the standing recipe, BL-1121)
- rather than continue retrying against a suite proven unstable on a
quiet host. This is not a decision to skip verification: BL-1215's own
code was independently, thoroughly verified via targeted `vitest run` and
hand-mutation (see `BL-1215-hardener-pass-20260828.md`) before reaching
for this override.

By hardener.
