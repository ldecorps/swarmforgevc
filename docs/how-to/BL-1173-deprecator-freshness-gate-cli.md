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
- The ticket claims **itself** superseded/retired/obsolete without a done/
  closure (BL-1268: a structured disposition field — `status`, `closed_as`,
  `superseded_by`, ... — or a claim word bound to a self-reference in the
  same sentence; a claim about a DIFFERENT ticket, e.g. a notes line citing
  another ticket's disposition, is not a claim about this one and does not
  hold. The hold reason names the field the claim was found in.)
- All `depends_on` are done, but the description still names **RETIRED**
  surfaces (`retiredSurfaceHits`; BL-1193: a retired token is extracted only
  when it is the item the `RETIRED` marker's own line actually
  predicates — mapping, predication, or announcement shape, taken adjacent
  to the marker — never a merely co-occurring earlier word on the same line)
- Repeated spec-gap bounces on the same ticket

Expedited-defect ordering never bypasses this gate.

## Promote path

`swarmforge/scripts/promote_and_route_next.sh` consults the CLI before the
git-mv into `active/`. On hold:

1. The ticket stays in `paused/`
2. A priority-`00` note reaches the **specifier** with the hold reason

Coordinator prompts still carry the manual checklist as fallback until this
CLI is the standing path.

## Discharging a hold (BL-1267)

Article 3.6 gives the specifier a `confirm-promote` outcome, but text alone
changes nothing the CLI can see. Recording the adjudication does:

```bash
node extension/out/tools/record-adjudication.js <project-root> <BL-id> \
  confirm_promote <adjudicated-by>
```

This writes `.swarmforge/deprecator/adjudications/<BL-ID>.json` — **outside**
the ticket, never inside it, because an adjudication necessarily discusses the
deprecation vocabulary that earned the hold, and writing it into the ticket
would arm the generic-claim branch (above) against the very ticket it just
cleared. The record is fingerprinted (SHA-256) against the ticket YAML text
at write time — **with one exclusion** (BL-1338): the `assigned_to:` routing
stamp a promotion itself writes (either appended fresh, or an existing line
rewritten in place by `promote_and_route_next.sh`'s `sed`) is normalized out
before hashing, so the promotion that a `confirm_promote` record authorizes
can no longer invalidate that same record the moment it runs. Any other
edit to the ticket — including a change to `assigned_to:` that is not that
promotion's own stamp write — still changes the fingerprint and re-arms the
gate; the exclusion covers only the routing write, never the ticket's
substance. See `fingerprintableTicketText`
(`extension/src/tools/deprecate-check.ts`) for the exact normalization.

```json
{
  "ticket": "BL-1256",
  "outcome": "confirm_promote",
  "adjudicated_by": "specifier",
  "adjudicated_at": "2026-08-29T12:00:00.000Z",
  "content_fingerprint": "<sha256 of the ticket YAML>"
}
```

`deprecate-check.js` reads the record before falling back to the stale-premise
signals above:

| Record state | Decision |
| --- | --- |
| `confirm_promote`, fingerprint matches current ticket text | Allow, naming the record it discharged from |
| Any other outcome (`amend`, `retire`, `split`) | Hold — recording a non-confirm-promote outcome does not discharge |
| Fingerprint does not match (ticket amended since adjudication) | Hold — names the record as stale, "re-adjudicate" |
| Missing, truncated, or malformed record | Hold — fails closed, never treated as absent-and-clean |
| No record at all | Hold — falls through to the stale-premise signals above |

There is deliberately no bypass: no environment variable, CLI flag, or caller
argument produces an allow. Amending the ticket after adjudication re-arms
the gate — a fresh adjudication is required.

## Modules

| Piece | Location |
| --- | --- |
| Pure evaluator + thin CLI | `extension/src/tools/deprecate-check.ts` |
| Adjudication writer | `extension/src/tools/record-adjudication.ts` |
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

Related: epic BL-1172 (deprecator); sibling
[BL-1174 `/deprecate` soft verbs](BL-1174-deprecate-operator-verbs-scan-docs.md);
BL-1268 narrowed the generic-claim branch to a self-claim (see Hold signals
above) — measured over the live paused pool, 27 held tickets dropped to 9,
zero newly held; BL-1267 shipped the discharge path above (a recorded
adjudication clears the gate; no currently-held ticket was retroactively
discharged by that parcel — clearing the live backlog is adjudication work
for the specifier, ticket by ticket); BL-1193 narrowed the retired-token
branch the same way — over the live docs tree the extractor's yield dropped
from four tokens (none actually retired) to the one genuine referent,
`type: bug`.
