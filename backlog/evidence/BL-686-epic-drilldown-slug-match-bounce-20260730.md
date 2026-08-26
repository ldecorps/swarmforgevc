# BL-686-epic-drilldown-slug-match — QA bounce evidence (2026-07-30)

## D1: Documenter pass missing entirely

**Failing command**: no command — inspected the commit lineage directly:

```
git log --oneline 97b0d841c..b0b3661925
git diff 6297db3f9 b0b3661925 --stat
```

**Commit hash**: `b0b3661925` (the commit the documenter's `git_handoff` named,
parents `567122c3a` and `6297db3f9`).

**First error excerpt** (the load-bearing evidence — an empty diff):

```
$ git diff 6297db3f9 b0b3661925 --stat
$
```

`b0b3661925`'s own commit message is `Merge hardener 6297db3f93 for
BL-686-epic-drilldown-slug-match` — it is a pure merge of the hardener's tip
into the documenter's branch with **zero unique content of its own**. Walking
every commit between the coder's `97b0d841c` and this tip (not `--grep`
filtered — the full list) shows exactly four BL-686-tagged commits: the
coder's implementation, an architect-review merge of that same coder commit
(cleaner made no changes of its own either, which is a legitimate "nothing to
clean" judgment), the hardener's real mutation-hardening commit, and this
content-free merge. No commit anywhere in the lineage adds README, changelog,
how-to, or `docs/` content for BL-686.

**Failure class**: `behavior`

**Expected vs observed**: Expected a genuine documenter pass — this project's
own convention for a comparable defect ticket, BL-675 (shipped two days
earlier), got an 88-line how-to doc from its documenter
(`397e01460 BL-675: how-to for the cron-side daemon log-freshness watchdog`).
BL-686 restores previously-shipped-but-broken user-facing behavior (the epic
drill-down and topic make-top on the phone Mini App) and has its own e2e QA
procedure worth capturing — a documenter judgment that no doc was needed would
still leave some record of that decision. Observed: no documenter-authored
commit exists anywhere in the lineage; the role was skipped and the parcel
forwarded as a bare merge.

## Everything else checked — no other defects

Full inventory run before this bounce, all PASS:
- `npm run compile` (extension/): clean, no errors.
- Full unit suite (`npx vitest run`): 386/390 files, 6784/6803 tests pass.
  The 19 failures (test/pausedPagerBridge.test.js, test/telegramCursorBridgeCli.test.js,
  test/tmpDirMigrationGuard.test.js) are pre-existing on `main` from BL-696 and
  BL-420 (confirmed: both origin commits, `c98e1c8d8` and `f1860ef0c`, are
  ancestors of `main` already) — they touch none of BL-686's scoped files and
  are not attributable to this parcel. Not bounced here; flagged separately to
  the coordinator for ticketing.
- `npm run test:properties`: 28/28 files, 88/88 tests pass, including
  `test/epicTopicSlugMatch.property.test.js`.
- Acceptance (`specs/pipeline/scripts/run_acceptance.sh`):
  `BL-686-epic-drilldown-slug-match.feature` 6/6 pass (including the
  slug-collision scenario the ticket's `approval_context` calls out);
  `BL-673-topic-make-top-priority.feature` 9/9 pass; `BL-674-epic-drilldown-ui.feature`
  5/5 pass — no regression in the two prior tickets whose fixtures this ticket
  corrected.
- Wiring: `computeEpicTopics`/`resolveTopicMembership` from the new
  `epicTopicSlugMatch.ts` are called from both the read route
  (`bridgeServer.ts:731`) and the write route (`bridgeServer.ts:1069`) — not
  merely unit-tested in isolation.

## Remediation pointer

Owning role: **documenter**. Add whatever documentation this ticket actually
warrants (a how-to or explanation doc for the epic drill-down/topic make-top
fix, and/or a `docs/index.md` entry) — or, if the call is genuinely "no doc
content needed," commit that judgment explicitly rather than forwarding a
content-free merge, so the decision is visible in the lineage the way BL-675's
was.
