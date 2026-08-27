# BL-1069 — architect pass, clean review (Article 4.4: NONE)

Reviewed merge `bf04e83826` (cleaner, straight merge with no changes of its
own on top of coder `e364cd7a4c`) into the architect worktree. Merged first
(`git merge --no-ff bf04e83826`), then read the ticket, the human's
`approval_context`/notes, and the coder's evidence.

This is a review ticket (stamp-off of a human-landed hotfix, `61c62f579`),
not a rewrite — I judged both the human's original diff and the coder's
narrow in-place fixes to three of its five review goals.

## Scope

`swarmforge/scripts/swarmforge.sh` (version-key/compare functions, socket-fed
`warn_if_tmux_too_old`, version-gated `prefer_local_tmux_bin`, the `ensure`
branch's own socket resolution), `swarmforge/scripts/control_plane_lib.bb`
(comment only — `harden-server!` unchanged in behavior), a rewritten
`swarmforge/scripts/install_tmux_wsl.sh` (arch table, digest verification,
fixed guard), `docs/how-to/BL-tmux-wsl-segfault-upgrade.md` (digest usage),
`specs/pipeline/steps/bl1069TmuxServerVersionSteps.js` (+ registration), two
new test runners. Zero `extension/` files touched.

## Architecture

- No extension/webview/host boundary is in play — this parcel is entirely
  `swarmforge/scripts/` shell + Babashka, the same maintained-fork lane as
  the rest of this swarm's own tooling (`babysitter_check.bb`,
  `master_checkout_drift_lib.bb`). Not a copy or modification of upstream
  `unclebob/swarm-forge` source.
- `install_tmux_wsl.sh` keeps the existing dual-purpose posture
  (`tunnel_ownership_lib.sh` precedent): no `set -e` at file scope, a run
  guard (`[[ "${BASH_SOURCE[0]:-$0}" == "$0" ]]`) gates `set -euo pipefail`
  and the EXIT trap to the executed path only, so sourcing it for tests
  cannot mutate the caller's shell options — read directly, confirmed.
- Version-pinning discipline (engineering.prompt, Startup Tools) upheld
  correctly under adversarial pressure: `TMUX_INSTALL_DEFAULT_VERSION` is a
  literal, and `tmux_install_known_sha256`'s digest table is deliberately
  EMPTY with a comment stating why ("a digest is a pin, and pinning is a
  human commit, never an agent action") rather than the coder inventing or
  guessing a digest — the script refuses without `TMUX_INSTALL_SHA256` set
  rather than install unverified. This is the correct call, not a shortcut.
- BL-971 (fixture cleanup on every exit path): `tmux_install_main` removes
  its own scratch dir on both the success and refusal path
  (`tmux_install_cleanup` called unconditionally after
  `tmux_install_fetch_and_place`), plus an EXIT trap on the executed path
  only — read the control flow directly, confirmed no path leaks the tmp
  dir.

## Required hard gate: `node extension/out/tools/dependency-gate.js`

This parcel touches no file under `extension/` (confirmed:
`git diff 39b7047e5 bf04e83826 --stat -- extension/` is empty), so there is
nothing of this parcel's for the gate to check. Full-repo scan reports only
the same pre-existing `telegram-front-desk-bot.ts` /
`telegramCursorOperatorExec.ts` / `telegramCursorOperatorLiveness.ts`
`acyclic` cycle every recent architect pass has reported — already tracked
as **BL-759** (paused), re-verified against the ticket file itself, per
[[architect-grep-exact-filenames-before-worth-a-ticket-note]] and the
role-prompt update that landed on `main` this session
(`swarmforge/roles/architect.prompt`, "A gate failure OUTSIDE your parcel is
already ticketed until you have grepped and proved otherwise"). None of this
parcel's files.

## Co-change (`node extension/out/tools/co-change-report.js`)

`swarmforge.sh` and `control_plane_lib.bb` show many "SUSPECTED COUPLING"
entries at high frequency — expected: both are the swarm's own
launcher/control-plane core, structurally central files that co-change with
most of `swarmforge/scripts/` regardless of what any individual diff touches
(same shape as `specs/pipeline/steps/index.js` in BL-1057's pass). The four
new/rewritten files this ticket actually owns
(`install_tmux_wsl.sh`, `bl1069TmuxServerVersionSteps.js`, both new test
runners) co-change only with each other, their own docs/evidence, and the
files they wire into — nothing flagged needs action.

## Invariants review (BL-633/BL-654) — 3 declared, all encoded, non-vacuous

1. **Version judgement reads the live server on the swarm socket, never
   `tmux -V` on PATH.** `warn_if_tmux_too_old` takes a socket, tries
   `tmux_server_version` first and only falls back to the client when no
   server answers, and says which of the two it measured. The `ensure`
   branch (the exact path the incident lives on, per the ticket's own review
   goal 1) now resolves its own socket via the same
   `resolve_swarm_socket.bb`/`project_socket_id` pair the file-scope launch
   path already uses — read and confirmed consistent, not a second
   resolution mechanism.
   **I independently reverted this fix** (restored the pre-BL-1069
   `warn_if_tmux_too_old` body reading only `tmux -V`) and re-ran
   `test_bl1069_tmux_server_version.sh`: it fails exactly as the coder's
   evidence describes — `client 3.7b in front of a 3.4 SERVER warns (the
   incident state)` goes from `ok` to `FAIL (expected 'warned', got
   'silent')`, plus the two assertions that the warning names/quotes what it
   measured. Restored the file afterward; `git status --porcelain` shows no
   diff and the suite is green again. This is the whole blind spot the
   ticket exists to close, proven to actually be closed, not merely claimed.
2. **Preferring a tmux binary never lowers the version in use.**
   `prefer_local_tmux_bin` now compares `local_ver`/`path_ver` via
   `tmux_version_lt` before prepending, and treats an unreadable local
   version as not earning the front of PATH. Property runner + shell suite
   both cover the downgrade-candidate row directly
   (`an OLDER local build never displaces a newer one on PATH`) and I
   re-ran both live (below) rather than trusting the commit message.
3. **A rejected stability knob never fails an ensure/launch/restore.** Traced
   both paths: the shell `harden_tmux_server`'s `|| true` is load-bearing
   (dropping it fails the suite per the coder's own recorded break, which I
   did not need to re-prove given goal-3's independent finding below);
   `harden-server!`'s `:continue true` is NOT what makes the bb path soft —
   `babashka.process/sh` never throws on a non-zero exit regardless of that
   flag (`p/shell` is the one that throws), and the function reads no exit
   code at all. This is a real, correctly-diagnosed finding: the coder did
   not silently accept the original comment's claim, traced the actual
   `babashka.process` semantics, and corrected the comment to name the
   runner as the real guarantee rather than the flag — exactly the kind of
   "stated seam is not the seam" catch this review pass exists for. Left
   in place deliberately (removing a flag that already does nothing changes
   nothing but the label), with the property runner's break now targeting
   the function that would actually break the invariant (a `harden-server!`
   that propagates failure), not the inert flag.

**Non-vacuity**: the coder's evidence documents five targeted breaks (one
per invariant-relevant path — landed `tmux -V` read, unconditional prepend,
raw-string version compare on the 3.10-vs-3.9 near miss, dropped `|| true`,
a propagating `harden-server!`), each applied, run, and reverted. I
independently reproduced break #1 (the highest-stakes one, since it is the
actual production blind spot) myself rather than taking the documented
table on faith, and the property runner's reach floors on my own re-run
match the coder's recorded numbers exactly (deterministic seeded generator,
reproducible) — see Verification below.

No invariant violation found. No missing or vacuous property test.

## Property-testing pass (BL-654 scope: undeclared properties on touched pure modules)

The touched pure surface (`tmux_version_key`, `tmux_version_lt`,
`tmux_server_version`, `prefer_local_tmux_bin`'s comparison, `harden-server!`)
is exactly what the three declared invariants already cover, including the
two deliberate near-miss version pairs (`3.7` vs `3.7b`: a lettered release
is later, not older; `3.10` vs `3.9`: numeric, where lexical string compare
gets it backwards) — real round-trip/idempotence is not a natural shape for
a one-shot version comparison. `install_tmux_wsl.sh`'s interesting property
(verify-before-install, refuse-leaves-nothing-behind) is exercised by real
subprocess acceptance scenarios against a real `file://` download and a real
digest mismatch, not a property generator — a fine shape for this surface,
since the property is "one refusal path always leaves the host as it found
it," already asserted directly in both obstacle rows. Nothing undercovered.
Nothing added.

## Correctness read-through

Read `tmux_version_key`/`tmux_version_lt`/`tmux_server_version`/
`warn_if_tmux_too_old`/`prefer_local_tmux_bin` end to end, and
`install_tmux_wsl.sh` end to end.

- `tmux_version_key`'s zero-padded `%03d.%03d.%s` format makes the
  subsequent `[[ "$a" < "$b" ]]` lexical compare numerically correct for
  both near misses: `"003.007." < "003.007.b"` (empty suffix sorts before
  any letter — 3.7 correctly reads as older than 3.7b) and
  `"003.009." < "003.010."` (padding fixes the 3.9-vs-3.10 lexical trap).
  Confirmed by reading the format string and the comparison operator
  together, not assumed from the property runner's green result alone.
- `warn_if_tmux_too_old` distinguishes "unparseable" from "too old"
  correctly: `tmux_version_key "$measured" >/dev/null 2>&1 || return 0` exits
  silently on a version it cannot read at all, and only the parseable case
  reaches the `tmux_version_lt` check — matches the comment's stated intent
  ("'I could not read it' and 'it is too old' are different answers").
- `install_tmux_wsl.sh`'s fixed guard (`[[ -z "$src" || ! -f "$src" ]]`) is
  correct; the landed version's `-z "$SRC" || ! -x "$SRC" && ! -f "$SRC"`
  bug (operator precedence collapsing it to just `-z "$SRC"`, since `&&`
  binds tighter than `||` inside `[[ ]]`) is a real, correctly-diagnosed
  finding, not invented — reproduced this fact by hand-tracing bash operator
  precedence, not by re-running the buggy version.
- Goal 4 (the `window-size largest`/`window-size manual` contention between
  this hotfix and `PaneTailer.applyPaneSettings()`): read both files named
  in the coder's evidence (`extension/src/panel/paneTailer.ts:226`,
  `extension/src/swarm/tmuxClient.ts:206,236`) directly. The finding is
  real — both write a global `window-size` option to the same swarm socket
  on independent triggers, and whichever runs last wins, which on the
  panel's turn re-arms `WINDOW_SIZE_MANUAL` (the exact tmux-3.4 crash
  trigger, moot only because the version fix is what actually protects a
  >=3.7 server). Correctly left unchanged here (scenario 03 requires
  `window-size largest` still be set; removing it is a design call outside
  a stamp-off ticket) and correctly routed onward as a narrow follow-up
  note rather than fixed or silently dropped — the right call under Article
  4.3 (a defect spanning both `swarmforge/` and `extension/` code is not
  cleanly this coder-pass's fix to make unilaterally) and does not block
  this parcel.
- Confirmed via live host: `bb …/host_switchover_doctor.bb`-adjacent probe
  not needed here; instead ran `tmux -S "$(…socket…)" display-message -p
  '#{version}'` directly against this host's real control-plane socket —
  reads `3.7b`, and `warn_if_tmux_too_old` on that socket is correctly
  silent (matches the coder's own live-host claim).

No correctness defect found beyond what the coder already caught and fixed
(goal 3's comment correction, goal 5's guard fix) or correctly routed
onward (goal 4).

## Verification re-run live (not trusted from the commit message)

- `bash swarmforge/scripts/test/test_bl1069_tmux_server_version.sh` →
  **ALL TESTS PASSED** (21 cases).
- `bb swarmforge/scripts/test/bl1069_tmux_version_property_runner.bb` →
  **ALL 40 RUNS PASSED**, reach counts matching the coder's recorded run
  exactly: `{:near-miss-letter 4 :silent 26 :downgrade-candidate 12
  :chose-none 1 :incident-pairing 7 :chose-path 16 :chose-local 23
  :harden-case 4 :warned 14 :near-miss-numeric 9}`.
- **Independently reverted invariant 1's fix and re-ran the shell suite**:
  3 failures, exactly the incident-state blind spot the ticket names.
  Restored; suite green again; `git status --porcelain` clean (only the
  pre-existing untracked BL-724 stray file this parcel does not touch).
- `specs/pipeline/scripts/run_acceptance.sh` on this ticket's feature →
  **14/14**.
- `swarmforge/scripts/gherkin_lint_gate.sh` on the feature → parses cleanly.
- `required_wiring` (`bl1069TmuxServerVersionSteps` registered in
  `specs/pipeline/steps/index.js`) → confirmed present.
- `zsh -n swarmforge/scripts/swarmforge.sh` → clean (this is a zsh script,
  confirmed by its shebang; `bash -n` on it fails on a pre-existing,
  unrelated zsh extended-glob pattern at line 329, outside this parcel's
  diff — the coder's own choice of `zsh -n` for this file was correct, not
  a gap).
- `bash -n swarmforge/scripts/install_tmux_wsl.sh` → clean (real bash
  script, correct shebang).
- Live host: `tmux -S <resolved socket> display-message -p '#{version}'`
  reads `3.7b`; `warn_if_tmux_too_old` against that socket is silent, as
  expected on this already-repaired host.
- Babashka/shell lane, per engineering.prompt's Startup Tools: no
  mutation/CRAP/DRY tooling wired. The two runners above plus the
  acceptance lane are its gate. No mutation/CRAP/DRY result is claimed —
  none was run, matching the coder's own recorded tooling-fallback note.
- Did not re-run the full `extension/ npm test` (8354 tests) myself since
  this parcel touches zero `extension/` files and the coder already
  recorded it unchanged (exit 0) on this same branch; re-running would
  re-verify unrelated surface, not this parcel.

## Verdict

**NONE.** No architecture violation, no invariant gap or vacuous property
test, no correctness defect in the parcel. The coder's three confirmed
review goals (1, 2, 5) are each correctly fixed and independently verified;
goal 3's finding (the stated seam is not the real seam) and goal 4's finding
(the `window-size` contention with the extension panel) are both correctly
diagnosed and correctly routed without widening this stamp-off ticket.
Forwarding to hardener.

— By architect.
