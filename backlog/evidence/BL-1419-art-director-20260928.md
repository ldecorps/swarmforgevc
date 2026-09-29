# Art director review: 2026-09-26 / 2026-09-27 headless briefings

Session: ephemeral art-director call, 2026-09-28. Reason: two consecutive
daily briefings (2026-09-26.md, 2026-09-27.md) sent via the headless
closing-ceremony path with no art-director sign-off recorded.

Method: rendered both files through the real send pipeline
(`briefing_email_lib.bb`'s `render-briefing-html` +
`markdown-to-html-lib/render-markdown-to-html`, invoked directly, same
functions `compose-and-send-one!` calls) rather than judging the
Markdown source, per Article 1.10 ("look at the real thing").

Verdict: **defect found**, not LGTM. The "Recent git activity" section
of both renders is a single unbroken HTML paragraph (2026-09-27's render
measured 17,309 characters, zero line breaks) because
`banked_briefing_lib.bb`'s `compose-banked-briefing` emits each git log
line without a Markdown bullet marker or separating blank line, so
CommonMark merges them into one paragraph. On the ~390px phone mail
client this renders as an unreadable wall of text with no per-commit
separation, and it also defeats the BL-1442 bold-leading-ticket-id rule
(there is no `<li>` for it to bold). Confirmed this pattern predates
these two dates (checked back to 2026-09-25.md, same shape) and does
not affect the coordinator/documenter-composed variant (spot-checked
2026-09-20.md, proper prose/headers).

Brief filed: `docs/design/briefs/2026-09-28-headless-briefing-wall-of-text.md`.
Sent to specifier as a `note` (priority 00).
