Feature: BL-1723 The orphan janitor sees bl-prefixed fixture roots on Linux

  The orphan janitor treats a process as a disposable-root ancillary only
  if its command line names a root of a known fixture shape. Under Darwin's
  temporary directory that includes the bl<number>- roots the swarm's own
  acceptance fixtures create. Under Linux's /tmp it does not, so on this
  host the janitor cannot see ancillaries left under about half of the
  fixture roots the step handlers create, and BL-849's scenario 03 has
  been red on main. This feature is that the Linux branch accepts the same
  bl<number>- family, and nothing else new.

  # BL-1723 a-bl-prefixed-tmp-root-is-disposable-01
  Scenario Outline: a command line naming <root> is a disposable-root ancillary on Linux
    When the janitor classifies the command line "bash <root>/bin/babysitterd.sh <root>"
    Then it is a disposable-root ancillary candidate

    Examples:
      | root                        |
      | /tmp/bl849-aps-root-Ab12Cd  |
      | /tmp/bl1366-land-Xy34Zw     |
      | /tmp/aps-Ab12Cd             |

  # BL-1723 a-non-fixture-path-is-not-disposable-02
  Scenario Outline: a command line naming <root> is not a disposable-root ancillary
    When the janitor classifies the command line "bash <root>/bin/babysitterd.sh <root>"
    Then it is not a disposable-root ancillary candidate

    Examples:
      | root                                  |
      | /home/carillon/swarmforgevc           |
      | /tmp/blog-notes                       |
      | /tmp/claude-1000/session-scratchpad   |
