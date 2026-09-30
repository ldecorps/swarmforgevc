# BL-1821 — architect bounce, 2026-09-30

## Review pass — complete inventory (Article 4.4)

Checked: `test_recruiter_hf_discover_batch.sh` (8/8), `test_recruiter_specifier_scout.sh`
(13/13), `test_recruiter_nightly_specifier_scout.sh` (6/6), acceptance
feature (7/7, including the `scout-own-seen-list-04` scenario), the
declared invariant re-checked by grep (no `git`, no `swarmforge.conf`, no
`packs/` write in `recruiter_specifier_scout.sh`). All pass, all
reproduced independently. No dependency-gate/co-change concerns (no
extension/src TypeScript touched by this round's changes).

## D1 (blamed: documenter) — the how-to doc still describes the retired shared seen.jsonl

- **Class:** documentation defect (stale prose describing retired
  behavior) — the SAME defect the cleaner already bounced
  (`backlog/evidence/BL-1821-cleaner-bounce-20260930.md`, commit
  cf4cd28991, blamed documenter), still unfixed in the commit
  (a7974c4d54) this parcel forwarded to architect.
- **What's wrong:** `docs/how-to/BL-1821-recruiter-specifier-scout.md`
  line 35-36 still reads: "The scout's writes are exactly: the score
  table, its report, the recruiter's `seen.jsonl`, and the battery's own
  evidence."
- **Why this is wrong:** the specifier's ruling on QA's D2 spec-gap
  (landed on `main` at 2e36351598) and the coder's own bounce-fix-3
  (`backlog/evidence/BL-1821-coder-bounce-fix3-20260930.md`) both settle
  this: the scout keeps its own list, `.swarmforge/recruiter/seen-specifier.jsonl`,
  never the weekly coder path's `seen.jsonl`. The ticket's amended
  invariant and the script itself (`SEEN_SPECIFIER=.swarmforge/recruiter/seen-specifier.jsonl`)
  both match the ruling. Only the how-to doc still names the shared file
  — verified directly against the current file content, this parcel's
  own tip.
- **Why this reaches architect rather than staying at documenter:** the
  cleaner's bounce named documenter as the owner, but the commit this
  git_handoff carries (a7974c4d54, "record bounce (bounce_count) after
  cleaner send-back") is the bounce record itself with no subsequent
  documenter fix commit in its ancestry — `git log --oneline -- docs/how-to/BL-1821-recruiter-specifier-scout.md`
  shows only the original authoring commit (8fa1bc57c0) and a revert
  (e4e36235e7), nothing after the cleaner bounce. Per "Never Blind-Forward
  A Bounce You Cannot Fix" (workflow-detailed.prompt), a defect outside
  architect's domain is not architect's to fix or to forward onward —
  it routes to the owning role.
- **Remediation:** documenter updates the sentence to name
  `seen-specifier.jsonl` (the scout's own list), matching the ticket's
  own invariant wording, then forwards. No other defect found this pass.

No other items. Nothing blocked.

By architect.
