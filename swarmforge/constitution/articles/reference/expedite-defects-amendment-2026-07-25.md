# AMENDMENT (INCORPORATED): Expedite defects through the pipeline

> **Status: INCORPORATED, 2026-07-25** (Article 5.1 step 2, by the specifier).
> The binding form now lives in **Article 3.2 rule 4** (constitution
> `articles/03_backlog.md`), **`coordinator.prompt`** ("Expedited Defects At
> Promotion Time"), and **`specifier.prompt`** ("Defect tickets: `type:
> defect` + mandatory `severity:`"), with the informal "bugs-first" wording in
> `workflow.prompt` / `coordinator.prompt` aligned to it. This file is the
> adoption record and rationale — read the articles, not this file, for the
> rule in force.
>
> Verified at incorporation: zero `type: bug` tickets remain in `paused/`,
> `active/`, or `hold/` — all 58 sit in `backlog/done/`. The transition
> predicate still matches `{defect, bug}` because a `done/` ticket can be
> re-promoted; drop `bug` only when no ticket carries it.
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
  constitution distinguishes them today, so any rule naming only "bugs" is
  ambiguous against 77 tickets. **RULED (operator, 2026-07-25): `defect` is the
  single class; `bug` is retired for new tickets.** `defect` wins on both
  counts — 77 tickets vs 58, and 72 mentions across `swarmforge/roles/` and
  `swarmforge/constitution/` vs 15 for `bug`. It is the term the swarm's own
  vocabulary already runs on.
- **`severity:` is already populated** on those tickets and is the natural
  discriminator: `high` 57, `medium` 32, `low` 14, `critical` 1, **absent 31**.

## 3. Proposed form

Severity-gated, not type-gated. The lane stays narrow enough to mean something:

1. **Eligibility.** A ticket of type `defect` whose `severity:` is `critical` or
   `high` is *expedited*. That is ~18% of today's backlog, not 42%.

   ⚠️ **Transition clause — the rule must ALSO match `type: bug` while any
   remain.** `bug` is retired for new tickets (§2), but 58 already carry it.
   A rule matching `defect` alone would silently drop those 58 out of the lane —
   the exact opposite of the amendment's intent. Match `{defect, bug}` and drop
   `bug` from the predicate only once the count reaches zero. The specifier
   should confirm that count at incorporation time rather than trusting this
   number.
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

## 6. Rulings received (operator, 2026-07-25) — none outstanding

1. **One class: `defect`.** `bug` is retired for new tickets. See §2 for the
   evidence and §3.1 for the transition clause covering the 58 legacy `bug`
   tickets.
2. **Threshold: `critical` + `high`.** `critical` alone would have been 1
   ticket — a rounding error, not a lane.
3. **Backfill: done.** The headline "31 untriaged tickets" was misleading and is
   corrected here: **27 of them sit in `backlog/done/`**, where `severity:`
   cannot affect promotion order, and **1 is in `backlog/hold/`**, which
   Article 3.1 forbids auto-promoting from. Only **4 were in `paused/`**, and
   all four have been triaged:

   | ticket | severity | rationale |
   |---|---|---|
   | BL-536 provider auth error auto-respawn | `high` | an unhandled provider auth error takes a role down; availability |
   | BL-562 backlog-depth WARNING counts `.gitkeep` | `high` | fires permanently at cap 1 — the cap actually in use — so it degrades the Article 3.5 circuit-breaker signal itself |
   | BL-559 pipelineBoard property test prefix-check | `medium` | a vacuous test is real, but scoped to one board with no production impact |
   | BL-612 claim-progress acceptance step handlers | `medium` | verification gap on already-shipped behaviour, not a live fault |

   All four were already `type: defect`; no `bug` among them. The remaining 27
   `done/` tickets are deliberately left untriaged — backfilling severity onto
   shipped work would be bookkeeping with no consumer.

   **This does not make rule 3 (fail-closed on missing severity) redundant.** It
   clears today's stock; §5's `specifier.prompt` change is what stops it
   re-accumulating.

## 7. Explicitly out of scope

- Any change to the active-slot cap. This amendment reorders a queue; it does
  not widen it.
- Any change to quality gates. An expedited defect clears the same QA,
  acceptance, and mutation gates as anything else. Expedite is about **when work
  starts**, never about what it is allowed to skip.

## 8. Article 3.2 rule 4's sub-bullets — Full Text (BL-858 split)

`03_backlog.md`'s own text, verbatim, before BL-858 compressed it to pointers:

- **Transition**: the predicate also matches legacy `type: bug` tickets
  while any still carry that type (58 at incorporation, 2026-07-25 — all in
  `backlog/done/`, matched in case one is re-promoted). `bug` is retired
  for new tickets: always write `type: defect`. Drop `bug` from the
  predicate only once no ticket carries it.
- **Missing `severity:` fails CLOSED**: a defect with no `severity:` field
  is NOT expedited — absence must never buy priority. The coordinator
  surfaces such tickets for triage rather than guessing a severity.
- **Ordering only**: expedite reorders the queue; it never creates an extra
  active slot (rule 1), never overrides orthogonality (rule 3 — an
  expedited ticket that overlaps in-flight work is skipped like any other),
  never changes the mutation-heavy scheduling window (3.4), and never
  bypasses the circuit breaker (3.5) — under a throttled cap of `1`/`0`,
  expedited tickets fit in the reduced capacity or wait.
- **Two `priority:` scales — never conflate**: this rule concerns the
  ticket YAML `priority:` (promotion order out of `paused/`) only.
  Expediting a ticket never bumps its handoff `priority:` to `00` — handoff
  priority (HANDOFF-PROTOCOL.md) reflects message routing, not work
  urgency, and the `00` lane is reserved for genuinely blocking decisions.
- Adoption record and rationale:
  `articles/reference/expedite-defects-amendment-2026-07-25.md`
  (operator directive 2026-07-25).
