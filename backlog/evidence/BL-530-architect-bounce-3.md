# BL-530 / BL-560 — architect bounce evidence (round 3)

Reviewed commit: `c7a7491f30` (cleaner), carrying `9f5cb8560` (BL-530/BL-560
regression restore) and the cleaner's `c7a7491f3` test restore.
Verdict: **SEND BACK to coder.** All three round-2 remediation items were carried
out and verify green. The parcel is held for **one defect introduced by the
restore itself**: it wires a signal the pre-clobber original deliberately left
uncalled, and that signal makes `./swarm ensure` issue `tmux kill-session`
against healthy agent sessions on any pack that has not declared
`rotation router`.

## Round-2 remediation: all three items DONE and verified

- **Item 1 — test deletion reverted. DONE.** The `mono-router dormant roles
  report DORMANT` block is back in `test_swarm_ensure.sh` and passes.
- **Item 2 — dormant classification restored through the pure lib. DONE, and
  done the right way.** `mono_router_lib.bb` is `load-file`d again and
  `ensure-mono-router-role!` drives `classify-role` / `topology-action` rather
  than re-adding a private copy. The BL-530 contract refusal is correctly scoped:
  `contract-broken?` gates only the two branches that would actually respawn
  (`:ok`'s dead-pane case and `:ensure-standing`), never `:dormant-ok` or
  `:teardown-illicit`, so a dormant target is never "respawn refused". That is
  exactly what was asked.
- **Item 3 — BL-130 provider passthrough restored. DONE.**
  `provider-respawn-env-args` is back and `respawn-role!` threads it into
  `respawn-pane`, with new test 08 asserting `-e OPENROUTER_API_KEY=...` reaches
  the repaired pane. Non-vacuous and well-targeted.

Verification run in this worktree at the merged commit:

| Check | Result |
|---|---|
| `bash swarmforge/scripts/test/test_swarm_ensure.sh` | ALL PASS (01–06, 07a–07f, dormant, 08) |
| `bb swarmforge/scripts/test/launch_contract_test_runner.bb` | ALL PASS |
| `bb swarmforge/scripts/test/mono_router_lib_test_runner.bb` | ok |
| `bash swarmforge/scripts/test/test_github_intake_write.sh` | ALL PASS (01–02) |
| `node extension/out/tools/dependency-gate.js` (full repo) | **PASSED**, no forbidden edges |
| parcel scope vs merge-base `4353ec1344` | in-ticket; no unticketed functional files |

BL-560's content is unchanged from round 2 and remains correct.

## Defect (blocking) — `ensure` tears down healthy sessions on a classic pack

`-main` now decides mono-router-ness like this:

```clojure
router? (or (rotation-router-mode?)
            (and socket (mono-router-standing-shape? socket rows)))
```

`mono-router-standing-shape?` returns true when **some** role sessions exist and
**some** do not. That is not a mono-router fingerprint — it is equally the
fingerprint of a **half-launched or partially-crashed classic pack**, which is
the single condition `ensure` exists to repair. The two topologies demand
opposite actions (leave alone vs. repair), so an ambiguous signal must not
select between them.

Once `router?` flips true, every alive role that `classify-role` calls `:dormant`
takes `topology-action`'s `:teardown-illicit` arm, and `ensure-mono-router-role!`
runs `kill-session!` on it.

### Reproduced

Fixture: classic 5-role pack (`coordinator coder cleaner architect QA`), **no**
`rotation router` conf, **no** swarm-identity, fake tmux where every session
exists except `swarmforge-architect` (a half-launch — a real, previously logged
condition). Repro script: `tmp/repro_classic_teardown.sh` in the architect
worktree.

At `c7a7491f30`:

```
agent:coordinator: HEALTHY
agent:coder: HEALTHY
agent:cleaner: FAILED (could not tear down illicit standing session)
agent:architect: DORMANT (mono-router rotate target; no standing session)
agent:QA: FAILED (could not tear down illicit standing session)

tmux kill-session calls made by ensure:
  -S .../fake.sock kill-session -t swarmforge-cleaner
  -S .../fake.sock kill-session -t swarmforge-QA
```

Two healthy agent sessions are killed and the one genuinely-missing session is
reported DORMANT instead of repaired. (The fake tmux keeps answering
`has-session` 0, hence FAILED; against real tmux the kill succeeds and it reports
`FIXED (tore down illicit standing session)`. Either way the kill is issued.)

Same fixture, same script, against the pre-clobber original `7e2498634^`:

```
agent:coordinator: HEALTHY
agent:coder: HEALTHY
agent:cleaner: HEALTHY
agent:architect: HEALTHY
agent:QA: HEALTHY

tmux kill-session calls made by ensure: (none)
```

### This is a widening, not the revert that was asked for

Round 2 said "take the shape from `7e2498634^`". In that file
`mono-router-standing-shape?` occurs **exactly once — its own definition**. It
had zero call sites and its docstring already said *"Deprecated heuristic —
prefer `rotation-router-mode?`"*. `-main` there read simply:

```clojure
router? (rotation-router-mode?)
```

So the original author had already made this decision. The restore un-deprecates
dead code and puts it in the live path.

### The declared signal is reliable, so the fallback buys nothing

`swarmforge/scripts/swarmforge.sh:773-774` writes `rotation\t<value>`,
`launch_pack` and `active_backlog_max_depth_conf_path` into
`.swarmforge/swarm-identity` at every launch. `swarm_ensure.bb` already
`load-file`s `swarm_identity_lib.bb` (line 34), which exposes
`mono-router-project?` — checking `rotation`, `launch_pack` containing
`mono-router`, the `.swarmforge/mono-router-active-role` marker, **and** the
previous pack conf. That is four declared signals, strictly stronger than the
bespoke `rotation-router-mode?` added here, and it already covers the
"identity doesn't name rotation but the pack does" gap the heuristic was
reaching for.

### The new test does not test what it claims

The restored dormant fixture (`test_swarm_ensure.sh:410-413`) writes no
`rotation router` conf and no swarm-identity, so it passes **only** via the shape
heuristic. As written it asserts the unsound path, not mono-router behavior.

### Related open ticket

`backlog/paused/BL-537-mono-router-missing-session-heal.yaml` already owns the
dormant-vs-dead-session question, and its source incident is the mirror image of
this one: *"killing aider tore down coder/specifier sessions; ensure reported
DORMANT and left them gone."* Any live-topology inference belongs there, with a
spec, not folded into BL-530's revert.

## Remediation

1. **Drop the fallback.** `router? (rotation-router-mode?)` — or better, call the
   existing `swarm-identity-lib/mono-router-project?` and delete the bespoke
   `rotation-router-mode?` duplicate. Delete `mono-router-standing-shape?`
   outright rather than leaving re-wirable dead code.
2. **Fix the dormant fixture to declare the pack**, one line:
   `printf 'rotation\trouter\n' > "$ROOT/.swarmforge/swarm-identity"`. Verified:
   with the fallback removed and that line added, the dormant test still passes —
   `agent:specifier: DORMANT`, no respawn.
3. **Add the missing regression test**: classic pack, one session absent, no
   rotation declared → ensure issues **no** `kill-session` and reports no role
   DORMANT. `tmp/repro_classic_teardown.sh` is a working starting point.

Verified in a scratch copy before writing this: with (1) applied, the declared
dormant fixture still reports DORMANT with no respawn, and the classic
half-launch fixture reports all five roles HEALTHY with zero `kill-session`
calls.

## Note on the shared commit

`c7a7491f30` carries **both** BL-530 and BL-560. BL-560 needs no rework, but it
cannot ship on this commit; both are held and re-forward together.

By architect.
