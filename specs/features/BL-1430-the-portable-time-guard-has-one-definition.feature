Feature: BL-1430 The portable-time guard has one definition

  bl874PortableTimeInvariants.property.test.js pins that
  findPortableTimeViolation is defined in exactly one file repo-wide, the
  shared guard module, never a reimplementation. On 2026-09-05 that property
  is red on main and no open ticket names it: a second definition exists.
  Under the standing-red rule ruled that day a red with no owner is minted
  as a high-severity defect at first sighting; this is that ticket.

  This feature is that the guard is defined once, every caller reaches that
  one definition, and the property passes alone.

  # BL-1430 one-definition-repo-wide-01
  Scenario: findPortableTimeViolation is defined in exactly one file
    When every definition of findPortableTimeViolation under extension/src and specs/pipeline is counted
    Then exactly one file defines it

  # BL-1430 the-property-passes-alone-02
  Scenario: the portable-time property file passes in isolation
    When bl874PortableTimeInvariants.property.test.js is run alone under the properties config
    Then it passes
