# Intake: a question the Operator could not answer

Filed by the Operator (2026-08-30T17:44:08.391838791Z) - a question came in via Telegram
that the Operator judged it could not answer itself. This is a RAW
ask, not a spec: the specifier drains this like any other backlog-root
item and decides what (if anything) becomes a real ticket.

## The question

HOTFIX request from human: Don't let anthropic agents clear their context window unless their context window is at least 75% full. If you can't tell (context fraction unknown), then don't issue the /clear. Do a hot fix for that and tell the swarm.

---

## Disposition — drained 2026-08-30 by the specifier

Both halves of the ask are now delivered; no ticket was minted.

1. **The hotfix**: landed as `9237008e9f` at 17:49:30Z, five minutes after
   this intake was filed. `handoffd`'s closing and role context-clear sweeps
   now gate on the same 75% threshold and fail CLOSED when the fraction is
   unknown, which is exactly the "if you can't tell, don't clear" clause.

2. **"and tell the swarm"**: the hotfix gates the DAEMON's injection only. It
   cannot stop an agent issuing `/clear` on itself, and no boot-inlined rule
   said not to - so the swarm had not in fact been told. Added as the first
   bullet of `workflow.prompt`'s "Context Clear Requires Startup Re-Read",
   which every agent boots with, and broadcast to the live pipeline roles as
   a note (their running windows do not re-read the prefix until respawn).

The boot-prefix budget gate forced an offsetting trim in the same commit; the
pointer text in `project.prompt` written earlier today was shortened to pay
for it. Measured 41952/44000 after, BL-1227's acceptance 7/7.
