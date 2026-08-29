# The BL-1237 expedite is abandoned at `init` with six tickets parked, uncommitted

Surfaced, not swept: these changes are staged in the shared `main` checkout
and I did not create them.

## State

`.swarmforge/expedite/BL-1237/progress.json`:

    {"ticket":"BL-1237","stage":"init","status":"running",
     "detail":"teardown + worktree", "updated-at-ms":1787964002286}

It never left `init`. `park-record.json` shows the park did complete:

    "destination": "hold",
    "tickets": ["BL-1249","BL-1247","BL-1244","BL-1233","BL-1234","BL-1242"],
    "why": "parked by the expeditor to free the pipeline for BL-1237"

## Why this is a hazard, not just untidiness

1. **The park is staged but never committed.** `git status` on `main` shows
   six `D backlog/active/... / A backlog/hold/...` pairs sitting in the index.
   Nothing has landed. Any commit made on `main` with a bare `git add -A`, or
   any reset, resolves this by accident in one direction or the other.

2. **The swarm is running against the parked tickets.** The expeditor's model
   is "stack stopped, one ticket, same gates". The stack is not stopped: at
   01:42-01:46Z the coder, cleaner, architect and QA were all live. The coder's
   `in_process` holds `Work BL-1244-a-delivered-answer-frees-the-question-slot`
   — one of the six the expeditor parked to `hold/` to get it out of the way.
   So a ticket is simultaneously being built and parked-for-not-being-built.

3. **`backlog/hold/` is human-held.** Article 3.1: never auto-promote from
   there. Six tickets are one uncommitted index away from a folder nothing is
   allowed to promote them out of, without a human ever having held them.

4. **BL-1237, the ticket the expedite was for, is still unrouted** — the
   coordinator refused it on the false dispatch trail (see the sibling
   evidence file). So the pipeline was cleared for a ticket that then did not
   run.

## Related, already recorded

The expeditor's teardown restarting the swarm against a standing hold is
BL-1249, which is itself one of the six parked tickets.

## Not resolved here

The disposition of the index — land the park, or discard it and return the six
to `active/` — is the coordinator's and the human's, not the specifier's.
