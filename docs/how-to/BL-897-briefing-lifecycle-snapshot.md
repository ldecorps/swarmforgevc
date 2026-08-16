# One briefing send, one backlog history walk: the shared lifecycle snapshot

## Background

Three sections of a morning briefing send each need ticket lifecycle data
derived from the backlog's git history (`deriveTicketLifecycles`): the
cost-health sidecar (`emit-cost-health-sidecar.ts`), the digest line
(`briefing-digest-line.ts`) and the not-done burndown chart
(`render-briefing-burndown.ts`). Before BL-897 each ran that walk itself, in
its own `node` process — three full-history `git log --name-status --
backlog/` walks (~7s CPU each) per send. On a loaded host also rasterizing
diagrams, that turned a tens-of-seconds send into a multi-minute saturation
spike, occasionally severe enough to keep the send from going out at all.

## The mechanism

`handoffd.bb`'s briefing sweep now runs `emit-lifecycle-snapshot.js` once,
before any consumer CLI, at the same point in its cadence as the sections it
feeds:

- **`extension/src/metrics/lifecycleSnapshot.ts`** defines the snapshot's
  shape (`{ dayKey, generatedAtIso, records }`) and its fixed path,
  `lifecycleSnapshotPath(projectRoot)` →
  `.swarmforge/briefing/lifecycle-snapshot.json`. Already covered by the
  bare `.swarmforge/` `.gitignore` entry — never a committed artifact
  (scenario 05).
- **`extension/src/tools/emit-lifecycle-snapshot.ts`** (`ensureLifecycleSnapshot`)
  is idempotent within a UTC day: if a snapshot already on disk carries
  today's `dayKey`, it is reused and no walk happens; otherwise it walks once
  and writes a fresh one. Safe to call unconditionally on every daemon tick —
  the real walk happens at most once per UTC day.
- Each consumer CLI now accepts an optional `--snapshot <path>` flag
  (`briefingSnapshotArgs.ts`'s `parseSnapshotPath`). When given a path whose
  contents pass `isUsableSnapshot` — present, valid JSON, and today's
  `dayKey` — it reads the shared `records` instead of re-deriving them
  (`readLifecycleSnapshot`). A missing, unreadable, or stale (yesterday's)
  snapshot degrades silently back to the consumer's own
  `runGitLog`/`deriveTicketLifecycles` walk, exactly as it worked before this
  ticket (scenario 03) — a malformed `--snapshot` never aborts the CLI, matching
  the existing "never crash the briefing send" contract these CLIs already
  have.
- `handoffd.bb` passes the same `lifecycle-snapshot-path` to all three
  consumer invocations, so every section of one send reads the identical
  records — no two sections of one send can disagree about a ticket's state
  (scenario 02).

Babashka cannot import the compiled TS module, so `handoffd.bb` keeps its own
copy of the snapshot path (`(fs/path project-root ".swarmforge" "briefing"
"lifecycle-snapshot.json")`) — kept in sync by hand with
`lifecycleSnapshotPath`'s `path.join`.

## Verifying

1. Trigger a briefing send with the burndown, sidecar and digest sections all
   enabled on a quiet host. Confirm (process accounting, or the counting seam
   `emit-lifecycle-snapshot.ts`'s injectable `runGitLogFn` gives tests) that
   the backlog is walked exactly once, not three times.
2. Run any consumer CLI by hand with no `--snapshot` flag
   (e.g. `node extension/out/tools/render-briefing-burndown.js`) — it still
   derives its own lifecycle data and renders normally (scenario 04).
3. After a send, `git status` in the master checkout — the snapshot file
   never appears, tracked or untracked (scenario 05).
4. Delete the snapshot, corrupt it to invalid JSON, or backdate its `dayKey`
   to yesterday mid-send — the affected consumer falls back to its own walk
   and the email still arrives complete (scenario 03).

## Related

`docs/how-to/BL-514-remote-control-health-and-ensure-wiring.md` — a
different `./swarm ensure` sweep on the same daemon, unrelated data.
