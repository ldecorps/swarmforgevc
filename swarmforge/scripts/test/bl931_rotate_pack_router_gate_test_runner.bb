#!/usr/bin/env bb
;; BL-931: TDD runner for the pack-router gate - mono_router_lib.bb's new
;; resolve-rotation-router-mode? (the lift: invariant 1's ONE resolution,
;; replacing what handoffd.bb/swarm_ensure.bb/babysitter_check.bb/
;; swarm_status.bb each hand-copy today) and handoff_lib.bb's
;; rotate-resident-to!, gated on it (invariant 2/3). Pure filesystem only -
;; no tmux, no real swarm state. rotate-resident-to!'s REFUSAL path never
;; touches tmux at all (it returns before the first sh/sh call), so its
;; negative cases are testable here directly; the positive "still rotates
;; on a router pack" cases need a real fake-tmux fixture and live in
;; test_rotate_pack_router_gate.sh, matching this project's established
;; "pure logic here, real-fixture wiring there" split (bl911's own file
;; header names the same split for recompose-role-prompt!).

(ns bl931-rotate-pack-router-gate-test-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "handoff_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(def created-temp-dirs (atom []))
(.addShutdownHook (Runtime/getRuntime)
                   (Thread. (fn [] (doseq [d @created-temp-dirs] (try (fs/delete-tree d) (catch Exception _ nil))))))

(defn mk-tmp-dir []
  (let [d (str (fs/create-temp-dir {:prefix "sfvc-bl931-pack-router-"}))]
    (swap! created-temp-dirs conj d)
    d))

;; Every assertion runs against its own disposable fixture root (never this
;; real worktree's .swarmforge/) via handoff-lib/set-project-root!.
(defn fixture-root! []
  (let [root (mk-tmp-dir)]
    (fs/create-dirs (fs/path root ".swarmforge"))
    (handoff-lib/set-project-root! root)
    root))

(defn write-default-conf! [root text]
  (fs/create-dirs (fs/path root "swarmforge"))
  (spit (str (fs/path root "swarmforge" "swarmforge.conf")) text))

(defn write-identity! [root text]
  (spit (str (fs/path root ".swarmforge" "swarm-identity")) text))

;; ── mono-router-lib/resolve-rotation-router-mode? ─────────────────────────

;; 01: no conf, no identity - fails closed (not a router pack).
(let [root (fixture-root!)]
  (assert= "01: no conf and no identity file resolves to false (fail closed)"
           false
           (mono-router-lib/resolve-rotation-router-mode?
            (str (fs/path root ".swarmforge"))
            (str (fs/path root "swarmforge" "swarmforge.conf")))))

;; 02: default conf declares rotation router.
(let [root (fixture-root!)]
  (write-default-conf! root "config active_backlog_max_depth 2\nconfig rotation router\n")
  (assert= "02: default conf with 'config rotation router' resolves to true"
           true
           (mono-router-lib/resolve-rotation-router-mode?
            (str (fs/path root ".swarmforge"))
            (str (fs/path root "swarmforge" "swarmforge.conf")))))

;; 03: default conf with no rotation line - standing pack.
(let [root (fixture-root!)]
  (write-default-conf! root "config active_backlog_max_depth 3\nwindow specifier claude master\n")
  (assert= "03: default conf with no rotation line resolves to false"
           false
           (mono-router-lib/resolve-rotation-router-mode?
            (str (fs/path root ".swarmforge"))
            (str (fs/path root "swarmforge" "swarmforge.conf")))))

;; 04: swarm-identity records rotation=router directly - no conf needed.
(let [root (fixture-root!)]
  (write-identity! root "launch_pack\tmono-router\nrotation\trouter\n")
  (assert= "04: swarm-identity's rotation=router resolves to true even with no conf on disk"
           true
           (mono-router-lib/resolve-rotation-router-mode?
            (str (fs/path root ".swarmforge"))
            (str (fs/path root "swarmforge" "swarmforge.conf")))))

;; 05: swarm-identity names a DIFFERENT conf path (the persisted active pack
;;     conf) that itself declares rotation router - the middle resolution
;;     branch (invariant 1's "else the persisted active pack conf").
(let [root (fixture-root!)
      alt-conf (str (fs/path root "swarmforge" "packs" "mono-router.conf"))]
  (fs/create-dirs (fs/path root "swarmforge" "packs"))
  (spit alt-conf "config rotation router\n")
  (write-identity! root (str "launch_pack\tmono-router\nactive_backlog_max_depth_conf_path\t" alt-conf "\n"))
  ;; The DEFAULT conf path, if read directly, would say false - proving this
  ;; case is exercised only via the identity-recorded override, not by luck.
  (write-default-conf! root "config active_backlog_max_depth 3\n")
  (assert= "05: swarm-identity's persisted active pack conf path is read over the default"
           true
           (mono-router-lib/resolve-rotation-router-mode?
            (str (fs/path root ".swarmforge"))
            (str (fs/path root "swarmforge" "swarmforge.conf")))))

;; 06: swarm-identity present but says nothing about rotation - falls
;;     through to the default conf, which IS a router conf.
(let [root (fixture-root!)]
  (write-identity! root "launch_pack\tfull-forge\n")
  (write-default-conf! root "config rotation router\n")
  (assert= "06: identity with no rotation key falls through to the default conf"
           true
           (mono-router-lib/resolve-rotation-router-mode?
            (str (fs/path root ".swarmforge"))
            (str (fs/path root "swarmforge" "swarmforge.conf")))))

;; ── handoff-lib/rotate-resident-to! - the gate itself ─────────────────────
;; Every case below refuses BEFORE rotate-resident-to! ever shells to tmux
;; (the gate is checked first), so none of these needs a fake tmux on PATH.

;; 07: standing pack (no conf at all) refuses with the new reason, whatever
;;     the target role - roles.tsv is not even written, proving the refusal
;;     happens before session/script resolution too.
(let [root (fixture-root!)]
  (assert= "07: rotate-resident-to! refuses outright on a standing (non-router) pack"
           {:ok false :reason "not-a-rotation-router"}
           (handoff-lib/rotate-resident-to! "architect")))

;; 08: a router pack is let THROUGH the gate - it still fails downstream
;;     (no roles.tsv/tmux socket in this fixture), but with a DIFFERENT
;;     reason, proving the gate itself did not refuse. Distinguishes "the
;;     gate correctly detected router mode" from "the gate always refuses
;;     regardless of input" (a mutant hardcoding the refusal branch true
;;     would still pass 07 alone, since 07's fixture is genuinely
;;     non-router - confirmed by hand: exactly that mutant left this
;;     assertion the only one still failing).
(let [root (fixture-root!)]
  (write-default-conf! root "config rotation router\n")
  (spit (str (fs/path root ".swarmforge" "tmux-socket")) "/tmp/does-not-matter.sock")
  ;; No roles.tsv at all -> mono-router-resident-session finds no
  ;; non-coordinator row -> "no-resident-session", never the pack reason.
  (assert= "08: a router pack is let through the gate (fails later, for a different reason)"
           {:ok false :reason "no-resident-session"}
           (handoff-lib/rotate-resident-to! "architect")))

;; SWARMFORGE_ROTATE_FORCE=1 does not reach rotate-resident-to! at all - it
;; is respawn-as!'s own override for the DEPARTING-role stuck-parcel gate
;; (BL-805), a different concern the ticket's own text explicitly declines
;; to overload ("a refusal with no escape hatch is the honest shape"). That
;; the override does NOT unlock the pack gate is proven end-to-end with a
;; real env var and real tmux in test_rotate_pack_router_gate.sh scenario
;; 04 - a real subprocess is the only honest way to set an env var for this
;; check, so it belongs in the shell fixture, not restated vacuously here.

(if (seq @failures)
  (do (doseq [f @failures] (println f))
      (System/exit 1))
  (println "bl931_rotate_pack_router_gate_test_runner: ALL CHECKS PASSED"))
