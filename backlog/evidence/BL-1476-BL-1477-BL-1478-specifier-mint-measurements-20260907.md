# Specifier mint measurements - BL-1476, BL-1477, BL-1478 (2026-09-07)

Read-only measurements taken on this host while draining the root intake
`INTAKE-turn-profile-producer-unbounded-transcript-walk.md`. No production
store was written: the two dry runs below inject the write/record seams.

## Turn-profile producer (BL-1476)

Phase timing over the coder role's transcripts, warm page cache, compiled
`extension/out` of main 53b4cd1785, via a scratch script calling the
production functions with the write seam unused:

| Phase | Result | ms |
|---|---|---|
| `listTranscriptJsonlPaths` | 272 files (414 MB) | 3 |
| `assessTranscriptReadability` | 272 readable, 0 unreadable, 0 torn | 2841 |
| `walkTranscriptFiles` (readable) | 93393 intervals | 3377 |
| `readTranscriptUsage` (sibling's read) | 33907 usage records | 2494 |

Transcript volume per role slug under `~/.claude/projects/` (2.2 GB total):
coder 272 / 414 MB, QA 216 / 273 MB, documenter 244 / 218 MB (others as
the intake's table; the master slug is shared by specifier + coordinator).

Live daemon log `.swarmforge/daemon/handoffd.log`, `sweep=turn-profile-producer-sweep`:

```
19:45:51Z ms=32438   19:47:03Z ms=32531   19:48:06Z ms=28154   19:49:06Z ms=27433
19:50:08Z ms=28224   19:51:13Z ms=32045   19:52:14Z ms=29255   19:53:19Z ms=30802
```

Failure report `handoffd-failure-20260907T180330Z.log` (reason stalled):
`turn-profile-producer-sweep ms=38876`; next slowest that cycle
`post-qa-branch-sweep ms=15779`; `context-telemetry-producer-sweep ms=780`
with NO `context-telemetry-producer` output line (exit non-zero, see below).

Ceilings: `daemon_cycle_guard_lib.bb` `default-subprocess-wait-bound-ms`
60000; `handoffd_supervisor.bb` `SUPERVISOR_IN_SWEEP_BUDGET_MS` 225000.

Series builder check: `buildTurnProfileSeries` is integer duration sums per
category per stage (`turnProfile.ts` `durationMs`/`categoryShare`);
`overheadIntervals` runs per file inside `walkTranscriptFiles`' loop;
`attributeTrail` with an empty trail returns each interval unchanged. So
per-file summaries reproduce the full-walk record exactly (BL-1476
invariant 1).

## Context-telemetry producer dark (BL-1477)

Dry run of `runContextTelemetryProducer` with `recordFn` a counter:

```
THREW after ms=534: SyntaxError: Unexpected token ' ', "          "... is not valid JSON
    at JSON.parse  at extension/out/metrics/contextTelemetryProducer.js:125:29 (readPersistedContextEvents)
```

Store inspection `.swarmforge/telemetry/context-events.jsonl` (61112320
bytes, mtime 2026-08-30 08:05Z):

```
lines=234114 good=234113 bad=1 firstBadIdx=234113 (the LAST line)
last line: about 4000 NUL bytes (0x00), no trailing newline
last parseable record: idx=234112 timestamp=2026-08-30T08:04:46Z
```

`bb swarmforge/scripts/context_telemetry_cli.bb summary` on the live store:
stack trace from `context-telemetry-store/read-events!`
(context_telemetry_store.bb:37) - the bb reader throws on the same line.

Daemon log: last `context-telemetry-producer RECORDED` line anywhere
2026-08-30T07:59:41Z; live log has 0 `context-telemetry-producer ` output
lines and one `sweep-boundary ... ms=467-780` per cycle.

Host: `uptime -s` = 2026-08-30 10:25:43 BST (09:25:43Z); daemon failure
report `handoffd-failure-20260830T080016Z.log` reason dead at 08:00:16Z.
The zero-filled tail is consistent with a write in flight at an unclean
shutdown before that boot.

Sibling read shape: `deriveEventsForRoleGroup` calls
`walkTranscriptFiles(transcriptPaths)` and discards the result, then
`readTranscriptUsage` reads every file again. Rate before it stopped: 234k
records over 2026-08-21..08-30 (about 26k/day), so about 200k events behind
today, each recorded through its own `bb context_telemetry_cli.bb record`
subprocess.

## Silent non-zero exit (BL-1478)

`grep -c 'when (zero? exit)' swarmforge/scripts/handoffd.bb` = 22; the four
compiled-tool sweeps `resource-sample-sweep!`, `context-telemetry-producer-sweep!`,
`turn-profile-producer-sweep!`, `ritual-ledger-producer-sweep!` all log
stdout only on exit zero and drop `:err`. `run-compiled-tool!` (the anchor
BL-1478 pins) occurs 0 times in handoffd.bb and daemon_cycle_guard_lib.bb
today.
