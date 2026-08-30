# mutation-stamp: sha256=ef05493b05d6a69e78ea7c689d382ec26348efc10e4dcc3d17a24918d9425037
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-30T06:56:38.512415732Z","feature_name":"BL-1210 every topic kind keeps its icon ownership marker, whatever store the tracked-record boundary sends it to","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1210-icon-ownership-marker-survives-the-tracked-record-boundary.feature","background_hash":"b7c8497e666bbdce98c51f980d883339f1ffc95cb79a45d3dcd67f430dca30ad","implementation_hash":"unknown","scenarios":[{"index":0,"name":"every topic kind records a readable marker, in the store its id kind belongs to","scenario_hash":"8541d023c869b8fe0e193c88c42dbb13048af23f5766bf7c3b91251e36e38d37","mutation_count":8,"result":{"Total":8,"Killed":8,"Survived":0,"Errors":0},"tested_at":"2026-08-30T06:56:38.512415732Z"}]}
# acceptance-mutation-manifest-end

Feature: BL-1210 every topic kind keeps its icon ownership marker, whatever store the tracked-record boundary sends it to

  recordSwarmIconId does two jobs that BL-695 treated as one. It serialises a
  ticket's topic record into the git-tracked backlog/topics/ directory, and it
  records the icon ownership marker that stops the swarm from touching an icon
  it did not set. The first is legitimately ticket-only. The second was
  deliberately reused generically - topicIcon.ts says so in as many words - by
  epic, standing and role topics, none of which carry a BL- or GH- id.

  BL-695 restricted the whole function to ids matching the ticket or supervisor
  shape, gave supervisor threads their own untracked store, and left the other
  three kinds with no store at all. They now fall to the unbound branch, which
  writes a line to stderr and returns, having recorded nothing. syncTopicIcon
  calls it and then returns updated regardless, so the caller is told the icon
  was set and owned when only the first half happened.

  What must change is not the boundary. Tracked records staying ticket-only is
  correct and stays. What must change is that a marker whose store the boundary
  redirects still gets written somewhere, and that a write which records
  nothing can never be reported to its caller as success.

  Background:
    Given a topic whose icon the swarm is setting for the first time

  # BL-1210 icon-ownership-marker-survives-the-tracked-record-boundary-01
  Scenario Outline: every topic kind records a readable marker, in the store its id kind belongs to
    Given the topic is identified by <id kind>
    When the swarm sets that topic's icon
    Then reading the ownership marker back returns the icon that was set
    And a tracked topic record <tracked record> for that id

    Examples:
      | id kind             | tracked record |
      | a ticket id         | exists         |
      | an epic id          | is not created |
      | a standing topic id | is not created |
      | a role id           | is not created |

  # BL-1210 icon-ownership-marker-survives-the-tracked-record-boundary-02
  Scenario: a marker the store refuses to write is never reported as a successful sync
    Given the topic is identified by an id no store will accept
    When the swarm sets that topic's icon
    Then the sync does not report the icon as updated and owned
    And the refusal is visible to the caller rather than only on stderr
