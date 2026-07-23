Feature: keyboard navigation and screen-reader labels across the tiles, tree, and PWA

  # Roadmap gap (coordinator scan 2026-07-10): Spec.MD 1438 accessibility "need a
  # pass" — keyboard nav of tiles and the work/backlog tree, and screen-reader
  # labels, across the webview and the PWA. BL-220 added only a font-size control.
  # Testable seam: the generated webview markup (webviewHtml.ts) and the PWA markup
  # are inspectable host-side (DOM/axe); full interactive keyboard nav may add a
  # browser-driven check. M6-adjacent; paused proposal.

  Background:
    Given the tiled agent panel, the backlog/work-tree view, and the PWA remote client

  # BL-238 keyboard-nav-tiles-01
  Scenario: every interactive tile control is reachable and operable by keyboard
    Given the tiled agent panel
    When the operator navigates with the keyboard only
    Then every tile and its controls can be focused and operated without a mouse
    And the focused element shows a visible focus indicator

  # BL-238 keyboard-nav-tree-02
  Scenario: the work/backlog tree is fully keyboard navigable
    Given the backlog/work-tree view
    When the operator navigates with the keyboard only
    Then every tree node can be expanded, collapsed, and activated without a mouse

  # BL-238 screen-reader-labels-03
  Scenario: interactive elements expose an accessible name and role
    Given the tiles, tree nodes, and status controls
    When a screen reader inspects them
    Then each exposes an accessible name and role rather than being an unlabeled control

  # BL-238 status-not-color-only-04
  Scenario: agent and completion status is conveyed by more than color
    Given agent liveness and completion indicators
    When their status is presented
    Then it is also conveyed by text or shape, not by color alone

  # BL-238 pwa-parity-05
  Scenario: the PWA remote client meets the same keyboard and labelling bar
    Given the PWA status and work-tree views
    When they are navigated by keyboard and inspected by a screen reader
    Then they are keyboard operable and their controls expose accessible names
