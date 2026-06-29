# Handoff Implementation Status

## Summary

**HANDOFF-PROTOCOL.md** describes the **aspirational, full-featured system** with a daemon postman. The **current implementation** is simpler: agents write handoff files directly.

This document clarifies what exists now vs. what's planned.

## Current Implementation (v1 — Today)

### How Agents Send Handoffs

**Coder, cleaner, specifier, coordinator:** Write handoff files directly.

```bash
# 1. Prepare handoff content
cat > /tmp/handoff.txt << 'EOF'
id: 20260629T163000Z_000010_from_coder
from: coder
to: cleaner
priority: 50
type: git_handoff
role: coder
commit: a1b2c3d9e8f7654
created_at: 2026-06-29T16:30:00Z

Re-read your role and constitution.

merge_and_process coder a1b2c3d9e8
EOF

# 2. Write atomically to inbox (temp + rename)
INBOX_DIR=".swarmforge/handoffs/inbox/new"
TIMESTAMP="20260629T163000Z"
SEQ="000010"
FINAL_NAME="${INBOX_DIR}/50_${TIMESTAMP}_${SEQ}_from_coder_to_cleaner.handoff"

cat /tmp/handoff.txt > "${INBOX_DIR}/.tmp_${SEQ}"
mv "${INBOX_DIR}/.tmp_${SEQ}" "$FINAL_NAME"
```

### How Agents Receive Handoffs

Agents check `.swarmforge/handoffs/inbox/new/` themselves:

1. **List** files in `inbox/new/` sorted by priority, timestamp, sequence
2. **Read** the highest-priority unprocessed handoff
3. **Act** on it (implement, review, route, etc.)
4. **Move** the file to `inbox/completed/` when done
5. **Repeat** until `inbox/new/` is empty

### No Wake-up Notifications

Currently, agents are responsible for:
- Periodically checking their inbox
- Or being notified by the coordinator/external trigger

The tmux wake-up mechanism described in HANDOFF-PROTOCOL.md is **not yet implemented**.

## Aspirational Implementation (v2 — Future)

The full protocol document describes:

### Daemon: `handoffd`

- Polls agent `outbox/` directories
- Validates and delivers files to recipient `inbox/new/`
- Sends tmux notifications when new mail arrives
- Handles delivery retries and failure modes
- Maintains audit trail

### Helper Scripts

**For agents:**
- `ready_for_next.sh` — Check inbox and print next task
- `done_with_current.sh` — Mark task complete and get next

**For handoff creation:**
- `swarm_handoff.sh` — Validate and queue outbound drafts atomically

**For queue management:**
- `ready_for_next_task.sh` — Single-task mode
- `done_with_current_task.sh` — Complete one task
- `ready_for_next_batch.sh` — Batch mode (collect equal-priority tasks)
- `done_with_current_batch.sh` — Complete a batch

### Automatic Wake-ups

Daemon sends tmux messages like:
```
You have new handoff mail. If idle, run ready_for_next.sh.
```

## Why Two Versions?

### v1 (Current): Simple, Direct
- ✅ Minimal infrastructure
- ✅ No daemon to manage
- ✅ Agents have full control
- ❌ Agents must poll
- ❌ No automatic notifications
- ❌ Manual inbox state management

### v2 (Aspirational): Robust, Automated
- ✅ Automatic delivery and notifications
- ✅ Helper scripts hide queue complexity
- ✅ Daemon enforces atomicity and delivery
- ❌ More complex (daemon + 8+ scripts)
- ❌ More moving parts
- ❌ Harder to debug

## Migration Path

When v2 is implemented:

1. Daemon (`handoffd`) starts alongside tmux session
2. Helper scripts become available on PATH
3. Agents update from direct file writes to calling helpers
4. Protocol behavior remains the same
5. Agents receive automatic notifications instead of polling
6. Queue management becomes deterministic

## For Agents Right Now

✅ **DO:**
- Write handoff files following HANDOFF-PROTOCOL.md format
- Use atomic writes (temp file + rename)
- Write to `.swarmforge/handoffs/inbox/new/`
- Use the correct priority level for your role
- Include all required headers (id, from, to, priority, type, created_at, etc.)

❌ **DON'T:**
- Wait for `swarm_handoff.sh` helper (doesn't exist yet)
- Wait for `ready_for_next.sh` helper (doesn't exist yet)
- Expect tmux wake-up notifications
- Assume daemon delivery and retry logic

## Reference

- **HANDOFF-PROTOCOL.md** — Full specification of the protocol and v2 design
- **swarmforge/roles/*.prompt** — Each role's specific handoff details
- **Implementation notes** — This file
