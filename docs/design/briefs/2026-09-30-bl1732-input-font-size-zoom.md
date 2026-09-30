# Brief: BL-1732 intake form's 14px inputs trigger iOS zoom-on-focus

**Artifact**: Telegram Intake form ("File an intake" Mini App page)
**Surface**: Telegram Mini App WebView, ~390px viewport, dark theme
**Reviewed**: 2026-09-30, source at `.worktrees/QA/tmp/bl1732-intake-form.html`
(QA sign-off request for BL-1732), cross-checked against
`extension/src/bridge/intakeFormUiHtml.ts`

## What's wrong, as a human sees it

```css
select, textarea, input[type="text"] { width: 100%; padding: 8px;
  font-size: 14px; ... }
```

Every text-entry control on the form — the scenarios, rule and notes
textareas — is 14px. Telegram's Mini App WebView on iOS is a WKWebView,
which inherits Mobile Safari's standard behaviour: focusing a text input
whose computed font-size is under 16px zooms the whole viewport in. A
human tapping into "Scenarios" to type a Given/When/Then loses the form's
own layout to an involuntary pinch-zoom and has to zoom back out to see
the rest of the fields, on every field, every time.

## Intended result

Every focusable text input (`textarea`, `input[type="text"]`, and the
narrative `select`s once [[BL-1732 narrative selects wrap fix]] lands) is
16px or larger. Verify on the surface: focusing the scenarios field on an
iOS device (or an iOS WebView simulation) does not change the page's zoom
level.

## Constraints

- 16px minimum is a floor for anything the human types into, not a
  redesign — keep labels and other non-input text at their current
  sizes.

## Disposition

Not blocking BL-1732 on its own (the form is usable, just zoom-jumpy) —
routed to the specifier as a `note` to mint, same as the narrative-selects
brief; worth landing together since both touch the same stylesheet rule.
