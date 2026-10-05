# AMENDMENT (PROPOSED 2026-10-05): The circuit breaker does not auto-restore — a human releases it

Proposed by the coordinator at the human's direction, 2026-10-05. Supersedes
the auto-restore clause of Article 3.5 (operator directive 2026-07-09).

## 1. The human's words

Human, to the coordinator, 2026-10-05 (lightly cleaned up from source):

> "Change logic around circuit breaker cap 1. Once cap 1 is reached, ask if
> it is safe to release the cap. The idea is that we prevent issues from
> piling up. The swarm is working ok, it is not safe to resume churning at
> full throttle [just because signals look normal again]."

## 2. What changes

Article 3.5's current text ends: "Restore the prior cap once signals
normalize — never leave the throttle engaged after recovery (operator
directive 2026-07-09)."

That clause is **retired**. Signals returning to baseline is no longer
sufficient, by itself, to lift the throttle. The new rule:

- While `active_backlog_max_depth` is throttled to `1` (degraded) or `0`
  (severe) under Article 3.5, the coordinator keeps re-checking the
  triggering signals as before.
- Once those signals read back at baseline, the coordinator does **not**
  silently restore the prior cap. Instead it raises **one** clarifying
  question to the human (`role_ask.bb --role coordinator`), naming: which
  signal(s) tripped the throttle, their current (normalized) reading, how
  long they have read normal, and the prior cap value it would restore.
- The cap stays at its throttled value until the human answers. A "yes" /
  approved answer restores the prior cap in that same turn; a "no" or a
  different instruction keeps the throttle at whatever value the human
  gives, and the coordinator records that durably on the throttle state
  (not just in a chat reply) so a later shift does not re-ask the same
  question for the same episode.
- This never overrides a **severe** (`0`) drop's own cause being cleared —
  e.g., a transport outage ending does not need a human for the coordinator
  to notice the outage is over, but it still needs the human's go-ahead
  before the cap itself climbs back off `0`/`1`.
- Only one pending question at a time (the existing `role_ask.bb` guard) —
  a second normalize event while the first question is unanswered does not
  queue a second ask; it just means the answer, once given, is evaluated
  against current signals, not stale ones.
- Rationale (the human's own words above): a quiet pipeline is not proof
  it is safe to resume full throughput — the throttle exists to stop
  issues piling up while the swarm works through what triggered it, and
  silently reopening the gate the instant the number looks clean defeats
  that purpose.

## 3. What does not change

- The trigger conditions for entering the throttle (Article 3.5's signal
  list) are unchanged.
- Ambulance mode (BL-679) still outranks everything, including this —
  no promotion at all while an ambulance ticket is in flight, whatever the
  circuit-breaker state.
- This is a promotion-gate change only; it does not touch Article 3.2.4
  ordering, the onboarding contract gate, or the deprecator freshness gate.

## 4. Standing pre-approval for the episode in flight right now (2026-10-05)

Human, same conversation, replying to the coordinator confirming this
amendment was routed: "Once it's implemented: I am already agreeing to
lift the cap, no need to ask me."

This is scoped: a pre-answer for the throttle episode already open when
this amendment was proposed — `.swarmforge/coordinator/throttle-changes.jsonl`
shows the cap dropped to `1` at `2026-10-03T22:54:28.074Z`, reason
"standing-red register signal (the red count) - stabilizing to one", and
it has not yet cleared. For *that* episode specifically: once the
standing-red-register signal that tripped it reads back at baseline, the
coordinator restores the prior cap without raising the `role_ask.bb`
question — the human has already answered it. Record the restoration in
`throttle-changes.jsonl` as usual, noting "pre-approved 2026-10-05, see
circuit-breaker-human-release-amendment" as the reason, so the trail shows
why no question was asked.

This is NOT a blanket revocation of §2's ask-first rule for *future*
throttle episodes — a new episode, tripped by a new signal spike after
this one clears, still gets the one clarifying question. The human may
choose to give the same standing pre-approval again at that time, but it
is not assumed.

## 5. Implementation note for the specifier

- `03_backlog.md` Article 3.5's inlined summary line needs its last
  sentence replaced (see §2 above) and a pointer added to this file.
- `03-backlog-detailed.md`'s Article 3.5 full-text copy needs the same
  edit, verbatim, per the file's own stated purpose (pre-trim wording).
- Whatever CLI/mechanism currently auto-restores the cap (if any exists
  today beyond the coordinator's own prose instruction) needs the
  auto-restore step replaced with the `role_ask.bb` prompt described above,
  and a durable record of the human's answer (ticket or throttle-state
  field) — this is production code, so it is the specifier's job to spec
  and the coder's job to build, not the coordinator's to hand-write.
