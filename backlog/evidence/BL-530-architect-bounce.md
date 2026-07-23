# BL-530 — architect bounce evidence

Reviewed commit: `30de3b6f33` (cleaner) / ticket work in `3d3a8869c` (coder).
Verdict: **SEND BACK to coder.** Architecture is clean; the parcel does not meet
the ticket's acceptance criterion.

## What is correct (keep this work)

- `launch_contract_lib.bb` is genuinely pure — conf text in, data out, no IO — so
  high-level policy stays independent of the filesystem, and the IO (identity
  read, `slurp`) is isolated in `swarm_ensure.bb`. Correct dependency direction,
  and it matches the established "pure lib + thin CLI" split used by
  `backlog_depth_lib.bb`.
- Splitting `raw-config-value` out of `parse-config-value` is a true pure
  refactor (presence vs. defaulted), no behavior change.
- Dependency-rule gate: **PASSED** full-repo, no forbidden edges.
- The decision logic is right on the real corpus. Running
  `launch-contract-violations` across all 24 `swarmforge/packs/*.conf`:
  it flags exactly `cerebras-mono-router.conf` (missing `coordinator_model`) —
  the concrete regression the ticket names — and passes the other 23.
- `launch_contract_test_runner.bb`: ALL PASS. `test_swarm_ensure.sh` 07a/07b/07c
  all pass.

## Defect 1 (blocking) — the guard cannot prevent what it exists to prevent

The ticket's OUTCOME is "**refuse start** or **auto-rewrite launch argv** when
COORDINATOR_MODEL / ROTATION_MODE ... are missing", and its acceptance is
"ensure fails loudly or applies the pack default **before agents start**".
The implementation does neither — it only *reports after the fact*.

In `swarm_ensure.bb` `-main`, the `let` bindings evaluate top to bottom:

```clojure
role-results          (... #(respawn-role! socket role session) ...)   ; STARTS agents
daemon-result         (ensure-component! "daemon" ...)
launch-contract-check (launch-contract-result)                          ; checks AFTER
```

`role-results` calls `respawn-role!`, which actually starts agent panes from
their persisted launch scripts. It is bound **before** `launch-contract-check`.
So on a pack with a broken contract, `./swarm ensure` respawns the coordinator
onto the broken argv — the exact busy-idle thrash BL-512 rank 3 describes — and
*then* prints `launch-contract: FAILED`. The check is purely advisory and fires
after the damage. The code comment even states the design as "no automated
repair", but the ticket offered only two options and neither is "report only".

**Remediation:** evaluate the launch-contract check *before* `role-results`, and
on violations refuse the respawn (skip role repair, exit non-zero) — or apply
the pack default, per the ticket's alternative. Note this is a deliberate
exception to ensure's "never abort on one failed repair" orchestration, so state
it in a comment: refusing to start agents onto a known-broken contract is the
point of the ticket.

Secondary, same area: `swarmforge.sh` / `start-swarm.sh` have **no**
launch-contract check at all (verified by grep). A fresh
`./swarm --pack cerebras-mono-router` starts the broken aider coordinator with
zero validation. The ticket is scoped "ensure-time", so this is not strictly
required — but the guard is much weaker without it, and `swarm_ensure.bb` and
`swarmforge.sh` are the top logical-coupling pair in the co-change report
(13 co-changes), which is the tool telling us these two move together.

## Defect 2 (fix in the same round) — unreadable conf silently reports HEALTHY

```clojure
(defn effective-conf-text []
  (let [path (not-empty (get (...read-swarm-identity...) "active_backlog_max_depth_conf_path"))]
    (when (and path (fs/exists? path)) (slurp (str path)))))
```

When the identity key is absent, or the persisted path no longer resolves, this
returns `nil`. `(launch-contract-violations nil)` returns `[]` — verified — so
the component reports **HEALTHY**. "I could not read the conf" is indistinguishable
from "the contract is fine": the same silent-green this ticket exists to kill.

The in-repo sibling facing the identical problem, `backlog_depth_lib.bb`, resolves
via `(fs/path project-root persisted)` and falls back to `default-conf-relpath`
rather than giving up — with a comment explaining exactly why (roles run from
`.worktrees/<role>`, never project-root).

**Remediation:** match that sibling — resolve the persisted path against
`project-root`, and fall back to the tracked `swarmforge/swarmforge.conf` so the
check always evaluates something real. Test 07a ("no identity file → HEALTHY")
stays green under this fallback, since `swarmforge.conf` uses the default
`claude` coordinator agent and therefore has no contract to violate.

## Property testing

Not applicable to this parcel. The only pure module BL-530 touched is Babashka
(`launch_contract_lib.bb`); the project's property framework is fast-check over
JS `*.property.test.js`. No JS pure module was touched, so no property test is
warranted here rather than a vacuous one.

## Not this parcel (pre-existing — do not fix here)

`test_swarm_ensure.sh`'s final case, "mono-router dormant roles report DORMANT",
FAILS (`expected specifier DORMANT, got ... agent:specifier: HEALTHY`). It fails
**identically at baseline `6159f775d`** (verified in a detached worktree), so it
is pre-existing and not a BL-530 regression. Worth its own ticket.

## Note on the shared commit

`30de3b6f33` carries **both** BL-530 and BL-560 (correctly forwarded as two
handoffs per Article 2.6). The rework must preserve BL-560's content. BL-560
cannot ship on a commit whose BL-530 content is bounced.

By architect.
