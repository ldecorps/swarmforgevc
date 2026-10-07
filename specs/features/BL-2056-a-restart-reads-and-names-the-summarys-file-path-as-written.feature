Feature: BL-2056 A restart reads and names the file its compaction summary named, at the path the summary wrote

  BL-1991's repeat guard reads the file a compaction's next step names,
  counts whether the seat has written it, and on a miss restarts the seat
  with a message telling it to write that file. The guard drops a path's
  leading "/": "Edit /home/carillon/swarmforgevc/.worktrees/coder/swarmforge/scripts/check_merge_deletion.sh"
  reads as "home/carillon/swarmforgevc/.worktrees/coder/swarmforge/scripts/check_merge_deletion.sh",
  and the seat's own writes use an absolute path (all 679 edit and
  write_file calls in the iq3 coder's recorded sessions did), so a relative
  summary path never matches either. Measured 2026-10-07: a seat that
  edits the absolute path its summary named, then makes two more calls, is
  judged to have missed the write, so "a seat that writes first is left
  alone" does not hold for the seat's own writes. The restart message also
  always says "Do not read <path> first - it does not exist yet", even for
  a file that exists; on 2026-10-06 at 23:38Z the iq3 coder replaced an
  existing step handler with write_file after a message of that kind.

  # BL-2056 a-seat-that-wrote-the-named-file-is-left-alone-01
  Scenario Outline: a seat that wrote the named file is left alone, whichever way the summary wrote its path
    Given a local coder seat whose latest compaction names an edit of <file>, written as an <form> path, as its next step
    And since that compaction the seat has edited that file at its absolute path and made one other tool call
    When the seat makes a third tool call that is not the named write
    Then the seat's qwen process is not restarted

    Examples:
      | file                                       | form     |
      | swarmforge/scripts/check_merge_deletion.sh | absolute |
      | tmp/notes.md                               | relative |

  # BL-2056 a-restart-names-an-existing-file-to-edit-02
  Scenario: a restart on a file that exists names it at its absolute path and says to edit it
    Given a local coder seat whose latest compaction names an edit of swarmforge/scripts/check_merge_deletion.sh, written as an absolute path, as its next step
    And that file exists in the seat's worktree
    And the seat has made two tool calls since that compaction, neither of them the named write
    When the seat makes a third tool call that is not the named write
    Then the fresh turn's only user message names that file at its absolute path
    And the message tells the seat to edit that file and never says that it does not exist
    And the message tells the seat to read only the lines it will change before editing, and never not to read the file

  # BL-2056 a-restart-on-a-new-file-says-write-it-unread-03
  Scenario: a restart on a file that does not exist yet still says to write it without reading it first
    Given a local coder seat whose latest compaction names a write of tmp/notes.md, written as a relative path, as its next step
    And that file does not exist in the seat's worktree
    And the seat has made two tool calls since that compaction, neither of them the named write
    When the seat makes a third tool call that is not the named write
    Then the fresh turn's only user message tells the seat to write tmp/notes.md and not to read it first
