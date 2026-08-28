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

---

# Twelfth occurrence, 13 minutes later — a human ruling destroyed in transit

Same actor, same turn, and this one had a consequence the previous eleven did
not: it destroyed a human decision on its way into code.

Reflog:

    5a4528936 main@{2026-08-28 13:03:00 +0100}: reset: moving to origin/main

Twelve commits became unreachable, including all seven restored 21 minutes
earlier by the eleventh occurrence's cherry-picks. New casualties:

| Commit | Content |
|---|---|
| `fb0a63d31` | the eleventh occurrence's own evidence file |
| `11f7c7539` | BL topic record for BL-1207 |
| `5a614f1b7` | BL topic record for BL-1244 |
| `3a3181e52` | BL-1244 `human_approval: approved` — a real human tap |
| `3a6222f15` | Mint BL-1244 |
| `133596717` | **BL-1230 amended for the human's ruling** |
| `22395f139` | restore of the destroyed 2026-08-28 answer record |

Three human decisions have now been discarded by this sweep in one hour: the
BL-1242 and BL-1243 approval taps (twice each, across both occurrences) and the
BL-1244 tap. A reset does not distinguish agent bookkeeping from a decision a
person made by hand.

## The consequence, which is the point

`133596717` carried the human's ruling — "Exempt git-ignored dirs (tmp/) by
construction", asked and answered while BL-1230 was at architect review — into
BL-1230's spec, feature file and invariant 1. It was committed at 13:00:39 and
destroyed at 13:03:00. BL-1230 was merged by QA and closed at 13:04:03.

The guard that shipped therefore has `SKIP_DIR_NAMES = {node_modules,
.worktrees}` and no ignore exemption: it reports the architect's own scratch
fixtures and turns that worktree's suite red, which is precisely what the human
ruled against. Nobody did anything wrong — the coder built against the contract
as it stood, the architect reviewed it, QA gated and landed it. The ruling
simply was not there any more when they read it.

Carried forward by **BL-1246**, minted the same day, since a closed ticket is
not the place to describe unbuilt work.

## What this adds to BL-1236's case

The prior occurrences cost bookkeeping and re-work. This one shows the sweep
can silently revert a human's decision mid-pipeline and let the pipeline
complete, green, around the hole — with no bounce, no conflict, and no signal
to anyone that the contract changed underneath them. Restoration by cherry-pick
is not a mitigation either: everything restored at 12:52 was destroyed again at
13:03, eleven minutes later.

## Corroboration from a second role

The coordinator independently reported the same occurrence by priority-00 note:
"BL-1236 12th: reset wiped my BL-1228 close, re-closed 82efa6e->a2e8f42". So the
13:03 sweep also discarded a completed backlog close, which its owner had to
redo. Two roles, working on unrelated tickets, lost work to the same one-second
decision — neither would have seen the other's casualty.
