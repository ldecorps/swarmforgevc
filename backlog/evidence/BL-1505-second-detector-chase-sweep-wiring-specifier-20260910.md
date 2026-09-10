# BL-1505 amendment — a second standing test detects the same defect

**Specifier, 2026-09-10, on `main` at `4f16c4dd66`.**
Inbound: coder `note`, priority `00`, 2026-09-10T09:04:46Z —
`unowned-red: test_handoffd_chase_sweep_wiring.sh 01 sidecar never written`.

**Disposition: FOLD INTO BL-1505 (amend + register row). No new ticket.**

## Reproduced, not taken on report

```
$ git rev-parse --short=10 HEAD
4f16c4dd66
$ bash swarmforge/scripts/test/test_handoffd_chase_sweep_wiring.sh
FAIL: 01: chase sidecar was never written - the daemon's sweep did not run
```

Both files are `standing` in `swarmforge/scripts/test/suite-manifest.tsv`
(lines 301 and 331), so both are expected green.

## Same defect, other label — traced, not assumed

Instrumented the fixture by hand (fresh mkdtemp root, fake tmux on PATH,
real `handoffd.bb`) and read the wake-attribution log it leaves behind:

```
{"role":"coder","sweep":"inbox-item","outcome":"landed",  "at":"...T09:06:32.585Z"}
{"role":"coder","sweep":"inbox-item","outcome":"skipped",
 "skipReason":"cooldown",                                 "at":"...T09:06:32.616Z"}
```

The delivery wake lands; the chase's own wake fires **31 ms later** against an
unchanged fingerprint inside the cooldown window. `decide-wake-dedup`
(`wake_dedup_lib.bb`) answers `:suppress` under three labels — `empty-mailbox`
(101), `cooldown` (108, 118), `unchanged-mailbox` (114). BL-1505's case-05 row
hits `unchanged-mailbox`; this file hits `cooldown`.

Both land in the same gate, `chase_sweep_lib.bb` `apply-inbox-item-action!`:

```clojure
"chased" (when ((:send-wake-up! adapters) role)
           (let [count (inc (:chaseCount item))]
             (write-chase-count! (:filePath item) count now-ms)
             ((:log-telemetry! adapters) {:type "chase" ...} now-ms)))
```

`:send-wake-up!` is documented at line 296-297 as returning truthy "only when
a pane wake was actually delivered (skipped-busy/dedup/recent/failed => false)",
so every suppression label swallows the sidecar write **and** the telemetry.

`send-keys` IS present in the fixture's tmux log (from the delivery wake), so
case 01's third assertion already passes; 01b/01c fail behind the missing
telemetry, not independently.

## Why fold rather than mint

BL-1505's `description` already states the mechanism for BOTH paths ("an
unchanged mailbox suppresses with NO time bound, **and a cooldown suppresses
inside its window**") and its remedy clause is label-independent ("a chase
attempt counts whether or not its text was injected"). The same one-site repair
turns both files green — no extra production work, so the slice size envelope is
unchanged. A second ticket would have been a duplicate owner for one defect,
the shape the memory of BL-1398/BL-1399 warns about.

What was genuinely missing was **bookkeeping**: the register is keyed per test
FILE, so with no row of its own this file read as an unowned red to BL-1429's
throttle and Article 4.2 — while being red for a defect that already had an
owner.

## Changes

- **BL-1505** — new description section naming the second detector, the three
  suppress labels, and the warning that a repair written against
  `unchanged-mailbox` alone leaves this file red; two additions to
  `out_of_scope` (no edit to the second test; the six unrelated census reds);
  `qa_e2e_procedure` step 1b added and step 4 now requires BOTH rows gone;
  `notes:` records the fold. `severity: high` and `human_approval: approved`
  unchanged — no new choice is posed.
- **backlog/standing-reds.tsv** — one `shell` row,
  `test_handoffd_chase_sweep_wiring.sh` -> BL-1505, `first_seen 2026-08-27`
  (cbe63cceba, the dedup landing). Five columns verified with awk `NF!=5`.

## Known gap left open, deliberately

BL-1498's `out_of_scope` (written 2026-09-08) lists **seven** census reds. This
note's is one of them. The other six remain unreproduced by me, unregistered
and unowned:

`test_handoffd_notify_verified` (02 typed 0 — note: BL-1499 owns case 02 of
that file already, so this may be a duplicate sighting),
`test_handoffd_role_context_clear_wiring` (initial clear never fired in 30 s),
`test_build_freshness_cli` (02/03 merge never reached the running process),
`test_handoffd_supervisor_job_reaper` (04 no reparent to PPID 1 — may be the
harness subreaper, i.e. possibly not a real red),
`test_rotate_recomposes_role_prompt` (05 no respawn-pane at the idle boundary),
`test_redo_from` (every case PASS, exit 2).

I did not mint for these: I have not reproduced them, and two of the six carry
a documented reason to suspect they are not defects at all. Minting six blind
owners would put six unverified rows into the register, which is the opposite of
what the register is for. Surfaced to the coordinator instead.

This is the **third** recorded sighting of the same systemic hole — a `standing`
row can be red for weeks with nothing running it (BL-1462's adjudication and
BL-1498's `out_of_scope` are the earlier two; this file sat red from 2026-08-27
and was written down on 2026-09-08 without gaining an owner). The systemic fix —
run every `standing` manifest row on a cadence and surface a red that has no
register row — is a lean-pass process candidate, not something to bolt onto this
parcel.
