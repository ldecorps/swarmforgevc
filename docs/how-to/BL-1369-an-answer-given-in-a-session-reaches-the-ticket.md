# An answer given in a session reaches the ticket (BL-1369)

## What was wrong

A ticket poses a choice through `ruling_options`. The answer is recorded
when the human taps the ask on the bot's keyboard. But the human does not
always answer there — they answer in whichever agent session they are
already talking to, and that channel wrote to no swarm store.

From the swarm's side, an in-session answer was byte-for-byte identical to
no answer at all: `human_ruling:` absent, `human_approval:` untouched, the
stored Telegram ask stale, no operator decision record. There was no way to
tell an honest report of a real answer from an unverifiable claim. Two
tickets in one day (BL-1296, BL-1309) went this way; the second only
survived because the coder volunteered provenance rather than letting the
record stand. That is not a control.

## The fix: a CLI that relays, never interprets

`extension/src/tools/relay-ruling.ts` (compiled to
`extension/out/tools/relay-ruling.js`) is the sole CLI an agent runs to
relay an in-session answer onto a ticket's `human_ruling:` field. Usage:

```
node extension/out/tools/relay-ruling.js \
  --ticket <id> --option <label> --relayer <role> [--target <path>]
```

`--target` defaults to the main worktree (same project-root resolution as
the other tools in the directory). The command prints its outcome as JSON
to stdout — both success and legitimate refusal are exit 0, so the calling
agent reads the JSON to distinguish `written` from `refused` (and the
refusal reason); a non-zero exit is reserved for bad args or IO errors.

## The three invariants this path must not break

1. **Relaying an answer NEVER records approval.** `human_approval` is the
   human's own tap; no relay path may write it, however well attested the
   answer is. `recordRelayedRuling` in
   `extension/src/concierge/pendingApprovalReply.ts` is the sole writer of
   `human_ruling:`; it does not touch `human_approval:`. There is no second
   writer anywhere under `extension/src/tools/` — a second writer is how
   the two drift and how invariant 3 quietly stops holding.
2. **A recorded ruling always carries its provenance.** Every ruling on
   record says whether it was relayed or tapped, and by whom. A relayed
   ruling that reads identically to a tapped one would be worse than no
   mechanism.
3. **A relay never overwrites a tapped ruling, and a later tap always
   supersedes a relayed one.** The human's own hand wins in both
   directions. If `human_ruling:` already records a tapped ruling, the
   relay is refused; if a relayed ruling is on record and the human later
   taps, the tap wins.

## Refusals are never silent

The answer must match a declared option exactly — no fuzzy matching, no
agent paraphrasing the human into the nearest option. That is the failure
this surface exists to prevent. The CLI refuses with a reason and (for
`unknown-option`) the declared options in the JSON body, so the calling
agent can surface them:

- **`already-tapped`** — the ticket already has a tapped ruling; the relay
  is refused, the tapped ruling is byte-identical afterwards (invariant 3).
- **`unknown-option`** — the answer matches none of the declared options;
  refusal names the options so the agent can ask the human again.
- **`no-ruling-options`** — the ticket declares no `ruling_options`; there
  is nothing to relay onto.
- **`no-ticket-file`** — the ticket YAML cannot be resolved at the target
  path.

## What is explicitly NOT in scope

- Writing `human_approval` from any relay path. Invariant 1, not
  negotiable.
- The paused-pager route that cannot record a ruling at all (BL-1367) and
  the hardcoded approval byline (BL-1368) — separate surfaces, separate
  tickets.
- A general capture of everything the human says in a session. This
  records an answer to a question a ticket actually asked, and nothing
  else.
- Filing the human's words to `backlog/answers-archive/` — that stays the
  specifier's act, separate from writing the field.

## Where it lives

- **CLI**: `extension/src/tools/relay-ruling.ts` (the thin wrapper) calling
  `recordRelayedRuling` in
  `extension/src/concierge/pendingApprovalReply.ts` (the sole
  `human_ruling:` writer, shared with the bot's callback path).
- **Acceptance**:
  `specs/features/BL-1369-an-answer-given-in-a-session-reaches-the-ticket.feature`
  (5 scenarios: relay writes ruling+provenance, relay never flips
  human_approval, relay refused when already-tapped, unknown option
  refused, tapped ruling supersedes relay).
- **Property tests**:
  `extension/test/bl1369RelayInvariants.property.test.js` verify all three
  invariants at the pure-text-transform layer.
- **Unit tests**: `extension/test/relayRuling.test.js` cover the CLI's
  `parseArgs` (every flag extracted, every missing-flag refusal,
  flag-order independence) and the full record/refuse matrix.

No diagram changes — the relay is a CLI an agent invokes, not a new
component, pipeline edge, or front-desk route.
