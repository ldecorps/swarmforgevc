# BL-604 — the morning briefing carries a trend analysis

Coder, 2026-08-30.

## What shipped

| piece | file |
|---|---|
| the pure builder | `extension/src/metrics/trendAnalysis.ts` |
| the section CLI | `extension/src/tools/trend-analysis-section.ts` |
| the section key | `:trend-analysis-section` in `briefing_email_lib.bb`'s `optional-section-adapter-keys` |
| the adapter | `trend-analysis-briefing-section` in `handoffd.bb`, wired into `briefing-email-sweep!` |
| unit tests | `extension/test/trendAnalysis.test.js` (19) |
| the two invariants | `extension/test/bl604TrendAnalysisInvariants.property.test.js` (4) |
| acceptance handlers | `specs/pipeline/steps/bl604MorningBriefingTrendAnalysisSteps.js` |

The established section shape, followed rather than reinvented: a pure builder,
a thin CLI whose `main()` wraps exported helpers, a two-line adapter fn, one new
key in the ordered vector — which is that vector's own stated contract ("adding
a section later is a new entry in this vector, not a new branch").

## The narrative renders the computed trend; it does not form one

Direction and magnitude are `computeTrend`'s own, for the same series the chart
plots. Nothing here recomputes, smooths or re-thresholds them. The reader sees a
bullet and a chart side by side, and if the bullet carried its own slope the two
could disagree with nothing to say which lied.

The one line of "so what" is deliberately about the SHAPE of the change and
never about whether it is good news: this module has no per-series notion of
which direction is desirable, and inventing one would be exactly the second
judgement invariant 1 forbids. A series that wants "up is bad" says so in its
own label.

## Ranking is relative, and the scenario is built so the two rules disagree

Significance is `|delta / prior|`, not `|delta|`. An absolute ranking puts
whichever series is measured in the largest units on top forever — a token count
would outrank every approval-tap collapse. A prior of zero has no ratio, so the
absolute delta stands in there; that is the one point where the two scales meet.

Scenario 02's fixture is constructed so the two candidate rules give DIFFERENT
orders (tokens moves furthest in raw units and least in proportion), because a
fixture whose orderings agree would pass against either rule and prove neither.

Ties break on series id, so two identical days render identically — a briefing
whose bullet order shuffles reads as movement that did not happen.

## Absence of data is never a finding

`unknown` is precisely `computeTrend`'s "fewer than two points", so the omission
rule needs no threshold of its own — and a series that is absent, unlanded, or
whose loader threw arrives as an empty array through `loadPointsSafely` and
falls out through the same clause, with no extra branch. A series reported as
"no change" would read as evidence that nothing happened, when the truth is that
nobody looked.

The CLI prints nothing at all when the analysis is empty, rather than a heading
with no bullets: a heading alone is that same false report wearing a hat, and
the briefing's optional-section machinery already drops a blank block.

## The two declared invariants (BL-654)

The ticket's e2e procedure names the reach this needs and is right — "a
generator that only ever produces trendable series makes invariant 2 vacuous".
So series LENGTH is drawn from `{0, 1, many}` with a floor of 12 on each bucket,
and both signs of delta carry their own floor of 10. Invariant 2 is checked in
BOTH directions on every draw (no un-trendable series gains a bullet; no
trendable one loses one), with the bound lifted so absence has exactly one cause
under test, and the bound checked separately so the two reasons never blur.

Invariant 1 compares the parsed rendered TEXT against `computeTrend` called
directly — not the struct that produced it. A builder can carry a correct
`direction` field and print the opposite word, and only the printed word reaches
the briefing.

**Non-vacuity, both shown by breaking the code and running:**

| break | result |
|---|---|
| the bullet prints double the computed delta | invariant 1 FAILS: "printed magnitude disagrees with computeTrend" |
| a one-point series is reported as "flat, no change" | BOTH fail: "printed direction disagrees with computeTrend" and "s0 has 1 point(s) and was reported anyway — absence of data rendered as a finding" |

Restored; 4/4 green.

## Runs

| what | result |
|---|---|
| BL-604 unit tests | 19/19 |
| BL-604 property tests | 4/4 |
| BL-604 acceptance | **8/8** |
| standing collision guard | 6/6 |

**A count in the ticket to reconcile, not a shortfall.** The e2e procedure says
"9 subtests (3 Examples rows in scenario 01, 2 in scenario 03, plus scenarios
02, 04 and 05)". That enumeration sums to 3 + 2 + 3 = **8**, which is what the
feature produces and what runs green. The "9" appears to be an arithmetic slip
in the procedure rather than a missing scenario — every scenario and every
Examples row in the feature file is present and passing.

## Scenario 05 drives the send path, not the seam's insides

`apply-optional-sections` and `compose-and-send-one!` are both private. Rather
than reach past that, scenario 05 calls the public `send-unsent-briefings!` —
the same function `handoffd`'s sweep calls — with `send-email!` capturing the
body, and asserts the section's own content is in the text handed to the mailer
alongside the rest of the briefing. It also reads the two wiring facts from the
real files, because a key in the vector with no adapter behind it (or the
reverse) is a section built and called from nowhere.

## Out of scope, untouched

No new instrumentation: this is a consumer of the nine landed series, and a
series that looks wrong is its producer's ticket. The board, the charts and
`computeTrend` itself are unchanged.
