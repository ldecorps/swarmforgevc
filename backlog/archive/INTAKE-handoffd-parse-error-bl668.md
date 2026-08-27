# ARCHIVED — drained by specifier 2026-08-27

Disposition: minted `backlog/paused/BL-1163-handoffd-parse-error-bl668-paren-hotfix.yaml`
(CRIT expedite; human pre-approved).

---

# INTAKE — handoffd down: parse error in handoffd.bb (BL-668 paren hotfix)

**Source:** operator/Cursor Auto, 2026-08-27 ~00:19 BST (BL-741 blocked)  
**Status:** new intake, not minted. **CRIT hotfix** — restore handoffd before
anything else.  
**Priority:** CRIT — no deliveries, chases, reconcile, or tmux inject until fixed.

## Symptom

Babysitter: `handoffd.bb not running`. `start_handoff_daemon.sh` fails:
`handoffd failed to claim handoffd.pid`.

## Root cause

Commit `f5b6b49f1` (`feat(BL-668): post-QA sweep fast-forwards clean role branches`)
introduced a **syntax error** in `swarmforge/scripts/handoffd.bb`:

```
EOF while reading, expected ) to match ( at [3213,1]
```

`post-qa-branch-sweep-role-dirty?` (line 3208) is **missing two closing parens**
on line 3211 — the `let` and `defn` bodies are not closed before the next
`defn` at 3213.

## Evidence

- `handoffd.log` and `bb swarmforge/scripts/handoffd.bb <project-root>` both show parse failure.
- `daemon-start-audit.log`: SUCCESS at 22:48:06Z, first FAILED at 22:49:00Z (after BL-668 landed).
- Parent commit `f5b6b49f1^`: handoffd starts cleanly.

## Fix (one line)

Line 3211 should end with **six** closing parens, not four:

```clojure
    (and (zero? exit) (not (str/blank? (str/trim out))))))
```

## Ops already tried

Coordinator ran `start_handoff_daemon.sh /home/carillon/swarmforgevc` — refused (expected).

## Request

Coder hotfix on main, then `start_handoff_daemon.sh` only to restore daemon.
