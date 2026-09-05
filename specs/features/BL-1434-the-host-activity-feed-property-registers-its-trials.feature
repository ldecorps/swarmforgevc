Feature: BL-1434 The host-activity-feed property registers its trials as tests

  extension/test/hostActivityFeed.property.test.js is BL-833's property
  ("feed never invents lines; bound holds; quiet is quiet"), written as a
  bare node script: forty trials over a hand-rolled PRNG, node:assert
  checks, process.exit(1) on any failure, and no test registration of any
  kind. Under the property lane's config vitest reports "No test suite
  found", so the property has been red since it was allowlisted on
  2026-08-27 and its assertions have never run under the suite. The
  standing-red register attributed it to BL-1206 on a grep hit; BL-1206's
  own list never named it, its fix (removing node:test imports) does not
  touch this file, and the architect found the row would read unowned the
  moment BL-1206 closes.

  This feature is that the file registers its trials with vitest so the
  properties config collects and runs them, that the property passes alone
  and still refuses an invented line, and that its register and allowlist
  rows leave in the same land that turns it green. Scenario 03 runs against
  an injected feed, never the live checkout's state.

  # BL-1434 the-file-registers-a-test-01
  Scenario: the property file is collected as a test under the properties config
    When hostActivityFeed.property.test.js is collected under the properties config
    Then at least one test is registered and none is reported as no suite found

  # BL-1434 the-property-passes-alone-02
  Scenario: the property passes in isolation
    When the forty registered trials execute in a solo vitest run of the file
    Then every trial passes

  # BL-1434 the-property-still-refuses-an-invented-line-03
  Scenario: the converted property still fails when the feed invents a line
    Given a feed that returns one line nobody recorded
    When the property runs against that feed
    Then it fails naming the invented line

  # BL-1434 the-rows-leave-with-the-green-04
  Scenario: the register and allowlist rows for the file are gone at the parcel commit
    When backlog/standing-reds.tsv and the property allowlist are read at the parcel commit
    Then neither names hostActivityFeed.property.test.js
