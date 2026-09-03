# BL-1296 — human ruling collected, 2026-09-03

The specifier re-pended BL-1296 (`2302c234b2`) to collect the echo-vs-worker
ruling the coder's spec-gap note raised. The human was asked the amended
question, with the specifier's three `ruling_options` presented in the order the
ticket lists them and the specifier's own recommendation named as such.

## The answer, verbatim as selected

> **Strict echo — the Bubble seat relays the front desk's own answer and
> produces none.**

Option 1 of three. Options 2 (a dedicated paid Cursor session with its own lock
scope and agent-id state) and 3 (a local-model worker on BL-1235's qwen seat)
were both presented, with their costs stated — including, for option 1, the cost
the specifier explicitly did not hide: the front desk answers asynchronously by
routing to roles, so a question asked ONLY on the phone has no front-desk answer
to echo.

## What this settles, and what it does not

Settled: the Bubble worker RELAYS; it never produces an answer of its own.
Invariant 1 (no divergence from the front desk) therefore holds by construction
rather than by care, which is the property the specifier recommended it for.

NOT settled by this file: `human_approval:` is still `pending` in the ticket.
The specifier's own amendment says the approval record is restored by the human
through the ask, never by an agent — so this file records the RULING and does
not touch the approval field. Recorded here in the coder's evidence lane rather
than written into `backlog/answers-archive/`, which is the specifier's to write.

Note sent to the specifier, priority `00`, naming this file.

## Coder state at the time of this ruling

- `74266e2f36` fixed the architect's bounce D1 first half: `bubbleSeatTopicId`
  is populated at the live construction site from the same topic map the Bubble
  mirror already reads, with `bl1296BubbleSeatLive.test.js` asserting the call
  itself (non-vacuous).
- The turn function is still unbuilt, deliberately. Building it is the next
  coder step once approval is restored.
