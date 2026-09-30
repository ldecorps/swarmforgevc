Feature: BL-1821 The recruiter scouts a batch of specifier candidates and challenges the incumbent
  The recruiter picks one Hugging Face model per run and batteries it for
  the coder role only. For the specifier seat it now scouts a batch: it
  pulls up to N unseen, trusted, host-fitting candidates, puts each
  through the specifier battery, re-runs the same battery on the model
  the steward currently favours for specifier, and keeps a score table
  answering "is it still the best?". A better challenger is an offer: the
  scout never edits a pack conf, swarmforge.conf or a seat, and never
  commits.

  Background:
    Given a stubbed Hugging Face listing, a stub puller and a stub specifier battery
    And the steward favours "local/incumbent" for the specifier role

  # BL-1821 batch-plus-incumbent-01
  Scenario Outline: a scout with a batch of 3 batteries <batteried> candidates and the incumbent when <unseen> are unseen
    Given the listing holds <unseen> unseen trusted host-fitting candidates
    When a specifier scout runs with a batch of 3
    Then the battery runs on <batteried> candidates and on "local/incumbent"

    Examples:
      | unseen | batteried |
      | 5      | 3         |
      | 1      | 1         |
      | 0      | 0         |

  # BL-1821 score-table-rows-02
  Scenario: the score table holds one row per batteried model and flags the incumbent
    Given the listing holds 2 unseen trusted host-fitting candidates
    When a specifier scout runs with a batch of 3
    Then the score table has 3 rows for the "specifier" role, each with its passed count, total and battery stamp
    And exactly the "local/incumbent" row is flagged incumbent

  # BL-1821 recommend-only-when-it-beats-03
  Scenario Outline: the recommend line names a challenger only when it passes more than the incumbent
    Given the best challenger passes <challenger> of 10 and the incumbent passes <incumbent> of 10
    When a specifier scout runs with a batch of 3
    Then the recommend line <recommend>

    Examples:
      | challenger | incumbent | recommend                        |
      | 9          | 7         | names the challenger as an offer |
      | 7          | 7         | keeps the incumbent              |

  # BL-1821 scout-own-seen-list-04
  Scenario: the scout keeps its own seen list, apart from the weekly coder path's
    Given the listing holds 5 unseen trusted host-fitting candidates
    And the weekly coder path's seen list already names the first of them
    When two specifier scouts run one after the other with a batch of 3
    Then the first run batteries the top 3 candidates of the listing
    And the second run batteries the other 2
    And the weekly coder path's seen list still names only that first candidate
