#!/usr/bin/env bb
;; BL-849 (invariant 1): "A reaper that cannot enumerate processes on its
;; host reports that it cannot, and never reports zero candidates as a
;; clean sweep." Wiring test against orphan_janitor_sweep_lib.bb and
;; orphan_agent_reaper_sweep_lib.bb's real sweep! - every adapter is
;; injected (never a real process-table scan or kill), covering both:
;;   1. a genuinely empty candidate list ([]) still reports "swept 0" as
;;      before (no regression on the happy path), and
;;   2. an unavailable candidate list (nil, standing in for a real
;;      process-table read failure) is reported as unavailable, never as
;;      "swept 0", and no kill/audit adapter is ever invoked.
(ns orphan-sweep-enumeration-unavailable-test-runner
  (:require [babashka.fs :as fs]))

(def here (fs/parent (fs/canonicalize *file*)))
(load-file (str (fs/path here ".." "orphan_janitor_lib.bb")))
(load-file (str (fs/path here ".." "process_table_lib.bb")))
(load-file (str (fs/path here ".." "orphan_agent_reaper_lib.bb")))
(load-file (str (fs/path here ".." "proc_fd_scan_lib.bb")))
(load-file (str (fs/path here ".." "orphan_agent_reaper_sweep_lib.bb")))
(load-file (str (fs/path here ".." "orphan_janitor_sweep_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true [msg actual]
  (assert= msg true (boolean actual)))

(defn assert-false [msg actual]
  (assert= msg false (boolean actual)))

;; Records every call the sweep makes into the adapter map so assertions
;; can check "kill/audit were never reached" precisely, not just infer it
;; from a lack of side effects.
(defn make-recorder []
  (let [calls (atom {:kills [] :audits [] :logs []})]
    {:calls calls
     :adapters
     {:cmdline! (fn [_] "")
      :cwd! (fn [_] nil)
      :has-children?! (fn [_] false)
      :age-ms! (fn [_] 0)
      :live-window-pid-set! (fn [] #{})
      :live-runtime-pid! (fn [] nil)
      :kill-pid! (fn [pid] (swap! calls update :kills conj pid))
      :audit! (fn [line] (swap! calls update :audits conj line))
      :log! (fn [msg] (swap! calls update :logs conj msg))}}))

;; ── orphan-janitor-sweep-lib ──────────────────────────────────────────────

(let [{:keys [calls adapters]} (make-recorder)
      adapters (assoc adapters :list-candidate-pids! (fn [] []))]
  (orphan-janitor-sweep-lib/sweep! "/irrelevant" adapters)
  (assert= "janitor: empty candidate list still reports swept 0 (no regression)"
           ["swept 0 candidate(s), reaped 0"]
           (:logs @calls))
  (assert= "janitor: no kills for an empty candidate list" [] (:kills @calls)))

(let [{:keys [calls adapters]} (make-recorder)
      adapters (assoc adapters :list-candidate-pids! (fn [] nil))]
  (orphan-janitor-sweep-lib/sweep! "/irrelevant" adapters)
  (assert-true "janitor: nil candidates reports the check unavailable"
               (some #(clojure.string/includes? % "unavailable") (:logs @calls)))
  (assert-false "janitor: nil candidates never claims a sweep count"
                (some #(clojure.string/includes? % "swept") (:logs @calls)))
  (assert= "janitor: no kills when enumeration is unavailable" [] (:kills @calls))
  (assert= "janitor: no audit entries when enumeration is unavailable" [] (:audits @calls)))

;; A live, reapable candidate is still reaped when candidates is a REAL
;; (non-nil) vector - proves the nil-check doesn't accidentally also
;; suppress the ordinary reap path for a genuinely present candidate.
(let [{:keys [calls adapters]} (make-recorder)
      adapters (-> adapters
                   (assoc :list-candidate-pids! (fn [] [4242]))
                   (assoc :cmdline! (fn [_] "bb /x/swarmforge/scripts/operator_runtime.bb /tmp/tmp.abc"))
                   (assoc :age-ms! (fn [_] 999999999)))]
  (orphan-janitor-sweep-lib/sweep! "/irrelevant" adapters)
  (assert= "janitor: a genuine stale tmp-rooted candidate is still reaped"
           [4242] (:kills @calls)))

;; ── orphan-agent-reaper-sweep-lib ───────────────────────────────────────

(let [{:keys [calls adapters]} (make-recorder)
      adapters (assoc adapters :list-candidate-pids! (fn [] []))]
  (orphan-agent-reaper-sweep-lib/sweep! "/irrelevant" adapters)
  (assert= "agent-reaper: empty candidate list still reports swept 0 (no regression)"
           ["swept 0 candidate(s), reaped 0"]
           (:logs @calls)))

(let [{:keys [calls adapters]} (make-recorder)
      adapters (assoc adapters :list-candidate-pids! (fn [] nil))]
  (orphan-agent-reaper-sweep-lib/sweep! "/irrelevant" adapters)
  (assert-true "agent-reaper: nil candidates reports the check unavailable"
               (some #(clojure.string/includes? % "unavailable") (:logs @calls)))
  (assert-false "agent-reaper: nil candidates never claims a sweep count"
                (some #(clojure.string/includes? % "swept") (:logs @calls)))
  (assert= "agent-reaper: no kills when enumeration is unavailable" [] (:kills @calls))
  (assert= "agent-reaper: no audit entries when enumeration is unavailable" [] (:audits @calls)))

;; ── process_table_lib's own contract: nil, not [], distinguishes failure ──
;; (Cannot force a REAL enumeration failure portably from a test - that is
;; exactly why the sweep-level tests above inject the failure at the
;; adapter boundary. This just pins the documented, load-bearing contract:
;; list-processes! / list-pids! never coerce nil into [].)
(assert-true "process-table-lib/list-processes! returns a real (non-nil) vector on this live host"
             (vector? (process-table-lib/list-processes!)))
(assert-true "process-table-lib/list-pids! returns a real (non-nil) vector on this live host"
             (vector? (process-table-lib/list-pids!)))

(if (seq @failures)
  (do (doseq [f @failures] (println f))
      (System/exit 1))
  (println "orphan_sweep_enumeration_unavailable_test_runner: ALL CHECKS PASSED"))
