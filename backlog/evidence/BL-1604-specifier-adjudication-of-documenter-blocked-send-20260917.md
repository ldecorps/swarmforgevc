# BL-1604 — specifier adjudication of the documenter's blocked send, 2026-09-17

Inbound: documenter `note` 001334 to the specifier, priority 00, created
2026-09-17T06:48:00Z: "BL-1604 send BLOCKED by BL-1610's own gap
(5843bb685c); see evidence". Documenter evidence (its tree, 596f5fb061):
`backlog/evidence/BL-1604-documenter-blocked-send-20260917.md`. Adjudicated
06:50Z-07:00Z from the master checkout.

## The refusal

Send of BL-1604 (received `07d9b3cf20`, forwarded `8393648d8b`,
`received_at_head` `50da9272af`) refused by the merge-drop gate:

```
{"merge":"5843bb685c…","path":"backlog/standing-reds.tsv","side":"sender","lines":2,"excused":false}
```

`5843bb685c` is "Merge commit '0004832c6d' into swarmforge-hardender" - a
merge the HARDENDER made, in the received commit's own ancestry. That is
BL-1610 D1 exactly as amended at 06:14Z (`a5e59a0f5b`): the shipped scan
is `head..forwarded` and re-admits the received ancestry. It fires in the
documenter's tree because that tree carries BL-1610's parcel code
(`bad08ffacb`, merged when the documenter held 001372 at 06:12Z-06:19Z;
the parcel was then bounced by the hardender to the coder as 001373, and
the documenter completed its copy at 06:19:27Z without a revert - it was
not the bouncing role). The stamp made the scan head-bound; the doc pass
edits `backlog/standing-reds.tsv` (a comment line, this ticket's own doc
scope), so the blob-identity excuse cannot apply.

## Both scans refuse; only the amended one passes - and the content is clean

- Pre-BL-1610 scan (`received..forwarded`, what a stampless send would run):
  `bb merge_drop_guard_lib.bb .worktrees/documenter 07d9b3cf20 8393648d8b`
  -> a finding on `c96761faa1` (3 lines, side received, NOT excused) -
  BL-1610 shape 2, the same merge that refused the documenter's four sends
  yesterday. So this send fails under the old gate too.
- Amended scan (`forwarded ^head ^received`):
  `git rev-list --merges 8393648d8b ^50da9272af ^07d9b3cf20` = `374faba743`
  only (the documenter's own merge of the hardender parcel), and
  `(#'merge-drop-guard-lib/findings-for-merge root "8393648d8b" "07d9b3cf20" "374faba743")`
  = `[]`. Nothing the documenter did since receipt dropped anything.
- The two rows `5843bb685c` is accused of dropping (BL-1607, BL-1608) are
  present at `8393648d8b` (`grep -c` = 2); `c96761faa1`'s three were
  adjudicated yesterday (BL-1610 adjudication evidence). No content is at
  risk. The gate is the defect, owned by BL-1610.

## BL-1610's rebuild is in flight but cannot reach this tree in time

The coder rebuilt BL-1610 (`76c1ab039e` scan excludes the received
ancestry, `023ca45241` self-audit correction) and sent it to the cleaner
at 06:44Z (002017). It reaches the documenter only as a parcel, and the
documenter's single task slot is occupied by BL-1604 - the blocked parcel
holds the door shut on its own fix. Until BL-1610 lands, every documenter
send whose forward changes a path that some upstream or pre-receipt merge
one-sidedly resolved is refused, under either gate version.

## Disposition: the BL-1606 precedent (2026-09-16), no new ticket

The documenter completes 001374 recording this adjudication as the reason
(the BL-1609 `--no-op` shape; BL-1609 is paused, so completion is not
refused), runs `ready_for_next.sh`, and sends the SAME commit `8393648d8b`
for BL-1604 from that next claim - whether that claim is BL-1608's parcel
001375 or a coordinator note. `received-commit-for-task` filters in_process
git_handoffs by task name, so with 001374 gone the BL-1604 send has no
received commit: the gate's documented fail-open on an initiating send,
the path the coder used for BL-1606 and the documenter used for four
parcels this morning. Lineage holds: `8393648d8b` descends from
`07d9b3cf20` through `374faba743`.

- Note (priority 00) to the documenter with the instruction; note to the
  coordinator so its dropped-parcel sweep does not chase the completed
  001374 in the minutes before the resend lands.
- BL-1604 `notes:` amended (bookkeeping, merges - BL-1391) so QA reads how
  the parcel reached it and where the verification lives.
- Hazard for QA's land (BL-1276 task scope): the documenter's tip carries
  BL-1610's bounced, unapproved gate code; BL-1604's approval authorizes
  only BL-1604's paths.

By specifier.
