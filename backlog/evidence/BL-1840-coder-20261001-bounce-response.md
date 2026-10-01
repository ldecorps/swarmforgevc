# BL-1840 — coder bounce response, 2026-10-01

## Hardener D1, independently verified

Re-derived qwen's own `computeThresholds(window, pct)` (chunk-TGWAQ5RB.js)
in a standalone Node snippet, using the installed package's own constants
(`DEFAULT_PCT=0.85`, `SUMMARY_RESERVE=COMPACT_MAX_OUTPUT_TOKENS=20000`,
`AUTOCOMPACT_BUFFER=13000`):

```
49152 @0.8:  auto=16152 (proportional=39321.6, absoluteCeiling=16152)
49152 @0.85: auto=16152 (proportional=41779.2, absoluteCeiling=16152)
32768 @0.8:  auto=26214.4 (proportional=26214.4, absoluteCeiling=-232, ceiling inert)
```

Confirms D1 exactly: for the real incident's window (49152), `auto` is
clamped to `window - 33000 = 16152` regardless of `autoCompactThreshold`
— 0.8, 0.85 (qwen's own un-pinned default), or anything else up to 1.
The parcel's fix (writing `context.autoCompactThreshold: 0.8`) changes
only the written JSON; it never changes qwen's actual compaction
trigger at this window. 16152 is close to the ~17,500 tokens the real
2026-09-30 session actually compressed at — this ceiling, not the
default `pct`, is the real mechanism behind the original incident.

Checked for a settings- or env-level override of `AUTOCOMPACT_BUFFER` /
`COMPACT_MAX_OUTPUT_TOKENS` in the installed `@qwen-code/qwen-code`
package: none exists. Both are fixed `var` declarations in the
compaction module, not read from `context.*`, `model.*`, or any
`process.env[...]` key (checked the settings schema doc and grepped
every `process.env[` in the compiled chunk holding `computeThresholds`).
The settings schema's own `autoCompactThreshold` description says so
directly: *"on smaller windows compaction may fire earlier to leave
room to summarize"* — this is describing the ceiling, not a bug.

General rule: the ceiling binds whenever `window < 33000 / (1 - pct)`.
For `pct=0.8` that is `window < 165000` — true of every served window
this swarm currently uses (32768, 49152; even a 131072-token model
would still land under the ceiling at `auto=98072` instead of
`104858`). Only the ticket's OWN 32768 example row sits where the
ceiling happens not to bind (`absoluteCeiling` goes negative there), so
scenario 01's second outline row is the one row where the written
fraction is the real, effective mechanism — row one (49152, the
incident's own window) is not.

## Disposition

This is not a defect this ticket's own mechanism can fix by writing a
different number into `context.autoCompactThreshold` — no value of that
key moves `auto` for a window under ~165k once the absolute ceiling
binds, and no override for the ceiling's own constants exists in the
installed qwen build. Per "Never Blind-Forward A Bounce You Cannot Fix"
and Article 4.4 ("Spec gaps leave by note, never a parcel"), sending the
specifier a note rather than shipping a fix the evidence shows cannot
work for the window that motivated the ticket, or silently narrowing
scope without a ruling.

Not re-sent forward. Sent `note` 2026-10-01 to the specifier (priority
00) with this finding, awaiting a ruling on how to proceed — the
parcel's own current commit (962bde286b, unchanged by this pass) stays
in `in_process` until the specifier answers.

By coder.
