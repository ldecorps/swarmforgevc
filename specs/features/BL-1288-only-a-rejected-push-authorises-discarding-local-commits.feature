Feature: Only a rejected push may authorise discarding local-ahead commits

  BL-1198 put a push in front of the reconcile's `git reset --hard
  origin/main`, so the common case resolves losslessly. The guard is wired at
  all three production call sites (handoffd.bb, swarm_heal.bb,
  post_hotfix_merge_origin.bb) and it still lost committed work seven times on
  2026-08-30, twice during a single specifier turn.

  The reason is the classification. `rematch-with-push-first!` treats EVERY
  unsuccessful push as the genuine-divergence signal:

      (let [push-result (push!)]
        (if (:success push-result)
          {:success true :outcome :pushed}
          (reset!)))

  A push also fails when the remote is unreachable, when the daemon has no
  credentials, or when the network is down - none of which is divergence, and
  each of which then destroys local-ahead commits. The adapter contract
  already returns `{:success bool :error str?}`, and that `:error` is the only
  thing that could tell the cases apart. It is never read. On the reset path
  the caller reports the RESET's error instead, so the push's own reason never
  reaches an operator at all.

  The sibling orchestrator in the same file already does this correctly:
  `absorb-with-merge!` logs `(merge-failure-log-tail outcome (:error result))`.

  Background:
    Given the master checkout holds commits origin does not have

  # BL-1288 push-failure-classification-01
  Scenario Outline: Only a remote's rejection authorises the discard
    Given a push is attempted first and fails because <cause>
    When the reconcile decides whether to reset
    Then the local-ahead commits are <fate>

    Examples:
      | cause                          | fate      |
      | the remote rejected it         | discarded |
      | the remote was unreachable     | kept      |
      | no credentials were available  | kept      |

  # BL-1288 push-failure-classification-02
  Scenario: The push's own reason survives into the reported outcome
    Given a push is attempted first and fails because the remote was unreachable
    When the reconcile reports what happened
    Then the report carries the push's own error text
    And it is not replaced by the reset's error or by an outcome name

  # BL-1288 push-failure-classification-03
  # BL-1198's behaviour, restated because this ticket changes the function
  # that carries it: a push that succeeds must still skip the reset entirely.
  Scenario: A successful push still resolves everything with no reset
    Given a push is attempted first and succeeds
    When the reconcile decides whether to reset
    Then no reset is attempted at all
