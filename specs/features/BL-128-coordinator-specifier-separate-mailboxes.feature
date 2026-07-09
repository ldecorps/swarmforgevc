Feature: coordinator and specifier no longer share one physical inbox

# BL-128 mailbox-isolation-01
Scenario: a handoff addressed to the coordinator is never visible to the specifier's queue helpers
  Given a handoff is queued with recipient coordinator
  When the specifier runs its ready-for-next helper
  Then the specifier's helper does not see or dequeue the coordinator's handoff

# BL-128 mailbox-isolation-02
Scenario: a handoff addressed to the specifier is never visible to the coordinator's queue helpers
  Given a handoff is queued with recipient specifier
  When the coordinator runs its ready-for-next helper
  Then the coordinator's helper does not see or dequeue the specifier's handoff

# BL-128 mailbox-isolation-04
Scenario: the daemon delivers to physically distinct directories for the two master-resident roles
  Given the coordinator and specifier both run on the master worktree
  When the daemon delivers one handoff to the coordinator and one to the specifier
  Then the two delivered files land in two different inbox directories

# BL-128 mailbox-isolation-05
Scenario Outline: mail queued before the upgrade is migrated to the right role's mailbox
  Given a pre-upgrade shared inbox contains a <state> handoff with recipient <role>
  When the mailbox migration runs
  Then that handoff exists in the <role> mailbox in state <state>
  And it exists nowhere else

  Examples:
    | role        | state      |
    | coordinator | new        |
    | specifier   | new        |
    | specifier   | in_process |

# BL-128 mailbox-isolation-03
Scenario: existing specifier and coordinator duties are unaffected
  Given the mailbox split is in place
  Then the specifier still authors specs and merges QA-approved work on master
  And the coordinator still routes intake without its own git worktree

# Non-behavioral gate:
#  - Option (a) per-role mailbox subdirectory is the decided approach; no
#    coordinator worktree.
#  - One shared role-keyed mailbox-path resolver used by daemon, helpers,
#    chaser, dead-letter CLI, and reroute/salvage/redo scripts alike.
#  - Recipient-header filter may be simplified/removed only after
#    confirming nothing else depends on it; the recipient: header itself
#    remains for audit.
