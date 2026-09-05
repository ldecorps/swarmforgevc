Feature: BL-1415 A dispatch that survives only in the sender's sent copy is lost, and the router re-routes it

  The dispatch trail (BL-1097, narrowed by BL-1223) answers "has this ticket
  ever been dispatched?" from every mailbox state of every role, the
  sender's sent/ copy included. On 2026-09-05 two Work notes the
  coordinator sent to the coder (03:27Z for BL-1384, 03:57Z for BL-1402)
  exist only as the coordinator's sent/ copies: no copy in the coder's
  new, in_process, completed, done or abandoned, and no work commit
  anywhere. The dropped-parcel sweep correctly said "no parcel in flight -
  possible drop", but route_backlog_to_coder.sh refused to fix it because
  the trail said DISPATCHED, and the coordinator had to --force both after
  proving by hand that nothing had been worked.

  This feature is that a sender-side copy proves dispatch only when a
  matching recipient-side copy exists in any state; a dispatch with no
  recipient-side copy is LOST, the CLI says so, the router re-routes with a
  warning that names the lost parcel, and the dispatch-gap sweep sees the
  same answer because it is the same predicate.

  Background:
    Given a fixture mailbox tree for coordinator, coder and cleaner

  # BL-1415 sender-only-copy-is-lost-01
  Scenario: a Work note present only in the sender's sent copy answers LOST and is re-routed with a warning
    Given the coordinator's sent copy of a Work note for BL-9001 to the coder and no copy in any coder mailbox state
    When the dispatch trail is asked whether BL-9001 is dispatched
    Then it answers LOST naming the sent copy
    And route_backlog_to_coder.sh routes BL-9001 and warns that the earlier dispatch was lost, naming the parcel

  # BL-1415 recipient-copy-in-any-state-is-dispatched-02
  Scenario Outline: a matching recipient-side copy in any state keeps the answer DISPATCHED and the router refusing
    Given the coordinator's sent copy of a Work note for BL-9001 to the coder and the coder's copy in <state>
    When the dispatch trail is asked whether BL-9001 is dispatched
    Then it answers DISPATCHED
    And route_backlog_to_coder.sh refuses without --force

    Examples:
      | state       |
      | new         |
      | in_process  |
      | completed   |

  # BL-1415 a-worktree-parcel-is-dispatched-regardless-03
  Scenario: a git_handoff sitting in a worktree role's mailbox is DISPATCHED whether or not any sent copy exists
    Given a git_handoff for BL-9001 in the cleaner's completed mailbox and no sent copy anywhere
    When the dispatch trail is asked whether BL-9001 is dispatched
    Then it answers DISPATCHED

  # BL-1415 the-sweep-and-the-router-agree-on-lost-04
  Scenario: the dispatch-gap sweep treats a LOST dispatch exactly as the router does
    Given an active ticket BL-9001 whose only trail is the coordinator's sent copy
    When the sweep lists undispatched active tickets
    Then BL-9001 is listed, with the same LOST reason the router printed
