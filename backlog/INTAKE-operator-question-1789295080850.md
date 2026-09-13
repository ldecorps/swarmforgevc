# Intake: a question the Operator could not answer

Filed by the Operator (2026-09-13T10:24:40.850591007Z) - a question came in via Telegram
that the Operator judged it could not answer itself. This is a RAW
ask, not a spec: the specifier drains this like any other backlog-root
item and decides what (if anything) becomes a real ticket.

## The question

Suggestion (not urgent): QA's pass routine repeats several mechanical, always-identical steps by hand each time as separate ad-hoc shell commands (observed live: check 'standing' status, grep required_wiring for the step handler file, check backlog/standing-reds.tsv for this ticket's register row, run the full unit test suite, re-run the property test suite). Precedent: BL-1362's record-review-evidence.js already replaced QA's hand-composed verdict files with a deterministic writer for the exact same reason (2182/12903 commits in 45 days were that one hand-made ritual). Recommend specifier scope a similar bundled 'QA gather' script/CLI that runs QA's standard mechanical checklist steps in one call and prints a structured report - it should gather and report only, never render the pass/bounce verdict itself (QA still has to read the output and judge pre-existing-red vs new, bounce vs pass - a script that also decided the verdict would let QA rubber-stamp green output instead of reviewing). Operator observed this live in the QA pane and is relaying it as a backlog-worthy efficiency idea, not a bug report.
