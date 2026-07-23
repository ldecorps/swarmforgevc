# mutation-stamp: sha256=ff247019e74ccd28a734993534e196ce92aab75eac927be680c17ee40283c230
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-07-16T06:23:57.280615130Z","feature_name":"the filed-intake confirmation links to the file's GitHub location","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-415-intake-reply-github-permalink.feature","background_hash":"407650f8b3ac0a995ff5a668c2359b06b6c4bf214f8bc5416d782df726487a3e","implementation_hash":"unknown","scenarios":[{"index":1,"name":"the GitHub base is derived from either origin remote URL form","scenario_hash":"aaa0833b15e1a94ded731500d14f40d79ec31c52a6e8438dfc1668ade8eed52f","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-07-16T06:23:57.280615130Z"}]}
# acceptance-mutation-manifest-end

Feature: the filed-intake confirmation links to the file's GitHub location

  # Operator-relayed request: when the Operator files a human's question as a raw
  # intake, its Telegram confirmation currently reads "Filed for the swarm:
  # backlog/INTAKE-<slug>.md" — a plain path the human cannot click. Since the
  # file was just committed, the confirmation can carry a clickable GitHub
  # permalink at that exact commit SHA (stable even after the intake is drained).

  Background:
    Given the Operator has just filed and committed a raw intake file at a known commit

  # BL-415 intake-reply-github-permalink-01
  Scenario: the confirmation carries a commit-SHA permalink to the filed file
    Given the origin remote resolves to owner "ldecorps" and repo "swarmforgevc"
    When the filed-intake confirmation is composed
    Then it contains the URL https://github.com/ldecorps/swarmforgevc/blob/<sha>/backlog/INTAKE-<slug>.md for the filing commit's sha
    And the URL uses the commit sha, not a mutable branch name

  # BL-415 intake-reply-github-permalink-02
  Scenario Outline: the GitHub base is derived from either origin remote URL form
    Given the origin remote URL is "<remote_url>"
    When the GitHub base for permalinks is derived
    Then it is "https://github.com/ldecorps/swarmforgevc"

    Examples:
      | remote_url                                  |
      | git@github.com:ldecorps/swarmforgevc.git    |
      | https://github.com/ldecorps/swarmforgevc.git |

  # BL-415 intake-reply-github-permalink-03
  Scenario: a missing or non-GitHub origin falls back to the plain path
    Given the origin remote is absent or not a GitHub URL
    When the filed-intake confirmation is composed
    Then it names the intake's plain repo-relative path
    And composing the confirmation does not fail
