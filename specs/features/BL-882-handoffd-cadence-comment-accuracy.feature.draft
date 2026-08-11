Feature: BL-882 handoffd cadence comment accuracy

  The BL-617 comment introducing the outbound-wakes suppression gate in
  swarmforge/scripts/handoffd.bb must not claim its sibling sweeps run
  unconditionally while they sit inside the chase-sweep-every-cycles gate.
  The fix is comment prose only; the gate structure itself is frozen.

  Background:
    Given the file "swarmforge/scripts/handoffd.bb" at the parcel commit

  # BL-882 handoffd-cadence-comment-accuracy-01
  Scenario: the misleading unconditional claim is gone
    When the comment block introducing the outbound-wakes suppression gate is read
    Then it does not contain the phrase "keep running unconditionally"

  # BL-882 handoffd-cadence-comment-accuracy-02
  Scenario: the comment states the sibling sweeps' true cadence
    When the comment block introducing the outbound-wakes suppression gate is read
    Then it contains the phrase "pause-exempt, never every-tick"
    And it names the "chase-sweep-every-cycles" gate as still applying to the sibling sweeps

  # BL-882 handoffd-cadence-comment-accuracy-03
  Scenario: the change is comment-only
    When the parcel's changes to that file are diffed against its received base
    Then every changed line in that file is a Clojure comment line
