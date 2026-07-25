# PROPOSED AMENDMENT: Expedite defects through the pipeline

> **Status: PROPOSAL — not in force.** Filed under Article 5.1 step 1. Routes to
> the **specifier** at priority `00`, who incorporates the agreed form into
> Article 3 (Backlog Management) and into `coordinator.prompt` /
> `specifier.prompt`. Do not treat any text below as binding until that has
> happened and QA has landed it on `main`.
>
> **Origin:** operator directive, 2026-07-25 — "les bugs doivent passer en
> accéléré (expedite) à travers la swarm; persiste cette règle dans la
> constitution du coordinateur et du specifier."

## 1. The intent

A defect is work the swarm created for itself. Every day a defect sits in
`paused/` it is a known-broken behaviour shipped to `main`, and it competes for
promotion against features on the same flat `priority:` ordering as if it were
new scope. The operator wants defects to reach the pipeline faster than that
ordering currently allows.

## 2. Why the literal rule cannot be adopted as stated

"Bugs are expedited" was measured against the actual backlog before drafting.
It does not survive contact with the numbers:

| type | count |
|---|---|
| `feature` | 137 |
| **`defect`** | **77** |
| **`bug`** | **58** |
| `epic` | 21 |
| `chore` | 20 |
| other (`enhancement`, `docs`, `task`) | 5 |

`bug` + `defect` = **135 of 318 tickets, ~42% of the backlog.**

A lane that carries 42% of all traffic is not an expedite lane — it is a
re-ordering that starves features permanently while giving defects no actual
speed advantage over each other. Adopting the rule literally would produce the
opposite of the intent: everything is expedited, so nothing is.

Two further facts the incorporating specifier must not gloss over:

- **`bug` and `defect` are BOTH live types** (58 and 77). Nothing in the
  constitution distinguishes them today. Any rule naming only "bugs" is
  ambiguous against 77 tickets. **The human must rule on whether these are one
  class or two** — and if two, what the difference is. Merging them is the
  cheaper answer, but that is a ruling, not an inference.
- **`severity:` is already populated** on those tickets and is the natural
  discriminator: `high` 57, `medium` 32, `low` 14, `critical` 1, **absent 31**.

## 3. Proposed form

Severity-gated, not type-gated. The lane stays narrow enough to mean something:

1. **Eligibility.** A ticket of type `bug` or `defect` whose `severity:` is
   `critical` or `high` is *expedited*. That is 58 tickets on today's backlog
   (~18%), not 135.
2. **Effect on promotion order.** An expedited ticket is promoted ahead of any
   non-expedited ticket regardless of its `priority:` value. Within the
   expedited set, the existing `priority:` ordering (Article 3.2.2) applies
   unchanged. Ordering only — it does **not** create an extra active slot.
3. **Missing severity fails CLOSED.** A `bug`/`defect` with no `severity:` field
   (31 today) is **not** expedited. Absence must never buy priority, or every
   future ticket acquires the lane by omission. The coordinator surfaces such
   tickets for triage rather than guessing a severity.
4. **The circuit breaker outranks the lane.** Article 3.5 wins outright. When
   `active_backlog_max_depth` is throttled to `1` or `0`, expedited tickets are
   promoted in that reduced capacity or not at all. They never bypass the
   throttle. A defect storm during an outage is exactly the pile-on 3.5 exists
   to prevent, and it is precisely when this lane would otherwise do most harm.
5. **Mutation-heavy scheduling still applies.** Article 3.4 is unchanged: an
   expedited but mutation-heavy defect is still deferred to overnight. Expedite
   governs ORDER, never the scheduling window.

## 4. Two priority scales — do not conflate them

This is the likeliest way to implement the rule wrongly. They are unrelated:

- **Ticket `priority:`** in the YAML — governs promotion order out of
  `paused/`. Scale in use: `00` epic trackers, `02`–`40` real work. This is the
  scale this amendment concerns.
- **Handoff `priority:`** in `HANDOFF-PROTOCOL.md` — governs message routing
  between roles. Scale: `00` blocking decisions, `10`–`49` normal routing, `50`
  batch mode (`coordinator.prompt:159`).

Expediting a ticket **must not** silently promote its handoffs to `00`. Handoff
priority reflects how a message is routed, not how urgent the underlying work
is. Conflating them would flood the `00` blocking lane with routine defect
traffic and degrade the one channel reserved for genuinely blocking decisions.

## 5. Where this lands once agreed

- **Article 3.2** — add expedite as an eligibility rule, explicitly subordinate
  to 3.5 and neutral to 3.4.
- **`coordinator.prompt`** — the coordinator enforces the order at promotion
  time, and surfaces missing-`severity:` defects for triage.
- **`specifier.prompt`** — the specifier must set `severity:` on every `bug` /
  `defect` it writes. Rule 3 is unenforceable if the field keeps being omitted;
  this is the half of the amendment that makes the other half work.

## 6. Open rulings the human owes before incorporation

1. **`bug` vs `defect`** — one class or two? (§2)
2. **Gate at `high`, or `critical` only?** `high`+`critical` is 58 tickets;
   `critical` alone is 1. The first is a lane, the second is a rounding error.
3. **Backfill** — do the 31 severity-less `bug`/`defect` tickets get triaged
   now, or does the rule apply only to newly written tickets?

## 7. Explicitly out of scope

- Any change to the active-slot cap. This amendment reorders a queue; it does
  not widen it.
- Any change to quality gates. An expedited defect clears the same QA,
  acceptance, and mutation gates as anything else. Expedite is about **when work
  starts**, never about what it is allowed to skip.
