Feature: BL-1435 A root derived through git rev-parse is a live read the guard can see

  BL-1038's live-repository derivation guard refuses a unit-lane test whose
  cost grows with the repository: a test that binds the live root and walks
  git history against it, enumerates or globs it, or hands it to production
  code. It recognizes one way of binding that root, path.join(__dirname,
  '..', '..'). On 2026-09-02 BL-1317's hardener re-derived
  docsStructureRealTree.test.js's root through execFileSync git rev-parse
  --show-toplevel for sandbox path safety, and the guard stopped seeing the
  file; on 2026-09-05 five unit-lane tests bind their root that way and the
  guard reports the real tree clean while inspecting none of them. BL-1212
  found this the hard way: its bare-marker scenario could not be refused
  because the marker was never read.

  This feature is that a root bound through git rev-parse --show-toplevel
  (execFileSync, execSync or spawnSync) is a live-root binding to the guard,
  subject to the same growth patterns, the same production-escape rule and
  the same exemption rule as the path.join idiom; that a bare marker on such
  a file is refused; and that every rev-parse-derived live read in the real
  tree is either exempt with a written reason or moved to a fixture root, so
  the guard's clean verdict is earned. Scenarios 01 and 02 run over fixture
  text the way BL-1038's do; scenario 03 reads the parcel's own test tree, a
  read-only live-tree read justified because the tree at this commit is the
  contract.

  Background:
    Given the BL-1038 live-repository derivation guard

  # BL-1435 a-rev-parse-root-is-detected-01
  Scenario Outline: a unit-lane test that binds its root through git rev-parse and grows with the repository is a violation
    Given a test that resolves its root with <call> and walks git log against that root
    When the guard inspects it
    Then it is named as a violation that walks live git history

    Examples:
      | call                                        |
      | execFileSync git rev-parse --show-toplevel  |
      | execSync git rev-parse --show-toplevel      |
      | spawnSync git rev-parse --show-toplevel     |

  # BL-1435 the-exemption-rule-applies-unchanged-02
  Scenario Outline: the exemption rule applies to a rev-parse root exactly as to a path.join root
    Given a rev-parse-rooted test whose exemption marker is <marker>
    When the guard inspects it
    Then it is <verdict>

    Examples:
      | marker                       | verdict                 |
      | followed by a written reason | treated as exempt       |
      | bare, with nothing after it  | reported as a violation |

  # BL-1435 the-real-tree-is-clean-for-real-03
  Scenario: every rev-parse-derived live read in the test tree is exempt with a reason or fixture-rooted
    When the guard runs over the parcel's own extension test tree
    Then it reports no violations
    And every file binding its root through git rev-parse --show-toplevel either carries a reasoned exemption or reads no live growth surface
