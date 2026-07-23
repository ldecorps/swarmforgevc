# Aged-note actionability in mono-router: draining dormant mailboxes

## Background

Under `config rotation router` (mono-router packs), one resident agent rotates through every pipeline role, and the other roles are dormant mailboxes with no standing pane. The handoff daemon's chase sweep decides which dormant mailboxes are worth rotating the resident for — and by default, it counts only in-process work and git_handoffs. This protection prevents broadcast thrash when five-role merge-up notes land.

The problem: a solo `type: note` to a dormant role (such as a design kickoff to the specifier) sits unread, because the chase sweep refuses to rotate for it. The delivery wake remaps to the resident pane, which runs `ready_for_next` as its current role, finds its own mailbox empty, and burns a turn on `NO_TASK`. A starved mailbox can sit for hours.

**Aged-note actionability** solves this: a fresh note stays broadcast-noise-level non-actionable, but a note sitting in a dormant mailbox past a configurable threshold (`note_actionable_after_ms`, default 20 minutes) becomes actionable. The resident rotates to pick it up. Everything else about rotation — newest-mail ordering, busy gate, cooldown, per-sweep budget — is unchanged.

## Configuration

### `note_actionable_after_ms`

**Location:** `swarmforge.conf` (or any pack's effective config)

**Type:** positive integer (milliseconds), or absent for default

**Default:** `1200000` (20 minutes)

**Examples:**

```text
# Explicit threshold
config note_actionable_after_ms 1200000

# Or shorten for a live investigation
config note_actionable_after_ms 60000  # 1 minute — faster pickup, higher rotation churn
```

### Resolution and degradation

The effective config is read at daemon startup (see `handoffd.bb` and BL-216). A missing, malformed, zero, or negative value silently degrades to the default. You cannot set a zero or negative threshold to disable the rule — that would reinstate broadcast thrash.

To override for a live investigation:
1. Edit `swarmforge/swarmforge.conf` (or the running pack's `.conf` file)
2. Restart the handoff daemon:
   ```sh
   start_handoff_daemon.sh
   ```

The resident and other panes do NOT need restarting.

## How it works

1. **Parcel age is measured from the handoff header**, not the file mtime. The daemon uses the first parseable of `enqueued_at` (how long it has sat in THIS mailbox) or `created_at` (when it was born). File mtime is ignored — worktree hot-syncs touch files and would give false age.

2. **Fresh notes are protected.** A note delivered while the resident is mid-parcel drains on the normal pipeline before it ages in, no rotation thrash.

3. **Aged notes trigger rotation.** When the chase sweep finds an aged note in a dormant role's inbox, the resident rotates to that role, `ready_for_next` drains it, and the resident returns home (to `config rotation_home`, usually **coder**).

4. **Newest actionable mail still wins.** If both an aged note and a git_handoff are actionable in different dormant roles, the newest one (by created_at) is rotated to first.

5. **Delivery wake is suppressed for dormant notes.** When a note lands in a dormant role's mailbox while the resident is elsewhere, no wake is sent to the resident. The aged-note chase sweep will pick it up when it qualifies. This prevents burning turns on `NO_TASK` wakes meant for mail that won't be processed for twenty minutes.

## Observing the behavior

### In the daemon log

Watch `handoffd.log` for these patterns:

- **Fresh note, no rotation yet:**
  ```
  deliver-notify-skip-dormant-note specifier note
  ```
  The resident wake is suppressed; the specifier's mailbox now holds the note.

- **Note aging into actionability (~20 minutes later):**
  ```
  chase-rotate specifier aged-note
  ```
  The resident rotates to specifier to drain it.

- **Rotation refused (busy or cooldown):**
  ```
  chase-rotate-skip-busy specifier aged-note
  chase-rotate-skip-cooldown specifier aged-note
  ```

### Live investigation with shorter threshold

```sh
# Edit the config to 1 minute for testing
sed -i 's/config note_actionable_after_ms.*/config note_actionable_after_ms 60000/' swarmforge/swarmforge.conf

# Restart the daemon (this alone picks up the new config)
start_handoff_daemon.sh

# Send a test note to a dormant role
swarm_handoff.sh <<'EOF'
type: note
to: documenter
priority: 50
message: test note
EOF

# Wait ~1 minute in the daemon log for:
#   chase-rotate documenter aged-note
# The resident should rotate and drain it immediately.
```

## Pacing a five-role broadcast

When QA sends a merge-up broadcast to all five pipeline worktree roles (coder, cleaner, architect, hardender, documenter), they eventually become actionable in all five dormant mailboxes. The resident drains them as follows:

- Rotate to newest-actionable role
- Drain its mailbox (`ready_for_next` handles this)
- Return home (coder) via `ROTATE_HOME` backstop
- Wait for the next chase sweep (~30s default cooldown)
- Rotate to the next aged role
- Repeat until all five are empty

This is **one rotation per sweep** (never mid-turn, never within cooldown), and **all five mailboxes eventually drain** without human action. The pacing is pinned in BL-576 scenario 05 to prevent silent regression into rotation thrash.

## When NOT to change the default

- **During normal operation:** 20 minutes is long enough that a QA merge-up broadcast landing during active work drains on the normal pipeline before aging in. The default prevents thrash.
- **If you trust manual rotation:** If you always `rotate_to_role.sh specifier` after dispatching design work, the default does not matter.

## When TO change the threshold

- **Starved specifier workflow:** If the specifier gets design notes only occasionally and they sit for hours, shorten to 5–10 minutes to pick them up faster.
- **Live incident debugging:** Shorten to 1 minute to test rotation quickly without waiting.
- **High-churn pack:** If your pack deliberately rotates the resident through roles frequently for other reasons, you may tolerate higher rotation churn and shorten the threshold.

## Troubleshooting

### Aged note never rotates

1. Confirm the daemon is running: `pgrep handoffd`
2. Check `handoffd.log` for `deliver-notify-skip-dormant-note` (note was delivered to dormant role)
3. Wait for the threshold to pass, then check for `chase-rotate` logs
4. If no rotation appears, check the note's `enqueued_at`/`created_at` headers (should be in the handoff file)
5. Confirm the role's inbox file exists: `.swarmforge/handoffs/<role>/inbox/new/` (or `.swarmforge/handoffs/inbox/new/` for master-resident roles)

### Rotate happening too often

The resident is rotating more than expected. This is usually:
- Multiple aged notes in different dormant roles (correct behavior — drain them one per sweep)
- Threshold set too short (edit `swarmforge.conf`, restart daemon)
- Or an unrelated rotation gate issue (busy pane, not respecting cooldown — file a ticket)

### How to disable aged-note rotation (not recommended)

You cannot set the threshold to zero or negative — it will silently degrade to default. If aged-note rotation is causing problems, the proper fix is to file a ticket (BL-XXX) so the mechanism can be refined. In the meantime, as a temporary workaround, you can:

1. Manually rotate the resident when design notes arrive: `rotate_to_role.sh specifier`
2. File a ticket describing why the default threshold does not fit your workflow

---

**Related:** See `swarmforge/PIPELINE.md` ("Mono-router idle and open slots" + "Aged-note rotation") for the full rotation mechanics and the integration with the chase sweep.
