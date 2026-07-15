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
