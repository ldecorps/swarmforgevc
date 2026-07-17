#!/usr/bin/env bb
;; BL-486: pure decision logic for the orphaned SwarmForge agent-process
;; reaper - see orphan_agent_reaper_sweep_lib.bb for the thin wiring slice
;; (real /proc scan, tmux window-set enumeration, kill) that calls this.
;; Built on the BL-458 fixture_reaper_lib.bb precedent: a pure `reapable?`
;; over injected decision inputs, with the decapitation guard checked FIRST
;; and winning over every other signal.
;;
;; INCIDENT: onboarding / second-swarm bring-up dry-runs (e.g. FES) launch
;; claude agents with --remote-control SwarmForge-<role> from a
;; /tmp/tmp.XXXX mktemp checkout and do not always tear them down, so
;; long-abandoned agent processes accumulate (a 6h43m-old orphaned coder was
;; found and killed by hand: cwd already `(deleted)`, 0 children, ~0% CPU).
;;
;; GUARDRAILS (same posture as BL-367/BL-458 - a careless reaper can
;; DECAPITATE the running swarm): this predicate NEVER pattern-matches a
;; kill directly - it only judges ONE candidate pid's already-gathered
;; decision inputs, and the live control socket's tmux window set (computed
;; by the wiring against the REAL tracked socket, never inferred here) is
;; checked FIRST, ahead of every other condition, including age.

(ns orphan-agent-reaper-lib)

;; Pure: given one candidate pid's decision inputs, return whether the
;; reaper may kill it. Order matters and is proven by an explicit test case
;; where every other signal says "reap" (engineering.prompt's
;; newly-adjacent-branch rule):
;;   1. in-live-window-set? - the decapitation guard, wins first.
;;   2. cwd-inside-root?    - a live agent's cwd resolves inside this repo's
;;                            own .swarmforge/ root; an orphan's cwd is
;;                            deleted or points elsewhere.
;;   3. remote-control-agent? - candidate SCOPE: only SwarmForge-* remote-
;;                              control claude processes are ever eligible.
;;   4. has-children?       - doing work - never reap.
;;   5. stale?               - too young could be an in-progress dry-run
;;                            (e.g. an active FES bring-up); protects it.
(defn reapable?
  [{:keys [in-live-window-set? cwd-inside-root? remote-control-agent? has-children? stale?]}]
  (cond
    in-live-window-set? false
    cwd-inside-root? false
    (not remote-control-agent?) false
    has-children? false
    (not stale?) false
    :else true))
