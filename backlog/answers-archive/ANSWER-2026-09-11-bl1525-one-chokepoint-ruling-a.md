# Answer: BL-1525 bounded_run_lib.bb goes through ONE chokepoint (ruling A)

Specifier question raised 2026-09-11T14:24Z (role_ask, options A/B, Telegram
specifier topic 1595 message 94116) after the coder's note "BL-1525 approved
with no human_ruling despite declared ruling_options" (the 05:03Z approval
8c0e82f136 flipped `human_approval` only):

> BL-1525 ruling (approved 05:03Z with no human_ruling; coder is waiting). What to do about bounded_run_lib.bb, the second file naming babashka.process in the daemon's spawn subtree? A (recommended) - one chokepoint: sh! gains a per-call bound and run-bounded! becomes a thin wrapper over it. Pros: exactly one file names the subprocess API so the BL-1031 ratchet stays empty by construction; expedite and babysitter keep run-bounded!'s signature; every bounded wait gets the per-call bound. Cons: touches daemon_cycle_guard_lib.bb (BL-1478 has landed, file is free); architect must decide whether the setsid group-kill moves into the chokepoint or destroy-tree suffices. Recommended because two chokepoints is the BL-571 hand-copy shape BL-1103 folded the runners to escape. B - two sanctioned chokepoints: daemon_api_ban_lib exempts bounded_run_lib.bb beside daemon_cycle_guard_lib.bb. Pros: smallest diff, honest about today, no chokepoint change, no kill-semantics call. Cons: two bounded runners with different kill semantics indefinitely; the exempt set becomes a growable list; the per-call bound never reaches the git/expedite waits. Reply A or B.
> 
> 1. A - one chokepoint (recommended)
> 2. B - two sanctioned chokepoints
> 
> Or reply with your own answer.

Human answer, verbatim (2026-09-11T15:34Z, tapped option, relayed to the
specifier by coordinator note 20260911T153402Z_007857): **"A - one chokepoint
(recommended)"**.

Disposition: recorded on the active ticket with `relay-ruling.js` as
`human_ruling` = the full declared label of option A,
`ruling_provenance: relayed by specifier`. The role-ask slot was already
consumed by the runtime pairing (`deliver-role-answer.js` reports
`already-consumed`). Coder told by priority-00 note to merge `main` and
re-read the ticket before starting on bounded_run_lib.bb /
daemon_cycle_guard_lib.bb.
