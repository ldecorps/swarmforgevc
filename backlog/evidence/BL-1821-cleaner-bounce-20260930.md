# BL-1821 — cleaner bounce, 2026-09-30

## Review pass — complete inventory (Article 4.4)

Checked: `test_recruiter_hf_discover_batch.sh` (8/8), `test_recruiter_specifier_scout.sh`
(13/13), `test_recruiter_nightly_specifier_scout.sh` (6/6), acceptance
feature (7/7, including the new `scout-own-seen-list-04` scenario), the
declared invariant re-checked by grep (no `git`/pack-conf/`swarmforge.conf`
write in `recruiter_specifier_scout.sh`). All pass, all reproduced
independently. No mutation-site or DRY concerns (bash/python, no
mutation/CRAP/DRY lane per Engineering rules).

## D1 (blamed: documenter) — the how-to doc still describes the pre-ruling shared seen.jsonl

- **Class:** documentation defect (stale prose describing retired
  behavior).
- **What's wrong:** `docs/how-to/BL-1821-recruiter-specifier-scout.md`
  line 35-36 reads: "The scout's writes are exactly: the score table, its
  report, the recruiter's `seen.jsonl`, and the battery's own evidence."
- **Why this is wrong:** the specifier's ruling on QA's D2 spec-gap
  (`backlog/evidence/BL-1821-bounce-20260930.md`, landed on `main` at
  2e36351598) is explicit: "the scout keeps its own seen list,
  `.swarmforge/recruiter/seen-specifier.jsonl` ... The weekly coder
  path's `seen.jsonl` neither limits the scout nor is written by it." The
  ticket's own amended invariant now reads: "its writes are the score
  table, its report, the scout's own seen list (never the weekly coder
  path's seen.jsonl) and the battery's own evidence." The actual script
  (`recruiter_specifier_scout.sh`) matches the ruling exactly — it writes
  `seen-specifier.jsonl`, never `seen.jsonl` (verified directly, line 79
  and the mark-before-pull block). Only the how-to doc still names the
  shared file.
- **How this happened:** the how-to doc was written by an earlier
  documenter pass (`8fa1bc57c0`) BEFORE QA's second bounce surfaced the
  D2 spec gap. QA's whole-parcel revert and the coder's rebuild carried
  the doc forward untouched (the coder's own bounce-fix-3 evidence says
  so explicitly: "Per the specifier's own note, the how-to doc line lands
  with the documenter in this same parcel — not touched here"). The
  documenter's most recent pass on this rebuilt parcel recorded NONE
  without catching that its own earlier doc content was now stale against
  the landed ruling.
- **Consequence:** an operator or a future coder reading this how-to
  would believe the scout reads/writes the shared `seen.jsonl`, exactly
  the design QA's D2 bounce and the specifier's ruling rejected as
  starving both roles of models the other has already seen.
- **Remediation:** update the sentence to name `seen-specifier.jsonl`
  (the scout's own list), matching the ticket's own invariant wording
  ("the scout's own seen list (never the weekly coder path's seen.jsonl)").

No other items. Nothing blocked.

By cleaner.
