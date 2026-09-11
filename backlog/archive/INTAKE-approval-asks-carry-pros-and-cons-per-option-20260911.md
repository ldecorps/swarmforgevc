# Intake: an approval ask on Telegram explains the pros and cons of every option

Filed by the human via Claude Code (2026-09-11T05:20Z). RAW ask, not a spec:
the specifier drains this like any other backlog-root item and decides what
(if anything) becomes a real ticket.

## The ask

Human, verbatim (2026-09-11, on the BL-1529 approval ask): "intake : what to
chose? pros and cons should be explained on the telegram message."

## What was observed

The BL-1529 approval message that reached Telegram read, in full:

- the ticket id and its (very long) title;
- "What it solves:" followed by the first ~300 characters of
  `approval_context`, cut mid-sentence with an ellipsis ("the audit is an
  agent-discipline …");
- "BL-1529 needs your approval before it can proceed. Reply here with
  'approve BL-1529' (or 'reject BL-1529 <reason>') to act."

The two `ruling_options` were not shown at all, and the reply hint does not
say how to name a ruling. The human had to have the ticket yaml read out to
them before they could choose. The specifier's own recommendation
("(recommended)" on option A) never reached the message either.

## What is wanted

When a ticket carries `ruling_options`, the Telegram approval ask carries,
for EACH option: the option label, its pros, its cons, and which one the
specifier recommends and why - not just the bare label. The reply hint
names how to pick one ("approve BL-1529 A" or equivalent). The
`approval_context` is shown whole or with its FIRM lines intact, not cut at
a fixed byte count.

Where the pros/cons come from is the specifier's call: a new per-option
field on the ticket (e.g. `ruling_options` entries with `label`, `pros`,
`cons`), or the specifier writing them into `approval_context` under a
fixed heading the relay can extract. Either way the message is composed from
ticket content, never invented by the relay.

## Pointers

- Ticket that triggered this: `backlog/paused/BL-1529-*.yaml`
  (`ruling_options`, `approval_context`).
- Relay path: the front-desk approval message composer in
  `extension/src/tools/telegramFrontDeskBotCore.ts` / the approval-ask
  sweep in the daemon (whichever composes "needs your approval before it
  can proceed").
- Related: BL-1455 (a re-pended ticket never gets a fresh approval ask).

## Disposition (specifier, 2026-09-11)

Split 1:2. The message content, the `ruling_tradeoffs` field, the lifted
approval-context cap and the lettered option buttons went to **BL-1531**
(`backlog/paused/BL-1531-the-approval-ask-explains-each-ruling-option.yaml`);
the typed "approve BL-1529 A" reply grammar and the refusal shapes went to
**BL-1532** (`backlog/paused/BL-1532-a-typed-approve-names-its-ruling-by-letter.yaml`,
depends_on BL-1531). The human sentence is quoted verbatim in both
tickets' `description:` (Article 5.3). Trade-off source chosen: a
structured per-option list, not prose headings in `approval_context`.
