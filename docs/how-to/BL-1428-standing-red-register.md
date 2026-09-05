# The standing-red register: every tolerated red names an open owner (BL-1428)

## The gap

Before this ticket, a test that failed on `main` but was "known about"
could be tolerated indefinitely with no mechanical check that anyone was
still doing anything about it. Measured 2026-09-05: the property-suite
allowlist (`property_suite_standing_allowlist.tsv`, BL-1175) carried 25
rows whose rationale all read "pre-existing; tracked under BL-1175 pending
fix" — but BL-1175 was closed (it built the allowlist gate, it fixed no
test) and five of those rows had gone green while still being listed. Unit
`npm test` had 7 red files (26 tests) that no list recorded at all. Owners
existed for 25 of the 27 reds, but all sat in `backlog/paused` at
`severity: medium`/`low`, untouched for six to eight days; two reds had no
owner anywhere. QA's own rule ("a red outside your parcel is presumed
already ticketed until grepped", BL-1063) was followed correctly every
time — 35 evidence files that day said "pre-existing" — and nothing ever
moved a fix, because nothing forced the record to stay honest.

Human directive, 2026-09-05, verbatim: "we should not sweep failing tests
under the carpet" — approved as a three-piece proposal ("go"). This ticket
is the first piece: the register itself. BL-1429 (the throttle signal) and
fixing any individual red are separate, sibling tickets. This ticket
supersedes BL-816 (2026-08-05: "Surface the meta-defect... leave the
safety signal broken"), which was approved and never promoted; BL-816's
own human sentence is carried verbatim in its retirement record
(Article 5.3).

## The three sources, one reader

`swarmforge/scripts/standing_red_register_lib.bb` is the **one** reader of
every place a tolerated red is recorded (invariant 1 — every consumer,
including BL-1429's throttle signal, QA, and the daily briefing, asks this
reader rather than parsing a source itself):

| Source | What it is | Ownership |
|---|---|---|
| `backlog/standing-reds.tsv` | The register (this ticket): `lane<TAB>file<TAB>ticket<TAB>first_seen<TAB>note`, one row per tolerated red not covered by the allowlist. Authoritative for a (lane, file) pair when it names one. | The row's own `ticket` column |
| `swarmforge/scripts/property_suite_standing_allowlist.tsv` | The BL-1175 property-suite allowlist. | A register row naming its file under lane `property`; absent from the register = unowned |
| `backlog/hardening-debt-ledger.yaml` | The BL-942 hardening-debt ledger (deferred mutation gates by parcel). | The ledger row's own `parcel` field, resolved to a bare ticket id |

`swarmforge/scripts/standing_red_register_cli.bb <project-root>` prints one
JSON object combining all three:

```json
{"rows": [{"lane": "property", "file": "...", "ticket": "BL-1206",
           "first_seen": "2026-08-28", "age_days": 8, "owned": true}, ...],
 "count": 27, "oldest_age_days": 8, "unowned": []}
```

- **A register row is emitted directly** — it IS the ownership record.
- **An allowlist or ledger row the register does not already cover**
  contributes its own row, with `ticket: null` and `owned: false` — never
  silently dropped, and never a ticket guessed out of the allowlist's own
  free-text `rationale` column (the lib never parses it).
- **`owned` is `ticket-state = :open`** — the named ticket resolves under
  `backlog/paused/<id>*.yaml` or `backlog/active/<id>*.yaml`. A ticket
  filed in `backlog/done/**/<id>*.yaml` (nested by milestone) is `:closed`;
  neither is `:absent`. Both `:closed` and `:absent` rows land in
  `unowned`.
- **A row is removed in the same land that turns its test green** — the
  register is never a running history of fixed reds, only the current
  standing ones.

## The commit guard

`swarmforge/scripts/check_standing_red_register.sh` joins the **cheap
tier** of `swarmforge/scripts/run_commit_guards.sh` (last in the chain, a
plain git-index read, same cost class as its siblings — see
[the guard chain](BL-1252-commit-guard-chain-reports-every-violation.md)).
It refuses a commit that **adds or changes** a register or ledger row
naming a ticket that is not open, naming the offending row.

- **Only the row(s) THIS commit touches are judged** (invariant 2): a row
  already on `HEAD` that has since gone stale — its ticket closed, or its
  age grown — is BL-1429's throttle signal to read, never a reason to
  refuse an unrelated commit that doesn't touch it. `git diff --cached
  -U0` on each of the three source paths gives exactly the resulting
  (post-change) lines, with none of the surrounding context a wider diff
  would also flag as "changed".
- **An added/changed allowlist row** has no ticket column of its own — it
  is judged by whether the CURRENT staged register already names an open
  ticket for it, via the same join the register CLI's `build-report`
  uses. Never a second, independent ownership rule.
- **Fail-open on an unreadable git index** (WARN, exit 0) — the same
  posture every other guard in the chain takes; this guard's own refusal
  requires being SURE the row is unowned, not merely suspicious.

## Allowlist clean-up (this parcel)

The five allowlist rows that had gone green while still listed
(`bl1012`, `bl593`, `bl632`, `bl687`, `selfHealTelemetry`) are removed.
The twenty genuinely red rows keep their `allowlist` disposition; their
free-text `rationale` now names the owning ticket from the register
instead of the stale "tracked under BL-1175" text. **The allowlist gate's
own reader and refusal predicate (BL-1175/BL-1234/BL-1407) are unchanged**
(invariant 3) — this parcel edits the allowlist's rows, never how it is
read or what it refuses.

## Verify

```bash
bb swarmforge/scripts/standing_red_register_cli.bb .
bb swarmforge/scripts/test/standing_red_register_lib_test_runner.bb
bash swarmforge/scripts/test/test_run_commit_guards.sh
```

Acceptance: `specs/features/BL-1428-every-standing-red-names-an-open-owner.feature`.

## Siblings

- BL-1429 — standing reds throttle intake (reads this CLI's report as the
  throttle signal).
- BL-1430 — the unowned `bl874` red this register's own audit surfaced,
  minted its own ticket the same pass.
- BL-816 — the 2026-08-05 ask this ticket supersedes and retires.
- [The hardening-debt ledger](BL-942-hardening-debt-ledger.md) (BL-942) —
  one of the three sources this register joins.
- [Property-suite standing-red allowlist](BL-1175-property-suite-standing-reds-block-unrelated-commits.md) (BL-1175) —
  the other source; its own gate is unchanged by this ticket.
- [Pre-commit guard chain](BL-1252-commit-guard-chain-reports-every-violation.md) (BL-1252) —
  this guard joins the cheap tier described there.
