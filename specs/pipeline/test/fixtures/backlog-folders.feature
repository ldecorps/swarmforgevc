Feature: backlog folders are read by folder, not by yaml status field

# backlog-folders-01
Scenario: a ticket in backlog/active is reported as active regardless of its yaml status
  Given a target repo with a backlog item "BL-9001" filed under "active" with yaml status "todo"
  When the backlog folders are read
  Then "BL-9001" appears in the "active" folder

# backlog-folders-02
Scenario: a ticket missing from every backlog folder is not reported
  Given a target repo with no backlog item "BL-9002"
  When the backlog folders are read
  Then "BL-9002" appears in no folder
