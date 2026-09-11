# BL-1536 - specifier census: QA git_handoffs stamped `non-forwarding: true`, 2026-09-11

Trigger: coordinator note `20260911T075650Z_007812` - "QA sent BL-1518-a
bounce as non-forwarding merge-only - dropped, mint?".

## Mechanism (read from the live source)

- `swarmforge/scripts/swarm_handoff.bb` `with-non-forwarding` (~line 839):
  `(and (= "git_handoff" type) (last-pack-role? sender))` -> stamps
  `non-forwarding: true`. `last-pack-role?` = `reverse-hop-lib/last-pipeline-role`
  over roles.tsv = `QA` on the live table. The recipient is never consulted.
- `write-handoffs!` (~line 1071) applies it to the FORWARD file; reverse
  copies get `:non-forwarding true` separately (that path is not the defect).
- Landed on `main` in `b27d9f6639` (2026-08-30, cleaner WIP snapshot of the
  reverse-hop/propagation work, BL-1299 era). Constitution Article 2.3 words
  the intent correctly: "The last non-coordinator pack role's FORWARD
  git_handoff is also stamped non-forwarding: true (terminal)".
- Receive side, Article 2.4: a `non-forwarding: true` inbound is merge-only -
  merge, `done_with_current.sh`, send no git_handoff. `swarm_handoff.bb`
  `inbound-non-forwarding?` (~line 1149) enforces it while the inbound is
  `in_process`.

## Census: every QA-sent git_handoff carrying the marker

Source: `grep -l 'non-forwarding: true' .worktrees/QA/.swarmforge/handoffs/sent/*`
(13 files, 2026-09-02 .. 2026-09-11). Recipient outcome read from the
recipient's `.worktrees/<role>/.swarmforge/handoffs/sent/` and
`inbox/completed/`.

| sent (UTC) | to | task | recipient outcome |
|---|---|---|---|
| 09-02 16:57 | coder | BL-1317-adapt-tier-effort [behavior: unwired] | forwarded to cleaner 18:56 (ignored the marker) |
| 09-02 17:19 | cleaner | BL-1271-dispatch-gap-suite-stale-bug-fixtures | forwarded to architect 17:40 (ignored the marker) |
| 09-04 13:25 | cleaner | BL-1385-a-handler-that-cannot-load-never-reaches-main | forwarded to architect 14:17 (ignored the marker) |
| 09-04 17:54 | coder | BL-1390-a-commit-on-the-shared-main-checkout... | forwarded to cleaner 17:59 (ignored the marker) |
| 09-04 20:23 | coder | BL-1399-freshness-fixture | forwarded to hardender 20:27 (ignored the marker) |
| 09-10 10:04 | coder | BL-1494-a-note-sent-as-deferred-costs-its-role-no-wake | completed merge-only in 16 s (10:05:43); re-forwarded 10:39 under bare task `BL-1494` |
| 09-11 07:01 | hardender | BL-1518-a-handoff-cli-never-writes-outside-the-root... [2 def] | completed merge-only (batch dequeued 07:07:08, completed 07:35:33), NO forward - dropped; coordinator note 07:56 |
| 09-08 17:24 | coordinator | BL-1369 | terminal forward - intended |
| 09-08 18:51 | coordinator | BL-1372 | terminal forward - intended |
| 09-08 20:58 | coordinator | BL-1373 | terminal forward - intended |
| 09-08 22:46 | coordinator | BL-1285 | terminal forward - intended |
| 09-09 06:46 | coordinator | BL-1278 | terminal forward - intended |
| 09-11 00:02 | coordinator | BL-1488 | terminal forward - intended |

Seven bounces stamped in nine days. Five were recovered only because the
coder/cleaner disobeyed Article 2.4 and forwarded anyway; one cost a 34-minute
detour under a renamed task; one (BL-1518-a) was dropped by a hardender that
did exactly what the protocol says, and surfaced only as a coordinator note.
The protocol-obeying outcome is the drop - the defect is the stamp.

## BL-1518-a state at census time

- QA bounce commit `d8704979b4` (2 defects: D1 hardender, D2 documenter) IS
  an ancestor of the hardender worktree tip (`7fbe02a365`), so the evidence
  and the tree are already in the hardender's checkout; only the instruction
  to act was lost with the merge-only completion.
- Coordinator already sent the coder `rotate_to_role.sh hardender - BL-1518-a
  QA bounce dropped, needs fix` (07:56:43). No amendment to BL-1518-a is
  needed: the parcel is correct against its contract; the hardender fixes D1
  and forwards to the documenter with the inventory (Article 4.4).

## Existing coverage that must stay green

- `swarmforge/scripts/test/reverse_audit_handoff_test_runner.bb` "terminal
  pack role is QA" and BL-1299 scenario 03 - unchanged, the terminal ROLE is
  still QA; only the stamping decision gains a direction input.
- `swarmforge/scripts/test/test_swarm_handoff_inbound_non_forwarding.sh`
  (BL-1302) - the receive-side refusal is correct and untouched.
- `bl1302ReverseCopyNotDuplicateChainSteps.js`, `bl1313BatchGuardVisibilitySteps.js`
  - reverse copies keep the marker.

By specifier.
