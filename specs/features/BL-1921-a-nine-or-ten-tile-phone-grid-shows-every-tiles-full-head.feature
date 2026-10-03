Feature: BL-1921 A nine- or ten-tile phone grid shows every tile's full head

  Before BL-1858 a phone's live grid never showed more than eight tiles:
  two columns, four rows. BL-1858 added the art-director and coder@2
  tiles, still two columns on a phone, so nine or ten seats make a fifth
  row. BL-609's crowded step shrinks only the fullscreen pane title and the
  pane output text, and neither is what a grid tile shows. A tile shows
  its role name, model label, ticket id, two-line slug and age inside a
  head whose padding and gap never change with the pane count. On a
  700px phone the fifth row leaves about 126px a row, about what the head
  alone needs, and a tile that does not fit is cropped, not reflowed.
  The crowded step now covers the tile head for nine and ten panes. One
  to eight panes keep every value they have today.

  Background:
    Given the live screen page is rendered

  # BL-1921 nine-and-ten-panes-step-the-tile-head-down-01
  Scenario Outline: nine and ten panes step the tile head down from its eight-pane value
    When the grid shows <count> panes
    Then the tile's <property> is smaller than at eight panes

    Examples:
      | count | property          |
      | 9     | head padding      |
      | 9     | head gap          |
      | 9     | model label size  |
      | 9     | ticket id size    |
      | 9     | slug size         |
      | 9     | age size          |
      | 10    | head padding      |
      | 10    | head gap          |
      | 10    | model label size  |
      | 10    | ticket id size    |
      | 10    | slug size         |
      | 10    | age size          |

  # BL-1921 one-to-eight-panes-keep-their-values-02
  Scenario Outline: one to eight panes keep every tile value the page shipped with before BL-1921
    When the grid shows <count> panes
    Then every tile property is the value the page shipped with before BL-1921

    Examples:
      | count |
      | 1     |
      | 2     |
      | 4     |
      | 7     |
      | 8     |
