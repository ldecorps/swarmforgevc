Feature: The ready_for_next receive helper never promotes backlog items — promotion is coordinator-only

  # ready_for_next.bb ends with (promote-next-paused-item-if-needed) on line 33,
  # AFTER (dispatch-lib/run-dispatch! ...) on line 30. run-dispatch! always
  # terminates the process before returning: it either execs the mode's helper
  # via run-helper! -> process/exec (which replaces the process image) or exits
  # via exit! -> System/exit. So line 33 is unreachable dead code and has never
  # run. Beyond being dead, it does not belong here at all: promoting paused
  # items into backlog/active/ is the coordinator's exclusive duty (Articles
  # 1.1 and 3.3) and must respect the depth cap and orthogonality — a receive
  # helper silently promoting would bypass both. Remove the function and its
  # call, keeping the helper's sole job (dispatch) intact.

  # BL-226 dispatch-unchanged-01
  Scenario Outline: ready_for_next still dispatches to the helper for the role's receive mode
    Given a role whose receive mode is "<mode>"
    When ready_for_next runs
    Then it execs "<helper>" as before

    Examples:
      | mode  | helper                  |
      | task  | ready_for_next_task.sh  |
      | batch | ready_for_next_batch.sh |

  # BL-226 no-helper-promotion-02
  Scenario: the receive helper moves no paused item into active
    Given a paused backlog item with backlog/active/ below the depth cap
    When ready_for_next runs
    Then no item is moved from backlog/paused/ to backlog/active/ by the helper

# Non-behavioral gates:
#  - promote-next-paused-item-if-needed (defined ready_for_next.bb:9) and its
#    post-run-dispatch call (line 33) are both deleted; a grep guard confirms the
#    symbol no longer appears in ready_for_next.bb.
#  - Promotion remains solely the coordinator's job (Articles 1.1/3.3); no receive
#    helper promotes. This also removes a latent depth-cap-bypass footgun.
#  - RECONCILE WITH BL-216 (active): BL-216 edits this SAME (dead) function's
#    config read. The two are NOT orthogonal — they touch the same lines and must
#    not run concurrently. If this function is confirmed unreachable, BL-216's
#    config-read fix within it has no live effect; the coordinator should sequence
#    BL-226 after BL-216 (or reconcile scopes) rather than promote them together.
