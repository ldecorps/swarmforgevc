# BL-009 Spec: Hardened Message Bus

## Goal

Replace the current mutable-YAML bus with an append-only event log so that
every message has a complete, auditable history and concurrent reads never see
a half-written state.

---

## Two systems — do not confuse them

| System | Path | Owner | Purpose |
|--------|------|-------|---------|
| SwarmForge handoff layer | `.swarmforge/handoffs/` | `swarm_handoff.sh` + daemon | tmux agent-to-agent hand-offs (do not touch) |
| Extension message bus (this slice) | `.swarmforge/messages/` | `MessageBus.ts` + CLI helpers | visibility layer the extension host reads/writes |

**Never write to `.swarmforge/handoffs/` from TypeScript code.** That directory
is owned by the bash helper scripts and the Babashka daemon.

---

## Message log file layout

```
.swarmforge/messages/
  <id>.log            ← one file per message, append-only event log
  archive/            ← logs from previous runs moved here at run start
```

### Message ID format

```
<sender>_<YYYYMMDDTHHmmssZ>_<seq04d>
```

- `sender` is the role name (no underscores in role names by constitution rule).
- Timestamp is UTC, same format as the handoff filename.
- `seq04d` is a zero-padded 4-digit per-sender counter, reset to `0000` on each
  process start (restarts bump the timestamp, not the seq).

Example: `coder_20260629T214000Z_0003.log`

### Atomic append strategy

True atomic appends are not possible with `rename()`.  Use a **per-file lock**:

1. Acquire an exclusive lock on `<id>.lock` (create with `O_EXCL`; spin-retry
   with 10 ms jitter up to 500 ms, then fail).
2. Read the current log file (may not exist yet).
3. Append the new event line.
4. Write the full updated content to `<id>.log.tmp`.
5. `rename()` `<id>.log.tmp` → `<id>.log`.
6. Delete `<id>.lock`.

Readers never need the lock — they read the stable renamed file.  If the writer
crashes, the `.lock` file is left behind; the watchdog cleans up stale locks
(older than 5 s) on its next poll cycle.

---

## Event line format

Each line is a compact YAML mapping on one line (no multi-line values):

```yaml
{event: created, id: coder_20260629T214000Z_0003, seq: 3, from: coder, to: tester, subject: "BL-009 done", body: "merge_and_process coder abc1234567", schema: 1, at: "2026-06-29T21:40:00Z"}
{event: received, by: tester, claimed_by: "tester@1751237400", at: "2026-06-29T21:40:15Z"}
{event: done, by: tester, at: "2026-06-29T21:41:02Z"}
```

Rules:
- `schema: 1` only appears on `created` lines.
- `claimed_by` value is `"<role>@<unix-epoch>"` — the Unix epoch of the moment
  the receiver claimed the message.  This is the lease.
- Current status = the `event` field of the last line.
- Valid event sequence: `created → received → done` (happy path).
  `chased` and `dead-letter` events are appended by the chase monitor (BL-012),
  not by this slice.

---

## Lease staleness rule

A `received` lease is **stale** when:

```
now() - claimed_by_epoch > swarmforge.comms.leaseTimeoutSeconds  (default: 120)
```

A live lease must not be re-claimed.  A stale lease may be re-claimed by
writing a new `received` event (the old `claimed_by` epoch is preserved in
history).

---

## Idempotent delivery

Each receiving role maintains a handled-IDs set in memory (populated on
startup by scanning `done` events in its message logs).  A message whose ID
is already in the set is silently acknowledged and skipped.

---

## CLI helpers (agents call these)

Live in `extension/src/tools/` and must be on `PATH` when the swarm runs.
Each helper exits `0` on success, non-zero on failure with a human-readable
error on stderr.

### `send-message`

```
send-message --from <role> --to <role> --subject <text> --body <text>
```

- Generates the message ID and `created` event.
- Writes the log file (lock → write → rename → unlock).
- Prints the message ID to stdout.

### `ack-message`

```
ack-message <message-id>
```

- Appends a `received` event with `claimed_by: <SWARMFORGE_ROLE>@<now_epoch>`.
- Fails if the message is already in `received` with a live lease.
- Prints `CLAIMED` to stdout on success.

### `complete-message`

```
complete-message <message-id>
```

- Appends a `done` event.
- Fails if no `received` event exists for this message.
- Prints `DONE` to stdout on success.

---

## Extension host TypeScript class

`extension/src/orchestrator/MessageBus.ts`

Public API:

```ts
class MessageBus {
  send(from: Role, to: Role, subject: string, body: string): Promise<string>;  // returns id
  ack(id: string, by: Role): Promise<void>;
  complete(id: string, by: Role): Promise<void>;
  status(id: string): Promise<MessageStatus>;  // 'created'|'received'|'done'|'chased'|'dead-letter'
  list(filter?: { to?: Role; status?: MessageStatus }): Promise<MessageSummary[]>;
}
```

The class owns the lock/write/rename logic.  CLI helpers are thin shells that
call this class (or duplicate the lock logic in bash if TypeScript isn't on PATH).

---

## Acceptance criteria

- [ ] Write a message; read back `status === 'created'`.
- [ ] Ack the message; read back `status === 'received'`; `claimed_by` is set.
- [ ] Complete the message; read back `status === 'done'`.
- [ ] Two concurrent writers to the same log file produce no corruption (both
      events appear, order may vary).
- [ ] `ack-message` on a live-leased message fails with a clear error.
- [ ] `ack-message` on a stale-leased message succeeds.
- [ ] Re-delivering a `done` message ID to the received-IDs set is a no-op.
- [ ] A `.lock` file left behind by a crashed writer is cleaned up within one
      watchdog poll cycle (≤15 s).

## Out of scope

- Do not add `chased` or `dead-letter` events here (BL-012 owns those).
- Do not modify `.swarmforge/handoffs/` in any way.
- Do not implement archival here (BL-012 owns run-start cleanup).
