Feature: the morning briefing renders its diagrams at high resolution

  # BL-402: the human (ldecorps) asked to "switch the daily briefing diagrams to
  # SVG" because the current PNGs look blurry. Clarified 2026-07-15: the real goal
  # is CRISP diagrams, not the SVG format itself. SVG is rejected here because the
  # human reads the briefing in Gmail, which strips/blocks SVG in every embedding
  # form (inline <svg>, data-URI, and cid attachment) - that is exactly why BL-286
  # moved to cid-referenced PNG. So the Gmail-safe fix is to raise the PNG
  # rasterization resolution, keeping the BL-260/BL-286 cid-PNG transport unchanged.
  #
  # Live path (verified): handoffd.bb -> extension/out/tools/render-briefing-diagrams.js
  # -> renderBriefingDiagrams -> renderMermaidToPng (mermaidRender.ts), whose Resvg
  # fitTo width is 1600 today. The composed html references each PNG via
  # <img src="cid:..." style="max-width:100%;height:auto"> (briefing_email_lib.bb).

  Background:
    Given the project's Mermaid architecture diagrams under docs/diagrams/

  # BL-402 high-dpi-render-width-01
  Scenario: a rendered diagram is high enough resolution to look crisp on high-DPI screens
    Given a fixture Mermaid source
    When the render step runs
    Then the rendered PNG is at least 3200 pixels wide

  # BL-402 determinism-preserved-02
  Scenario: the higher-resolution render stays deterministic
    Given the same Mermaid source
    When it is rendered twice
    Then it produces byte-identical image output

  # BL-402 scales-to-column-width-03
  Scenario: the higher-resolution diagram still displays at the email column width
    Given the daily briefing is generated with rendering available
    When the email body is composed
    Then the inline diagram image is constrained to the container width
