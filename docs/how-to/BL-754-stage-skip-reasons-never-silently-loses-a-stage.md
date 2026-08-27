# Malformed stage_skip_reasons is surfaced, never silently truncated (BL-754)

## The gap

Flow-style `stage_skip_reasons: { … }` parsing had three branches. Only
double-quoted reasons were tested. An unquoted reason with a comma such as

```yaml
stage_skip_reasons: { cleaner: no test, obvious, architect: covered }
```

split on the first comma, stored `cleaner → "no test"`, then failed to parse
the remainder as a `stage:` pair — so **architect's reason disappeared** with
no error. That looked like a complete parse.

## What changed

`read-stage-skip-reasons` returns `{:reasons … :malformed nil-or-string}`:

| Input | Result |
| --- | --- |
| Double- or single-quoted reason with commas | Full reason kept; next stage still parses; quote styles equivalent |
| Unquoted reason, comma only before next `stage:` | Accepted (simple unquoted) |
| Unquoted reason with an interior comma | `:malformed` names the unparseable remainder — never a silent partial map |
| Absent field | `{:reasons {} :malformed nil}` |

Reading stays observational: a malformed declaration does **not** abort the
handoff. The routing-skip header/journal may carry
`skip_reasons_malformed="…"` (same loud-surface posture as BL-951's invalid
`required_stages`).

Prefer quoted reasons (live convention). If you see
`skip_reasons_malformed=`, quote the reason text or fix the commas.

Acceptance:
`specs/features/BL-754-stage-skip-reasons-never-silently-loses-a-stage.feature`

Related: `docs/how-to/BL-661-stage-skip-reasons-flow-style.md`.
