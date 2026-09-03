#!/usr/bin/env bb
;; BL-1345: the two halves the RC-repair hotfix did not touch - the health
;; sweep reading the resident marker on a standing pack, and a recheck that
;; called a wrongly-respawned pane healthy.

(ns bl1345-stale-marker-test-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(def script-dir (str (fs/parent (fs/canonicalize *file*))))
(load-file (str (fs/path script-dir ".." "mono_router_lib.bb")))
(load-file (str (fs/path script-dir ".." "remote_control_health_lib.bb")))

(def failures (atom []))
(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))
(defn assert-nil [msg actual] (assert= msg nil actual))

;; The sweep's own resolution, as babysitter_check.bb now composes it: the
;; shared decision, then "is this actually one of our roles".
(defn- sweep-resident [{:keys [rotation-router? marker ordered-roles home]}]
  (let [d (mono-router-lib/resolve-resident-role
           {:rotation-router? rotation-router? :recorded-role marker :home-role home})
        candidate (when (:honour-marker? d) (:role d))]
    (when (some #(= candidate %) ordered-roles) candidate)))

(def roles ["specifier" "coder" "cleaner" "QA"])

;; ── scenario 01: a standing pack derives no resident from a leftover ─────
(assert-nil "a leftover marker names no resident on a standing pack"
            (sweep-resident {:rotation-router? false :marker "coordinator"
                             :ordered-roles roles :home "specifier"}))

;; ── scenario 02 (the regression guard): a router pack STILL resolves ─────
(assert= "a router pack still honours the marker" "coder"
         (sweep-resident {:rotation-router? true :marker "coder"
                          :ordered-roles roles :home "specifier"}))

;; ── scenario 05 / invariant 3: unusable markers change nothing ───────────
(doseq [[label marker] [["absent" nil] ["blank (unreadable)" "   "] ["unknown role" "nosuchrole"]]]
  (assert-nil (str "a " label " marker names no resident on a standing pack")
              (sweep-resident {:rotation-router? false :marker marker
                               :ordered-roles roles :home "specifier"}))
  (assert-nil (str "a " label " marker names no resident on a ROUTER pack either")
              (sweep-resident {:rotation-router? true :marker marker
                               :ordered-roles roles :home "specifier"})))

;; ── scenario 03: a pane running the wrong role is not healthy ────────────
(let [m (remote-control-health/assigned-role-mismatch
         {:rotation-router? false :pane "swarmforge-specifier"
          :assigned-rc-name "SwarmForge-Specifier" :observed-rc-name "SwarmForge-Coordinator"})]
  (assert= "a wrong-role pane is reported as a mismatch"
           {:pane "swarmforge-specifier" :expected "SwarmForge-Specifier" :observed "SwarmForge-Coordinator"} m))

;; ── scenario 04: a correctly staffed pane still passes ───────────────────
(assert-nil "a correctly staffed pane is not a mismatch"
            (remote-control-health/assigned-role-mismatch
             {:rotation-router? false :pane "swarmforge-coder"
              :assigned-rc-name "SwarmForge-Coder" :observed-rc-name "SwarmForge-Coder"}))

;; A rotated resident on a ROUTER pack is legitimate, not a mismatch.
(assert-nil "a rotated resident on a router pack is not a mismatch"
            (remote-control-health/assigned-role-mismatch
             {:rotation-router? true :pane "swarmforge-coder"
              :assigned-rc-name "SwarmForge-Coder" :observed-rc-name "SwarmForge-Cleaner"}))

;; No observed name is the pane-liveness check's job, not a mismatch; no
;; expected name is a role whose launch script carries no RC flag.
(assert-nil "no observed name is not a mismatch"
            (remote-control-health/assigned-role-mismatch
             {:rotation-router? false :pane "p" :assigned-rc-name "A" :observed-rc-name nil}))
(assert-nil "no expected name is not a mismatch"
            (remote-control-health/assigned-role-mismatch
             {:rotation-router? false :pane "p" :assigned-rc-name nil :observed-rc-name "B"}))

(if (seq @failures)
  (do (doseq [f @failures] (println f))
      (println (str (count @failures) " failure(s)"))
      (System/exit 1))
  (println "ALL PASS: BL-1345 stale marker"))
