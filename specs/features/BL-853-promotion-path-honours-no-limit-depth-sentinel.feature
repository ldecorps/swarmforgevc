Feature: the promotion path honours the documented no-limit depth sentinel

  # BL-853: swarmforge.conf documents `active_backlog_max_depth -1` as "no
  # limit", and backlog_depth_lib.bb has honoured it since BL-216. The
  # promotion path never asks. promote_and_route_next.sh validates the
  # effective cap against ^[0-9]+$, which a signed -1 fails; falls back to
  # backlog_depth_cli.bb passing $ROOT where that CLI documents a CONF PATH,
  # so its slurp throws and it returns the library's default; and would
  # otherwise land on a literal CAP=1. promotion_gates_lib.bb's own
  # depth-refusal is a bare (>= active-count max-depth) with no no-limit
  # branch, so even a correctly-resolved -1 refuses at any count. Measured
  # 2026-08-08: configured -1, effective CLI -1, resolved CAP 5, active count
  # 5 -> every promotion refused; the coordinator un-promoted BL-574 by hand
  # to free a slot for the expedited BL-852 (9c43f00e).

  # BL-853 no-limit-cap-never-blocks-promotion-01
  Scenario Outline: an unlimited cap never blocks promotion, at any active depth
    Given a swarm whose launched config declares active_backlog_max_depth as -1
    And backlog/active/ holds <active_count> tickets
    When promote_and_route resolves the effective depth cap
    Then the resolved cap is -1
    And the depth gate allows the promotion

    Examples:
      | active_count |
      | 0            |
      | 5            |
      | 40           |

  # BL-853 resolved-cap-comes-from-the-launched-config-02
  Scenario: the resolved cap is the value the launched config declares
    Given a swarm whose launched config declares active_backlog_max_depth as -1
    When promote_and_route resolves the effective depth cap
    Then the resolved cap is -1
    And it is not the depth library's default for an unreadable config

  # BL-853 depth-gate-refuses-only-a-real-ceiling-03
  Scenario Outline: the depth gate refuses only when a real finite ceiling is reached
    Given a promotion candidate evaluated against a cap of <max_depth> with an active count of <active_count>
    When the promotion gates evaluate that candidate
    Then the depth gate <verdict> it

    Examples:
      | max_depth | active_count | verdict |
      | -1        | 5            | allows  |
      | -1        | 0            | allows  |
      | 5         | 4            | allows  |
      | 5         | 5            | refuses |
      | 1         | 1            | refuses |
      | 0         | 0            | refuses |

  # BL-853 unreadable-config-degrades-to-the-shared-default-04
  Scenario: an unreadable config degrades to the shared library default, not a tighter literal
    Given a swarm whose config cannot be read by any depth reader
    When promote_and_route resolves the effective depth cap
    Then the resolved cap is the value backlog_depth_cli.bb itself reports for an unreadable config
    And the promotion path contributes no depth default of its own
