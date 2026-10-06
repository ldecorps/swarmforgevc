Feature: BL-2049 A change runs exactly the property runners it reaches

  About 200 of the 217 property runners under swarmforge/scripts/test run
  only when a role picks one by hand (QA note 003876), and a full run of
  all 217 takes over half an hour on the swarm host (measured 2026-10-06).
  Article 4.5 asks QA to run every test whose scope covers a changed path,
  and BL-1877's ruling A already runs only the vitest property files a
  change reaches. The reach selector does the same for property runners:
  a runner is reached by a changed file when it is that file, when its
  load-file closure holds that file, or when its own text names that
  file. The property-runner front-end (BL-2048) runs exactly the reached
  runners when it is given the commit the change is measured from.

  Background:
    Given a fixture scripts directory where lib a.bb load-files lib b.bb and script c.sh exists
    And its test directory holds runner x that load-files a.bb, runner y whose text names c.sh, and runner z that load-files and names neither

  # BL-2049 reach-selector-01
  Scenario Outline: the reach selector reports exactly the runners a changed file reaches
    When the reach selector is given the changed path <changed>
    Then it reports exactly the runners <reached>

    Examples:
      | changed                                      | reached |
      | swarmforge/scripts/a.bb                      | x       |
      | swarmforge/scripts/b.bb                      | x       |
      | swarmforge/scripts/c.sh                      | y       |
      | swarmforge/scripts/test/z_property_runner.bb | z       |
      | docs/how-to/note.md                          | none    |

  # BL-2049 front-end-runs-the-reached-runners-02
  Scenario Outline: the front-end given a base commit runs exactly the runners the change since it reaches
    Given the fixture is a git repository in which <changed> changed since its base commit and runner x <outcome>
    When the property-runner front-end runs with that base commit
    Then it runs exactly the runners <reached>
    And it exits <exit>

    Examples:
      | changed                 | outcome | reached | exit |
      | swarmforge/scripts/b.bb | passes  | x       | 0    |
      | swarmforge/scripts/b.bb | fails   | x       | 1    |
      | docs/how-to/note.md     | fails   | none    | 0    |
