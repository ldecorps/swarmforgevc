# Bubble Health page — swarm trends on phone (BL-832)

*How-to. Task-oriented: open **Health** from the expanded Bubble pager and see
whether the swarm has been working well lately — traverse time, rework,
bottleneck stage, and velocity — without inventing a second formula for any
number.*

Remote HTML in the BL-829 ui-bundle family (same posture as Pipeline and
Operator docs). The page is a **reader** of metrics the bridge and CLI already
compute; it never re-derives them.

## What you get

1. Expand Bubble → open **Health** (manifest page `health`, order 3 — after
   Talk, Live, and Pipeline).
2. Four number-first readouts, each with its **own honest window label**:
   traverse time, rework (split by bouncing role), bottleneck stage, velocity.
3. Rework carries the diagnosed verdict as its direction line when the signal
   has one.
4. Empty windows say **No observations** — never a misleading zero.

## Window honesty

The human's mental model is "about two weeks", but underlying computations use
different windows today (e.g. velocity rolls 7 days; cycle time uses a count of
recent tickets). This page labels each readout with the window **its**
computation actually used. Uniform windows across metrics is a follow-up owned
by whoever changes those computations for every consumer at once.

## Constraints

| Rule | Detail |
| --- | --- |
| No second formula | Each figure equals the named existing computation |
| Window labeled | Every readout states the window it covers |
| Absent data | Empty window → explicit "no observations", not zero |
| Auth | Valid bridge token required |

## Where it lives

| Piece | Location |
| --- | --- |
| Pager entry | `letsTalkRoutes.ts` → `bubbleHealth` |
| Readout logic | `bubbleHealthCore.ts` |
| HTML shell | `bubbleHealthHtml.ts` |
| JSON feed | `/health-trends` via `buildBubbleHealthTrendsState` |
| Mini App shell | `/health` |

Design mocks: `docs/design/bubble-health-trends-screen-mock.png`,
`docs/design/bubble-health-trends-REAL-data-mock.png`.

## Verify

```bash
cd extension && npm test -- bubbleHealthCore
cd extension && npm test -- bubbleHealthReadouts
bash specs/pipeline/scripts/run_acceptance.sh \
  specs/features/BL-832-bubble-health-trends-page.feature
```

Manual once on device: expanded Bubble → Health → each readout legible at
phone width; compare figures against the bridge route or CLI for the same
metric — they must agree exactly.

Related: [Bubble remote page pager](BL-829-bubble-remote-page-pager.md),
[Operator docs on phone](BL-1166-bubble-authored-docs-index-and-first-pages.md).
