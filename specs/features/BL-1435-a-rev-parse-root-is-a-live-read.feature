# mutation-stamp: sha256=a82f466bdd7d65d9c0dd3404247f5fe44749f50325e7d0d37ef9415bd53d6e1e
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-09-05T20:51:09.938003520Z","feature_name":"BL-1435 A root derived through git rev-parse is a live read the guard can see","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1435-a-rev-parse-root-is-a-live-read.feature","background_hash":"fbc4836ebc39ceb22acb8da25c934103c770686b59de7b1e88233a695dce9c36","implementation_hash":"unknown","scenarios":[{"index":0,"name":"a unit-lane test that binds its root through git rev-parse and grows with the repository is a violation","scenario_hash":"26ecdedce48e165efc57cd0ac8feb204927187d5d46ed478c8b50083e46ea1a8","mutation_count":3,"result":{"Total":3,"Killed":3,"Survived":0,"Errors":0},"tested_at":"2026-09-05T20:51:09.938003520Z"},{"index":1,"name":"the exemption rule applies to a rev-parse root exactly as to a path.join root","scenario_hash":"a135774058027b6450f5870119410e8fbe0c91e96e9f755c060bacac50cab671","mutation_count":4,"result":{"Total":4,"Killed":4,"Survived":0,"Errors":0},"tested_at":"2026-09-05T20:51:09.938003520Z"}]}
# acceptance-mutation-manifest-end

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
