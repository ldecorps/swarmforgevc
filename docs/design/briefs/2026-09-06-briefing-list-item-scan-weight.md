# Brief: briefing-email list items don't carry the scan weight their intro does

**Artifact**: Daily briefing email, HTML part
**Surface**: phone mail client, ~390px viewport
**Reviewed**: 2026-09-06, rendered from `specs/pipeline/steps/fixtures/BL-1419-2026-09-05-briefing.md`
through `render-markdown-to-html` + `render-briefing-html` (the same
production path QA exercised for BL-1419)

## What's wrong, as a human sees it

Under "Business features delivered" a `<strong>` sentence introduces each
themed group ("The QA land/replay/reconcile machinery kept absorbing
structural gaps"), then a plain, unstyled `<li>` list follows it — 15 items
in the largest group, each opening with a ticket ID in ordinary body text:

```html
<li style="margin:0 0 6px 0">BL-1309: the one landing step QA cannot
skip never asked what the tip actually carried...</li>
<li style="margin:0 0 6px 0">BL-1374: a routine <code>...</code> named
after a ticket credited that ticket's replay with every passenger...</li>
```

On a phone, a reader scanning for one ticket (their own, or one named in a
Telegram alert) has nothing to catch their eye against — the ID sits in
the same 14–16px regular weight as the sentence around it, in a 15-item
list with 6px of margin between entries. The bold group-intro sentence
sets an expectation of visual hierarchy that the list itself doesn't
deliver.

## Intended result

The leading ticket-ID token in each list item is bolded
(`<strong style="font-weight:600">BL-1309</strong>:`), matching the weight
already used for the group-intro sentence. Verify on the surface: scanning
the rendered email at phone width, a reader can find "BL-1385" by its
visual weight alone before reading the surrounding sentence.

## Constraints

- Inline `style` only — no `<style>` block, no color (mail-client-safe,
  Design system's existing "no color, no rule" heading rule extends here:
  weight only, not a new color).
- Applies to the two multi-item lists in "Business features delivered"
  and any future list whose intro sentence is bold; single-paragraph
  items (e.g. "Smaller fixes:") are unaffected since they're not `<li>`.

## Disposition

Not blocking BL-1419 — the reflow invariants it shipped (real paragraphs,
lists, quotes, code; bounded phone layout; no wrapped fragments) are met
and confirmed by QA and by this review. This is a same-system follow-up:
routed to the specifier as a `note` to mint.
