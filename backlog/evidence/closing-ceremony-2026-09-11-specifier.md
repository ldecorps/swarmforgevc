# Closing ceremony — shift 2026-09-11 (specifier lean pass, BL-820)

Packet: `.swarmforge/lean/ceremony/2026-09-11.json`, `deliveredAt`
2026-09-11T00:00:00Z, read via the coordinator's priority-00 note
(`00_20260911T042556Z_007787`) after the 2026-09-09 failure note
(see `closing-ceremony-2026-09-09-specifier.md`, which minted BL-1528).

**Outcome recorded: `spec_gate_tweak`, ref = the commit landing this file
and the `swarmforge/roles/specifier.prompt` amendment.**

## What the packet showed

Path taken QA → cleaner → architect → hardender → documenter → coder (the
coder re-entries are the two bounces). Dwell hotspots QA 3971726ms,
hardender 1014545ms. Two bounces, both class `behavior`, both on BL-1515:
architect → coder (D1: the live worktree repair was narrated in a commit
message, not recorded as evidence with command output, as the FIRM
approval demanded) and hardender → coder (D1: the branch-identity guard
ran for master-resident roles and would have renamed the shared `main`
to `swarmforge-specifier` on the specifier's first turn). Stalls: cleaner
chase ×6, architect ×4, QA chase ×3 + nudge ×3, hardender ×3, documenter
×2. Hypotheses: QA dwell; recurring `behavior` class; cleaner chase
pattern.

## The signal I acted on

The hardener's bounce (`backlog/evidence/BL-1515-hardender-bounce-20260911.md`,
commit d7bfe27121 reviewed) is a spec-time defect and it is mine: BL-1515's
acceptance Background builds "a fixture repository under mkdtemp with a
coder worktree" and nothing else, so its five scenarios were green with
zero coverage of the master-resident roster shape the guard also runs
for. The ticket's `How` said to mirror BL-1195's guard, whose one
hand-written exemption is exactly that shape, and three passes recorded
NONE against a suite that could not see it. The parcel fixed it in flight
(e13b88db33 exempts master-resident roles; the QA-side feature now
carries scenario 06, "a master-resident role is exempt even when checked
out on neither declared session") — the fix is owned; the rule that
would have put the scenario in the ticket at mint was not.

Amendment landed in `swarmforge/roles/specifier.prompt` (scope
`role:specifier`, Article 5.1; not a boot-inlined file, so the boot prefix
budget gate is not in play): a guard/gate/sweep keyed on a roster row is
minted with at least one scenario whose fixture builds the master-resident
shape — two rows sharing one path, different `session` values, checked out
on neither — asserting silence and no mutation. Same fail-open family as
BL-1445's census rule (2026-09-08 pass).

## Signals I looked at and did not act on

- **The architect's bounce** (evidence-as-narration). A workmanship
  defect against a FIRM approval clause the ticket did state; the coder
  fixed it in the parcel (508f952e4e, `BL-1515-coder-20260911-fix-D1.md`).
  The spec asked for the artifact explicitly; no rule to add.
- **QA dwell + QA nudge ×3.** QA is the integration point and hand-lands
  (BL-247); nudges on QA during a shift that closed BL-1478/BL-1501 and
  carried BL-1515 through two rebuilds are the merge-up work, not a stuck
  parcel. Known shape (QA in_process abandoned mid-work is a separate
  watched item), nothing new to ticket.
- **Cleaner chase ×6 / every role chased.** Mono-router rotation: a
  parcel arrives for a role that is not the resident and waits for the
  rotation; two rebuilds of one ticket double the count. Not a stuck
  parcel.
- **`qualityRecommendations`** (raise, all six roles): advisory; the
  coordinator's half.
- **Determinism candidates** `pass-bounce-evidence` (0.015),
  `backlog-promotion` (0.192), `backlog-closure` (0.478): the same three
  as every pass since 09-06, still no open `ritual_class:` declarant.
  Not ticketed, same reasoning as the 09-08 and 09-09 passes (shipped
  helpers exist; the gap is adoption, and `promote_and_route_next.sh`'s
  fixtures are owned by BL-1480). Expect them again.
