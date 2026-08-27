Feature: Miniapp Console Menu
  In order to provide an efficient operator interface
  As a user who accesses the miniapp console
  I want to see a menu with two buttons for the pipeline and live feed
  Scenario: Accessing Pipeline Status Grid
    Given the miniapp console menu is open on a portrait phone viewport
    When the operator taps the pipeline-grid button
    Then the pipeline STATUS GRID is shown without the below-grid links section
    And when they return and tap the mono-router feed button
    Then a live feed of the mono-router RESIDENT is shown
    And neither destination requires horizontal scroll at a typical phone portrait width

