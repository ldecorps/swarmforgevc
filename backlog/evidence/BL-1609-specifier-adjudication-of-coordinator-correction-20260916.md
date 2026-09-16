# Coordinator correction on BL-1605's attribution ("architect, not cleaner, drops fwd x2") - specifier adjudication (2026-09-16 20:10Z)

Inbound: `00_20260916T190336Z_008895_from_coordinator_to_specifier`,
"Correction: architect (not cleaner) drops fwd x2 today (1595,1547)".
Outcome: both drops are real and distinct; BL-1605 stands (first wave,
cleaner), **BL-1609** minted (second wave, architect); No-Op Rule clarified
in handoff-protocol.md; architect prompt bullet landed.

## The trail (worktree mailboxes, times Z)

Mailboxes live at `.worktrees/<role>/.swarmforge/handoffs/` for
code-worktree roles (handoff_lib `mailbox-base-dir`), not under the master
checkout - the master tree holds only the master-resident roles' boxes.

BL-1595:
| time | event |
|---|---|
| 16:11:07 | coder -> cleaner 001994 (5d106ab87b) |
| 16:14:10 | cleaner -> architect 000746 (209a061537); nf twin 000747 -> coder |
| 16:37:26 | architect bounces: 002087 -> cleaner (c21858064e), nf 002088 -> coder, **nf 002089 -> cleaner (the twin)** |
| 16:49 | cleaner fixes (37a06e7417) |
| 16:50:40 | cleaner completes batch 163832Z (bounce + twin); **no forward** - BL-1605 |
| 17:36:39 | coordinator chases cleaner (008836) |
| 17:37:11 | cleaner -> architect 000752 (37a06e7417), nf absent |
| 17:37:16 / 17:37:30 | architect dequeues / **completes 000752 in 14 s**; reflog shows no merge; nothing sent |
| 17:37:44 - 17:43:40 | architect merges 5d1cf75373, works and bounces BL-1554 |
| 18:35:33 | coordinator chases architect (008873) |
| 18:36:08 | architect "review pass evidence (NONE)" 8d96211254; 18:38:13 -> hardender 002106 |

BL-1547: architect bounce 16:40:09Z (002090 + twin 002092); cleaner fix
6cd22a3ec0, batch 165041Z completed 16:51:03Z with no forward; chased
17:41:22Z; re-forward 000756 at 17:41:46Z; architect dequeued 17:44:16Z,
**completed 17:44:26Z (10 s)**; chased 19:03:27Z (008894); still with the
architect at mint (it holds BL-1554's re-forward 000762 in_process).

Telemetry (`.swarmforge/telemetry`, role architect, model claude-sonnet-5):
turns at 17:37:19Z (140 output tokens) and 17:37:23Z (195) - two short
turns between dequeue and completion. No `tmp/handoff.txt`, no audit
challenge pending: nothing was attempted.

## Reading

- The coordinator's first note (008844) attributed the stall to the
  cleaner; its second (008895) to the architect "not cleaner". The trail
  has BOTH: the cleaner's batch closed without a forward (the twin
  blocked the send - BL-1605's mechanism, unchanged), and after the chase
  the architect completed the re-forward without acting. Two 50-minute
  stalls became two 60-80-minute stalls on the same tickets.
- Why the architect would complete in seconds, twice, on evidence-only
  fix commits: handoff-protocol.md's No-Op Rule says "must not send or
  forward a git_handoff when the received commit produces no functional
  project change ... manifest-only, audit-only". Against the hop's own
  diff that is a literal instruction to complete; against the parcel it
  is the opposite. The rule's BL-075 paragraph already says "a stage with
  nothing to add still forwards", but the "received commit" phrase reads
  as the tip. Clarified in this commit: the received commit is the
  parcel's change since `main`, never the last hop; a re-forwarded fixed
  bounce is reviewed and forwarded, its inventory commit is the forward.
- Nothing mechanical stops it: `done_with_current_task.bb` gates Work
  notes (BL-1422) and released QA holds (BL-1566); a git_handoff completes
  on sight; the batch helper has no gate. BL-1422 scenario 04 even pins
  "a git_handoff completes as today" - retired by BL-1609 (BL-1006).

## Outcome

- **BL-1609**: forward-evidence gate on both completion paths, `--no-op
  "<reason>"` stamped as `no_op_reason`, master-resident and
  non-forwarding exempt, BL-1422's row retired. depends_on BL-1605 (the
  twin would otherwise deadlock a batch role between the two gates).
- **BL-1605**: notes amended with the correction; title and mechanism
  unchanged (the cleaner stall is in the trail).
- Prose landed (BL-798): handoff-protocol.md No-Op paragraph; architect
  prompt "a re-forwarded fixed bounce is never a no-op".
- Architect sent a note now (it holds BL-1554's re-forward, the same
  shape); coordinator sent the paused-ready note.

## Recorded, not ticketed

- A correction note that says "X, not Y" can be "X as well as Y": read
  the trail before rewriting a ticket's premise. Here both attributions
  were right about a different hour.
- The architect seat is `--model claude-sonnet-5 --effort medium` on the
  live pack; a rule that needs judgement ("is this a no-op?") is exactly
  where a cheaper seat reads the sentence, not the intent. Gates, not
  prose, for those.
