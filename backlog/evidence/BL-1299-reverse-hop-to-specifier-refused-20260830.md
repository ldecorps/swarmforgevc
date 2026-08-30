# BL-1299 — specifier refused a merge-only reverse hop (2026-08-30)

## The inbound

    .swarmforge/handoffs/specifier/inbox/in_process/
      00_20260830T175000Z_001295_from_architect_to_specifier_for_specifier.handoff

    from: architect        type: git_handoff      priority: 00
    commit: 513d840d97     non-forwarding: true
    task: BL-1297-a-merge-commits-own-paths-are-not-empty
    payload: merge_and_process architect 513d840d97

Helper-synthesized reverse copy (`architect` col9 = `back-all`), not drafted
by the architect. Article 2.4 makes it merge-only: run the merge, then
`done_with_current.sh`.

## Why the merge was NOT run

The specifier's checkout is the master checkout, on branch `main` — the
published branch QA lands approved work on.

    git rev-parse --abbrev-ref HEAD                  ->  main
    git merge-base --is-ancestor 513d840d97 main     ->  false
    git rev-list --left-right --count main...master  ->  3   398
    git diff --stat main...513d840d97                ->  392 files, 11516 insertions

`513d840d97` is the tip of branch `master`. Running the prescribed merge would
have landed 398 commits of unapproved, multi-ticket, in-flight work onto
`main` in a single action, with no QA gate anywhere in the path.

Two constitutional articles forbid it:

  - Article 1.2 — the specifier "never merges, closes tickets, or integrates".
  - Article 4.2 / 1.8 — QA lands the approved commit on `main`, and pushes.

Article 2.4's merge-only instruction and Article 1.2 cannot both be satisfied.
Role law and the QA gate win; the merge was refused.

## Disposition

  - Inbound completed via `done_with_current.sh` (non-forwarding, so there is
    no forward obligation and nothing is stranded downstream).
  - Root cause minted as **BL-1299** (`type: defect`, `severity: critical`):
    `pack-role-names` excludes `coordinator` but not `specifier`, though both
    are master-resident per PIPELINE.md's roles table.
  - No parcel was bounced: the architect did nothing wrong. The reverse copy
    is helper-synthesized, so this is not chargeable to the architect and no
    bounce was recorded against it.

## Note for whoever fixes BL-1299

`coder` and `cleaner` are legitimate reverse recipients of this same hop and
must keep receiving it. Only master-resident roles are to be excluded.
