# BL-1236 evidence — eleventh reset-to-origin occurrence, caught mid-turn

**Recorded:** 2026-08-28, by the specifier, while working the architect's
priority-00 note about BL-1230's guard firing on live scratch repositories.
**Owner:** BL-1236 (`backlog/paused/BL-1236-reconcile-conflict-prediction-from-git-verdict.yaml`).
**Relation to occurrence ten:** same actor, same decision line, one turn later.
This one is recorded because it landed *between two commits of a single agent
turn*, which is the tightest window yet observed and rules out "the agent
should have pushed sooner" as a remedy.

## The decision line

`.swarmforge/daemon/handoffd.log.20260828T115126Z` (rotated out of the live log
by the daemon restart 67 seconds later — recoverable only because
`start_handoff_daemon.sh:104` **rotates** rather than truncates):

    2026-08-28T11:50:16.417Z  push-sweep diverged delivered
    2026-08-28T11:50:17.383Z  master-main-reconcile drift ahead=7 behind=62
    2026-08-28T11:50:18.564Z  master-main-reconcile conflict predicted-conflict-colliding-local-ahead
    2026-08-28T11:50:19.623Z  master-main-reconcile reconciled

Reflog on `main`:

    cb742b22b main@{2026-08-28 12:50:19 +0100}: reset: moving to origin/main

The verdict `predicted-conflict-colliding-local-ahead` is followed 1.06s later
by `reconciled`, and the only act between them is a reset that discards the
entire ahead set. `behind=62` is new relative to occurrence ten (`ahead=9
behind=30`) — the further origin runs ahead, the more certain the prediction is
to fire.

## The seven casualties — all restored

`ahead=7` matches the casualty count exactly; nothing was lost beyond it.

| Commit | Content | Restored as |
|---|---|---|
| `ea99fd5ed` | BL topic record for BL-1242 | `c82bed77b` |
| `b91b69d31` | Mint BL-1242 (merge-up deletes rebuilt work) + feature + evidence | `7c8705f6d` |
| `1a59b0223` | BL-1242 `human_approval: approved` (real human tap) | `731d7d1fd` |
| `021e41702` | Mint BL-1243 (Live Screen activity signal) + feature | `ba49629b2` |
| `86066164d` | BL topic record for BL-1243 | `751bde649` |
| `b5fc948a6` | BL-1243 `human_approval: approved` (real human tap) | `0e05a6d79` |
| `2c11c6c4b` | BL-1230 spec-time notes on the live guard fire | `5ea398925` |

Restored by `git cherry-pick` in original order; every file verified present
afterwards. Two human approval taps were among the casualties for the second
occurrence running — a reset does not discriminate between agent bookkeeping
and a decision the human made by hand.

## Why this occurrence is worth its own record

1. **It fired inside one agent turn.** The specifier committed `2c11c6c4b` at
   12:49:23 and the reset landed at 12:50:19 — 56 seconds later, while the same
   turn was still running. The agent then referenced `2c11c6c4b` in a handoff
   note to the architect that was already dangling by the time it was read.
   A remedy phrased as "land and push promptly" cannot close a 56-second window.
2. **The evidence is destroyed on a timer.** The decision line survived only
   because it was rotated, not truncated, and because it was looked for within
   three minutes. Daemon restarts today ran at 11:36:03, 11:42:06, 11:48:04 and
   11:51:26 — roughly every 3-6 minutes — so the live `handoffd.log` holds only
   the current instance, and any occurrence not investigated immediately is
   reconstructed from casualties alone (as occurrences one through nine were).
3. **A downstream handoff carried a dead hash.** The reset silently invalidated
   a commit id already in flight in a `note`. Any note naming a commit is a
   dangling reference the moment this fires; the sender has to re-send.
