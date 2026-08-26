#!/usr/bin/env bb
;; BL-906: PROPERTY tests over babysitterd_freshness_lib.bb, covering the
;; three invariants the ticket YAML declares (coder-authored first, per
;; BL-654; this is a bounce-round-2 remediation - architect's evidence:
;; backlog/evidence/BL-906-swarm-stamp-operator-babysitterd-freshness-watchdog-bounce-20260817.md):
;;
;;   P1 classify-never-restarts - invariant 1's pure-layer component ("The
;;      Operator runtime never starts, restarts, or spawns a babysitterd
;;      process on any code path... its only outputs are a coordinator note
;;      and a status.json field"): across every generated
;;      {:enabled? :live-pid :pidfile-alive? :telegram-creds?} combination,
;;      classify's :action is always :tell or :none, never :restart. (The
;;      other half of invariant 1 - operator_runtime.bb never calling
;;      start_babysitterd.sh - is grep-checkable, not a runtime property of
;;      this pure module; the architect's own review already re-confirmed
;;      the grep.)
;;   P2 state-priority-and-process-truth-only - invariant 3 ("Every reported
;;      state is derived from observed process truth; the pidfile is
;;      corroborating evidence, never the sole source"): across the full
;;      generated input space, classify's :state exactly matches the
;;      documented priority (down > pidfile-lie > announce-mute > healthy,
;;      gated by enabled?) computed independently here from the same four
;;      inputs alone - proving the state is a pure function of exactly the
;;      declared observed-process-truth fields, nothing else.
;;   P3 pidfile-unlinked-only-by-the-process-it-names - invariant 2 ("A
;;      pidfile is only ever removed by the process it names, so a second
;;      launch can never make a live daemon report DOWN"), via
;;      should-unlink-pidfile?, the pure twin of babysitterd.sh's own EXIT
;;      trap: across random recorded pidfile content (matching own pid with
;;      assorted whitespace, matching a DIFFERENT pid, blank, nil) and
;;      random own-pid values, the predicate is true if and only if the
;;      trimmed recorded content equals own-pid as a string. This is the
;;      exact live regression the ticket exists to fix: a second launch
;;      racing the missing-pidfile window overwrites the file with a
;;      different pid before the original process's EXIT trap fires - the
;;      original must NOT unlink a pidfile that no longer names it.
;;
;; Seeded (not wall-clock) randomness so failures reproduce: a fixed-seed
;; java.util.Random, never rand/rand-int's unseeded global generator - same
;; idiom as babysitterd_sweep_lib_property_runner.bb.

(ns babysitterd-freshness-lib-property-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "babysitterd_freshness_lib.bb")))
(require '[babysitterd-freshness-lib :as bf])

(def failures (atom []))

(defn assert-true [msg expr]
  (when-not expr
    (swap! failures conj (str "FAIL: " msg))))

(def ^:private rng (java.util.Random. 906))
(defn- rbool [] (.nextBoolean rng))
(defn- rint [bound] (.nextInt rng (int bound)))

;; ── P1: classify-never-restarts ──────────────────────────────────────────
;; Generator MUST demonstrably reach every state the invariant quantifies
;; over (disabled/down/pidfile-lie/announce-mute/healthy), not just a lucky
;; slice - tracked so a shallow generator fails loudly rather than passing
;; by omission.

(def p1-states-hit (atom #{}))

(defn- gen-classify-snapshot []
  (let [enabled? (rbool)
        live-pid (when (rbool) (inc (rint 90000)))
        pidfile-alive? (rbool)
        telegram-creds? (rbool)]
    {:enabled? enabled? :live-pid live-pid
     :pidfile-alive? pidfile-alive? :telegram-creds? telegram-creds?}))

(dotimes [_ 1000]
  (let [snap (gen-classify-snapshot)
        result (bf/classify snap)]
    (swap! p1-states-hit conj (:state result))
    (assert-true (str "classify never returns :restart for " (pr-str snap) " (got " (pr-str result) ")")
                 (not= :restart (:action result)))
    (assert-true (str "classify's :action is only :tell or :none for " (pr-str snap))
                 (contains? #{:tell :none} (:action result)))))

(assert-true "P1 generator reached all five classify states"
             (= #{"disabled" "down" "pidfile-lie" "announce-mute" "healthy"} @p1-states-hit))

;; ── P2: state-priority-and-process-truth-only ────────────────────────────
;; Independently re-derive the expected state from exactly the four declared
;; inputs, using the priority order the ticket's own qa_e2e_procedure names
;; (down > pidfile-lie > announce-mute > healthy, gated by enabled?), and
;; assert classify agrees for every generated combination - proving the
;; state depends on nothing outside these observed-process-truth fields.

(defn- expected-state [{:keys [enabled? live-pid pidfile-alive? telegram-creds?]}]
  (cond
    (not enabled?) "disabled"
    (nil? live-pid) "down"
    (not pidfile-alive?) "pidfile-lie"
    (not telegram-creds?) "announce-mute"
    :else "healthy"))

(def p2-states-hit (atom #{}))

(dotimes [_ 1000]
  (let [snap (gen-classify-snapshot)
        result (bf/classify snap)
        want (expected-state snap)]
    (swap! p2-states-hit conj want)
    (assert-true (str "classify's state matches the declared priority for " (pr-str snap)
                       " (want " want ", got " (:state result) ")")
                 (= want (:state result)))))

(assert-true "P2 generator reached all five priority-derived states"
             (= #{"disabled" "down" "pidfile-lie" "announce-mute" "healthy"} @p2-states-hit))

;; ── P3: pidfile-unlinked-only-by-the-process-it-names ────────────────────
;; Covers both directions: recorded content that DOES name own-pid (with
;; assorted whitespace, matching the trap's `tr -d "[:space:]"` normalization)
;; must unlink; anything else (a different pid, blank, nil) must not - this
;; is the exact live regression (a racing second launch's pidfile overwrite)
;; the ticket exists to fix.

(def p3-branches-hit (atom #{}))

(defn- whitespace-pad [s]
  ;; Mirrors the range of raw pidfile bytes tr -d "[:space:]" was written to
  ;; normalize: trailing newline (the common `echo $$ > PIDFILE` case),
  ;; leading/trailing spaces, or none at all.
  (case (rint 4)
    0 s
    1 (str s "\n")
    2 (str "  " s "  ")
    3 (str s "\n\n")))

(defn- gen-pidfile-case []
  (let [own-pid (inc (rint 90000))
        matches? (rbool)]
    (if matches?
      (let [recorded (whitespace-pad (str own-pid))]
        (swap! p3-branches-hit conj :matches)
        {:own-pid own-pid :recorded recorded :expect true})
      (let [kind (rint 3)]
        (swap! p3-branches-hit conj :non-matches)
        (case kind
          0 {:own-pid own-pid :recorded (whitespace-pad (str (inc (+ own-pid (rint 5000))))) :expect false}
          1 {:own-pid own-pid :recorded "" :expect false}
          2 {:own-pid own-pid :recorded nil :expect false})))))

(dotimes [_ 500]
  (let [{:keys [own-pid recorded expect]} (gen-pidfile-case)
        got (bf/should-unlink-pidfile? recorded own-pid)]
    (assert-true (str "should-unlink-pidfile? recorded=" (pr-str recorded) " own-pid=" own-pid
                       " expected " expect " got " got)
                 (= expect got))))

(assert-true "P3 generator reached both a matching and a non-matching recorded pidfile"
             (and (contains? @p3-branches-hit :matches)
                  (contains? @p3-branches-hit :non-matches)))

;; A second launch racing the missing-pidfile window: the original process's
;; pid is no longer what the file names once it has been overwritten - the
;; exact live failure. Fixed, non-random case pinning that scenario down.
(assert-true "a pidfile overwritten by a racing second launch is never unlinked by the original"
             (not (bf/should-unlink-pidfile? "38002\n" 33001)))
(assert-true "a pidfile still naming this process (with trailing newline, the real echo $$ shape) is unlinked"
             (bf/should-unlink-pidfile? "33001\n" 33001))

(when (seq @failures)
  (binding [*out* *err*]
    (doseq [f @failures] (println f)))
  (System/exit 1))

(println "babysitterd_freshness_lib_property_runner: ok")
