# Deprecator freshness-gate CLI before promote (BL-1173)

*How-to. Task-oriented: run the machine check that keeps stale paused tickets
out of `backlog/active/`.*

Article 3.6 requires a **deprecator freshness check** before every
paused→active promotion. BL-1173 ships the CLI and wires it into
`promote_and_route_next.sh` (fail-closed, same posture as BL-262).

## CLI

```bash
node extension/out/tools/deprecate-check.js <project-root> <BL-id>
```

Stdout is one JSON object:

| Decision | Shape |
| --- | --- |
| Allow | `{"decision":"allow"}` |
| Hold | `{"decision":"hold","reason":"..."}` |

Compile the extension first (`cd extension && npm run compile`) so
`extension/out/tools/deprecate-check.js` exists. A missing binary, crash, or
malformed JSON is treated as **hold** — never as allow.

## Hold signals (any one)

- `.swarmforge/superseded/<id>` marker on disk
- Ticket YAML claims superseded/retired/obsolete without a done/ closure
- All `depends_on` are done, but the description still names **RETIRED**
  surfaces (`retiredSurfaceHits`)
- Repeated spec-gap bounces on the same ticket

Expedited-defect ordering never bypasses this gate.

## Promote path

`swarmforge/scripts/promote_and_route_next.sh` consults the CLI before the
git-mv into `active/`. On hold:

1. The ticket stays in `paused/`
2. A priority-`00` note reaches the **specifier** with the hold reason

Coordinator prompts still carry the manual checklist as fallback until this
CLI is the standing path.

## Modules

| Piece | Location |
| --- | --- |
| Pure evaluator + thin CLI | `extension/src/tools/deprecate-check.ts` |
| Promote consult | `swarmforge/scripts/promote_and_route_next.sh` |
| Constitution | Article 3.6 — `03_backlog.md` / `03-backlog-detailed.md` |
| Amendment | `deprecator-freshness-gate-amendment-2026-08-27.md` |

## Verify

```bash
cd extension && npm test -- deprecateCheck
bash specs/pipeline/scripts/run_acceptance.sh \
  specs/features/BL-1173-deprecator-freshness-gate-cli.feature
```

Acceptance: `specs/features/BL-1173-deprecator-freshness-gate-cli.feature`

Related: epic BL-1172 (deprecator); sibling BL-1174 (full `/deprecate` scan —
out of scope here).
