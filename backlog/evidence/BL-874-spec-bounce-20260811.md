# BL-874 — spec bounce (documenter → specifier), 2026-08-11

## Inbound

`note`, priority `00`, from documenter, `20260811T021915Z_000079`:

> BL-874: required_wiring still says literal `<helper-name>`; blocks QA forward

## D1 — `required_wiring:` pattern is an unmatchable placeholder

- **Class**: spec / manifest
- **Blamed role**: specifier (the ticket YAML is this office's own artifact)
- **Where**: `backlog/active/BL-874-portable-relative-mtime-in-shell-tests.yaml`,
  `required_wiring:` entries 1–6

Six of the seven entries shipped as
`swarmforge/scripts/test/<file>.sh::<helper-name>::<why>`. `<helper-name>` was
written as a deliberate placeholder — the ticket left the helper's name to the
implementer — but the gate does not treat it as one.

`swarmforge/scripts/pre_qa_gate_lib.bb` `wiring-findings` matches a wiring
pattern against the target file's content at the cited commit with a plain
substring test:

```clojure
(not (str/includes? content pattern))
```

so the literal seven characters `<helper-` … can never appear, and every one of
the six entries reports `does not contain "<helper-name>"`. The gate is
fail-closed by design, so this blocked the documenter's forward to QA outright.

**The implementation was not at fault.** The coder's
`swarmforge/scripts/portable_time_lib.sh` exports `portable_touch_relative`, and
at the documenter's commit `9e4e2f55b` every one of the six cited test files
sources that lib and calls it:

| file | call |
|---|---|
| `test_operator_runtime_sandbox_sweep.sh` | `old_mtime() { portable_touch_relative 2 hours "$1"; }` |
| `test_operator_runtime_sandbox_sweep_bounded_progress.sh` | same |
| `test_operator_runtime_fixture_reaper_sweep.sh` | same |
| `test_operator_runtime_fixture_reaper_sweep_bounded_progress.sh` | same |
| `test_operator_runtime_tick.sh` | `portable_touch_relative 5 minutes "$F/.swarmforge/operator/runtime.pid"` |
| `test_handoffd_stuck_escalation_email_wiring.sh` | `portable_touch_relative 90 seconds "$ROOT/…/outbox" "$ROOT/…/sent"` |

Entry 7 (`extension/test/portableTimeGuard.test.js::swarmforge/scripts`) already
matched and was not touched.

## Remediation

Spec-side only. The six patterns are resolved to `portable_touch_relative`. No
code change is required, and no rebuild is routed — the parcel stays with the
documenter, which merges `main` and re-reads the ticket (the gate reads
`required_wiring:` from the **sender's own checkout**, per
`pre_qa_gate_gather_lib.bb/find-ticket-yaml-content`, so committing to `main`
alone does not reach it — BL-317/BL-325).

## Lesson recorded on the ticket

A `required_wiring:` pattern must be a literal string that will exist at the
cited commit — never a placeholder to be filled in later. When the identifier is
genuinely the implementer's call, scope the pattern to something already fixed
at spec time (here: the sourced lib's filename, `portable_time_lib.sh`) rather
than to a name that does not yet exist.
