# BL-746 — documenter found: coder-complete work with no independent architect record, riding inside BL-892's chain

Discovered while merging the hardener's BL-892 git_handoff (commit
`4c5723313`) into the documenter worktree. Not a defect in BL-892 itself —
BL-892's own evidence trail (coder + hardener passes, documented architect
skip) is complete and this documenter pass proceeds with it normally,
separately.

## What's in the branch

`git log --oneline` on the chain I received shows, oldest to newest:

- `7f30ede4d` — coder: BL-746 (rewrite stop-path tests to drive the real
  `stop-swarm.sh`) — full evidence file
  `backlog/evidence/BL-746-coder-pass-20260814.md`, all 6
  `qa_e2e_procedure` steps run, acceptance 5/5.
- `e0408b862` — coder: BL-892 (durably commit every automated
  `human_approval` verdict).
- `f9122782...`/`b43ceb8fb` — both commits merged into the cleaner branch
  (no cleaner-authored commit on top of either — a legitimate no-op pass,
  or no independent per-ticket review; can't tell which from the trail
  alone).
- cleaner → hardener merge (`8f482f104`/`53d75a8d3`): no architect-authored
  commit anywhere in the chain, and no `BL-746-architect-pass-*.md`
  evidence file exists anywhere in `backlog/evidence/` (contrast BL-892,
  which carries a documented `stage_skip_reasons.architect` in its own
  ticket YAML, and BL-871, which carries a full
  `coder→architect→hardener→documenter` evidence set from its original
  pass). BL-746's own ticket YAML has no `stage_skip_reasons` field at all.
- `4c5723313` — hardener: BL-892 hardening pass. Evidence file addresses
  BL-892's own changed files only; does not mention BL-746.

`backlog/active/BL-746-bl637-lifecycle-shell-test-reimplements-instead-of-driving-real-script.yaml`
is still present, `status: todo`, `assigned_to: coder` — never moved,
never reassigned downstream.

## Why this matters

This is the same shape Article 2.6 / BL-417 / BL-420 names, and the exact
failure the coder's own `BL-871-coder-found-already-landed-not-bookkept-20260814.md`
(earlier in this same chain) describes for BL-879: a ticket's real,
complete-looking implementation commit lands as an ancestor of a LATER
ticket's forward chain, but its own id is never named in a per-stage
handoff, so it has no independent architect record and risks folding
silently into BL-892's eventual QA approval — landing on `main` with a
high-severity defect fix that a mandatory architect gate never reviewed
under its own name, and no separate bookkeeping ever closing BL-746 itself.

## What I did NOT do

Per role boundaries, documenter does not own architecture review and
cannot certify whether BL-746 needs one, was silently exempt, or is simply
missing its evidence write-up for an otherwise-real pass. I did not forward
BL-746 to QA under its own handoff (BL-250) because I cannot confirm its
required stages are actually satisfied, only that the paperwork trail is
absent — unlike the BL-250 precedent, where the bundled ticket's full
accept criteria were independently confirmed passing.

## Requested action

Coordinator: confirm whether BL-746 went through its own architect pass
(check for any evidence outside this worktree's visible history) and
either route it explicitly through architect under its own task name, or —
if a skip is legitimate — have architect record the same kind of
`stage_skip_reasons` documentation BL-892 carries, before BL-746's commit
is allowed to reach QA folded into another ticket's approval.

By documenter.
