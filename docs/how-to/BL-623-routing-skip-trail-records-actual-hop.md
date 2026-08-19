# BL-623: Routing skip trail records what the hop actually skipped

When required-stages routing is enabled, every forward `git_handoff` that skips canonical stages between the sender and the **delivered** recipient leaves a durable skip record — in the envelope header and in `.swarmforge/routing-skips.jsonl` — regardless of whether the router rewrote the destination or the sender pre-addressed a later required stage directly.

This runbook explains what gets recorded, the emitted shapes, and how to grep the trail for a ticket.

## What changed (BL-623)

Before BL-623, the skip record was produced **only** when `route-required-stages` rewrote the literal `to:` field. If a sender read the ticket and addressed a handoff directly to a later required stage (for example, coder → QA on `[coder, qa]`), delivery was correct but the trail was empty — no `routing_skipped` header and no jsonl line.

After BL-623, the record derives from **what the hop actually skipped**: canonical stages strictly between the sender and the delivered recipient (`required_stages_lib.bb` `hop-skipped-stages`), plus the rewritten-away literal recipient on rewrite branches. Whenever that set is non-empty, the header and journal line are emitted.

Delivery behaviour is unchanged. Recording only.

**As of BL-951**, the fourth bullet below no longer applies — a record is
produced whatever the declaration state, not only when the ticket carries a
valid `required_stages`. Before BL-951, `route-required-stages` returned
before recording whenever `resolve-effective` read `:default-full` — field
absent, unparseable, present-but-invalid, or the sender's worktree simply had
no active-ticket copy of the field yet (the BL-317/BL-325 staleness window).
That made the conservative default — "no declaration, assume everything is
required" — the one case with no audit trail: a coder→QA hop that jumped four
stages left no `routing_skipped` header and no jsonl line whenever the
sender's ticket copy lacked the field, even though an identical jump on a
declaring ticket recorded both. The record now derives from the hop itself
(`hop-skipped-stages sender delivered`), which needs no declaration to
compute, so it runs for every forward hop. Only the **rewrite** decision — not
recording — is still gated on a usable declaration.

A present-but-invalid declaration also now surfaces its rejection reason on
the record itself: `rejected="<reason>"` on the envelope header, and a
`rejection-reason` key on the jsonl line (see "Emitted shapes" below).
Previously `resolve-effective`'s `:rejected?`/`:rejection-reason` were
computed but never read by the caller — folded silently into the same
no-record bucket as "no declaration at all", against `required_stages_lib`'s
own docstring.

## When a record is produced

All of the following must hold:

- `SWARMFORGE_REQUIRED_STAGES_ROUTING=1` (or routing enabled in config)
- The handoff is a forward hop (`routes-forward?` — sender before recipient in the canonical chain)
- Single recipient, no `rejection_reason` or `reroute_reason` header
- The hop skips at least one canonical stage between sender and delivered recipient

The ticket's `required_stages` declaration state (absent, invalid, staleness-window-nil, or fully declared) no longer gates recording — see "As of BL-951" above. It still gates whether the router **rewrites** the literal recipient.

**No record** when:

- Routing kill-switch is off
- Adjacent hop (documenter → QA on the full chain skips nothing between them)
- Backward bounce (QA → coder with a rejection reason)

## Emitted shapes

### Envelope header

Grammar (from `format-routing-skipped` in `swarmforge/scripts/swarm_handoff.bb`):

```
routing_skipped: <ticket-id> <from>-><to> skipped=<stage>[,<stage>...][ reasons=<stage>:<reason>[;<stage>:<reason>...]][ rejected="<reason>"]
```

Example:

```
routing_skipped: BL-900 coder->QA skipped=cleaner,architect,hardender,documenter reasons=cleaner:not touched, config-only change;architect:no design impact;hardender:existing coverage suffices;documenter:no user-facing behavior change
```

`routing_skipped` is reserved — agents must not write it in drafts.

**As of BL-951**, a hop whose `required_stages` declaration is
present-but-invalid also carries a trailing `rejected="<reason>"` clause,
e.g. `routing_skipped: BL-042 coder->QA skipped=cleaner,architect rejected="unknown or out-of-chain stage(s) in required_stages: revieweer"`.
The clause is present only when `resolve-effective` rejected the
declaration (unknown/duplicate stages, or coder present without QA); an
absent or fully-valid declaration never carries it.

### Journal line

One JSON object per line in `.swarmforge/routing-skips.jsonl`:

```json
{"ticket-id":"BL-042","from":"coder","to":"QA","skipped":["cleaner","architect","hardender","documenter"],"reasons":{"cleaner":"style-only, no code logic","architect":"configuration change","hardender":"no new code paths","documenter":"no user-facing docs change"},"sender":"coder","created_at":"2026-07-23T14:30:15Z"}
```

Keys:

| Key | Meaning |
|---|---|
| `ticket-id` | Ticket the hop belongs to |
| `from` | Sender role |
| `to` | Delivered recipient after routing |
| `skipped` | Stages skipped on this hop |
| `reasons` | Ticket's declared `stage_skip_reasons` where present |
| `rejection-reason` | Present only when the ticket's `required_stages` was present but invalid (BL-951) — why `resolve-effective` rejected it |
| `sender` | Same as `from` (duplicate for grep convenience) |
| `created_at` | ISO timestamp when the handoff was written |

A skipped **required** stage with no declared reason appears in `skipped` but has no entry in `reasons` — a greppable anomaly (delivery is unchanged; enforcement is out of scope for BL-623).

## Grep the trail for a ticket

```bash
grep '"ticket-id":"BL-042"' .swarmforge/routing-skips.jsonl
```

Stages **not** listed in `skipped` for a hop are the ones that ran on that hop. Cross-check against git history on the ticket branch for a full ran-vs-skipped picture (see also BL-606 `ran-and-skipped` reporting).

## Live verification (QA procedure)

1. On a scratch ticket with `required_stages: [coder, qa]` and `stage_skip_reasons`, send as coder addressed **directly to QA** with routing on. Expect `routing_skipped` naming cleaner, architect, hardender, documenter, and one jsonl line for the ticket.
2. Repeat addressed to `cleaner`. Parcel delivers to QA; record shape is equivalent.
3. Run the grep example from `swarmforge/handoff-protocol.md` verbatim against the jsonl — it matches.

## Related

- BL-606: required-stages routing, kill-switch, rewrite behaviour
- BL-951: recording no longer gated on a valid/present declaration; adds `rejected="..."` / `rejection-reason`
- `swarmforge/handoff-protocol.md` — "Reading the Routing Log" section
- `swarmforge/scripts/required_stages_lib.bb` — `hop-skipped-stages`, `ran-and-skipped`, `resolve-effective`
