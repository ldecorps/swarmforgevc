# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-09-06T00:01:48.338743238Z","feature_name":"BL-1440 Every docs path a constitution article cites resolves on disk","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1440-every-constitution-doc-citation-resolves.feature","background_hash":"74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b","implementation_hash":"unknown","scenarios":[]}
# acceptance-mutation-manifest-end

Feature: BL-1440 Every docs path a constitution article cites resolves on disk

  BL-945 (2026-08-19) put a dangling-citation guard in the vitest suite:
  every backtick-quoted docs/ path in a constitution article must exist.
  On 2026-08-27 the deprecator amendment (Article 3.6 and its reference
  pages) cited docs/deprecated/, the directory retired pages move to,
  which nothing had created; the guard has been red on main since, and
  nobody registered it. On 2026-09-05 the Art Director article (1.10)
  added docs/design/artifact-inventory.md and docs/design/system.md, two
  living documents the role keeps, neither written yet. The coder found
  the red on 2026-09-05 while running BL-1439: Stryker's dry run executes
  the whole suite, so this one red refuses every mutation run on the
  host, and the coder reported it as an unowned standing red rather than
  working around it. The constitution commits that added the citations
  passed every commit guard because the guard lives only in the suite.

  This feature is that the guard is green on the parcel's own tree, that
  retired pages have a home the docs index links, and that a constitution
  commit which cites a docs path that does not exist is refused at commit
  time, so the class cannot recur unseen. How the two design-document
  citations come to resolve is a human ruling recorded on the ticket and
  is not asserted here. Scenarios 01 and 02 read the parcel's own tree, a
  read-only live-tree read justified because the constitution and the
  docs at this commit are the contract; scenario 03 runs the guard over a
  fixture repository.

  # BL-1440 the-citation-guard-is-green-01
  Scenario: the dangling-citation guard finds nothing in the parcel's own constitution
    When every constitution article at the parcel commit is scanned for docs paths
    Then no cited path is unresolved

  # BL-1440 retired-pages-have-a-home-02
  Scenario: the retired-pages directory exists with an index the docs index links
    When docs/deprecated/ and docs/index.md are read at the parcel commit
    Then the directory holds an index page stating how a page arrives there
    And docs/index.md links that index page

  # BL-1440 a-dangling-citation-is-refused-at-commit-03
  Scenario Outline: the commit guard chain refuses a constitution article that cites a missing docs path
    Given a fixture repository whose constitution article cites <path>
    When the constitution citation commit guard runs over that repository
    Then the guard <outcome> naming <path>

    Examples:
      | path                        | outcome |
      | docs/how-to/not-there.md    | refuses |
      | docs/how-to/present.md      | passes  |
