Feature: A parcel claimed by a killed agent is resumed, not silently stranded

# BL-323: an agent killed after claiming a parcel leaves it in inbox/in_process/.
# The replacement agent starts clean, sees an empty inbox/new/, concludes NO_TASK and
# idles — while the ticket sits in backlog/active/ with nobody working it. The parcel is
# findable (ready_for_next.sh returns in_process work first); nothing consults it on
# start. BL-316 sat this way ~4 hours across two relaunches.

Background:
  Given a swarm whose roles each own an inbox with new/ and in_process/ queues

# BL-323 resume-orphaned-inprocess-01
Scenario: A parcel orphaned by a killed agent is resumed on relaunch
  Given a role has claimed a parcel into its in_process queue
  And that role's agent is killed before completing it
  When a replacement agent for that role starts
  Then it resumes the orphaned parcel without human intervention
  And it does not report that there is no work

# BL-323 resume-orphaned-inprocess-02
Scenario: A parcel held by a live agent is never taken away from it
  Given a role is actively working a parcel in its in_process queue
  And that role's agent is alive
  When the swarm's stall detection runs
  Then the parcel is left with its owning agent
  And it is not requeued or reassigned

# BL-323 resume-orphaned-inprocess-03
Scenario Outline: Status distinguishes no work from work claimed by nobody
  Given a role whose new/ queue is empty and whose in_process queue <in_process_state>
  When the swarm's status is reported for that role
  Then the status reports <reported_state>

  Examples:
    | in_process_state       | reported_state          |
    | is also empty          | no work pending         |
    | holds an orphaned parcel | work claimed by nobody |

# BL-323 resume-orphaned-inprocess-04
Scenario: An idle role with a genuinely empty inbox still reports no work
  Given a role whose new/ and in_process/ queues are both empty
  When a replacement agent for that role starts
  Then it reports that there is no work
  And it does not fabricate or resume a parcel
