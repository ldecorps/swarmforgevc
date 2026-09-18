# BL-1637 - specifier adjudication of the coder's forward-gate refusal note, 2026-09-18

Inbound: coder note 00_20260918T144557Z_000019 (priority 00): "BL-831
forward-gate false-refused; evidence in backlog/evidence". Coder evidence
`backlog/evidence/BL-831-coder-forward-gate-false-refusal-20260918.md`
(coder@2 branch 6d63104e70).

## What the coder saw

- `swarm_handoff.sh` delivered BL-831's forward (commit c6507fe1bd) to
  the cleaner at 14:42:41Z; the cleaner's batch claimed it at 14:42:53Z.
- `done_with_current.sh` refused: `FORWARD_NOT_SENT: BL-831 has no
  git_handoff naming it queued since dequeue.`
- A resend was refused by the duplicate-parcel check (live at cleaner);
  `redo_from.sh` was correctly NOT run; the inbound
  `000858_from_cleaner_to_coder` was completed with `--no-op` at 14:46:01Z
  with a reason naming the evidence. The coder attributed the missing
  evidence to an external sweep of its outbox/sent/tmp at 15:42 local.

## What the file system says

- The delivered file exists at
  `.worktrees/coder/.swarmforge/handoffs/sent/50_20260918T144241Z_000018_from_coder_to_cleaner.handoff`
  - the CODER STAGE's sent folder. Its `from:` header is `coder`.
- `.worktrees/coder2/.swarmforge/handoffs/sent/` is empty and has been
  since 2026-09-17 07:00:06 (directory mtime). Its `outbox/` mtime is
  15:45:58 local - the moment the daemon moved the delivered file out; no
  sweep ran.
- `.worktrees/coder2/tmp/handoff.txt` (75 bytes, 15:44) is the draft; it
  was not swept either.
- BL-831 is now in the architect's in_process (forwarded by the cleaner
  at 14:47:01Z). A non-forwarding reverse copy `000862` addressed to
  coder@2 sits in the seat's inbox/new; with BL-1615 landed today the
  seat's dispatcher will claim it (merge-only).

## Why

- `swarmforge/scripts/handoffd.bb:598` (and `:729`):
  `(move-with-collision path (sent-dir (get roles sender-role)))` - the
  delivered outbox file is filed under the role named by the file's
  `from:` header. A seat stamps `from:` with its STAGE (BL-982/BL-983: the
  stage is the addressable identity), so coder@2's forwards are filed
  under `.worktrees/coder`.
- `swarmforge/scripts/forward_evidence_lib.bb:32-48`
  `sent-handoff-names-ticket-since?` scans `(handoff-lib/my-mailbox-dir
  :sent)` and `:outbox`, which for `SWARMFORGE_ROLE=coder@2` resolve
  through `my-mailbox-base-dir` and roles.tsv to `.worktrees/coder2/...` -
  the seat's own folders.
- Sender writes to the seat's outbox; daemon files under the stage's
  sent; gate reads the seat's sent. For a bare seat all three coincide,
  so BL-1609's fixture (a bare architect/cleaner) never saw it.
- BL-1615 (landed 2026-09-18) fixed the INBOUND side (the seat's
  dispatcher claims mail addressed to it). This is the OUTBOUND side.

## Ruling

Real gate defect, not a false alarm and not a sweep. The coder's
`--no-op` completion with its reason stands (the honest option available;
`redo_from.sh` on a live parcel would have been wrong). Minted BL-1637
(defect, high, auto-approved): the gate scans the seat's folders and its
stage's; the daemon files a seat's delivered mail under the seat by a
daemon-stamped seat header while `from:` keeps the stage. Until it lands,
a coder@2 forward refused at completion is this defect: complete with
`--no-op` naming BL-1637, never clear a live parcel.

By specifier.
