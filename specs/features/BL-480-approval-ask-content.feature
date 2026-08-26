# mutation-stamp: sha256=942c59706a2ef491733e67c4e4f622b22a9d597a3d6f24b2831151505450a447
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-07-17T03:05:13.423246011Z","feature_name":"The Approvals-topic ask carries enough ticket meat to decide","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-480-approval-ask-content.feature","background_hash":"c97b6c9437759ebded8dda033360713dc71a954d75b1a02587e8c002e7f564e9","implementation_hash":"unknown","scenarios":[{"index":5,"name":"Every non-ApprovalRequested render is unchanged by this feature","scenario_hash":"7e237e49eea8a11eb3b1b2c6693b396662d96a25a2097469a191dd5e5df88b95","mutation_count":3,"result":{"Total":3,"Killed":3,"Survived":0,"Errors":0},"tested_at":"2026-07-17T03:05:13.423246011Z"}]}
# acceptance-mutation-manifest-end

Feature: The Approvals-topic ask carries enough ticket meat to decide

# BL-480: approvalRequestedText (extension/src/concierge/topicRouter.ts) renders an
# ApprovalRequested event as ONLY the ticket id plus the reply grammar, so the human
# is asked to approve a spec/governance change with nothing to base the decision on.
# TaskStarted already gets a rich render (BL-322 taskStartedText); ApprovalRequested
# was deliberately left unchanged then. The conciergeTick snapshot's ticketSummaries
# map already carries title/notes/firstAcceptanceStep for every live ticket, and the
# approval_context field (BL-479) is available on disk - so the data is on hand at
# render time; only the ApprovalRequested branch ignores it. The reply-grammar line
# and the Approve/Amend/Reject buttons are a frozen contract (pendingApprovalReply.ts
# classifyApprovalsTopicReply plus BL-410's callback wiring key off them) and must not
# drift; the enrichment adds content around them, never alters them.

Background:
  Given a ticket whose human_approval has just flipped to pending, posting its ApprovalRequested ask in the Approvals topic

# BL-480 approval-ask-content-01
Scenario: The ask carries the ticket title, a what-it-solves summary, and the acceptance signal
  Given that ticket has a title, a notes block, and a first acceptance step
  When its ApprovalRequested ask is rendered
  Then the ask names the ticket id and its title
  And the ask states what the ticket solves, drawn from its notes
  And the ask states the ticket's first acceptance signal
  And the ask is more than the bare pre-change "id plus reply grammar" line

# BL-480 approval-ask-content-02
Scenario: The reply grammar and the Approve/Amend/Reject buttons stay byte-identical
  Given that ticket has a title, a notes block, and a first acceptance step
  When its ApprovalRequested ask is rendered
  Then the ask still contains the frozen reply-grammar line for approving or rejecting by id
  And the ask carries the Approve, Amend, and Reject buttons exactly as before

# BL-480 approval-ask-content-03
Scenario: An approval_context, when the ticket has one, is included in the ask
  Given that ticket also carries an approval_context field
  When its ApprovalRequested ask is rendered
  Then the ask includes the ticket's approval context

# BL-480 approval-ask-content-04
Scenario: An oversized notes block is truncated to a safe Telegram message length
  Given that ticket's notes block is far longer than a Telegram message allows
  When its ApprovalRequested ask is rendered
  Then the ask is truncated
  And the ask is within the Telegram message length limit

# BL-480 approval-ask-content-05
Scenario: A ticket with no summary source still renders a well-formed ask
  Given that ticket has no title, notes, acceptance step, or approval context
  When its ApprovalRequested ask is rendered
  Then the ask is non-empty and names the ticket id
  And the ask still contains the frozen reply-grammar line for approving or rejecting by id

# BL-480 approval-ask-content-06
Scenario Outline: Every non-ApprovalRequested render is unchanged by this feature
  Given a <event_type> event for the same ticket
  When that non-approval event message is composed
  Then the <event_type> render is byte-identical to its pre-change output

  Examples:
    | event_type    |
    | TaskStarted   |
    | TaskCompleted |
    | NeedsApproval |
