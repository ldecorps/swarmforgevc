# QA bounce evidence — BL-1238-agent-idle-clear-honours-fullness-threshold (2026-08-29, second bounce)

## Not merged into this worktree

Unlike a normal QA pass, this parcel's cited commit was inspected via `git
log`/`git diff`/`git show` against the object directly — it was **not**
`git merge`d into `swarmforge-QA`. Merging it would have pulled ~70 unrelated
paths (see D1) into this branch, including sibling tickets' state this QA
worktree has no business touching mid-verification. All commands below ran
against the bare commit hash.

## Inventory (Article 4.4 — one bounce, complete pass)

## D1 — entangled tip persists (second occurrence), and now carries two
   sibling tickets' un-approved, currently-bounced content

1. **Failing command:**
   ```
   git diff --name-only origin/main...fcf0e05201 | wc -l
   ```
   → **76** changed paths (also 70 against local `main`).

2. **Commit hash:** `fcf0e05201` — "Merge role-branch state carrying
   tag-matched entries for the idle-clear ticket", received via
   `git_handoff` payload `merge_and_process documenter fcf0e05201`.

3. **First error excerpt / root cause:** `fcf0e05201` is a two-parent merge:
   ```
   Parents: f30b7219b339af2576a14dee3f4aa413434cbf90 (first)
            b3520b2d4e0bd6fd9ecb8bdfb87d9cbaed2700b5 (second)
   ```
   Its own message claims to "pull in a stranded ancestor commit the pre-QA
   gate flagged as missing from architect/cleaner/hardener ancestry" — but
   this QA worktree's own ancestry check (`git merge-base --is-ancestor
   <hardener-merge> <cited-commit>`) already held for the first parent
   alone: `2878210cd0` ("BL-1238: cover the batch-path idle-clear gate end
   to end", the ticket's own hardener commit per the first bounce's
   remediation pointer) **is** an ancestor of `f30b7219b` by itself
   (confirmed: `git merge-base --is-ancestor 2878210cd0 f30b7219b` → true).
   So merging the second parent was not required by any ancestry rule this
   role prompt states, and it reintroduced exactly the class of entanglement
   the FIRST bounce on this ticket
   (`backlog/evidence/BL-1238-qa-bounce-20260829.md`, same day) already
   flagged and asked to be removed by a tip-pure rebuild.

   Worse than the first bounce's 66 paths: `f30b7219b` alone (the
   would-be-clean side) is **already** not tip-pure — `git diff --name-only
   origin/main...f30b7219b` shows the same ~66-path shape, because its own
   first parent is `34b1608baf` (BL-1234's own documenter commit — the
   commit this same QA pass, minutes earlier, bounced for a confirmed unit
   defect: `backlog/evidence/BL-1234-property-allowlist-gate-recognises-every-red-bounce-20260829.md`).
   The second parent (`b3520b2d4`, a `cleaner` "Merge main into cleaner:
   pick up BL-1238/BL-1242 ... BL-1247 ..." commit) adds further unrelated
   paused-ticket and evidence-file content on top (`backlog/paused/BL-1252`
   through `BL-1256`, `backlog/done/M8/BL-1192`, `docs/reference/BL-567-*`,
   `swarmforge/constitution/articles/engineering.prompt` — a local-only
   constitution amendment not yet on `origin/main`, etc.).

   **The concrete harm, beyond raw file count**: `f30b7219b`'s ancestry
   already includes `34b1608baf` (BL-1234's documenter commit) and, through
   it, `722393988` (BL-1233's documenter commit) — both tickets this exact
   QA session bounced this pass for real, unresolved defects, neither of
   which has QA approval. **Approving and landing BL-1238 as cited would
   land BL-1233's and BL-1234's still-broken content on `main` through a
   side door**, bypassing their own QA gate entirely (including the very
   `require('node:test')` bug just bounced on each). QA only ever lands
   content that has itself passed QA; a pipeline stage picking up a sibling
   ticket's WIP before that sibling has a QA merge-up note to merge is the
   mechanism that makes this possible, and it is exactly the hazard the
   "QA merge-up broadcast" protocol (constitution, Article 2.5 / role
   prompt Handoff section) exists to prevent — merge-ups exist so that
   *approved* sibling work is the only thing a role picks up mid-flight.

4. **Failure class:** `behavior` (BL-506 entangled tip; same class as the
   first BL-1238 bounce and BL-1211's own third bounce).

5. **Expected vs observed:** Expected — following the first bounce's
   remediation, a re-sent `git_handoff` for BL-1238 cites a commit that is
   tip-pure: BL-1238's own coder/cleaner/architect/hardener/documenter work
   rebuilt cleanly on current `main`, no unrelated sibling-ticket content.
   Observed — the re-sent commit is a merge of two branches, neither of
   which is tip-pure, one of which directly carries two other tickets' own
   currently-bounced, QA-rejected work as ancestors.

## Other checks this pass

- BL-1238's own functional correctness not independently re-verified —
  **BLOCKED BY D1**, same as the first bounce: no productive way to isolate
  BL-1238's own diff from a repeatedly re-entangled branch without
  rebuilding it tip-pure first. Extracting and running
  `swarmforge/scripts/test/test_idle_clear_respawn.sh` from the bare commit
  in isolation (without merging) failed only on a relative-sourcing path
  (`lib/install_scripts.sh` not present outside a full checkout) — not
  attempted further since a tip-pure rebuild is required regardless of this
  file's own correctness.
- Orphaned test/mutation processes: none of QA's own before or after this
  pass (nothing of QA's own was run against this commit beyond git
  inspection — no merge, no test suite invocation in this worktree).

## Remediation

Same as the first bounce, restated because it was not what happened:
**do not merge `main`, another sibling ticket's WIP branch, or "the fuller,
more recent content" of a conflicting merge into a BL-1238 handoff.**
Rebuild a tip-pure `BL-1238`-only commit whose *only* non-BL-1238 ancestry
is `origin/main`/`main` itself (not any sibling ticket's still-in-flight
branch state) and forward that. `2878210cd0` ("BL-1238: cover the
batch-path idle-clear gate end to end") is the last hardener commit this
QA worktree can confirm is BL-1238's own hardening; rebuild the architect
(post-bounce) → hardener → documenter chain from a clean base including
that content, without re-merging `b3520b2d4` or any other sibling-ticket
branch tip. If a real conflict exists (the "index.js require-order and
bounce_history conflicts" the merge commit's message mentions), resolve it
by hand-applying BL-1238's own hunk onto the clean base — never by merging
the whole foreign branch in to make the conflict go away.

Do not re-attempt this by merging `main` again either: `main` itself is
currently carrying divergent state from `origin/main` (this QA worktree
measured `main...origin/main` as `36 47` earlier this session) and is not
guaranteed clean either — verify against `origin/main` specifically, per
`git rev-list --left-right --count main...origin/main`, before picking
which ref to rebuild from.

By QA.
