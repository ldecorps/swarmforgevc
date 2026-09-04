# BL-1371 — documenter pass, 2026-09-03 (expedite run, stage 05)

Reviewed commit `e1e07c364e` (hardener, PASS — both real mutation gaps
closed, `featureHandlerRegistrationTypes.js` survivors confirmed a tooling
false reading).

## What the prior stages flagged as documenter-domain

The coder's stage-01 handoff (`backlog/evidence/BL-1371-coder-pass-20260903.md`,
"For the next stages" § documenter) named two concrete items:

1. `docs/` still describes step-handler registration as appending a require
   line to `index.js` in places this parcel did not sweep, and the
   `required_wiring` handler-registration anchor convention is retired for
   new tickets.
2. One stale sentence (not a diagram edit — all six registered diagrams were
   checked against their change-triggers and none depicts step-handler
   registration): `docs/diagrams/architecture.mmd:48`'s BL-988 comment
   describes the BL-578 contract binding as staying bound "in steps/index.js"
   by source text, which is no longer how `bl988Bl578ContractBinding.property.test.js`
   proves the binding (it now asks `discoverHandlerFiles()` whether the
   module loads, per that file's own BL-1371 comment).

## What was done

- `docs/diagrams/architecture.mmd:47-48` — corrected the stale BL-988 comment
  to describe the binding as asking discovery, and added a one-line BL-1371
  note explaining why. No diagram source/structure changed (confirmed against
  the registered `DIAGRAM_FILES` allowlist and each diagram's own
  change-trigger — none fired).
- New how-to page:
  `docs/how-to/BL-1371-step-handlers-register-by-discovery.md` — what changed,
  what a new ticket's `required_wiring` should point at instead of the old
  `index.js` anchor, what discovery does and does not catch (subdirectory/
  non-`*Steps.js` files stay outside it), and that
  `check_feature_handler_registration.sh` is narrowed rather than retired.
  Linked from `docs/index.md`'s How-to section in the same commit.
- `docs/reference/Specification.MD` — new **Last Updated** changelog entry at
  the top of the chain (date already current, September 3, 2026 — bumped in
  the same commit as required), summarizing the change, the verification
  method (set comparison + per-step resolution parity, never a count), the
  narrowing of BL-1303's gate, and the retirement of the
  `required_wiring: specs/pipeline/steps/index.js::blNNNSteps` anchor pattern
  for new tickets. Cross-referenced the new how-to page and the acceptance
  feature.

## Swept, found not applicable

- Grepped `docs/` for `require line|DOMAINS|hand-maintained` (10 hits) and
  read each: all but the architecture.mmd comment above are either (a)
  historical incident narratives written in past tense about unrelated
  hand-maintained lists (BL-944/BL-671/BL-1049/BL-1179's own distinct
  fixture/allowlist stories) that this ticket does not touch, or (b)
  `docs/reference/Specification.MD`'s own append-only changelog entries for
  past tickets, correctly describing what those tickets did AT THE TIME
  (`git log`-style history, not a living claim about current mechanism) — not
  something this ticket rewrites.
  - `docs/how-to/BL-1237-reference-freshness-guard-is-direction-aware.md:53`'s
    "stale require line" is one such past-tense incident narrative (a
    specific leftover from an earlier merge-conflict resolution) — left as
    written, it is history, not a claim about how registration currently
    works.
- No retirement/deprecation applies here — this ticket narrows a gate and
  retires a convention, it does not retire user-visible behaviour, so
  `docs/deprecated/` is not in scope (Article 3.6 only fires on retired
  behaviour, confirmed against the specifier's freshness note on the ticket:
  `allow`, no supersede marker).
- `node extension/out/tools/docsOrphanLandCheck.js .` from `extension/`: exit
  0 — the new how-to page is linked, no orphan.

## Verification run this pass

| Check | Result |
|---|---|
| `node extension/out/tools/docsOrphanLandCheck.js ..` (from `extension/`) | exit 0 |
| `git diff main...HEAD --stat` (doc files only) | `architecture.mmd` (comment only), `docs/index.md` (+1 line), `docs/reference/Specification.MD` (+1 changelog entry), new `docs/how-to/BL-1371-step-handlers-register-by-discovery.md` |
| No production code, test, or ticket-yaml file touched this pass | confirmed via `git status`/`git diff --stat` before commit |

## Verdict

PASS. Both documenter-domain items the coder flagged are cleared: the stale
architecture.mmd sentence corrected, and the retired `required_wiring`
convention plus the new discovery mechanism documented in a linked how-to
page and in Specification.MD's changelog with the date bumped in the same
commit. No diagram structurally changed (none depicts this mechanism). No
bounce. Forwarding to QA.
