# BL-1090 — architect pass — 20260824

## Review inventory (Article 4.4)

NONE.

## Inbound

Merged cleaner `41ff9d7ab8` (on coder `537bb54dea`) into
`swarmforge-architect`. Ancestry confirmed. Lands the uncommitted draft
disposition (review-and-stamp), with cleaner remint/edge-loop tidy.

## Scope

Shared `approvalAskRecordedOnLiveTopic` for reconcile + edge path; suppress
edge `ApprovalRequested` when ask already on live Approvals topic and add
its key to `alreadyEmitted` so durable dedup catches up after a lost
`writeTickState`. Remint (stale topicId) still re-posts.

## Architecture

- One predicate for both consumers — they cannot disagree on “already live.”
- Invariant 1: live-topic ask → no second post from edge after crash window.
- Invariant 2: suppressed edges mark emitted in the same tick (not silent loss).
- Invariant 3: remint not suppressed (cleaner kept explicit remint branch).
- Matches the captured draft shape; no greenfield rewrite. Concierge-only;
  no webview/host/secrets surface change.

## Gates

| Gate | Result |
|---|---|
| Unit (approvalAskReconcile + conciergeTick) | **120/120** |
| Acceptance (BL-1090 feature) | **6/6** |
| Stamp-off (BL-1113) | **9/9** |

## Findings

NONE.

## Forward

`git_handoff` to `hardender`, priority `00`, task
`BL-1090-a-lost-tick-baseline-reposts-an-exact-duplicate-approval-ask`.

By architect.
