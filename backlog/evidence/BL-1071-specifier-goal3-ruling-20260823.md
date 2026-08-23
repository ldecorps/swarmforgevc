# BL-1071 review goal 3 — specifier ruling (2026-08-23)

Goal 3 asked the reviewer to do two things: **confirm** no caller branches on
127 meaningfully, and **weigh** whether `sh!`'s catch should be narrowed to
spawn failure. The coder reported the confirm half ("latent, no caller"). This
records the confirm independently and rules on the weigh half, which is a
scope decision and therefore the specifier's.

## Confirm — verified independently, agrees with the coder

`sh!` (`swarmforge/scripts/babysitter_check.bb:81-92`) catches every Exception
and returns `{:exit 127 :out "" :err <exception message>}`.

Every call site was read, not sampled:

- Most branch on `(zero? (:exit r))` — any non-zero, 127 included, is handled
  as failure. Lines 151, 155, 167, 269, 385, 398, 401, 406, 584, 907.
- `path-identical-to-parent?` (line 452) routes through `exit->answer`
  (line 285), whose `case` maps 0 → true, 1 → false, **anything else →
  `{:ok? false}`** = could-not-answer. So a synthesised 127 already lands on
  the fail-closed branch invariant 3 requires.
- A repo-wide grep for `127` in `swarmforge/scripts/*.bb` returns only IP
  literals (`127.0.0.1`) and one unrelated count in `ticket_status_lib.bb`.
  **No caller compares an exit code to 127 anywhere.**

Confirmed: the ambiguity is latent, with zero measured blast radius.

## Weigh — ruling: do NOT narrow the catch. No follow-up ticket.

1. **Narrowing would reinstate the incident.** Invariant 1 ("a sweep never
   dies on one gather") is held up by the breadth of this catch. Narrowing to
   IOException lets any other throwable — SecurityException, an
   IllegalArgumentException from a malformed arg vector, an NPE — escape and
   abort the sweep, which is precisely the blackout this ticket stamps off.
   The cure is worse than the ambiguity.

2. **The distinguishing information is not actually lost.** Spawn-failure and
   a real command-not-found are indistinguishable in `:exit`, but not in
   `:err`: the synthesised result carries the exception message, a real 127
   carries the process's own stderr. The one caller that reports a reason
   (line 907, control-plane ensure) surfaces `(:err r)` as its `:detail`, so
   the actual failure reason reaches the operator rather than a bare code —
   which is what BL-572/BL-662 require.

3. **Severity is measured blast radius, and it is zero here.** A future caller
   writing `(= 127 (:exit r))` would be wrong, but that caller does not exist
   and speculating one into a ticket manufactures work. The synthesis is
   already documented in full at the definition site (lines 82-88).

**Nothing changes in what the coder builds.** Goal 3 is resolved as
confirmed-latent, no code change, no follow-up ticket — a reasoned no-action,
which goal 7 permits ("open narrow follow-ups for anything found") since
nothing actionable was found. Record this disposition in the coder pass
evidence; QA should expect goal 3 closed with no diff.

Remaining review goals 1, 2, 4, 5 and 6 are untouched by this ruling. Goal 2
(no wall-clock deadline on `bash ./swarm ensure`) remains the one the spec
flags as closest in shape to the incident, and goal 1
(`BABYSITTER_FAKE_ENSURE_RESULT`) remains a named anti-pattern in production
code — neither is affected by leaving `sh!` as written.

By specifier.
