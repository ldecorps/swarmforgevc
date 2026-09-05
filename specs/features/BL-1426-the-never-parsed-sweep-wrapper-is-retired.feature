Feature: BL-1426 The never-parsed post-QA sweep wrapper is retired

  swarmforge/scripts/post_qa_branch_sweep.bb, the manual entry point BL-668
  documented for running the post-QA branch sweep by hand, has never parsed:
  its birth commit f5b6b49f1f (2026-08-26) left one paren unclosed in
  role-facts (line 41), so the reader fails before any function exists. In
  ten days nobody ran it. The live sweep never needed it - handoffd loads
  post_qa_branch_sweep_lib.bb directly and supplies its own role facts - and
  the wrapper carries a second copy of that fact supplier which BL-1421 is
  about to make diverge. It has no acceptance scenario and no caller but its
  own shell shim. Dead since birth and duplicated, it is removed rather than
  repaired (Article 3.6: dead logic is removed, not re-shipped).

  This feature is that the wrapper and its shim are gone, every Babashka
  script under swarmforge/scripts reads to its end, and the how-to offers no
  command that runs the sweep by hand. Every scenario reads the parcel's own
  tracked tree, a read-only live-tree read justified because the tree at
  this commit is the contract.

  # BL-1426 the-wrapper-and-its-shim-are-gone-01
  Scenario: the manual wrapper and its shell shim no longer exist
    When the tree is inspected for the manual sweep entry points
    Then neither post_qa_branch_sweep.bb nor post_qa_branch_sweep.sh exists under swarmforge/scripts

  # BL-1426 every-script-reads-to-its-end-02
  Scenario: every Babashka script under swarmforge/scripts reads to its end
    When every .bb file directly under swarmforge/scripts is read form by form
    Then none of them fails to read

  # BL-1426 the-how-to-offers-no-manual-command-03
  # The check is for a fenced command that invokes the sweep, never for the
  # file name in prose: a sentence recording the retirement may name it.
  Scenario: the how-to offers no command that runs the sweep by hand
    When the post-QA branch sweep how-to is read
    Then it contains no fenced command that invokes the sweep by hand
