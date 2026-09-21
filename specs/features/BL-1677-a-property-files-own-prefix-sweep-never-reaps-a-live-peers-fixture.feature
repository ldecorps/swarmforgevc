Feature: BL-1677 A property file's own prefix sweep never reaps a live peer's fixture

  Three property files sweep every os.tmpdir() entry sharing their prefix
  before each invariant, so a concurrent run of the same file removes a
  live peer's fixture mid-classify - bl1354's landed-sibling verdict then
  reads every landed sibling as unlanded with no warning, the report a
  partial object loss produces. BL-1623's finder misses them because they
  alias os.tmpdir() into a variable. This feature is that a fixture root
  is reaped only when its recorded owner pid is dead or is the sweeping
  process, that the finder reports the aliased form, and that the guard's
  census carries the three files.

  # BL-1677 a-live-peers-root-survives-the-sweep-01
  Scenario Outline: the owner-aware sweep reaps only roots whose recorded owner is gone
    Given a scratch temp directory holding a root named with <owner> under the prefix
    When the prefix sweep the three files now use runs from this process
    Then that root is <outcome>

    Examples:
      | owner                        | outcome |
      | a live peer process's pid    | kept    |
      | a dead process's pid         | reaped  |

  # BL-1677 the-finder-reports-the-aliased-form-02
  Scenario: the blind-sweep finder reports a sweep that reaches os.tmpdir() through a variable
    Given a scratch test directory holding one file that binds os.tmpdir() to a variable and lists that variable with readdirSync
    When the blind temp-dir sweep finder runs over the scratch directory and over the real extension/test directory
    Then it reports the scratch file
    And it reports nothing under extension/test

  # BL-1677 the-guard-census-carries-the-three-files-03
  # Census pin (BL-1445): the migrated set is named, not derived.
  Scenario: the BL-1623 guard's migrated census names the three files
    When the blind temp-dir sweep guard test runs
    Then it reports every test passed
    And its migrated census lists exactly ten files including bl1354SharedPathLandedSiblingInvariants, bl1389UnlandedSiblingPathNeverRidesInvariants and bl1380ExpediteNeverAnswersUnshownQuestion
