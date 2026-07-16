# Intake: a question the Operator could not answer

Filed by the Operator (2026-07-16T12:38:36.219570263Z) - a question came in via Telegram
that the Operator judged it could not answer itself. This is a RAW
ask, not a spec: the specifier drains this like any other backlog-root
item and decides what (if anything) becomes a real ticket.

## The question

Which agent (coder/cleaner/documenter/hardener) causes the most bounce-back from QA? Operator finding: today there is no per-agent QA-bounce counter to read. QA merges-or-reports EVERY verdict to the coordinator (git_handoff merge_and_process, or type:note 'QA-approved'); genuine defect send-backs are rare in the whole handoff archive and, when they happen, the COORDINATOR re-dispatches to the producing role, so no from_QA_to_<producer> attribution exists. Treat as an observability/metrics ask (sibling to BL-452 pipeline-board): record QA fail-verdicts and attribute each to the producing role + ticket type, so 'which agent bounces most from QA' becomes answerable.
