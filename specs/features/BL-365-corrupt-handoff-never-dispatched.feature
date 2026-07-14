# mutation-stamp: sha256=f849db3862b7cba06cb7bbcd8803007a1cb141acc83cff23bad298bb64b302a4
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-07-14T03:53:55.880936138Z","feature_name":"A corrupt handoff is quarantined and surfaced, never delivered as work","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-365-corrupt-handoff-never-dispatched.feature","background_hash":"6f0ce5e6a9f8cd29d16822bb207f5db94940a4290de18d00af50e870bd4ceb26","implementation_hash":"unknown","scenarios":[{"index":0,"name":"A corrupt handoff is never dispatched to a role as work","scenario_hash":"a3eec46efcc6398e9da799f2f7cf692482947af70a3a47d7dbc50009ea8b4ff1","mutation_count":3,"result":{"Total":3,"Killed":3,"Survived":0,"Errors":0},"tested_at":"2026-07-14T03:53:55.880936138Z"}]}
# acceptance-mutation-manifest-end

Feature: A corrupt handoff is quarantined and surfaced, never delivered as work

# BL-365: on 2026-07-13 a coder→cleaner git_handoff was emitted as a ZERO-BYTE file
# (.worktrees/coder/.swarmforge/handoffs/sent/50_20260713T165246Z_000238_from_coder_to_cleaner.handoff —
# every sibling handoff is ~280 bytes). It was copied onward and dequeued as a task with no from, no
# type, no task name and no commit: nothing for the cleaner to act on. The parcel was silently lost,
# and no stuck-detection fired, because from the outside mail DID move. Recovering the commit meant
# cross-referencing the coder's git log by timestamp. Two halves: a corrupt message must never be
# dispatched as work (at every hop that can see it), and an "atomically installed" file must actually
# be durable — a rename without an fsync is atomic in ordering, never in durability.

Background:
  Given roles exchange handoffs through their mailboxes

# BL-365 corrupt-handoff-never-dispatched-01
Scenario Outline: A corrupt handoff is never dispatched to a role as work
  Given a handoff file that is "<corruption>"
  When the receiving role asks for its next task
  Then it is not given that file as a task
  And the file is quarantined
  And the corruption is surfaced rather than passed on in silence

  Examples:
    | corruption           |
    | empty                |
    | truncated mid-header |
    | headers with no body |

# BL-365 corrupt-handoff-never-dispatched-02
Scenario: A corrupt handoff is not delivered onward to a recipient's inbox
  Given a corrupt handoff file is waiting to be delivered
  When the handoff daemon processes it
  Then it is not copied into any recipient's inbox
  And it is quarantined with a diagnostic saying what was wrong with it

# BL-365 corrupt-handoff-never-dispatched-03
Scenario: A sender cannot install an empty handoff into its outbox
  When a role sends a handoff whose contents fail to be written
  Then no handoff file appears in its outbox

# BL-365 corrupt-handoff-never-dispatched-04
Scenario: A handoff that survives a crash still has its contents
  Given a handoff has been reported as sent
  When the machine loses power before the write reaches the disk
  Then the handoff still carries the task and commit it was sent with

# BL-365 corrupt-handoff-never-dispatched-05
Scenario: A lost parcel is visible, not silent
  Given a corrupt handoff was quarantined instead of delivered
  When the swarm looks for work that has gone missing
  Then the quarantined handoff is reported as needing a human
