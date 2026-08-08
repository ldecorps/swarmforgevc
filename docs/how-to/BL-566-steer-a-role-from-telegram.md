# Steering a swarm role from Telegram, and reading the receipt

Each of the eight swarm roles has its own Telegram forum topic (BL-425). A
message you post there is injected straight into that role's live tmux pane as
a verified nudge — it interrupts the agent mid-turn rather than queuing behind
its current work. Since BL-566 every steer answers back with a one-line receipt
in the same topic, so you can tell a steer that landed from one that went
nowhere.

## Which topic reaches which role

The bindings live in `.swarmforge/operator/role-topic-map.json`:

```json
{"specifier":1595,"coder":1596,"cleaner":1597,"architect":1598,
 "hardender":1599,"documenter":1600,"QA":1601,"coordinator":1602}
```

Two guards apply, in this order:

1. **Topic scope first.** A topic that is not one of the eight does nothing at
   all — the message falls through to normal SUP/Operator/BL-ticket routing
   without auth even being evaluated. The same text in the Concierge topic or a
   ticket topic keeps that topic's existing behaviour.
2. **Principal only.** Anyone other than the authorised human posting in a role
   topic is refused, and told nothing at all — no receipt, no error. A receipt
   would confirm to them that the topic is live and steerable.

## Reading the receipt

| Receipt | Meaning | What to do |
|---|---|---|
| `✓ steered <role>` | The nudge was typed into that role's pane and confirmed submitted | Nothing — the agent has it |
| `⚠ <role> has no live pane - not delivered` | No tmux pane exists for that role | See below — usually expected |
| `⚠ not delivered to <role>: <reason>` | A pane exists but the verified send did not land | Real fault; check the pane and the bot's stderr |

The middle case is deliberately worded differently from the third, because on a
**mono-router pack it is the normal state for six of the eight roles**. Only
`swarmforge-coordinator` and `swarmforge-coder` hold live panes; specifier,
cleaner, architect, hardender, documenter and QA are dormant rotation targets
with a mailbox but no process. Steering one of those cannot work until the
router rotates the single resident into that role.

So on a mono-router, the two topics worth steering are **coordinator (1602)**
and **coder (1596)** — and even coder is only live while the resident happens
to be sitting in its home role rather than rotated into cleaner or another
persona. Check the Swarm Live Screen if you are unsure which role the resident
currently is.

To reach a dormant role instead, use its mailbox: a `type: note` handoff is
picked up whenever the resident next rotates into that role, rather than
requiring a live pane.

## If you get no receipt at all

- **In a role topic, as the principal** — the receipt channel is not wired
  (`notifyRoleTopic` absent from the bot's adapters). Steering still works; it
  is just silent, exactly as it behaved before BL-566.
- **In any other topic** — expected. Receipts are only ever posted for the
  eight role topics.
- **As a non-principal sender** — expected. Refused senders are told nothing.

## Where the operator-facing record lives

The receipt is the human-facing signal. Both failure paths also still write a
line to the bot's stderr (captured in
`.swarmforge/operator/front-desk-supervisor.log`):

```
redirectToRole: no live pane resolved for role "specifier" - is the swarm running?
redirectToRole: failed to deliver redirect to "coder": <reason>
```

Use those when you need the detail behind a `⚠` receipt.

## What a steer does not do

- It does **not** relay the agent's reply back into the topic. You see whether
  the steer arrived, not what the agent then said. Watch the pane (Swarm Live
  Screen) for the response. Two-way steering is BL-425's parked slice 2.
- It does **not** wake or rotate a dormant role. The receipt tells you the
  steer went nowhere; it does not queue it for later.
- It does **not** wait for a safe point. A redirect interrupts the agent
  mid-turn by design.
