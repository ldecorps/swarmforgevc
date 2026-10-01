Feature: BL-1857 A commit that lands no line of its own never blocks a shared-path rebuild

  BL-1830 rebuilds a path the landing ticket shares with an unlanded
  sibling, keeping only the landing ticket's lines. It cannot attribute a
  touching commit whose subject names no ticket, so it refuses the land by
  name. QA's bounce restores and reverts carry no ticket id by rule, and
  QA's branch keeps every one of them in every later land's range. On
  2026-10-01 BL-1842's land refused on docs/how-to/BL-1052-local-model-seat-launch.md
  for that reason. Six untagged commits touched the file, all of them QA
  restores or reverts, and not one line any of them added is in BL-1842's
  approved copy without also being on origin/main. Such a commit
  contributes nothing the land could publish, so the line-set walk now
  leaves it out. An untagged commit that does put a line into the landed
  copy, one origin/main lacks, still refuses by name.

  Background:
    Given a fixture repository where the landing ticket and an unlanded sibling each changed a shared path since origin/main in their own tagged commits

  # BL-1857 untagged-commit-that-lands-no-line-is-left-out-01
  Scenario Outline: what an untagged commit left in the landed copy decides whether the shared path is rebuilt
    Given an untagged commit on the landing branch that <untagged change>
    When the land step builds the landing ticket's commit
    Then the land <outcome>

    Examples:
      | untagged change                                                          | outcome                                                   |
      | restores the shared path to origin/main's content                        | rebuilds the path with only the landing ticket's lines    |
      | adds a line to the shared path that a later commit removes again         | rebuilds the path with only the landing ticket's lines    |
      | adds a line to the shared path that the landing commit keeps and origin/main lacks | refuses, naming the path and the sibling        |
