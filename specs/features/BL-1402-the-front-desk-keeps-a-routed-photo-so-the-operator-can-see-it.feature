Feature: BL-1402 The front desk keeps a routed photo so the operator can see it

  A photo the human attaches to a front-desk message is downloaded once, kept
  on disk under the operator's media store, and the routed text names where it
  was saved on a line of its own after the BL-620 note. Keeping the bytes never
  claims the front desk read the image, never blocks the caption when the
  photo cannot be fetched, and never lets the store grow without bound.

  Background:
    Given a front-desk bot bound to its own group with the principal configured
    And an operator media store for the front desk

  # BL-1402 a-routed-photo-is-kept-and-named-01
  Scenario: a captioned photo routed by the front desk is saved and its path is named
    Given the principal sends a photo whose caption carries the message words
    When the front desk routes the message
    Then a file named by the update id sits in the media store with the photo's bytes
    And the routed text notes the attached image was not read by the front desk
    And the routed text names the saved file's path on its own line

  # BL-1402 a-photo-that-cannot-be-kept-never-blocks-its-caption-02
  Scenario Outline: a photo that cannot be fetched still lets the caption route unchanged
    Given the principal sends a photo whose caption carries the message words
    And fetching the photo fails because <failure>
    When the front desk routes the message
    Then the routed text is exactly the text routed before this feature
    And one audit line names the update id and the reason
    And no file is written to the media store

    Examples:
      | failure                          |
      | the file lookup fails            |
      | the download fails               |
      | the photo exceeds the size cap   |

  # BL-1402 a-redelivered-update-writes-one-file-03
  Scenario: a redelivered update never writes a second file
    Given the principal sends a photo whose caption carries the message words
    And the same update is delivered a second time
    When the front desk routes both deliveries
    Then exactly one file for that update id sits in the media store
    And it was written once

  # BL-1402 the-media-store-stays-bounded-04
  Scenario: the media store keeps its newest files and drops the oldest past its bound
    Given the media store already holds its bound of older files
    And the principal sends a photo whose caption carries the message words
    When the front desk routes the message
    Then the media store holds exactly its bound of files
    And the oldest file is gone and the new file is present
