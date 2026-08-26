Feature: The Live Screen renders the pack that is actually running
  On 2026-08-18 the operator switched to a standing full pack, eight sessions
  up, and the phone Live Screen still showed a RESIDENT tile beside SPECIFIER
  and CLEANER, a global ticket strip advertising one role's ticket as the
  swarm's current work, and a specifier tile whose subtitle read Coder. The
  layout decision short-circuits on the presence of a mono-router active-role
  marker file, so a marker written under a full pack keeps the whole screen in
  resident mode no matter how many roles are standing.

  Amended by BL-994, which moved a tile's ticket metadata off the grid tile
  head and into the fullscreen Expand view. The property under test is
  unchanged - a tile holding a ticket never resurrects the global top strip,
  and that ticket stays attributed to the tile that holds it - only the
  surface it is read from moved. BL-929's own locked decision 1 already named
  the fullscreen head as a valid home for it.

  Background:
    Given an operator viewing the Live Screen for the running swarm

  # BL-929 live-screen-pack-layout-01
  Scenario: a standing full pack renders as a full pack despite a resident marker
    Given a standing full pack with eight live role sessions
    And a mono-router active-role marker naming coder
    When the Live Screen renders
    Then no tile is labelled Resident
    And the coder tile is labelled with the coder role's own display name
    And the top ticket strip is not shown

  # BL-929 live-screen-pack-layout-02
  Scenario: a full-pack tile carries its own role identity, never the marker's role
    Given a standing full pack with eight live role sessions
    And a mono-router active-role marker naming coder
    When the Live Screen renders
    Then the specifier tile identity names the specifier role

  # BL-929 live-screen-pack-layout-03
  Scenario: the top strip is decided by the layout, not by which tile holds a ticket
    Given a standing full pack with eight live role sessions
    And only the documenter tile holds a ticket
    When the Live Screen renders
    And the documenter tile is expanded
    Then the top ticket strip is not shown
    And the documenter tile shows that ticket in its Expand view

  # BL-929 live-screen-pack-layout-04
  Scenario: a rotating mono-router pack still renders the resident and the top strip
    Given a rotating mono-router pack with a coordinator session and one resident session
    And a mono-router active-role marker naming coder
    When the Live Screen renders
    Then the coder tile is labelled Resident
    And the top ticket strip is shown
