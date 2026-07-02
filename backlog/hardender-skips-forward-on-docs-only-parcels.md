BUG (coordinator-observed, 2026-07-02): hardender dropped BL-074's handoff.

BL-074 (docs-only ticket) flowed coder -> cleaner -> architect -> hardender.
Hardener completed its batch item (dequeued 09:59:31Z, completed 10:00:04Z,
33s) without sending anything to documenter — while forwarding its other
three batch siblings (BL-073, BL-069, BL-063) normally in the same window.

Root cause candidate: handoff-protocol.md's rule "a role must not forward a
git_handoff when the received commit produces no functional project change"
lists manifest-only/audit-only/generated-metadata/formatting-only churn as
the exemption. A docs-only deliverable (a real new guide file satisfying the
ticket's acceptance criteria) is NOT that kind of churn, but hardener seems
to have treated "nothing of my own to mutation-test" as equivalent to "no
functional change to forward" and stopped instead of passing the received
commit on.

Effect: BL-074's content merged into main via a sibling branch's stacked
merge, but the ticket itself never reached documenter or QA and sat in
backlog/active/ with status: todo and nobody holding the parcel — a silent
stall the coordinator had to manually unstick by routing it back through
the specifier.

What: clarify handoff-protocol.md's "no functional change" rule so it only
exempts meta/manifest/audit churn, never a real deliverable a role simply
has nothing further to add to (docs-only, config-only, etc. tickets still
must be forwarded to the next stage). Consider a regression test at the
hardener-batch level: a docs-only commit in a batch must still produce a
forward to documenter.

Scope: swarmforge/handoff-protocol.md wording, swarmforge/roles/hardender.prompt
if it duplicates the rule, plus a test/regression scenario if practical.
