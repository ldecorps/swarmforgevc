# Certifying an operator hotfix

## Background

Operator / Cursor / hand-adopted hotfixes land straight on `main`, outside the
normal `specifier → coder → cleaner → architect → hardener → documenter → QA`
pipeline. Nothing else in the constitution catches that a hotfix is "live but
never reviewed" — BL-810's fix was only certified because a human happened to
ask for BL-811, and the Darwin orphan-janitor fix (`f9cf29c2`, 2026-08-07) sat
as an unticketed root intake with no detector at all until BL-848.

BL-848 gives the swarm a durable ledger (`backlog/hotfix-ledger.yaml`) and a
recurrent check (riding `operator_runtime.bb`'s existing tick loop) that keeps
surfacing an uncertified hotfix until a human has been asked and has answered
— never on green tests alone.

**The load-bearing rule: detection is DECLARED, not inferred.** The specifier
measured every plausible derived signal (missing commit byline, no ticket id
cited, cites a ticket that reached `done`) over 600 commits of `main` and each
one failed on a real hotfix — worst case, "cites a done ticket" FALSELY
CERTIFIED `f9cf29c2`, which only cites BL-811 as a posture reference, not as
its own review. A hotfix is metadata-indistinguishable from ordinary pipeline
work. So: **if you land a hand/operator/Cursor hotfix with a functional
change, you must declare it.**

## Landing a hotfix: add the trailer

When you commit a hotfix directly to `main` (or the specifier commits one on
the human's behalf), add a `Hotfix-Certification: pending` trailer to the
commit message, after the byline:

```text
Fix the thing that was on fire.

By specifier.

Hotfix-Certification: pending
```

That trailer is the ONLY signal the recurrent check trusts. An undeclared
hotfix does not automatically get caught — the check's derived scan
(`unaccounted-commits`, below) is a best-effort review queue, not a safety
net. Declare it.

## What happens next (automatic)

On its next due tick (`HOTFIX_CERT_INTERVAL_MS`, default 1h),
`operator_runtime.bb`'s `hotfix-certification-sweep!`:

1. Scans recent `main` commits for the trailer and appends any commit not
   already in the ledger as a new entry — `state: pending`, no stamp ticket,
   no human decision. It never re-adds a commit already in the ledger.
2. For every OPEN entry (not yet `certified`/`waived`) whose resurfacing
   cooldown (`HOTFIX_CERT_RESURFACE_MS`, default 6h) has elapsed, it surfaces
   the entry again — logged to `runtime.log`, and additionally as a `note` to
   the **coordinator** when the entry still has no `stamp_ticket`. An open
   entry is never permanently silenced; only certification or a waiver stops
   the resurfacing (invariant 2).
3. It also runs the honestly-scoped derived scan: any functional `main`
   commit that declares no hotfix, has no ledger entry, AND cites no ticket
   that has reached `done` is logged as `unaccounted for` — explicitly
   labeled a review queue, never a certification verdict (R1's own
   false-negative evidence applies here too).

The sweep **never** writes `state: certified`/`waived`, `human_decision`, or
`decided_at` — that would auto-fire certification on green tests alone,
exactly what invariant 3 forbids. It only appends new `pending` entries and
refreshes the derived `state` snapshot on existing ones.

## The state machine

```
pending  ──(stamp ticket minted)──▶  stamp-open  ──(stamp ticket reaches done)──▶  awaiting-human
                                                                                          │
                                                                       (human records a decision)
                                                                                          │
                                                              ┌───────────────────────────┴──────────┐
                                                              ▼                                       ▼
                                                          certified                                waived
```

- **pending** — no stamp ticket yet. The sweep nudges the coordinator to mint
  one (a BL-811/BL-849-shaped review ticket: confirm or refute, don't rewrite
  from scratch).
- **stamp-open** — the stamp ticket exists and is still moving through the
  pipeline (`backlog/active/` or `backlog/paused/`).
- **awaiting-human** — the stamp ticket reached `backlog/done/` (QA passed).
  This is where the Concierge's existing `ApprovalRequested` detector already
  surfaces the ask — the stamp ticket's own `human_approval: pending` +
  `approval_context` routes to the human's Approvals topic with
  Approve/Amend/Reject buttons. No new ask channel was built for this (R4).
- **certified** / **waived** — only reached once a human decision has been
  **recorded in the ledger itself** (next section). Reaching `done` is not
  enough on its own; see the anomaly case below.

If a stamp ticket reaches `done` with `human_approval` already something
other than `pending` and the ledger still has no recorded decision, the sweep
logs an anomaly (`hotfix-certification [<commit>] ... check wiring`) instead
of silently treating it as resolved — that combination means the normal
ticket-approval flow ran without the ledger decision being recorded, which is
worth a human's attention.

## Recording the human decision

`human_approval` on a ticket means "OK to build/promote" — it is a different,
older field used across the whole backlog, not a hotfix certification
decision. The ledger's own `human_decision` field is the one durable fact
that actually certifies or waives an entry, and it is **only ever written by
hand or via the helper CLI below** — never by the recurrent check.

Once the stamp ticket has passed QA and the human has answered the Approvals
prompt (or otherwise told you directly: certify, or waive review):

```sh
# Link a freshly-minted stamp ticket to its ledger entry (do this once the
# review ticket is minted, so the sweep stops nudging the coordinator for it)
bb swarmforge/scripts/hotfix_ledger_update.bb . --link <commit> BL-nnn

# Record the human's decision once the stamp ticket has reached QA/done
bb swarmforge/scripts/hotfix_ledger_update.bb . --decide <commit> approved
bb swarmforge/scripts/hotfix_ledger_update.bb . --decide <commit> waived
```

`<commit>` is the ledger entry's 10-hex `commit` field. Commit the resulting
`backlog/hotfix-ledger.yaml` change — the ledger is meant to travel with the
repo (R2), so an uncommitted decision is invisible on every other worktree
and host.

To register a brand-new hotfix commit yourself (rare — the sweep normally
does this from the trailer on its next tick):

```sh
bb swarmforge/scripts/hotfix_ledger_update.bb . --new <commit> "<subject>" [<YYYY-MM-DD>]
```

## Why this lives on `operator_runtime.bb`, not babysitterd or the coordinator

The ticket's preference order was coordinator lean/closing pass, then
babysitterd, then `operator_runtime`. The closing ceremony isn't live yet
(blocked on other work); babysitterd's checks are all swarm-liveness signals
(panes, processes, mailboxes) routed to a CRIT/WARN health channel, not a
work-routing one — a bad fit. `operator_runtime` already has the cadence gate
this needs (`operator-lib/timer-due?`, the same one `SWARM_CHECK_TIMER` uses)
and, critically, it **survives hibernation** — `closing-pass-sweep!` parks the
swarm when the backlog drains, which is exactly when an uncertified hotfix is
most likely to be forgotten. babysitterd and the coordinator's own pane are
both asleep in that window; `operator_runtime` is not.

## Seeded debt (first tick)

`backlog/hotfix-ledger.yaml` ships with two entries so the recurrent check has
live work on its very first tick:

- `f9cf29c29b` (Darwin orphan-janitor) — `stamp-open`, linked to BL-849.
- `f175bc56d1` — the one genuine `unaccounted` finding from the 600-commit
  scan the specifier ran while designing this ticket, seeded directly as a
  `pending` entry so the sweep nudges the coordinator to mint it a stamp
  ticket on its first tick.

BL-850 and BL-851 are two more minted stamp tickets for open hotfixes, but
both underlying hotfixes were still **uncommitted** in the master checkout at
BL-848 mint time — there is no commit to key a ledger row on. Once either
lands as a declared commit, add its entry with `--new` (or let the sweep pick
it up from the trailer) and `--link` it to its ticket.

## Tunables

| Env var | Default | Meaning |
|---|---|---|
| `HOTFIX_CERT_INTERVAL_MS` | `3600000` (1h) | How often the sweep runs at all — an hourly git scan does not run on every 30s tick. |
| `HOTFIX_CERT_RESURFACE_MS` | `21600000` (6h) | Per-entry cooldown before an open entry is surfaced again. |

## Related

- `swarmforge/scripts/hotfix_certification_lib.bb` — the pure decision core
  (ledger parse/render, state machine, unaccounted-commit scan).
- `swarmforge/scripts/operator_runtime.bb`'s `hotfix-certification-sweep!` —
  the impure wiring (git scan, ticket status resolution, coordinator note).
- `backlog/done/BL-811-swarm-review-host-queue-starvation-hotfix.yaml` — the
  pattern this ticket generalizes (review ticket + human ruling before
  `satisfied-by-hotfix`).
