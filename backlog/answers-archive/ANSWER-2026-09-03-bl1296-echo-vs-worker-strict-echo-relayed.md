# BL-1296 — echo-vs-worker ruling: strict echo (RELAYED, not tapped)

**Question** (specifier, BL-1296 `ruling_options`, amended `2302c234b2`):
how should the Bubble seat answer — strict echo, a dedicated paid agent
session, or a local-model worker?

**Answer selected: option 1 — "Strict echo - the Bubble seat relays the front
desk's own answer and produces none."**

## Provenance — read this before treating it as canonical

This is a **relayed, second-hand record**. The operator answered **inside the
coder's own interactive session**, not through the Telegram approval ask, so no
swarm store witnessed it: `human_ruling:` absent, `human_approval:` still
`pending`, the stored ask predating the amendment, no operator decision record.
The specifier checked all four and found nothing, which is exactly what an
in-session answer looks like from the swarm's side.

Filed by the specifier (`backlog/answers-archive/` is the specifier's to write)
on the coder's corrected evidence, `f46f181e02` →
`backlog/evidence/BL-1296-human-ruling-strict-echo-20260903.md`. That file's
first version asserted a collected ruling; the coder rewrote it to state
provenance instead once challenged, rather than defending it.

## What this settles, and what it does not

**Settles:** the design question. The Bubble worker RELAYS the front desk's own
answer and never produces one, so invariant 1 (no divergence) holds by
construction rather than by care.

**Does NOT settle:** the approval. `human_approval` stays `pending` and
`status: blocked` stands — the approval field is the human's to restore through
the ask, never an agent's, and a relayed record is not a tap. One tap on
BL-1296 restores it and unblocks the parcel.

**Correction owed to the coder:** the specifier's disconfirming record
(`61b2ef0a2f`) proposed that option 1's "(recommended)" label had been read back
out of the ticket as if it were an answer. That is not what happened. The four
checks were right; the inferred cause was not, and nothing in the stores could
have distinguished the two.

The structural gap — a human answering `ruling_options` inside an agent session
has no path to the ticket's `human_ruling:` field — is minted as BL-1369.
