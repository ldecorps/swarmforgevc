Feature: a handoff CLI invocation whose draft lies outside the project root it resolved is refused before any mailbox write

  # BL-1518-a (epic swarm-reliability). A BL-607 unit test shells the real
  # swarm_handoff.bb with an options object (`cwd`, `env`) a mutant can
  # empty or partially drop. Under that mutant the child process inherits
  # the TEST PROCESS's own cwd and SWARMFORGE_ROLE - a real, valid
  # SwarmForge project (a coder-pane mutation run's own worktree) - so the
  # CLI's project-root resolution succeeds against the WRONG project while
  # the draft it was actually handed lives under an unrelated mkdtemp
  # fixture. Four such notes reached the live specifier inbox on
  # 2026-09-10 carrying a retired human directive
  # (`use staging please`) before this was traced. See
  # backlog/active/BL-1518-a-handoff-cli-never-writes-outside-the-root-its-draft-lives-in.yaml
  # for the full incident record.
  #
  # The fix asks a question answerable from data the CLI already holds,
  # regardless of how a caller's cwd/env got corrupted: does the draft this
  # invocation was actually given live under the root this invocation
  # actually resolved? Every production draft (a worktree role's own
  # tmp/handoff.txt, master's swarmforge/runtime/handoff-draft.txt) is
  # under its role's resolved root by construction, so this refuses only
  # ever a fixture escape, never a live send.

  Background:
    Given a role's own project has a valid roles.tsv

  # BL-1518-a draft-under-root-sends-normally-01
  Scenario: A draft under the resolved project root sends normally
    Given a note draft file under the role's own resolved project root
    When the role sends the handoff
    Then the send succeeds
    And the note is queued in the resolved root's own mailbox

  # BL-1518-a draft-outside-root-is-refused-02
  Scenario: A draft outside the resolved project root is refused before any mailbox write
    Given a note draft file under an unrelated second project
    When the role sends the handoff from its own project
    Then the send is refused
    And the refusal names the draft path and the resolved root
    And nothing is queued under either project

  # BL-1518-a sibling-sharing-root-as-text-prefix-still-refused-03
  #
  # The boundary a naive string-prefix containment check gets wrong: a
  # sibling directory whose name merely shares the resolved root as a TEXT
  # prefix (root ".../coder" vs a draft under ".../coderr") must never be
  # mistaken for containment.
  Scenario: A draft under a sibling directory that only shares the root's name as a text prefix is still refused
    Given a note draft file under a sibling directory whose name is the resolved root's name with an extra character appended
    When the role sends the handoff from its own project
    Then the send is refused
    And the refusal names the draft path and the resolved root
